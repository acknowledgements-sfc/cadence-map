import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  recalculateFromReleaseDate,
  formatDate,
  isOverdue,
  isDueSoon,
} from '../lib/cascadeEngine'
import TimelineView, { type TimelineTask, type TimelineDep } from '../components/TimelineView'

// ============================================================
// Types
// ============================================================
interface Release {
  id: string
  title: string
  artist: string | null
  release_type: string
  release_date: string | null
  created_at: string
}

type Task = TimelineTask
type Dependency = TimelineDep

// ============================================================
// Main component
// ============================================================
export default function ReleaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [release, setRelease] = useState<Release | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [deps, setDeps] = useState<Dependency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // UI state
  const [cascadePreview, setCascadePreview] = useState<{ affectedCount: number } | null>(null)

  // ============================================================
  // Fetch
  // ============================================================
  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)

    const [releaseRes, tasksRes] = await Promise.all([
      supabase.from('releases').select('*').eq('id', id).single(),
      supabase.from('tasks').select('*').eq('release_id', id).order('due_date', { ascending: true }),
    ])

    if (releaseRes.error) {
      setError(releaseRes.error.message)
      setLoading(false)
      return
    }

    setRelease(releaseRes.data)

    const fetchedTasks = tasksRes.data ?? []
    setTasks(fetchedTasks)

    // Fetch dependencies for these specific tasks
    if (fetchedTasks.length > 0) {
      const taskIds = fetchedTasks.map((t: Task) => t.id)
      const { data: depsData } = await supabase
        .from('task_dependencies')
        .select('*')
        .in('task_id', taskIds)
      setDeps(depsData ?? [])
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ============================================================
  // Release date change — recalculates ALL tasks from offsets
  // ============================================================
  const handleReleaseDateChange = async (newDate: string) => {
    if (!release || !newDate) return
    setSaving(true)

    const updates = recalculateFromReleaseDate(newDate, tasks)

    // Optimistic update
    setTasks(prev => prev.map(t =>
      updates[t.id] ? { ...t, due_date: updates[t.id] } : t
    ))
    setRelease(prev => prev ? { ...prev, release_date: newDate } : prev)

    // Persist
    await Promise.all([
      supabase.from('releases').update({ release_date: newDate }).eq('id', release.id),
      ...Object.entries(updates).map(([tid, date]) =>
        supabase.from('tasks').update({ due_date: date }).eq('id', tid)
      ),
    ])

    setSaving(false)
  }

  // ============================================================
  // Derived stats
  // ============================================================
  const totalTasks = tasks.length
  const completedTasks = tasks.filter(t => t.status === 'complete').length
  const overdueTasks = tasks.filter(t => t.status !== 'complete' && t.status !== 'skipped' && isOverdue(t.due_date)).length
  const dueSoonTasks = tasks.filter(t => t.status === 'complete' || t.status === 'skipped' ? false : isDueSoon(t.due_date)).length
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  // ============================================================
  // Render helpers
  // ============================================================
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading release…</p>
      </div>
    )
  }

  if (error || !release) {
    return (
      <div className="p-8">
        <p className="text-sm" style={{ color: '#f87171' }}>{error ?? 'Release not found.'}</p>
        <button onClick={() => navigate('/releases')} className="mt-4 text-sm underline" style={{ color: 'var(--color-accent)' }}>
          ← Back to releases
        </button>
      </div>
    )
  }

  const nextTask = tasks
    .filter(t => t.status === 'pending' || t.status === 'in_progress')
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0]

  return (
    <div className="min-h-screen pb-16">
      {/* ── Header ── */}
      <div
        className="sticky top-0 z-20 px-6 py-4 flex items-center justify-between"
        style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/releases')}
            className="text-sm hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ← Releases
          </button>
          <span style={{ color: 'var(--color-border)' }}>/</span>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{release.title}</span>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Saving…</span>
          )}
          <span
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
          >
            {release.release_type}
          </span>
        </div>
      </div>

      <div className="px-6 py-6 max-w-5xl mx-auto">
        {/* ── Release info + progress ── */}
        <div className="mb-6">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                {release.title}
              </h1>
              {release.artist && (
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-muted)' }}>{release.artist}</p>
              )}

              {/* Release date — editable */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Release date:</span>
                <input
                  type="date"
                  value={release.release_date ?? ''}
                  onChange={(e) => handleReleaseDateChange(e.target.value)}
                  className="text-xs rounded-lg px-2 py-1 outline-none"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
                {release.release_date && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {formatDate(release.release_date)}
                  </span>
                )}
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{completedTasks}/{totalTasks}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Tasks done</p>
              </div>
              {overdueTasks > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold" style={{ color: '#f87171' }}>{overdueTasks}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Overdue</p>
                </div>
              )}
              {dueSoonTasks > 0 && (
                <div className="text-center">
                  <p className="text-2xl font-bold" style={{ color: '#f59e0b' }}>{dueSoonTasks}</p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Due soon</p>
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {totalTasks > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Progress</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{progressPct}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%`, background: 'var(--color-accent)' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Cascade notification ── */}
        {cascadePreview && (
          <div
            className="mb-4 px-4 py-3 rounded-xl flex items-center gap-3 text-sm"
            style={{ background: 'rgba(124,108,252,0.15)', border: '1px solid var(--color-accent)', color: 'var(--color-text)' }}
          >
            <span style={{ fontSize: 18 }}>⚡</span>
            <div>
              <span className="font-semibold">Timeline updated. </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {cascadePreview.affectedCount} downstream {cascadePreview.affectedCount === 1 ? 'task' : 'tasks'} automatically rescheduled.
              </span>
            </div>
          </div>
        )}

        {/* ── Next up card ── */}
        {nextTask && (
          <div
            className="mb-6 p-4 rounded-xl flex items-center justify-between gap-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-accent)' }}>UP NEXT</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{nextTask.title}</p>
              <p className="text-xs mt-0.5" style={{ color: isOverdue(nextTask.due_date) ? '#f87171' : 'var(--color-text-muted)' }}>
                {isOverdue(nextTask.due_date) ? '⚠ Overdue · ' : ''}
                {formatDate(nextTask.due_date)}
              </p>
            </div>
          </div>
        )}

        {/* ── Timeline — dual view (Graph / Gantt) + Pressure Map ── */}
        {tasks.length === 0 ? (
          <div
            className="rounded-xl p-10 text-center"
            style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No tasks yet. Create a release with a release date to auto-generate your plan.
            </p>
          </div>
        ) : (
          <TimelineView
            tasks={tasks}
            deps={deps}
            releaseDate={release.release_date}
            onTasksChange={setTasks}
            onCascade={(count) => {
              setCascadePreview({ affectedCount: count })
              setTimeout(() => setCascadePreview(null), 5000)
            }}
          />
        )}
      </div>
    </div>
  )
}
