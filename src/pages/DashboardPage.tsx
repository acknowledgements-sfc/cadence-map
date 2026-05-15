import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import NewReleaseModal from '../components/NewReleaseModal'
import { formatDate, isOverdue, isDueSoon } from '../lib/cascadeEngine'

interface Release {
  id: string
  title: string
  artist: string | null
  release_type: string
  release_date: string | null
}

interface UpcomingTask {
  id: string
  title: string
  due_date: string
  release_id: string
  releaseTitle: string
  is_overdue: boolean
}

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [releases, setReleases] = useState<Release[]>([])
  const [upcomingTasks, setUpcomingTasks] = useState<UpcomingTask[]>([])
  const [loadingReleases, setLoadingReleases] = useState(true)

  const fetchData = async () => {
    setLoadingReleases(true)

    const [releasesRes, tasksRes] = await Promise.all([
      supabase
        .from('releases')
        .select('id, title, artist, release_type, release_date')
        .order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select('id, title, due_date, release_id, status')
        .neq('status', 'complete')
        .neq('status', 'skipped')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true })
        .limit(50),
    ])

    const releasesData = releasesRes.data ?? []
    setReleases(releasesData)

    // Build release title lookup
    const releaseTitleMap = new Map(releasesData.map(r => [r.id, r.title]))

    // Filter to due soon or overdue
    const upcoming = (tasksRes.data ?? [])
      .filter(t => isDueSoon(t.due_date, 14) || isOverdue(t.due_date))
      .slice(0, 8)
      .map(t => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date,
        release_id: t.release_id,
        releaseTitle: releaseTitleMap.get(t.release_id) ?? 'Unknown release',
        is_overdue: isOverdue(t.due_date),
      }))

    setUpcomingTasks(upcoming)
    setLoadingReleases(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const totalDueSoon = upcomingTasks.length
  const totalOverdue = upcomingTasks.filter(t => t.is_overdue).length

  const stats = [
    {
      label: 'Active Releases',
      value: loadingReleases ? '…' : String(releases.length),
      icon: '🎵',
      onClick: () => navigate('/releases'),
    },
    {
      label: totalOverdue > 0 ? 'Tasks Overdue' : 'Due This Week',
      value: loadingReleases ? '…' : String(totalOverdue > 0 ? totalOverdue : totalDueSoon),
      icon: totalOverdue > 0 ? '⚠️' : '⏰',
      danger: totalOverdue > 0,
      onClick: undefined,
    },
  ]

  const getReleaseTypeEmoji = (type: string) => {
    switch (type) {
      case 'Single': return '🎵'
      case 'EP': return '💿'
      case 'Album': return '📀'
      case 'Mixtape': return '📼'
      default: return '🎶'
    }
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const firstName = user?.email?.split('@')[0] ?? ''

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
          {getGreeting()}{firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Here's what's happening with your releases.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {stats.map(s => (
          <div
            key={s.label}
            className={`rounded-xl p-5 flex items-center gap-4 ${s.onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
            style={{
              background: s.danger ? '#f871710d' : 'var(--color-surface)',
              border: `1px solid ${s.danger ? '#f8717133' : 'var(--color-border)'}`,
            }}
            onClick={s.onClick}
          >
            <span className="text-2xl">{s.icon}</span>
            <div>
              <p className="text-2xl font-bold" style={{ color: s.danger ? '#f87171' : 'var(--color-text)' }}>
                {s.value}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming tasks */}
        {!loadingReleases && (
          <div>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
              {upcomingTasks.length > 0 ? 'Coming up' : 'No tasks due soon'}
            </h2>
            {upcomingTasks.length > 0 ? (
              <div className="flex flex-col gap-2">
                {upcomingTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => navigate(`/releases/${task.release_id}`)}
                    className="rounded-xl px-4 py-3 flex items-center gap-3 text-left w-full transition-all hover:opacity-90"
                    style={{
                      background: 'var(--color-surface)',
                      border: `1px solid ${task.is_overdue ? '#f8717133' : 'var(--color-border)'}`,
                    }}
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: task.is_overdue ? '#f87171' : '#f59e0b' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                        {task.title}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {task.releaseTitle}
                      </p>
                    </div>
                    <span
                      className="text-xs shrink-0"
                      style={{ color: task.is_overdue ? '#f87171' : '#f59e0b' }}
                    >
                      {task.is_overdue ? '⚠ Overdue' : formatDate(task.due_date)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div
                className="rounded-xl p-6 text-center"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {releases.length > 0
                    ? '✓ You\'re all caught up.'
                    : 'Create a release to see your upcoming tasks here.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Recent releases */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Recent releases
            </h2>
            {releases.length > 0 && (
              <button
                onClick={() => navigate('/releases')}
                className="text-xs font-medium hover:opacity-70 transition-opacity"
                style={{ color: 'var(--color-accent)' }}
              >
                View all →
              </button>
            )}
          </div>

          {!loadingReleases && releases.length === 0 ? (
            <div
              className="rounded-2xl p-10 flex flex-col items-center text-center"
              style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 text-xl"
                style={{ background: 'var(--color-surface-2)' }}
              >
                🎶
              </div>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                No releases yet
              </h2>
              <p className="text-xs mb-4 max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
                Create your first release plan — Cadence will build the full timeline automatically.
              </p>
              <button
                onClick={() => setShowModal(true)}
                className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-accent)', color: 'white' }}
              >
                + New Release
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {releases.slice(0, 5).map(release => (
                <button
                  key={release.id}
                  onClick={() => navigate(`/releases/${release.id}`)}
                  className="rounded-xl px-4 py-3 flex items-center gap-3 text-left w-full transition-all hover:opacity-90"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
                    style={{ background: 'var(--color-surface-2)' }}
                  >
                    {getReleaseTypeEmoji(release.release_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                      {release.title}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {release.artist ?? 'No artist'} · {release.release_type}
                    </p>
                  </div>
                  <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {formatDate(release.release_date)}
                  </span>
                </button>
              ))}

              <button
                onClick={() => setShowModal(true)}
                className="mt-1 w-full rounded-xl py-2.5 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-accent)', color: 'white' }}
              >
                + New Release
              </button>
            </div>
          )}
        </div>
      </div>

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
