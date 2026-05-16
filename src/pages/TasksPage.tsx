import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, isOverdue, isDueSoon } from '../lib/cascadeEngine'
import type { TaskStatus } from '../lib/releaseTemplates'

// ============================================================
// Types
// ============================================================
interface FlatTask {
  id: string
  title: string
  phase: string
  status: TaskStatus
  due_date: string | null
  effort_hours: number
  is_external: boolean
  release_id: string
  releaseTitle: string
  releaseType: string
}

type FilterKey = 'all' | 'overdue' | 'due_soon' | 'in_progress' | 'pending' | 'complete'

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  complete: 'Done',
  skipped: 'Skipped',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'var(--color-text-muted)',
  in_progress: '#6366f1',
  complete: '#10b981',
  skipped: 'var(--color-border)',
}

const PHASE_COLORS: Record<string, string> = {
  'Pre-Production': '#6366f1',
  'Production': '#8b5cf6',
  'Distribution': '#06b6d4',
  'Marketing': '#f59e0b',
  'Release': '#10b981',
  'Post-Release': '#6b7280',
}

// ============================================================
// Component
// ============================================================
export default function TasksPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<FlatTask[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setLoading(true)

    const [releasesRes, tasksRes] = await Promise.all([
      supabase.from('releases').select('id, title, release_type'),
      supabase
        .from('tasks')
        .select('id, title, phase, status, due_date, effort_hours, is_external, release_id')
        .order('due_date', { ascending: true }),
    ])

    const releaseMap = new Map(
      (releasesRes.data ?? []).map(r => [r.id, { title: r.title, type: r.release_type }])
    )

    const flat: FlatTask[] = (tasksRes.data ?? []).map(t => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      status: t.status as TaskStatus,
      due_date: t.due_date,
      effort_hours: t.effort_hours ?? 0,
      is_external: t.is_external ?? false,
      release_id: t.release_id,
      releaseTitle: releaseMap.get(t.release_id)?.title ?? 'Unknown',
      releaseType: releaseMap.get(t.release_id)?.type ?? '',
    }))

    setTasks(flat)
    setLoading(false)
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // ── Status update ──────────────────────────────────────────
  const cycleStatus = async (task: FlatTask) => {
    const next: TaskStatus =
      task.status === 'pending' ? 'in_progress'
      : task.status === 'in_progress' ? 'complete'
      : task.status === 'complete' ? 'pending'
      : task.status  // skipped: no cycle

    setUpdatingId(task.id)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t))
    await supabase.from('tasks').update({ status: next }).eq('id', task.id)
    setUpdatingId(null)
  }

  // ── Filtering ──────────────────────────────────────────────
  const filtered = tasks.filter(t => {
    if (filter === 'overdue')    return t.status !== 'complete' && t.status !== 'skipped' && isOverdue(t.due_date)
    if (filter === 'due_soon')   return t.status !== 'complete' && t.status !== 'skipped' && isDueSoon(t.due_date)
    if (filter === 'in_progress') return t.status === 'in_progress'
    if (filter === 'pending')    return t.status === 'pending'
    if (filter === 'complete')   return t.status === 'complete'
    return true
  })

  // ── Group by release ───────────────────────────────────────
  const grouped = filtered.reduce<Record<string, FlatTask[]>>((acc, t) => {
    if (!acc[t.release_id]) acc[t.release_id] = []
    acc[t.release_id].push(t)
    return acc
  }, {})

  // ── Counts for filter badges ───────────────────────────────
  const counts = {
    all: tasks.length,
    overdue: tasks.filter(t => t.status !== 'complete' && t.status !== 'skipped' && isOverdue(t.due_date)).length,
    due_soon: tasks.filter(t => t.status !== 'complete' && t.status !== 'skipped' && isDueSoon(t.due_date)).length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    complete: tasks.filter(t => t.status === 'complete').length,
  }

  const filters: { key: FilterKey; label: string; danger?: boolean }[] = [
    { key: 'all',         label: 'All' },
    { key: 'overdue',     label: 'Overdue', danger: true },
    { key: 'due_soon',    label: 'Due Soon' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'pending',     label: 'Pending' },
    { key: 'complete',    label: 'Done' },
  ]

  return (
    <div className="p-8 max-w-4xl">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Tasks</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          All tasks across your releases.
        </p>
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {filters.map(f => {
          const count = counts[f.key]
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: active
                  ? f.danger ? '#f871711a' : 'var(--color-accent)'
                  : 'var(--color-surface)',
                border: `1px solid ${active
                  ? f.danger ? '#f87171' : 'var(--color-accent)'
                  : 'var(--color-border)'}`,
                color: active
                  ? f.danger ? '#f87171' : 'white'
                  : f.danger && count > 0 ? '#f87171' : 'var(--color-text-muted)',
              }}
            >
              {f.label}
              {count > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-xs font-bold"
                  style={{
                    background: active ? 'rgba(255,255,255,0.25)' : f.danger && count > 0 ? '#f871711a' : 'var(--color-surface-2)',
                    color: active ? 'inherit' : f.danger && count > 0 ? '#f87171' : 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Task list ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading tasks…</p>
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div
          className="rounded-xl p-12 text-center"
          style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {filter === 'all' ? 'No tasks yet. Create a release to generate your plan.' : `No ${filter.replace('_', ' ')} tasks right now.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Object.entries(grouped).map(([releaseId, relTasks]) => {
            const releaseTitle = relTasks[0].releaseTitle
            const releaseType = relTasks[0].releaseType
            const doneCount = relTasks.filter(t => t.status === 'complete').length

            return (
              <div key={releaseId}>
                {/* Release header */}
                <button
                  onClick={() => navigate(`/releases/${releaseId}`)}
                  className="flex items-center gap-2 mb-2 group"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider transition-opacity group-hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>
                    {releaseTitle}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}>
                    {releaseType}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {doneCount}/{relTasks.length}
                  </span>
                  <span className="text-xs opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--color-accent)' }}>→</span>
                </button>

                {/* Tasks */}
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {relTasks.map((task, idx) => {
                    const overdue = task.status !== 'complete' && task.status !== 'skipped' && isOverdue(task.due_date)
                    const soon = !overdue && task.status !== 'complete' && task.status !== 'skipped' && isDueSoon(task.due_date)
                    const isLast = idx === relTasks.length - 1

                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 px-4 py-3"
                        style={{
                          background: 'var(--color-surface)',
                          borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
                          opacity: task.status === 'skipped' ? 0.45 : 1,
                        }}
                      >
                        {/* Status toggle button */}
                        <button
                          onClick={() => cycleStatus(task)}
                          disabled={task.status === 'skipped' || updatingId === task.id}
                          className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all hover:scale-110"
                          style={{
                            borderColor: STATUS_COLORS[task.status],
                            background: task.status === 'complete' ? STATUS_COLORS.complete : 'transparent',
                            cursor: task.status === 'skipped' ? 'default' : 'pointer',
                          }}
                          title={`Status: ${STATUS_LABELS[task.status]} — click to advance`}
                        >
                          {task.status === 'complete' && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                          {task.status === 'in_progress' && (
                            <div className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS.in_progress }} />
                          )}
                        </button>

                        {/* Phase dot */}
                        <div
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: PHASE_COLORS[task.phase] ?? 'var(--color-border)' }}
                        />

                        {/* Title + meta */}
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-xs font-medium truncate"
                            style={{
                              color: task.status === 'complete' ? 'var(--color-text-muted)' : 'var(--color-text)',
                              textDecoration: task.status === 'complete' ? 'line-through' : 'none',
                            }}
                          >
                            {task.title}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                            {task.phase}{task.is_external ? ' · External' : ''}
                            {task.effort_hours > 0 ? ` · ${task.effort_hours}h` : ''}
                          </p>
                        </div>

                        {/* Due date */}
                        <div className="shrink-0 text-right">
                          <span
                            className="text-xs font-medium"
                            style={{ color: overdue ? '#f87171' : soon ? '#f59e0b' : 'var(--color-text-muted)' }}
                          >
                            {overdue ? '⚠ Overdue' : formatDate(task.due_date)}
                          </span>
                        </div>

                        {/* Go to release */}
                        <button
                          onClick={() => navigate(`/releases/${task.release_id}`)}
                          className="shrink-0 text-xs opacity-30 hover:opacity-70 transition-opacity"
                          style={{ color: 'var(--color-text-muted)' }}
                          title="Open release"
                        >
                          →
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
