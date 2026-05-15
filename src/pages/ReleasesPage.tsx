import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import NewReleaseModal from '../components/NewReleaseModal'
import { formatDate, isOverdue } from '../lib/cascadeEngine'

interface Release {
  id: string
  title: string
  artist: string | null
  release_date: string | null
  release_type: string
  created_at: string
}

export default function ReleasesPage() {
  const navigate = useNavigate()
  const [releases, setReleases] = useState<Release[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskStats, setTaskStats] = useState<Record<string, { total: number; complete: number; overdue: number }>>({})

  const fetchReleases = async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('releases')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      const releases = data ?? []
      setReleases(releases)

      // Fetch task stats for each release
      if (releases.length > 0) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('release_id, status, due_date')
          .in('release_id', releases.map(r => r.id))

        const stats: Record<string, { total: number; complete: number; overdue: number }> = {}
        releases.forEach(r => { stats[r.id] = { total: 0, complete: 0, overdue: 0 } })

        tasks?.forEach(t => {
          if (!stats[t.release_id]) return
          stats[t.release_id].total++
          if (t.status === 'complete') stats[t.release_id].complete++
          if (t.status !== 'complete' && t.status !== 'skipped' && isOverdue(t.due_date)) {
            stats[t.release_id].overdue++
          }
        })
        setTaskStats(stats)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchReleases()
  }, [])

  const getReleaseTypeEmoji = (type: string) => {
    switch (type) {
      case 'Single': return '🎵'
      case 'EP': return '💿'
      case 'Album': return '📀'
      case 'Mixtape': return '📼'
      default: return '🎶'
    }
  }

  const getReleaseDaysUntil = (dateStr: string | null) => {
    if (!dateStr) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const release = new Date(dateStr + 'T00:00:00')
    const days = Math.round((release.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return days
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Releases</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>All your release plans in one place.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-accent)', color: 'white' }}
        >
          + New Release
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm" style={{ background: '#fee2e24d', color: '#f87171' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading releases…</p>
        </div>
      ) : releases.length === 0 ? (
        <div
          className="rounded-2xl p-12 flex flex-col items-center text-center"
          style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
        >
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-2xl"
            style={{ background: 'var(--color-surface-2)' }}
          >
            🎶
          </div>
          <h2 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            No releases yet
          </h2>
          <p className="text-sm mb-6 max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
            Create your first release plan and Cadence will build out your full timeline automatically.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            + New Release
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {releases.map(release => {
            const stats = taskStats[release.id]
            const progressPct = stats && stats.total > 0
              ? Math.round((stats.complete / stats.total) * 100)
              : null
            const daysUntil = getReleaseDaysUntil(release.release_date)
            const hasOverdue = stats?.overdue > 0

            return (
              <button
                key={release.id}
                onClick={() => navigate(`/releases/${release.id}`)}
                className="rounded-xl px-5 py-4 flex items-center gap-4 text-left w-full transition-all hover:scale-[1.005]"
                style={{
                  background: 'var(--color-surface)',
                  border: `1px solid ${hasOverdue ? '#f8717133' : 'var(--color-border)'}`,
                }}
              >
                {/* Icon */}
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                  style={{ background: 'var(--color-surface-2)' }}
                >
                  {getReleaseTypeEmoji(release.release_type)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                    {release.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                    {release.artist ?? 'No artist'} · {release.release_type}
                  </p>

                  {/* Progress bar */}
                  {progressPct !== null && stats.total > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${progressPct}%`, background: 'var(--color-accent)' }}
                        />
                      </div>
                      <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                        {stats.complete}/{stats.total}
                        {hasOverdue && <span style={{ color: '#f87171' }}> · {stats.overdue} overdue</span>}
                      </span>
                    </div>
                  )}
                </div>

                {/* Release date badge */}
                <div className="shrink-0 text-right">
                  {release.release_date ? (
                    <>
                      <p
                        className="text-xs font-medium"
                        style={{
                          color: daysUntil !== null && daysUntil < 0
                            ? '#6b7280'
                            : daysUntil !== null && daysUntil <= 14
                              ? '#f59e0b'
                              : 'var(--color-text)',
                        }}
                      >
                        {formatDate(release.release_date)}
                      </p>
                      {daysUntil !== null && (
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {daysUntil < 0
                            ? `${Math.abs(daysUntil)}d ago`
                            : daysUntil === 0
                              ? 'Today!'
                              : `${daysUntil}d away`}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>No date set</span>
                  )}
                </div>

                {/* Arrow */}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )
          })}
        </div>
      )}

      {showModal && (
        <NewReleaseModal
          onClose={() => setShowModal(false)}
          onCreated={(releaseId) => {
            navigate(`/releases/${releaseId}`)
          }}
        />
      )}
    </div>
  )
}
