import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { buildReleaseTaskPayload, type ReleaseType } from '../lib/releaseTemplates'
import { TEMPLATES } from '../lib/releaseTemplates'

interface NewReleaseModalProps {
  onClose: () => void
  onCreated: (releaseId: string) => void
}

const RELEASE_TYPES: ReleaseType[] = ['Single', 'EP', 'Album', 'Mixtape', 'Compilation']

// What's already done? Used to pre-mark tasks as complete
const PROGRESS_OPTIONS = [
  { key: 'recording', label: 'Recording done' },
  { key: 'mix_delivery', label: 'Mixed' },
  { key: 'master_delivery', label: 'Mastered' },
  { key: 'artwork_final', label: 'Artwork ready' },
  { key: 'distribution_submit', label: 'Submitted to distributor' },
]

export default function NewReleaseModal({ onClose, onCreated }: NewReleaseModalProps) {
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [releaseType, setReleaseType] = useState<ReleaseType>('Single')

  // Step 2
  const [doneTasks, setDoneTasks] = useState<Set<string>>(new Set())

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleDone = (key: string) => {
    setDoneTasks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Release title is required.')
      return
    }
    setError(null)
    setStep(2)
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Not authenticated.')
      setLoading(false)
      return
    }

    // 1. Insert release
    const { data: release, error: releaseError } = await supabase
      .from('releases')
      .insert({
        title: title.trim(),
        artist: artist.trim() || null,
        release_date: releaseDate || null,
        release_type: releaseType,
        user_id: user.id,
      })
      .select('id')
      .single()

    if (releaseError || !release) {
      setError(releaseError?.message ?? 'Failed to create release.')
      setLoading(false)
      return
    }

    // 2. Generate task plan (only if release date is set)
    if (releaseDate) {
      const { tasks } = buildReleaseTaskPayload(
        releaseType,
        releaseDate,
        release.id,
        user.id
      )

      // Mark already-done tasks
      const taskPayload = tasks.map(t => ({
        ...t,
        status: doneTasks.has(t.template_key) ? 'complete' : 'pending',
      }))

      const { data: insertedTasks, error: tasksError } = await supabase
        .from('tasks')
        .insert(taskPayload)
        .select('id, template_key')

      if (tasksError) {
        setError(tasksError.message)
        setLoading(false)
        return
      }

      // 3. Insert dependency edges
      // Build a map: template_key → db task id
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
        const { error: depsError } = await supabase
          .from('task_dependencies')
          .insert(depInserts)

        if (depsError) {
          // Non-fatal — release and tasks still created
          console.warn('Dependency insert error:', depsError.message)
        }
      }
    }

    setLoading(false)
    onCreated(release.id)
    onClose()
  }

  // Estimated task count for this release type
  const taskCount = TEMPLATES[releaseType]?.length ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              {step === 1 ? 'New Release' : 'What\'s already done?'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {step === 1
                ? 'Cadence will build your full timeline automatically.'
                : `We'll pre-mark completed steps so your plan starts in the right place.`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-2)' }}
          >
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {[1, 2].map(s => (
            <div
              key={s}
              className="flex-1 h-1"
              style={{
                background: s <= step ? 'var(--color-accent)' : 'var(--color-surface-2)',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        <div className="p-6">
          {step === 1 ? (
            <form onSubmit={handleStep1} className="flex flex-col gap-4">
              {/* Release type — visual selector */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  What are you releasing?
                </label>
                <div className="flex gap-2 flex-wrap">
                  {RELEASE_TYPES.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setReleaseType(type)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                      style={{
                        background: releaseType === type ? 'var(--color-accent)' : 'var(--color-surface-2)',
                        color: releaseType === type ? 'white' : 'var(--color-text-muted)',
                        border: `1px solid ${releaseType === type ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      }}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Release title <span style={{ color: 'var(--color-accent)' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder={releaseType === 'Single' ? 'e.g. Midnight' : 'e.g. Midnight Sessions'}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                  autoFocus
                />
              </div>

              {/* Artist */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Artist / project name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rob C"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              {/* Release date */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  Target release date
                </label>
                <input
                  type="date"
                  value={releaseDate}
                  onChange={(e) => setReleaseDate(e.target.value)}
                  className="rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
                {!releaseDate && (
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    No date yet? You can set it later — we'll still create your plan.
                  </p>
                )}
                {releaseDate && (
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    We'll generate {taskCount} tasks with dependency-aware due dates.
                  </p>
                )}
              </div>

              {error && (
                <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#fee2e24d', color: '#f87171' }}>
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: 'var(--color-accent)', color: 'white' }}
                >
                  Next →
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Check off anything that's already complete for <strong style={{ color: 'var(--color-text)' }}>{title}</strong>:
              </p>

              <div className="flex flex-col gap-2">
                {PROGRESS_OPTIONS.map(opt => {
                  // Only show options that exist in this release type's template
                  const templateKeys = TEMPLATES[releaseType].map(t => t.key)
                  if (!templateKeys.includes(opt.key)) return null

                  const isChecked = doneTasks.has(opt.key)
                  return (
                    <button
                      key={opt.key}
                      onClick={() => toggleDone(opt.key)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                      style={{
                        background: isChecked ? 'rgba(124,108,252,0.15)' : 'var(--color-surface-2)',
                        border: `1px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      }}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                        style={{
                          background: isChecked ? 'var(--color-accent)' : 'var(--color-border)',
                          color: 'white',
                        }}
                      >
                        {isChecked ? '✓' : ''}
                      </div>
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        {opt.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                None of the above? No worries — we'll start from the beginning.
              </p>

              {error && (
                <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#fee2e24d', color: '#f87171' }}>
                  {error}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setStep(1); setError(null) }}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}
                >
                  ← Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--color-accent)', color: 'white' }}
                >
                  {loading ? 'Building plan…' : 'Create Release →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
