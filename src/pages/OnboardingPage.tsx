// ============================================================
// CADENCE — Onboarding Flow Component
//
// This is the production-ready onboarding flow that can be used:
// 1. As a standalone page for new users (public onboarding)
// 2. Embedded in the dashboard for "New Release" flow (logged-in users)
//
// Key features:
// - 60-second flow: 5 screens to value
// - Mobile responsive (768px breakpoint)
// - Supabase integration for release + task creation
// - 3 timeline visualizations
// - 3 AI personality variations
// - Logged-in variant skips account creation
// ============================================================

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { buildReleaseTaskPayload, TEMPLATES, type ReleaseType } from '../lib/releaseTemplates'
import DraggableTimeline, { type DraggableTask } from '../components/DraggableTimeline'
import Phase2Prompts, { type Phase2Answers } from '../components/Phase2Prompts'
import StalledProjectModal from '../components/StalledProjectModal'

// ============================================================
// Constants
// ============================================================

const AI_PERSONALITIES = {
  invisible: {
    masteringWarning: 'Mastering usually takes 5–7 days.',
    masteringWarningCTA: 'Adjust timeline',
  },
  friendly: {
    masteringWarning: 'Hey — most mastering takes 5–7 days. Your current timeline might be tight. Want to adjust?',
    masteringWarningCTA: 'Yes, adjust it',
  },
  strategist: {
    masteringWarning: 'Industry standard: mastering takes 5–7 days. Current buffer: 3 days.',
    masteringWarningCTA: 'Extend to 7 days',
  },
}

const PROGRESS_OPTIONS = [
  { key: 'recording', label: 'Recording done' },
  { key: 'mix_delivery', label: 'Mixed' },
  { key: 'master_delivery', label: 'Mastered' },
  { key: 'artwork_final', label: 'Artwork ready' },
]

// ============================================================
// Helper Functions
// ============================================================

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}


function generatePreviewTasks(releaseType: ReleaseType, releaseDate: string, doneKeys: string[]): DraggableTask[] {
  const template = TEMPLATES[releaseType] || TEMPLATES.Single
  return template.slice(0, 9).map(t => ({
    key: t.key,
    id: t.key,
    title: t.title,
    phase: t.phase,
    effort: t.effortHours,
    dueDate: addDays(releaseDate, t.dueDateOffset),
    status: doneKeys.includes(t.key) ? 'complete' : 'pending',
  }))
}


// ============================================================
// Main Onboarding Component
// ============================================================

export default function OnboardingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const isLoggedIn = !!user

  // ── Stalled project detection via URL params ─────────────────
  // Dashboard can link to /releases/new?stalledTitle=...&stalledDays=10&stalledDate=2026-08-01&stalledReleaseId=xxx
  const stalledTitle = searchParams.get('stalledTitle')
  const stalledDays = parseInt(searchParams.get('stalledDays') ?? '0', 10)
  const stalledDate = searchParams.get('stalledDate')
  const stalledReleaseId = searchParams.get('stalledReleaseId')
  const hasStalledProject = !!stalledTitle && stalledDays >= 10
  const [showStalledModal, setShowStalledModal] = useState(hasStalledProject)

  const [screen, setScreen] = useState(1)
  const [releaseType, setReleaseType] = useState<ReleaseType>('Single')
  const [releaseDate, setReleaseDate] = useState('')
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [doneTasks, setDoneTasks] = useState<string[]>([])
  const [tasks, setTasks] = useState<DraggableTask[]>([])
  const [showAIWarning, setShowAIWarning] = useState(false)
  const [phase2Answers, setPhase2Answers] = useState<Phase2Answers>({})
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // AI personality - could be user preference in future
  const [_aiPersonality] = useState<keyof typeof AI_PERSONALITIES>('invisible')

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const handleGenerate = () => {
    if (!releaseDate) {
      setError('Please select a release date')
      return
    }
    const generatedTasks = generatePreviewTasks(releaseType, releaseDate, doneTasks)
    setTasks(generatedTasks)
    setScreen(4)
    setTimeout(() => setShowAIWarning(true), 1500)
  }

  const handleCreateRelease = async () => {
    setLoading(true)
    setError(null)

    try {
      // Get current user
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      
      if (!currentUser) {
        // Not logged in - move to signup screen
        setScreen(5)
        setLoading(false)
        return
      }

      // 1. Create release
      const { data: release, error: releaseError } = await supabase
        .from('releases')
        .insert({
          title: title.trim() || `${releaseType} Release`,
          artist: artist.trim() || null,
          release_date: releaseDate,
          release_type: releaseType,
          user_id: currentUser.id,
        })
        .select('id')
        .single()

      if (releaseError || !release) {
        throw new Error(releaseError?.message ?? 'Failed to create release')
      }

      // 2. Generate tasks
      const { tasks: taskPayload } = buildReleaseTaskPayload(
        releaseType,
        releaseDate,
        release.id,
        currentUser.id
      )

      // Mark done tasks as complete
      const tasksWithStatus = taskPayload.map(t => ({
        ...t,
        status: doneTasks.includes(t.template_key) ? 'complete' as const : 'pending' as const,
      }))

      const { data: insertedTasks, error: tasksError } = await supabase
        .from('tasks')
        .insert(tasksWithStatus)
        .select('id, template_key')

      if (tasksError) {
        throw new Error(tasksError.message)
      }

      // 3. Insert dependencies
      const keyToId = new Map<string, string>()
      insertedTasks?.forEach(t => {
        if (t.template_key) keyToId.set(t.template_key, t.id)
      })

      const template = TEMPLATES[releaseType]
      const depInserts: { task_id: string; depends_on_task_id: string; lag_days: number }[] = []

      for (const tmplTask of template) {
        const taskId = keyToId.get(tmplTask.key)
        if (!taskId) continue
        for (const depKey of tmplTask.dependsOn) {
          const depId = keyToId.get(depKey)
          if (!depId) continue
          depInserts.push({
            task_id: taskId,
            depends_on_task_id: depId,
            lag_days: tmplTask.lagDays ?? 0,
          })
        }
      }

      if (depInserts.length > 0) {
        await supabase.from('task_dependencies').insert(depInserts)
      }

      // Success! Navigate to release detail page
      navigate(`/releases/${release.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  const handleSignup = async () => {
    if (!email) {
      setError('Please enter your email')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { error: signupError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
      })

      if (signupError) {
        throw signupError
      }

      // Show success message and wait for email verification
      alert('Check your email for a magic link to sign in!')
      // In production, show a better success state
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link')
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Stalled project modal — shown when navigated here from dashboard with ?stalled params */}
      {showStalledModal && stalledTitle && (
        <StalledProjectModal
          projectTitle={stalledTitle}
          daysSinceLastVisit={stalledDays}
          releaseDate={stalledDate}
          onAction={(action) => {
            setShowStalledModal(false)
            if (action === 'resume' && stalledReleaseId) {
              navigate(`/releases/${stalledReleaseId}`)
            }
            // postpone / hold: dismiss modal, continue to new release flow
          }}
        />
      )}
      {/* Header */}
      <header
        style={{
          padding: isMobile ? '16px 20px' : '20px 32px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, maxWidth: 1200, margin: '0 auto' }}>
          <div
            style={{
              width: isMobile ? 28 : 32,
              height: isMobile ? 28 : 32,
              borderRadius: 8,
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width={isMobile ? 16 : 18} height={isMobile ? 16 : 18} viewBox="0 0 18 18" fill="none">
              <path d="M9 2L9 16M5 6L9 2L13 6M5 12L9 16L13 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Cadence</h1>
          {screen > 1 && (
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: 4,
                padding: '4px 6px',
                background: 'var(--color-surface-2)',
                borderRadius: 8,
              }}
            >
              {[1, 2, 3, 4, 5].map(s => (
                <div
                  key={s}
                  style={{
                    width: s <= screen ? 32 : 8,
                    height: 4,
                    borderRadius: 2,
                    background: s <= screen ? 'var(--color-accent)' : 'var(--color-border)',
                    transition: 'all 0.3s',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '24px 20px' : '40px 20px' }}>
        {/* Screen 1: What are you working on? */}
        {screen === 1 && (
          <div className="animate-in" style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
            <h2 style={{ fontSize: isMobile ? 24 : 32, fontWeight: 700, marginBottom: isMobile ? 8 : 12, lineHeight: 1.2 }}>
              What are you working on?
            </h2>
            <p style={{ fontSize: isMobile ? 13 : 14, color: 'var(--color-text-muted)', marginBottom: isMobile ? 28 : 40 }}>
              We'll build your timeline in seconds.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(['Single', 'EP', 'Album'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => {
                    setReleaseType(type)
                    setScreen(2)
                  }}
                  style={{
                    padding: '20px 24px',
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--border-radius-xl)',
                    color: 'var(--color-text)',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    textAlign: 'left',
                  }}
                >
                  I'm releasing a {type.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Screen 2: Release date & title */}
        {screen === 2 && (
          <div className="animate-in" style={{ maxWidth: 480, width: '100%' }}>
            <h2 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
              When is the release?
            </h2>
            <p style={{ fontSize: isMobile ? 13 : 14, color: 'var(--color-text-muted)', marginBottom: isMobile ? 24 : 32, textAlign: 'center' }}>
              We'll work backward from your target date.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <input
                type="date"
                value={releaseDate}
                onChange={(e) => setReleaseDate(e.target.value)}
                style={{
                  padding: '16px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--border-radius-md)',
                  color: 'var(--color-text)',
                  fontSize: 16,
                  outline: 'none',
                }}
              />

              <input
                type="text"
                placeholder={releaseType === 'Single' ? 'e.g. Midnight' : 'e.g. Midnight Sessions'}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  padding: '16px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--border-radius-md)',
                  color: 'var(--color-text)',
                  fontSize: 16,
                  outline: 'none',
                }}
              />

              <input
                type="text"
                placeholder="Artist name (optional)"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                style={{
                  padding: '16px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--border-radius-md)',
                  color: 'var(--color-text)',
                  fontSize: 16,
                  outline: 'none',
                }}
              />

              {error && (
                <p style={{ fontSize: 12, color: '#f87171', padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8 }}>
                  {error}
                </p>
              )}

              <button
                onClick={() => setScreen(3)}
                style={{
                  padding: '16px',
                  background: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 'var(--border-radius-md)',
                  color: 'white',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: 8,
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Screen 3: What's done? */}
        {screen === 3 && (
          <div className="animate-in" style={{ maxWidth: 480, width: '100%' }}>
            <h2 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
              What's already done?
            </h2>
            <p style={{ fontSize: isMobile ? 13 : 14, color: 'var(--color-text-muted)', marginBottom: isMobile ? 24 : 32, textAlign: 'center' }}>
              Check off completed steps — we'll start your plan from there.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {PROGRESS_OPTIONS.map(opt => {
                const isChecked = doneTasks.includes(opt.key)

                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setDoneTasks(prev =>
                        isChecked ? prev.filter(k => k !== opt.key) : [...prev, opt.key]
                      )
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 16px',
                      background: isChecked ? 'rgba(124,108,252,0.15)' : 'var(--color-surface)',
                      border: `1px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--border-radius-md)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: isChecked ? 'var(--color-accent)' : 'var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {isChecked ? '✓' : ''}
                    </div>
                    <span style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 500 }}>
                      {opt.label}
                    </span>
                  </button>
                )
              })}
            </div>

            <button
              onClick={handleGenerate}
              style={{
                width: '100%',
                padding: '16px',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 'var(--border-radius-md)',
                color: 'white',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Generate My Plan →
            </button>
          </div>
        )}

        {/* Screen 4: Timeline preview */}
        {screen === 4 && (
          <div className="animate-in" style={{ maxWidth: 900, width: '100%', paddingBottom: isMobile ? 80 : 0 }}>
            <div style={{ textAlign: 'center', marginBottom: isMobile ? 24 : 32 }}>
              <h2 style={{ fontSize: isMobile ? 20 : 28, fontWeight: 700, marginBottom: isMobile ? 6 : 8 }}>
                Your timeline for {title || 'your release'}
              </h2>
              <p style={{ fontSize: isMobile ? 12 : 14, color: 'var(--color-text-muted)', padding: isMobile ? '0 12px' : 0 }}>
                Target date: {formatDate(releaseDate)}
              </p>
            </div>

            <DraggableTimeline
              tasks={tasks}
              onTasksChange={setTasks}
              showAIWarning={showAIWarning}
              isMobile={isMobile}
            />

            <Phase2Prompts
              answers={phase2Answers}
              onAnswer={setPhase2Answers}
            />

            <div style={{ textAlign: 'center', marginTop: isMobile ? 28 : 40 }}>
              <button
                onClick={handleCreateRelease}
                disabled={loading}
                style={{
                  padding: isMobile ? '14px 28px' : '16px 32px',
                  background: 'var(--color-accent)',
                  border: 'none',
                  borderRadius: 'var(--border-radius-md)',
                  color: 'white',
                  fontSize: isMobile ? 15 : 16,
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? 'Creating...' : isLoggedIn ? 'Create Release →' : 'Save My Plan →'}
              </button>
            </div>
          </div>
        )}

        {/* Screen 5: Account creation (only for non-logged-in users) */}
        {!isLoggedIn && screen === 5 && (
          <div className="animate-in" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(124,108,252,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </div>

            <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Things change — and when they do</h2>
            <p style={{ fontSize: 16, color: 'var(--color-text-muted)', marginBottom: 32 }}>
              Your whole plan adjusts automatically. Save your progress to keep your timeline on track.
            </p>

            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '16px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--border-radius-md)',
                color: 'var(--color-text)',
                fontSize: 16,
                outline: 'none',
                marginBottom: 12,
              }}
            />

            {error && (
              <p style={{ fontSize: 12, color: '#f87171', padding: '8px 12px', background: 'rgba(248,113,113,0.1)', borderRadius: 8, marginBottom: 12 }}>
                {error}
              </p>
            )}

            <button
              onClick={handleSignup}
              disabled={loading}
              style={{
                width: '100%',
                padding: '16px',
                background: 'var(--color-accent)',
                border: 'none',
                borderRadius: 'var(--border-radius-md)',
                color: 'white',
                fontSize: 16,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Sending...' : 'Create Account & Save'}
            </button>

            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 16 }}>
              Free forever for your first 3 releases.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
