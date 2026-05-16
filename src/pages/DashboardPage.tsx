import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import NewReleaseModal from '../components/NewReleaseModal'
import UpgradeModal, { FREE_LIMIT } from '../components/UpgradeModal'
import { formatDate, isOverdue, isDueSoon, daysBetween } from '../lib/cascadeEngine'

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

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

interface TaskSummary {
  release_id: string
  status: string
  due_date: string | null
}

interface ReleaseProgress {
  total: number
  complete: number
  overdue: number
  tasks: TaskSummary[]
}

// ─────────────────────────────────────────────────────────
// Mini Timeline Strip  (Aeon "context bar" concept)
//
// Renders a compact SVG strip showing all tasks as colored
// dots along a horizontal timeline axis, with today marker
// and release date diamond. Lets Maya see the full arc of
// a release plan at a glance without navigating into it.
// ─────────────────────────────────────────────────────────

function ReleaseMiniTimeline({
  tasks,
  releaseDate,
}: {
  tasks: TaskSummary[]
  releaseDate: string | null
}) {
  const W = 300
  const H = 22
  const PAD = 10

  const today = new Date().toISOString().split('T')[0]
  const datedTasks = tasks
    .filter(t => t.due_date && t.status !== 'skipped')
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))

  const datePts = [
    ...datedTasks.map(t => t.due_date!),
    ...(releaseDate ? [releaseDate] : []),
    today,
  ]
    .filter(Boolean)
    .sort()

  if (datePts.length < 2) return null

  const minD = datePts[0]
  const maxD = datePts[datePts.length - 1]
  const totalDays = Math.max(daysBetween(minD, maxD), 1)
  const toX = (d: string) =>
    PAD + (daysBetween(minD, d) / totalDays) * (W - PAD * 2)

  const todayX = toX(today)
  const relX = releaseDate ? toX(releaseDate) : null

  // Color each task dot by status / urgency
  const dotColor = (status: string, due: string | null) => {
    if (status === 'complete') return '#10b981'
    if (status === 'in_progress') return '#f59e0b'
    if (due && isOverdue(due)) return '#f87171'
    if (due && isDueSoon(due, 7)) return '#f59e0b'
    return 'var(--color-border)'
  }

  // Completed progress line: from start to the last completed task
  const doneDates = datedTasks
    .filter(t => t.status === 'complete' && t.due_date)
    .map(t => t.due_date!)
    .sort()
  const lastDoneX = doneDates.length > 0 ? toX(doneDates[doneDates.length - 1]) : null

  const isTodayInRange = today >= minD && today <= maxD

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: H, display: 'block', marginTop: 8 }}
    >
      {/* Background track */}
      <line
        x1={PAD} y1={H / 2}
        x2={W - PAD} y2={H / 2}
        stroke="var(--color-border)"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.6}
      />

      {/* Completed segment — green fill up to last done task */}
      {lastDoneX && (
        <line
          x1={PAD} y1={H / 2}
          x2={lastDoneX} y2={H / 2}
          stroke="#10b981"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.7}
        />
      )}

      {/* Today line */}
      {isTodayInRange && (
        <line
          x1={todayX} y1={4}
          x2={todayX} y2={H - 4}
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0.9}
        />
      )}

      {/* Release date — diamond marker */}
      {relX && (
        <polygon
          points={`${relX},${H / 2 - 5} ${relX + 4},${H / 2} ${relX},${H / 2 + 5} ${relX - 4},${H / 2}`}
          fill="var(--color-accent)"
          opacity={0.9}
        />
      )}

      {/* Task dots — drawn last so they sit on top */}
      {datedTasks.map((t, i) => (
        <circle
          key={i}
          cx={toX(t.due_date!)}
          cy={H / 2}
          r={3}
          fill={dotColor(t.status, t.due_date)}
          opacity={0.9}
        />
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────
// Progress Ring  (compact circular indicator for the stats row)
// ─────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 32 }: { pct: number; size?: number }) {
  const r = (size - 4) / 2
  const circ = 2 * Math.PI * r
  const dash = pct * circ
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={3} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={pct === 1 ? '#10b981' : 'var(--color-accent)'}
        strokeWidth={3}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1)' }}
      />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [releases, setReleases] = useState<Release[]>([])
  const [upcomingTasks, setUpcomingTasks] = useState<UpcomingTask[]>([])
  const [releaseProgress, setReleaseProgress] = useState<Map<string, ReleaseProgress>>(new Map())
  const [loadingReleases, setLoadingReleases] = useState(true)

  const fetchData = async () => {
    setLoadingReleases(true)

    const [releasesRes, tasksRes, allTasksRes] = await Promise.all([
      supabase
        .from('releases')
        .select('id, title, artist, release_type, release_date')
        .order('created_at', { ascending: false }),

      // Upcoming / overdue tasks for the "Coming up" panel
      supabase
        .from('tasks')
        .select('id, title, due_date, release_id, status')
        .neq('status', 'complete')
        .neq('status', 'skipped')
        .not('due_date', 'is', null)
        .order('due_date', { ascending: true })
        .limit(50),

      // All tasks — minimal columns — for progress computation + mini timeline
      supabase
        .from('tasks')
        .select('release_id, status, due_date'),
    ])

    const releasesData = releasesRes.data ?? []
    setReleases(releasesData)

    // Build release title lookup
    const releaseTitleMap = new Map(releasesData.map(r => [r.id, r.title]))

    // Upcoming tasks filter
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

    // Compute per-release progress from all tasks
    const progressMap = new Map<string, ReleaseProgress>()
    ;(allTasksRes.data ?? []).forEach(task => {
      if (!progressMap.has(task.release_id)) {
        progressMap.set(task.release_id, { total: 0, complete: 0, overdue: 0, tasks: [] })
      }
      const p = progressMap.get(task.release_id)!
      if (task.status !== 'skipped') {
        p.total++
        if (task.status === 'complete') p.complete++
        if (isOverdue(task.due_date) && task.status !== 'complete') p.overdue++
      }
      p.tasks.push(task as TaskSummary)
    })
    setReleaseProgress(progressMap)

    setLoadingReleases(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Aggregate stats
  const totalTasks = Array.from(releaseProgress.values()).reduce((s, p) => s + p.total, 0)
  const completedTasks = Array.from(releaseProgress.values()).reduce((s, p) => s + p.complete, 0)
  const overdueTotal = Array.from(releaseProgress.values()).reduce((s, p) => s + p.overdue, 0)
  const progressPct = totalTasks > 0 ? completedTasks / totalTasks : 0

  const getReleaseTypeEmoji = (type: string) => {
    switch (type) {
      case 'Single':   return '🎵'
      case 'EP':       return '💿'
      case 'Album':    return '📀'
      case 'Mixtape':  return '📼'
      default:         return '🎶'
    }
  }

  const getGreeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const firstName = user?.email?.split('@')[0] ?? ''

  return (
    <div className="p-8 max-w-5xl">
      {/* ── Header ── */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
          {getGreeting()}{firstName ? `, ${firstName}` : ''} 👋
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Here's what's happening with your releases.
        </p>
      </div>

      {/* ── Stats row — 3 cards ── */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {/* Active Releases */}
        <div
          className="rounded-xl p-5 flex items-center gap-4 cursor-pointer hover:opacity-90 transition-opacity"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          onClick={() => navigate('/releases')}
        >
          <span className="text-2xl">🎵</span>
          <div>
            <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              {loadingReleases ? '…' : releases.length}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Active Releases</p>
          </div>
        </div>

        {/* At Risk */}
        <div
          className="rounded-xl p-5 flex items-center gap-4"
          style={{
            background: overdueTotal > 0 ? '#f871710d' : 'var(--color-surface)',
            border: `1px solid ${overdueTotal > 0 ? '#f8717133' : 'var(--color-border)'}`,
          }}
        >
          <span className="text-2xl">{overdueTotal > 0 ? '⚠️' : '✓'}</span>
          <div>
            <p className="text-2xl font-bold" style={{ color: overdueTotal > 0 ? '#f87171' : '#10b981' }}>
              {loadingReleases ? '…' : overdueTotal}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {overdueTotal > 0 ? 'Tasks At Risk' : 'All On Track'}
            </p>
          </div>
        </div>

        {/* Overall Progress */}
        <div
          className="rounded-xl p-5 flex items-center gap-4"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <ProgressRing pct={progressPct} size={36} />
          <div>
            <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              {loadingReleases ? '…' : `${Math.round(progressPct * 100)}%`}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {loadingReleases ? 'Loading…' : `${completedTasks} of ${totalTasks} tasks`}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Coming up ── */}
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

        {/* ── Releases — with mini timeline strips ── */}
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
                onClick={() => releases.length >= FREE_LIMIT ? setShowUpgrade(true) : setShowModal(true)}
                className="rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-accent)', color: 'white' }}
              >
                + New Release
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {releases.slice(0, 5).map(release => {
                const progress = releaseProgress.get(release.id)
                const pct = progress && progress.total > 0 ? progress.complete / progress.total : 0
                const hasOverdue = (progress?.overdue ?? 0) > 0

                return (
                  <button
                    key={release.id}
                    onClick={() => navigate(`/releases/${release.id}`)}
                    className="rounded-xl px-4 pt-3 pb-2 flex flex-col text-left w-full transition-all hover:opacity-90"
                    style={{
                      background: 'var(--color-surface)',
                      border: `1px solid ${hasOverdue ? '#f8717122' : 'var(--color-border)'}`,
                    }}
                  >
                    {/* Top row */}
                    <div className="flex items-center gap-3 w-full">
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
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {formatDate(release.release_date)}
                        </span>
                        {progress && progress.total > 0 && (
                          <span
                            className="text-xs font-medium"
                            style={{ color: hasOverdue ? '#f87171' : pct === 1 ? '#10b981' : 'var(--color-text-muted)' }}
                          >
                            {hasOverdue
                              ? `${progress.overdue} at risk`
                              : pct === 1
                                ? '✓ Complete'
                                : `${progress.complete}/${progress.total}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Mini timeline strip — the Aeon context bar */}
                    {progress && progress.total > 0 && (
                      <ReleaseMiniTimeline
                        tasks={progress.tasks}
                        releaseDate={release.release_date}
                      />
                    )}
                  </button>
                )
              })}

              <button
                onClick={() => releases.length >= FREE_LIMIT ? setShowUpgrade(true) : setShowModal(true)}
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
          onCreated={(releaseId) => navigate(`/releases/${releaseId}`)}
        />
      )}
      {showUpgrade && (
        <UpgradeModal onClose={() => setShowUpgrade(false)} reason="release_limit" />
      )}
    </div>
  )
}
