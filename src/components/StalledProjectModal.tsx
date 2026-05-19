import { formatDate } from '../lib/cascadeEngine'

interface StalledProjectModalProps {
  projectTitle: string
  daysSinceLastVisit: number
  releaseDate: string | null
  onAction: (action: 'resume' | 'postpone' | 'hold') => void
}

export default function StalledProjectModal({
  projectTitle,
  daysSinceLastVisit,
  releaseDate,
  onAction,
}: StalledProjectModalProps) {
  const daysUntilRelease = releaseDate
    ? Math.ceil((new Date(releaseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-7 flex flex-col"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        {/* Icon */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 text-xl shrink-0"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          🌙
        </div>

        {/* Headline */}
        <h2 className="text-base font-semibold mb-2 leading-snug" style={{ color: 'var(--color-text)' }}>
          {projectTitle} has been quiet
        </h2>

        {/* Body */}
        <p className="text-sm leading-relaxed mb-1" style={{ color: 'var(--color-text-muted)' }}>
          You haven't visited in {daysSinceLastVisit} day{daysSinceLastVisit !== 1 ? 's' : ''}.
          That's completely normal — creative work has its own rhythm.
        </p>

        {daysUntilRelease !== null && (
          <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--color-text-muted)' }}>
            {daysUntilRelease > 0
              ? `Your release date is ${formatDate(releaseDate!)} — ${daysUntilRelease} day${daysUntilRelease !== 1 ? 's' : ''} away. A few minutes now can go a long way.`
              : `Your release date has passed. Whenever you're ready, let's figure out next steps.`
            }
          </p>
        )}

        {!releaseDate && <div className="mb-5" />}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {/* Primary: Resume */}
          <button
            onClick={() => onAction('resume')}
            className="w-full rounded-xl py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            Pick up where I left off
          </button>

          {/* Secondary: Postpone */}
          <button
            onClick={() => onAction('postpone')}
            className="w-full rounded-xl py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{
              background: 'var(--color-surface-2, var(--color-surface))',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          >
            Push release date back 2 weeks
          </button>

          {/* Tertiary: Hold */}
          <button
            onClick={() => onAction('hold')}
            className="w-full py-2 text-sm transition-opacity hover:opacity-70"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Put this on hold for now
          </button>
        </div>
      </div>
    </div>
  )
}
