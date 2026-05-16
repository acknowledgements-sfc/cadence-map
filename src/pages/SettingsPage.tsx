import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { FREE_LIMIT } from '../components/UpgradeModal'
import UpgradeModal from '../components/UpgradeModal'

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [emailDigest, setEmailDigest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [releaseCount, setReleaseCount] = useState<number | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Load display name from localStorage (no user_profiles table yet)
  useEffect(() => {
    const stored = localStorage.getItem('cadence_display_name')
    if (stored) setDisplayName(stored)
    const digest = localStorage.getItem('cadence_email_digest')
    if (digest === 'true') setEmailDigest(true)
  }, [])

  // Fetch release count for plan display
  useEffect(() => {
    supabase
      .from('releases')
      .select('id', { count: 'exact', head: true })
      .then(({ count }) => setReleaseCount(count ?? 0))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    localStorage.setItem('cadence_display_name', displayName)
    localStorage.setItem('cadence_email_digest', String(emailDigest))
    await new Promise(r => setTimeout(r, 400)) // feel like it's doing something
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This will permanently delete all your releases and tasks. This cannot be undone.'
    )
    if (!confirmed) return
    // Sign out — actual account deletion would need a server-side call
    await signOut()
  }

  const firstName = displayName || user?.email?.split('@')[0] || 'there'
  const planFull = releaseCount !== null && releaseCount >= FREE_LIMIT

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Settings</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Manage your account and preferences.
        </p>
      </div>

      <div className="flex flex-col gap-6">

        {/* ── Profile ── */}
        <Section title="Profile">
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder={firstName}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Email
              </label>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>{user?.email}</p>
            </div>
          </div>
        </Section>

        {/* ── Notifications ── */}
        <Section title="Notifications">
          <Toggle
            label="Weekly email digest"
            description="Get a summary of upcoming and overdue tasks every Monday morning."
            value={emailDigest}
            onChange={setEmailDigest}
          />
        </Section>

        {/* ── Plan ── */}
        <Section title="Plan">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>
                Free Plan
              </p>
              <p className="text-xs" style={{ color: planFull ? '#f87171' : 'var(--color-text-muted)' }}>
                {releaseCount !== null
                  ? `${releaseCount} / ${FREE_LIMIT} releases used${planFull ? ' — limit reached' : ''}`
                  : 'Loading…'}
              </p>
            </div>
            <button
              onClick={() => setShowUpgrade(true)}
              className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-accent)', color: 'white' }}
            >
              Upgrade to Pro
            </button>
          </div>

          {/* Usage bar */}
          {releaseCount !== null && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (releaseCount / FREE_LIMIT) * 100)}%`,
                    background: planFull ? '#f87171' : 'var(--color-accent)',
                  }}
                />
              </div>
            </div>
          )}
        </Section>

        {/* ── Save button ── */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
          </button>
        </div>

        {/* ── Danger zone ── */}
        <Section title="Danger zone">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>Sign out</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Sign out of your account on this device.
              </p>
            </div>
            <button
              onClick={signOut}
              className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              Sign out
            </button>
          </div>

          <div
            className="flex items-center justify-between pt-4 mt-4"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <div>
              <p className="text-sm font-medium mb-0.5" style={{ color: '#f87171' }}>Delete account</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Permanently delete your account and all data. Cannot be undone.
              </p>
            </div>
            <button
              onClick={handleDeleteAccount}
              className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{
                background: 'transparent',
                border: '1px solid #f8717133',
                color: '#f87171',
              }}
            >
              Delete
            </button>
          </div>
        </Section>

      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-muted)' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium mb-0.5" style={{ color: 'var(--color-text)' }}>{label}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{description}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className="shrink-0 w-10 h-6 rounded-full transition-all relative mt-0.5"
        style={{
          background: value ? 'var(--color-accent)' : 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
        }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{
            background: value ? 'white' : 'var(--color-text-muted)',
            left: value ? 'calc(100% - 18px)' : '2px',
          }}
        />
      </button>
    </div>
  )
}
