// ============================================================
// CADENCE — TimelineView
//
// Dual-view timeline system inspired by Ableton Live's
// Session/Arrangement/Detail view architecture:
//
//  ◈ Graph View   — dependency node graph (primary)
//  ▬ Gantt View   — linear timeline bars (secondary)
//  ↕ Detail Panel — persistent bottom drawer (always follows selection)
//  ⚡ Pressure Map — task density heatmap overlay
//
// Aeon Timeline-inspired additions (Phase 1):
//  🔴 Dependency violation lines — red edges when ordering is broken
//  📋 Violation dialog — 3-option resolution when clicking red edges
//  ▓  Progress bars   — partial fill on in-progress Gantt bars
//
// Tab / G / T to switch views. Click any task to open Detail Panel.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  cascadeFromTask,
  formatDate,
  formatDateShort,
  isOverdue,
  isDueSoon,
  addDays,
  daysBetween,
} from '../lib/cascadeEngine'
import type { CascadeTask, CascadeDependency } from '../lib/cascadeEngine'
import type { TaskPhase, TaskStatus } from '../lib/releaseTemplates'
import { supabase } from '../lib/supabase'

// ============================================================
// Types
// ============================================================
export interface TimelineTask extends CascadeTask {
  title: string
  description: string
  phase: TaskPhase
  effort_hours: number
  is_external: boolean
  is_optional: boolean
  template_key: string | null
  sort_order: number
  status: TaskStatus
}

export interface TimelineDep extends CascadeDependency {
  lag_days: number
}

interface TimelineViewProps {
  tasks: TimelineTask[]
  deps: TimelineDep[]
  releaseDate: string | null
  onTasksChange: (tasks: TimelineTask[]) => void
  onCascade?: (affectedCount: number) => void
}

// ============================================================
// Constants
// ============================================================
const PHASES: TaskPhase[] = [
  'Pre-Production',
  'Production',
  'Distribution',
  'Marketing',
  'Release',
  'Post-Release',
]

const PHASE_COLORS: Record<TaskPhase, string> = {
  'Pre-Production': '#6366f1',
  'Production':     '#8b5cf6',
  'Distribution':   '#06b6d4',
  'Marketing':      '#f59e0b',
  'Release':        '#10b981',
  'Post-Release':   '#6b7280',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending:     'var(--color-text-muted)',
  in_progress: '#f59e0b',
  complete:    '#10b981',
  skipped:     '#6b7280',
}

type ViewMode = 'graph' | 'gantt'

// ============================================================
// Graph layout helpers
// ============================================================
interface NodeLayout {
  id: string
  x: number
  y: number
  task: TimelineTask
}

function computeGraphLayout(
  tasks: TimelineTask[],
  _deps: TimelineDep[],
  width: number
): NodeLayout[] {
  if (tasks.length === 0) return []

  const sorted = [...tasks].sort((a, b) =>
    (a.due_date ?? '').localeCompare(b.due_date ?? '')
  )

  const dates = sorted.map(t => t.due_date ?? '').filter(Boolean)
  if (dates.length === 0) return []

  const minDate = dates[0]
  const maxDate = dates[dates.length - 1]
  const totalDays = Math.max(daysBetween(minDate, maxDate), 1)

  const PADDING = 80
  const NODE_R = 22
  const usableWidth = width - PADDING * 2
  const PHASE_HEIGHT = 90

  const phaseIndex = Object.fromEntries(PHASES.map((p, i) => [p, i]))

  const nodes: NodeLayout[] = sorted.map(task => {
    const dayOffset = task.due_date ? daysBetween(minDate, task.due_date) : 0
    const x = PADDING + (dayOffset / totalDays) * usableWidth
    const y = PADDING + (phaseIndex[task.phase] ?? 0) * PHASE_HEIGHT + PHASE_HEIGHT / 2
    return { id: task.id, x, y, task }
  })

  // Collision resolution within same phase row
  const MAX_ITER = 30
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        if (Math.abs(a.y - b.y) > 5) continue
        const dx = b.x - a.x
        const dist = Math.abs(dx)
        const minDist = NODE_R * 2 + 8
        if (dist < minDist) {
          const push = (minDist - dist) / 2
          nodes[i].x -= push
          nodes[j].x += push
          moved = true
        }
      }
    }
    if (!moved) break
  }

  nodes.forEach(n => {
    n.x = Math.max(NODE_R + 40, Math.min(width - NODE_R - 40, n.x))
  })

  return nodes
}

// ============================================================
// Pressure map computation
// ============================================================
interface WeekBucket {
  weekStart: string
  taskCount: number
  effortHours: number
  tasks: TimelineTask[]
}

function computePressureMap(tasks: TimelineTask[]): WeekBucket[] {
  const active = tasks.filter(t => t.due_date && t.status !== 'complete' && t.status !== 'skipped')
  if (active.length === 0) return []

  const buckets = new Map<string, WeekBucket>()
  active.forEach(task => {
    if (!task.due_date) return
    const d = new Date(task.due_date + 'T12:00:00Z')
    const day = d.getUTCDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(d)
    monday.setUTCDate(monday.getUTCDate() + mondayOffset)
    const key = monday.toISOString().split('T')[0]
    if (!buckets.has(key)) {
      buckets.set(key, { weekStart: key, taskCount: 0, effortHours: 0, tasks: [] })
    }
    const b = buckets.get(key)!
    b.taskCount++
    b.effortHours += task.effort_hours ?? 0
    b.tasks.push(task)
  })

  return Array.from(buckets.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

// ============================================================
// Violation detection
//
// A dependency is violated when the downstream task (task_id)
// is due BEFORE the upstream task (depends_on_task_id) + lag.
// This is the Aeon "red line" concept — visible ordering conflict.
// ============================================================
function isDepViolated(dep: TimelineDep, nodeMap: Map<string, NodeLayout>): boolean {
  const from = nodeMap.get(dep.depends_on_task_id)
  const to   = nodeMap.get(dep.task_id)
  if (!from || !to) return false
  const fromDate = from.task.due_date
  const toDate   = to.task.due_date
  if (!fromDate || !toDate) return false
  // Violated if downstream is due before upstream + lag
  const minExpected = addDays(fromDate, dep.lag_days ?? 0)
  return toDate < minExpected
}

// ============================================================
// Violation Dialog
//
// Appears as a floating panel when clicking a red (violated)
// dependency edge. Inspired by Aeon Timeline's three-option
// resolution UI — framed for the music release context.
// ============================================================
interface ViolationDialogState {
  dep: TimelineDep
  fromTask: TimelineTask
  toTask: TimelineTask
  x: number
  y: number
}

interface ViolationDialogProps extends ViolationDialogState {
  onPushForward: () => void
  onDismiss: () => void
}

function ViolationDialog({ dep, fromTask, toTask, x, y, onPushForward, onDismiss }: ViolationDialogProps) {
  const expectedMinDate = addDays(fromTask.due_date ?? '', dep.lag_days ?? 0)
  const daysOff = toTask.due_date ? Math.abs(daysBetween(toTask.due_date, expectedMinDate)) : 0

  const panelW = 308
  const clampedX = Math.max(16, Math.min(x - panelW / 2, window.innerWidth - panelW - 16))
  const clampedY = Math.max(16, y - 8)

  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s

  return (
    <>
      {/* Click-outside overlay */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onClick={onDismiss}
      />
      <div
        style={{
          position: 'fixed',
          left: clampedX,
          top: clampedY,
          zIndex: 1000,
          width: panelW,
          background: 'var(--color-surface)',
          border: '1px solid #f8717140',
          borderRadius: 14,
          padding: '14px 16px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>⚠</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
            Dependency conflict
          </span>
        </div>

        {/* Explanation */}
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.65, marginBottom: 14 }}>
          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            {truncate(toTask.title, 28)}
          </span>{' '}
          is due {daysOff} day{daysOff !== 1 ? 's' : ''} too early —{' '}
          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            {truncate(fromTask.title, 28)}
          </span>{' '}
          needs to finish first
          {(dep.lag_days ?? 0) > 0 ? ` (+ ${dep.lag_days}d buffer)` : ''}.
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/* Primary: push the downstream task forward */}
          <button
            onClick={e => { e.stopPropagation(); onPushForward() }}
            style={{
              background: '#f8717112',
              border: '1px solid #f8717133',
              borderRadius: 9,
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 600,
              color: '#f87171',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Push "{truncate(toTask.title, 22)}" → {formatDate(expectedMinDate)}
          </button>

          {/* Dismiss */}
          <button
            onClick={e => { e.stopPropagation(); onDismiss() }}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
              borderRadius: 9,
              padding: '8px 12px',
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Dismiss for now
          </button>
        </div>
      </div>
    </>
  )
}

// ============================================================
// Detail Panel
// ============================================================
interface DetailPanelProps {
  task: TimelineTask | null
  tasks: TimelineTask[]
  deps: TimelineDep[]
  onClose: () => void
  onStatusChange: (task: TimelineTask, status: TaskStatus) => void
  onDateChange: (task: TimelineTask, date: string) => void
  onNavigateToTask: (taskId: string) => void
}

function DetailPanel({ task, tasks, deps, onClose, onStatusChange, onDateChange, onNavigateToTask }: DetailPanelProps) {
  const [panelHeight, setPanelHeight] = useState(320)
  const [isDragging, setIsDragging] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartY.current = e.clientY
    dragStartH.current = panelHeight
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY
      setPanelHeight(Math.max(200, Math.min(600, dragStartH.current + delta)))
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const depTaskIds = task ? deps.filter(d => d.task_id === task.id).map(d => d.depends_on_task_id) : []
  const blockedIds = task ? deps.filter(d => d.depends_on_task_id === task.id).map(d => d.task_id) : []
  const depTasks = depTaskIds.map(id => tasks.find(t => t.id === id)).filter(Boolean) as TimelineTask[]
  const blockedTasks = blockedIds.map(id => tasks.find(t => t.id === id)).filter(Boolean) as TimelineTask[]

  const isOpen = !!task

  return (
    <div
      ref={panelRef}
      className="shrink-0 flex flex-col"
      style={{
        height: isOpen ? panelHeight : 44,
        transition: isDragging ? 'none' : 'height 0.25s cubic-bezier(0.4,0,0.2,1)',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Resize handle */}
      {isOpen && (
        <div
          onMouseDown={onMouseDown}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            cursor: 'ns-resize',
            zIndex: 10,
            background: isDragging ? 'var(--color-accent)' : 'transparent',
            transition: 'background 0.15s',
          }}
        />
      )}

      {/* Panel header */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{
          height: 44,
          borderBottom: isOpen ? '1px solid var(--color-border)' : 'none',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-1 h-4 rounded-full"
            style={{ background: task ? PHASE_COLORS[task.phase] : 'var(--color-border)' }}
          />
          <span
            className="text-xs font-semibold"
            style={{ color: task ? 'var(--color-text)' : 'var(--color-text-muted)' }}
          >
            {task ? task.title : 'Select a task to inspect'}
          </span>
          {task && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: PHASE_COLORS[task.phase] + '22', color: PHASE_COLORS[task.phase] }}
            >
              {task.phase}
            </span>
          )}
          {task && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: task.status === 'complete' ? '#10b98122' : task.status === 'in_progress' ? '#f59e0b22' : 'var(--color-surface-2)',
                color: STATUS_COLORS[task.status],
              }}
            >
              {task.status.replace('_', ' ')}
            </span>
          )}
        </div>
        {isOpen && (
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:opacity-70 transition-opacity text-xs"
            style={{ color: 'var(--color-text-muted)', background: 'var(--color-surface-2)' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Panel body */}
      {isOpen && task && (
        <div className="flex-1 overflow-y-auto p-5 flex gap-6">
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              {task.description}
            </p>

            <div className="flex gap-5 flex-wrap">
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>Due date</p>
                {editingDate ? (
                  <input
                    type="date"
                    defaultValue={task.due_date ?? ''}
                    autoFocus
                    className="text-xs rounded px-2 py-1 outline-none"
                    style={{
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-accent)',
                      color: 'var(--color-text)',
                    }}
                    onBlur={(e) => {
                      setEditingDate(false)
                      if (e.target.value && e.target.value !== task.due_date) onDateChange(task, e.target.value)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setEditingDate(false)
                        const v = (e.target as HTMLInputElement).value
                        if (v && v !== task.due_date) onDateChange(task, v)
                      }
                      if (e.key === 'Escape') setEditingDate(false)
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setEditingDate(true)}
                    className="text-xs px-2 py-1 rounded hover:opacity-80 transition-opacity"
                    style={{
                      color: isOverdue(task.due_date) ? '#f87171' : isDueSoon(task.due_date) ? '#f59e0b' : 'var(--color-text)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {task.due_date ? formatDate(task.due_date) : 'Set date'}
                  </button>
                )}
              </div>

              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>Status</p>
                <select
                  value={task.status}
                  onChange={(e) => onStatusChange(task, e.target.value as TaskStatus)}
                  className="text-xs rounded px-2 py-1 outline-none"
                  style={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    color: STATUS_COLORS[task.status],
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Complete</option>
                  <option value="skipped">Skipped</option>
                </select>
              </div>

              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>Effort</p>
                <p className="text-xs py-1" style={{ color: 'var(--color-text)' }}>{task.effort_hours}h</p>
              </div>

              {task.is_external && (
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>Type</p>
                  <span className="text-xs py-1" style={{ color: '#f59e0b' }}>↗ External</span>
                </div>
              )}
              {task.is_optional && (
                <div>
                  <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>Optional</p>
                  <span className="text-xs py-1" style={{ color: 'var(--color-text-muted)' }}>Yes</span>
                </div>
              )}
            </div>
          </div>

          {/* Dependency chains */}
          <div className="flex flex-col gap-4 min-w-[220px]">
            {depTasks.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>BLOCKED BY</p>
                <div className="flex flex-col gap-1.5">
                  {depTasks.map(dt => (
                    <button
                      key={dt.id}
                      onClick={() => onNavigateToTask(dt.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:opacity-80 transition-opacity"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: `1px solid ${dt.status === 'complete' ? '#10b98133' : 'var(--color-border)'}`,
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PHASE_COLORS[dt.phase] }} />
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text)' }}>{dt.title}</span>
                      {dt.status === 'complete' && <span className="text-xs shrink-0" style={{ color: '#10b981' }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {blockedTasks.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>UNLOCKS</p>
                <div className="flex flex-col gap-1.5">
                  {blockedTasks.map(bt => (
                    <button
                      key={bt.id}
                      onClick={() => onNavigateToTask(bt.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:opacity-80 transition-opacity"
                      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PHASE_COLORS[bt.phase] }} />
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--color-text-muted)' }}>{bt.title}</span>
                      <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>→</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// Graph View
// ============================================================
interface GraphViewProps {
  tasks: TimelineTask[]
  deps: TimelineDep[]
  selectedTaskId: string | null
  hoveredTaskId: string | null
  cascadingIds: Set<string>
  onSelectTask: (id: string | null) => void
  onHoverTask: (id: string | null) => void
  showPressure: boolean
  onEdgeClick?: (dep: TimelineDep, fromTask: TimelineTask, toTask: TimelineTask, x: number, y: number) => void
}

function GraphView({
  tasks,
  deps,
  selectedTaskId,
  hoveredTaskId,
  cascadingIds,
  onSelectTask,
  onHoverTask,
  showPressure,
  onEdgeClick,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setMounted(false)
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [tasks.length])

  const NODE_R = 22
  const PHASE_HEIGHT = 90
  const PADDING = 80

  const nodes = useMemo(() => computeGraphLayout(tasks, deps, width), [tasks, deps, width])
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  const hoveredAncestors = useMemo(() => {
    if (!hoveredTaskId) return new Set<string>()
    const result = new Set<string>()
    const queue = [hoveredTaskId]
    while (queue.length) {
      const curr = queue.shift()!
      deps.filter(d => d.task_id === curr).forEach(d => {
        if (!result.has(d.depends_on_task_id)) {
          result.add(d.depends_on_task_id)
          queue.push(d.depends_on_task_id)
        }
      })
    }
    return result
  }, [hoveredTaskId, deps])

  const hoveredDescendants = useMemo(() => {
    if (!hoveredTaskId) return new Set<string>()
    const result = new Set<string>()
    const queue = [hoveredTaskId]
    while (queue.length) {
      const curr = queue.shift()!
      deps.filter(d => d.depends_on_task_id === curr).forEach(d => {
        if (!result.has(d.task_id)) {
          result.add(d.task_id)
          queue.push(d.task_id)
        }
      })
    }
    return result
  }, [hoveredTaskId, deps])

  const svgHeight = PADDING * 2 + PHASES.length * PHASE_HEIGHT

  const pressureBuckets = useMemo(() => showPressure ? computePressureMap(tasks) : [], [tasks, showPressure])
  const maxPressure = useMemo(() => Math.max(1, ...pressureBuckets.map(b => b.taskCount)), [pressureBuckets])

  const dateToX = useCallback((isoDate: string): number => {
    const allDates = tasks.map(t => t.due_date ?? '').filter(Boolean).sort()
    if (allDates.length === 0) return 0
    const minDate = allDates[0]
    const maxDate = allDates[allDates.length - 1]
    const totalDays = Math.max(daysBetween(minDate, maxDate), 1)
    const usableWidth = width - PADDING * 2
    return PADDING + (daysBetween(minDate, isoDate) / totalDays) * usableWidth
  }, [tasks, width])

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
        No tasks to display
      </div>
    )
  }

  const todayISO = new Date().toISOString().split('T')[0]
  const allDates = tasks.map(t => t.due_date ?? '').filter(Boolean).sort()
  const minDate = allDates[0]
  const maxDate = allDates[allDates.length - 1]
  const showToday = todayISO >= minDate && todayISO <= maxDate
  const todayX = showToday ? dateToX(todayISO) : null

  // Count violations for the badge
  const violationCount = deps.filter(dep => isDepViolated(dep, nodeMap)).length

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto"
      style={{ minHeight: svgHeight + 32 }}
    >
      {/* Violation count badge */}
      {violationCount > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 16,
            zIndex: 10,
            background: '#f8717115',
            border: '1px solid #f8717140',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            color: '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            pointerEvents: 'none',
          }}
        >
          ⚠ {violationCount} conflict{violationCount !== 1 ? 's' : ''} — click red lines to resolve
        </div>
      )}

      {/* Phase lane labels */}
      <div
        className="absolute left-0 top-0 flex flex-col pointer-events-none"
        style={{ paddingTop: PADDING - 12, gap: 0 }}
      >
        {PHASES.map((phase) => {
          const hasTasks = tasks.some(t => t.phase === phase)
          if (!hasTasks) return null
          return (
            <div
              key={phase}
              style={{ height: PHASE_HEIGHT, display: 'flex', alignItems: 'center', paddingLeft: 8 }}
            >
              <span
                className="text-xs font-semibold"
                style={{
                  color: PHASE_COLORS[phase] + 'cc',
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  letterSpacing: '0.05em',
                  fontSize: 10,
                }}
              >
                {phase.toUpperCase()}
              </span>
            </div>
          )
        })}
      </div>

      <svg width={width} height={svgHeight} style={{ display: 'block', overflow: 'visible' }}>
        {/* Phase lane backgrounds */}
        {PHASES.map((phase, i) => {
          const hasTasks = tasks.some(t => t.phase === phase)
          if (!hasTasks) return null
          const y = PADDING + i * PHASE_HEIGHT
          return (
            <rect
              key={phase}
              x={0} y={y} width={width} height={PHASE_HEIGHT}
              fill={i % 2 === 0 ? 'var(--color-surface)' : 'transparent'}
              opacity={0.4}
            />
          )
        })}

        {/* Pressure map overlay */}
        {showPressure && pressureBuckets.map((bucket) => {
          const x = dateToX(bucket.weekStart)
          const intensity = bucket.taskCount / maxPressure
          const hue = 45 - intensity * 45
          const alpha = 0.12 + intensity * 0.22
          return (
            <rect
              key={bucket.weekStart}
              x={x} y={PADDING - 30}
              width={Math.max(dateToX(addDays(bucket.weekStart, 7)) - x, 20)}
              height={svgHeight - PADDING + 30}
              fill={`hsla(${hue}, 90%, 60%, ${alpha})`}
              rx={4}
            />
          )
        })}

        {/* Today line */}
        {todayX !== null && (
          <g>
            <line
              x1={todayX} y1={PADDING - 20} x2={todayX} y2={svgHeight - PADDING + 20}
              stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7}
            />
            <circle cx={todayX} cy={PADDING - 20} r={3} fill="var(--color-accent)" />
            <text x={todayX + 5} y={PADDING - 22} fill="var(--color-accent)" fontSize={9} fontWeight="600" opacity={0.85}>
              TODAY
            </text>
          </g>
        )}

        {/* ── Dependency edges — Aeon-inspired violation coloring ── */}
        <defs>
          <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="var(--color-border)" opacity={0.4} />
          </marker>
          <marker id="arrow-highlight" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="var(--color-accent)" />
          </marker>
          <marker id="arrow-cascade" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#f59e0b" />
          </marker>
          <marker id="arrow-violated" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6 Z" fill="#f87171" />
          </marker>
        </defs>

        {deps.map((dep, i) => {
          const from = nodeMap.get(dep.depends_on_task_id)
          const to   = nodeMap.get(dep.task_id)
          if (!from || !to) return null

          const violated = isDepViolated(dep, nodeMap)

          const isHighlighted =
            hoveredTaskId === dep.task_id ||
            hoveredTaskId === dep.depends_on_task_id ||
            (hoveredTaskId && (
              hoveredAncestors.has(dep.depends_on_task_id) ||
              hoveredDescendants.has(dep.task_id) ||
              dep.task_id === hoveredTaskId ||
              dep.depends_on_task_id === hoveredTaskId
            ))

          const isCascading = cascadingIds.has(dep.task_id) || cascadingIds.has(dep.depends_on_task_id)
          const dim = hoveredTaskId && !isHighlighted && !violated

          // Bezier path
          const sx = from.x + NODE_R
          const sy = from.y
          const ex = to.x - NODE_R
          const ey = to.y
          const cx1 = sx + (ex - sx) * 0.4
          const cy1 = sy
          const cx2 = ex - (ex - sx) * 0.4
          const cy2 = ey
          const pathD = `M ${sx} ${sy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`

          // Color logic — violated = red, otherwise existing logic
          const edgeColor = violated
            ? '#f87171'
            : isCascading
              ? '#f59e0b'
              : isHighlighted
                ? 'var(--color-accent)'
                : 'var(--color-border)'

          const edgeWidth = violated
            ? 2
            : isCascading ? 2 : isHighlighted ? 1.5 : 1

          const edgeOpacity = violated
            ? 0.9
            : dim ? 0.15 : isCascading ? 0.9 : isHighlighted ? 0.8 : 0.35

          const markerId = violated
            ? 'arrow-violated'
            : isCascading
              ? 'arrow-cascade'
              : isHighlighted
                ? 'arrow-highlight'
                : 'arrow-default'

          return (
            <g key={`${dep.task_id}-${dep.depends_on_task_id}-${i}`}>
              {/* Visible edge */}
              <path
                d={pathD}
                fill="none"
                stroke={edgeColor}
                strokeWidth={edgeWidth}
                opacity={edgeOpacity}
                markerEnd={`url(#${markerId})`}
                style={{ transition: 'opacity 0.2s, stroke 0.3s' }}
                // Animated dash for violations to draw the eye
                strokeDasharray={violated ? '5 3' : undefined}
              />

              {/* Wide invisible hit area — clickable for violated edges */}
              {violated && onEdgeClick && (
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdgeClick(dep, from.task, to.task, e.clientX, e.clientY)
                  }}
                />
              )}
            </g>
          )
        })}

        {/* Task nodes */}
        {nodes.map((node, idx) => {
          const { task } = node
          const isSelected = selectedTaskId === task.id
          const isHovered = hoveredTaskId === task.id
          const isAncestor = hoveredAncestors.has(task.id)
          const isDescendant = hoveredDescendants.has(task.id)
          const isCascading = cascadingIds.has(task.id)
          const dim = hoveredTaskId && !isHovered && !isAncestor && !isDescendant
          const overdue = task.status !== 'complete' && task.status !== 'skipped' && isOverdue(task.due_date)
          const soon = !overdue && task.status !== 'complete' && isDueSoon(task.due_date)

          const phaseColor = PHASE_COLORS[task.phase]
          const nodeColor = task.status === 'complete'
            ? '#10b981'
            : task.status === 'in_progress'
              ? '#f59e0b'
              : overdue
                ? '#f87171'
                : phaseColor

          const enterDelay = idx * 30

          return (
            <g
              key={task.id}
              style={{
                cursor: 'pointer',
                opacity: mounted ? (dim ? 0.2 : 1) : 0,
                transform: mounted
                  ? `translate(${node.x}px, ${node.y}px) scale(1)`
                  : `translate(${node.x}px, ${node.y}px) scale(0.4)`,
                transition: `opacity 0.2s, transform 0.35s cubic-bezier(0.34,1.56,0.64,1) ${enterDelay}ms`,
              }}
              onClick={() => onSelectTask(isSelected ? null : task.id)}
              onMouseEnter={() => onHoverTask(task.id)}
              onMouseLeave={() => onHoverTask(null)}
            >
              {isCascading && (
                <circle r={NODE_R + 8} fill="none" stroke="#f59e0b" strokeWidth={2} opacity={0.6}
                  style={{ animation: 'cascadePulse 1s ease-out forwards' }} />
              )}
              {isSelected && (
                <circle r={NODE_R + 5} fill="none" stroke="var(--color-accent)" strokeWidth={2} opacity={0.8} />
              )}
              <circle
                r={NODE_R}
                fill={`${nodeColor}22`}
                stroke={nodeColor}
                strokeWidth={isSelected || isHovered ? 2.5 : 1.5}
                style={{ transition: 'stroke-width 0.15s, fill 0.2s' }}
              />
              {task.status === 'complete' && <text textAnchor="middle" dy="0.35em" fontSize={14} fill="#10b981">✓</text>}
              {task.status === 'in_progress' && <circle r={5} fill="#f59e0b" />}
              {task.status === 'skipped' && <text textAnchor="middle" dy="0.35em" fontSize={12} fill="#6b7280">—</text>}
              {task.status === 'pending' && <circle r={4} fill="none" stroke={phaseColor} strokeWidth={1.5} />}
              {task.is_external && <text x={NODE_R - 6} y={-NODE_R + 6} fontSize={9} fill="#f59e0b">↗</text>}
              <text
                textAnchor="middle" y={NODE_R + 14}
                fontSize={9.5}
                fontWeight={isSelected || isHovered ? '600' : '400'}
                fill={isSelected || isHovered ? 'var(--color-text)' : 'var(--color-text-muted)'}
                style={{ transition: 'fill 0.15s', pointerEvents: 'none' }}
              >
                {task.title.length > 16 ? task.title.slice(0, 15) + '…' : task.title}
              </text>
              <text
                textAnchor="middle" y={NODE_R + 26}
                fontSize={8}
                fill={overdue ? '#f87171' : soon ? '#f59e0b' : 'var(--color-text-muted)'}
                opacity={0.8}
                style={{ pointerEvents: 'none' }}
              >
                {task.due_date ? formatDateShort(task.due_date) : ''}
              </text>
            </g>
          )
        })}
      </svg>

      <style>{`
        @keyframes cascadePulse {
          0%   { r: 24px; opacity: 0.8; }
          100% { r: 42px; opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ============================================================
// Gantt View
// ============================================================
interface GanttViewProps {
  tasks: TimelineTask[]
  deps: TimelineDep[]
  selectedTaskId: string | null
  hoveredTaskId: string | null
  cascadingIds: Set<string>
  onSelectTask: (id: string | null) => void
  onHoverTask: (id: string | null) => void
  showPressure: boolean
  onDragDate?: (task: TimelineTask, newDate: string) => void
}

function GanttView({
  tasks,
  deps: _deps,
  selectedTaskId,
  hoveredTaskId,
  cascadingIds,
  onSelectTask,
  onHoverTask,
  showPressure,
  onDragDate,
}: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [mounted, setMounted] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPreviewDate, setDragPreviewDate] = useState<string | null>(null)
  const dragStartX = useRef(0)
  const dragOrigDate = useRef('')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setMounted(false)
    const t = setTimeout(() => setMounted(true), 30)
    return () => clearTimeout(t)
  }, [tasks.length])

  const ROW_H = 40
  const ROW_GAP = 6
  const LABEL_W = 180
  const PADDING_TOP = 50

  const allDates = useMemo(() => tasks.map(t => t.due_date ?? '').filter(Boolean).sort(), [tasks])

  const minDate = allDates[0] ?? new Date().toISOString().split('T')[0]
  const maxDateRaw = allDates[allDates.length - 1] ?? addDays(minDate, 30)
  const maxDate = addDays(maxDateRaw, 7)
  const totalDays = Math.max(daysBetween(minDate, maxDate), 1)
  const chartWidth = width - LABEL_W - 24

  const dateToChartX = useCallback((isoDate: string) => {
    return LABEL_W + (daysBetween(minDate, isoDate) / totalDays) * chartWidth
  }, [minDate, totalDays, chartWidth])

  const chartXToDate = useCallback((x: number): string => {
    const days = Math.round(((x - LABEL_W) / chartWidth) * totalDays)
    return addDays(minDate, Math.max(0, days))
  }, [minDate, totalDays, chartWidth])

  const sortedTasks = useMemo(() =>
    [...tasks].sort((a, b) => {
      const pi = PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase)
      if (pi !== 0) return pi
      return (a.due_date ?? '').localeCompare(b.due_date ?? '')
    }),
    [tasks]
  )

  const pressureBuckets = useMemo(() => showPressure ? computePressureMap(tasks) : [], [tasks, showPressure])
  const maxPressure = useMemo(() => Math.max(1, ...pressureBuckets.map(b => b.taskCount)), [pressureBuckets])

  const svgHeight = PADDING_TOP + sortedTasks.length * (ROW_H + ROW_GAP) + 20
  const todayISO = new Date().toISOString().split('T')[0]

  const startDrag = useCallback((e: React.MouseEvent, task: TimelineTask) => {
    e.stopPropagation()
    e.preventDefault()
    setDraggingId(task.id)
    dragStartX.current = e.clientX
    dragOrigDate.current = task.due_date ?? todayISO
    setDragPreviewDate(task.due_date)
  }, [todayISO])

  useEffect(() => {
    if (!draggingId) return
    const container = containerRef.current
    if (!container) return
    const onMove = (e: MouseEvent) => {
      const containerRect = container.getBoundingClientRect()
      setDragPreviewDate(chartXToDate(e.clientX - containerRect.left))
    }
    const onUp = (e: MouseEvent) => {
      const containerRect = container.getBoundingClientRect()
      const newDate = chartXToDate(e.clientX - containerRect.left)
      const task = sortedTasks.find(t => t.id === draggingId)
      if (task && newDate !== dragOrigDate.current && onDragDate) {
        onDragDate(task, newDate)
      }
      setDraggingId(null)
      setDragPreviewDate(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [draggingId, chartXToDate, sortedTasks, onDragDate])

  const weekTicks = useMemo(() => {
    const ticks: { isoDate: string; x: number; label: string }[] = []
    let curr = minDate
    while (curr <= maxDate) {
      const x = dateToChartX(curr)
      const [y, m, d] = curr.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      ticks.push({ isoDate: curr, x, label: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) })
      curr = addDays(curr, 7)
    }
    return ticks
  }, [minDate, maxDate, dateToChartX])

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto"
      style={{ cursor: draggingId ? 'grabbing' : 'default' }}
    >
      <svg width={width} height={svgHeight} style={{ display: 'block' }}>

        {/* Pressure map */}
        {showPressure && pressureBuckets.map(bucket => {
          const x = dateToChartX(bucket.weekStart)
          const endX = dateToChartX(addDays(bucket.weekStart, 7))
          const intensity = bucket.taskCount / maxPressure
          const hue = 45 - intensity * 45
          return (
            <rect
              key={bucket.weekStart}
              x={x} y={0} width={endX - x} height={svgHeight}
              fill={`hsla(${hue}, 90%, 60%, ${0.1 + intensity * 0.2})`}
            />
          )
        })}

        {/* Row backgrounds */}
        {sortedTasks.map((task, i) => (
          <rect
            key={`bg-${task.id}`}
            x={0}
            y={PADDING_TOP + i * (ROW_H + ROW_GAP) + ROW_GAP / 2}
            width={width}
            height={ROW_H}
            fill={hoveredTaskId === task.id ? 'var(--color-surface-2)' : i % 2 === 0 ? 'var(--color-surface)' : 'transparent'}
            opacity={0.5}
            rx={4}
            style={{ transition: 'fill 0.15s' }}
          />
        ))}

        {/* Week grid lines */}
        {weekTicks.map(tick => (
          <g key={tick.isoDate}>
            <line x1={tick.x} y1={PADDING_TOP - 8} x2={tick.x} y2={svgHeight} stroke="var(--color-border)" strokeWidth={0.5} opacity={0.4} />
            <text x={tick.x + 4} y={PADDING_TOP - 14} fontSize={9} fill="var(--color-text-muted)" opacity={0.7}>
              {tick.label}
            </text>
          </g>
        ))}

        {/* Today line */}
        {todayISO >= minDate && todayISO <= maxDate && (
          <g>
            <line
              x1={dateToChartX(todayISO)} y1={0} x2={dateToChartX(todayISO)} y2={svgHeight}
              stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.7}
            />
            <circle cx={dateToChartX(todayISO)} cy={PADDING_TOP - 4} r={3} fill="var(--color-accent)" />
          </g>
        )}

        {/* Task rows */}
        {sortedTasks.map((task, i) => {
          const y = PADDING_TOP + i * (ROW_H + ROW_GAP)
          const isSelected = selectedTaskId === task.id
          const overdue = task.status !== 'complete' && task.status !== 'skipped' && isOverdue(task.due_date)
          const soon = !overdue && task.status !== 'complete' && isDueSoon(task.due_date)
          const isCascading = cascadingIds.has(task.id)
          const isDraggingThis = draggingId === task.id

          const phaseColor = PHASE_COLORS[task.phase]
          const barColor = task.status === 'complete' ? '#10b981'
            : isCascading ? '#f59e0b'
              : overdue ? '#f87171'
                : soon ? '#f59e0b'
                  : phaseColor

          const taskDate = isDraggingThis && dragPreviewDate ? dragPreviewDate : (task.due_date ?? minDate)
          const barEndX = dateToChartX(taskDate)
          const barStartX = Math.max(LABEL_W, barEndX - Math.max(16, (task.effort_hours ?? 1) * 4))
          const barW = Math.max(12, barEndX - barStartX)
          const barH = 18
          const barY = y + (ROW_H - barH) / 2

          // Progress fill — Aeon-inspired partial fill for in-progress tasks
          const progressFill = task.status === 'complete' ? 1
            : task.status === 'in_progress' ? 0.5
              : 0

          const enterDelay = i * 20

          return (
            <g
              key={task.id}
              style={{ cursor: 'pointer', opacity: mounted ? 1 : 0, transition: `opacity 0.3s ${enterDelay}ms` }}
              onMouseEnter={() => onHoverTask(task.id)}
              onMouseLeave={() => onHoverTask(null)}
              onClick={() => onSelectTask(isSelected ? null : task.id)}
            >
              {/* Label */}
              <text
                x={8} y={y + ROW_H / 2 + 1}
                fontSize={10}
                fontWeight={isSelected ? '600' : '400'}
                fill={isSelected ? 'var(--color-text)' : 'var(--color-text-muted)'}
                dominantBaseline="middle"
                style={{ transition: 'fill 0.15s' }}
              >
                {task.title.length > 22 ? task.title.slice(0, 21) + '…' : task.title}
              </text>

              {/* Phase dot */}
              <circle cx={LABEL_W - 12} cy={y + ROW_H / 2} r={4} fill={phaseColor} opacity={0.8} />

              {/* Bar shell */}
              <rect
                x={barStartX} y={barY}
                width={mounted ? barW : 0} height={barH}
                rx={5}
                fill={`${barColor}22`}
                stroke={barColor}
                strokeWidth={isSelected ? 2 : 1}
                style={{
                  transition: isDraggingThis ? 'none' : `width 0.4s cubic-bezier(0.4,0,0.2,1) ${enterDelay}ms, stroke-width 0.15s`,
                }}
              />

              {/* Progress fill — Aeon-inspired completion indicator */}
              {progressFill > 0 && (
                <rect
                  x={barStartX} y={barY}
                  width={barW * progressFill} height={barH}
                  rx={5}
                  fill={barColor}
                  opacity={0.35}
                  style={{
                    transition: isDraggingThis ? 'none' : `width 0.5s cubic-bezier(0.4,0,0.2,1) ${enterDelay}ms`,
                  }}
                />
              )}

              {/* Drag handle */}
              <rect
                x={barEndX - 6} y={barY + 2}
                width={6} height={barH - 4}
                rx={2}
                fill={barColor} opacity={0.7}
                style={{ cursor: 'ew-resize' }}
                onMouseDown={(e) => startDrag(e, task)}
              />

              {/* Complete tick */}
              {task.status === 'complete' && (
                <text x={barStartX + 6} y={barY + barH / 2 + 1} fontSize={9} fill="#10b981" dominantBaseline="middle">✓</text>
              )}

              {/* In-progress half-fill label */}
              {task.status === 'in_progress' && (
                <text x={barStartX + 6} y={barY + barH / 2 + 1} fontSize={8} fill="#f59e0b" dominantBaseline="middle" opacity={0.85}>···</text>
              )}

              {/* Cascade shimmer */}
              {isCascading && (
                <rect
                  x={barStartX} y={barY} width={barW} height={barH} rx={5}
                  fill="none" stroke="#f59e0b" strokeWidth={2} opacity={0.8}
                  style={{ animation: 'cascadeShimmer 0.8s ease-out forwards' }}
                />
              )}

              {/* Due date label */}
              <text
                x={barEndX + 6} y={y + ROW_H / 2 + 1}
                fontSize={9}
                fill={overdue ? '#f87171' : soon ? '#f59e0b' : 'var(--color-text-muted)'}
                dominantBaseline="middle"
                opacity={isDraggingThis ? 1 : 0.8}
              >
                {isDraggingThis && dragPreviewDate
                  ? formatDateShort(dragPreviewDate)
                  : task.due_date ? formatDateShort(task.due_date) : ''}
              </text>
            </g>
          )
        })}
      </svg>

      <style>{`
        @keyframes cascadeShimmer {
          0%   { opacity: 0.9; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ============================================================
// Pressure Map Tooltip
// ============================================================
function PressureTooltip({ buckets, maxPressure }: { buckets: WeekBucket[]; maxPressure: number }) {
  const [hovered, setHovered] = useState<WeekBucket | null>(null)

  return (
    <div className="flex items-center gap-1 relative">
      <span className="text-xs font-medium mr-1" style={{ color: 'var(--color-text-muted)' }}>Load:</span>
      {buckets.slice(0, 12).map(bucket => {
        const intensity = bucket.taskCount / maxPressure
        const hue = 45 - intensity * 45
        return (
          <div
            key={bucket.weekStart}
            className="relative"
            onMouseEnter={() => setHovered(bucket)}
            onMouseLeave={() => setHovered(null)}
          >
            <div style={{
              width: 10, height: 20, borderRadius: 2,
              background: `hsla(${hue}, 90%, 60%, ${0.25 + intensity * 0.65})`,
              border: '1px solid var(--color-border)',
              cursor: 'default',
            }} />
            {hovered === bucket && (
              <div
                className="absolute bottom-full mb-1 left-1/2 z-50 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap"
                style={{
                  transform: 'translateX(-50%)',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              >
                <p className="font-semibold">{formatDateShort(bucket.weekStart)} week</p>
                <p style={{ color: 'var(--color-text-muted)' }}>{bucket.taskCount} tasks · {bucket.effortHours}h</p>
                {bucket.taskCount >= maxPressure && <p style={{ color: '#f87171' }}>⚠ Heaviest week</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// Main TimelineView
// ============================================================
export default function TimelineView({
  tasks,
  deps,
  releaseDate: _releaseDate,
  onTasksChange,
  onCascade,
}: TimelineViewProps) {
  const [view, setView] = useState<ViewMode>('graph')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)
  const [showPressure, setShowPressure] = useState(false)
  const [cascadingIds, setCascadingIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [violationDialog, setViolationDialog] = useState<ViolationDialogState | null>(null)

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  )

  const pressureBuckets = useMemo(() => computePressureMap(tasks), [tasks])
  const maxPressure = useMemo(() => Math.max(1, ...pressureBuckets.map(b => b.taskCount)), [pressureBuckets])

  // Keyboard shortcuts: G / T / Tab / Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'g' || e.key === 'G') setView('graph')
      if (e.key === 't' || e.key === 'T') setView('gantt')
      if (e.key === 'Tab') {
        e.preventDefault()
        setView(v => v === 'graph' ? 'gantt' : 'graph')
      }
      if (e.key === 'Escape') {
        setSelectedTaskId(null)
        setViolationDialog(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const flashCascade = useCallback((ids: string[]) => {
    setCascadingIds(new Set(ids))
    setTimeout(() => setCascadingIds(new Set()), 1500)
  }, [])

  const handleDateChange = useCallback(async (task: TimelineTask, newDate: string) => {
    if (!newDate || newDate === task.due_date) return
    setSaving(true)

    const result = cascadeFromTask(task.id, newDate, tasks, deps)
    const updatedTasks = tasks.map(t =>
      result.updates[t.id] ? { ...t, due_date: result.updates[t.id] } : t
    )
    onTasksChange(updatedTasks)

    const affected = Object.keys(result.updates).filter(id => id !== task.id)
    flashCascade([task.id, ...affected])
    if (result.affectedCount > 0) onCascade?.(result.affectedCount)

    await Promise.all(
      Object.entries(result.updates).map(([tid, date]) =>
        supabase.from('tasks').update({ due_date: date }).eq('id', tid)
      )
    )
    setSaving(false)
  }, [tasks, deps, onTasksChange, onCascade, flashCascade])

  const handleStatusChange = useCallback(async (task: TimelineTask, status: TaskStatus) => {
    const updated = tasks.map(t => t.id === task.id ? { ...t, status } : t)
    onTasksChange(updated)
    await supabase.from('tasks').update({ status }).eq('id', task.id)
  }, [tasks, onTasksChange])

  const navigateToTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId)
  }, [])

  // Violation edge click handler
  const handleEdgeClick = useCallback((
    dep: TimelineDep,
    fromTask: TimelineTask,
    toTask: TimelineTask,
    x: number,
    y: number
  ) => {
    setViolationDialog({ dep, fromTask, toTask, x, y })
  }, [])

  // Resolve: push the downstream task to the expected date
  const handleViolationResolve = useCallback(() => {
    if (!violationDialog) return
    const { dep, fromTask, toTask } = violationDialog
    const expectedDate = addDays(fromTask.due_date ?? '', dep.lag_days ?? 0)
    setViolationDialog(null)
    handleDateChange(toTask, expectedDate)
  }, [violationDialog, handleDateChange])

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        height: 680,
      }}
    >
      {/* ── Toolbar ── */}
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{
          height: 44,
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        {/* View toggle */}
        <div
          className="flex rounded-lg overflow-hidden shrink-0"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => setView('graph')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all"
            style={{
              background: view === 'graph' ? 'var(--color-accent)' : 'var(--color-surface-2)',
              color: view === 'graph' ? 'white' : 'var(--color-text-muted)',
              borderRight: '1px solid var(--color-border)',
            }}
            title="Graph view (G)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="2" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="6.5" cy="2" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="11" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
              <circle cx="6.5" cy="11" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
              <line x1="3.8" y1="6.5" x2="4.7" y2="6.5" stroke="currentColor" strokeWidth="1.3"/>
              <line x1="8.3" y1="6.5" x2="9.2" y2="6.5" stroke="currentColor" strokeWidth="1.3"/>
              <line x1="6.5" y1="3.8" x2="6.5" y2="4.7" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            Graph
          </button>
          <button
            onClick={() => setView('gantt')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all"
            style={{
              background: view === 'gantt' ? 'var(--color-accent)' : 'var(--color-surface-2)',
              color: view === 'gantt' ? 'white' : 'var(--color-text-muted)',
            }}
            title="Timeline view (T)"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <rect x="1" y="3" width="8" height="2" rx="1" fill="currentColor" opacity="0.8"/>
              <rect x="4" y="7" width="7" height="2" rx="1" fill="currentColor" opacity="0.8"/>
              <rect x="1" y="9" width="5" height="2" rx="1" fill="currentColor" opacity="0.8"/>
            </svg>
            Timeline
          </button>
        </div>

        <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}>
          G · T · Tab
        </span>

        <div className="flex-1" />

        {/* Pressure map toggle */}
        <button
          onClick={() => setShowPressure(p => !p)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            background: showPressure ? '#f59e0b22' : 'var(--color-surface-2)',
            color: showPressure ? '#f59e0b' : 'var(--color-text-muted)',
            border: `1px solid ${showPressure ? '#f59e0b44' : 'var(--color-border)'}`,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="0" y="8" width="2.5" height="4" rx="1" fill="currentColor" opacity="0.4"/>
            <rect x="3.2" y="5" width="2.5" height="7" rx="1" fill="currentColor" opacity="0.65"/>
            <rect x="6.5" y="2" width="2.5" height="10" rx="1" fill="currentColor" opacity="0.85"/>
            <rect x="9.5" y="6" width="2.5" height="6" rx="1" fill="currentColor" opacity="0.6"/>
          </svg>
          Load
        </button>

        {showPressure && pressureBuckets.length > 0 && (
          <PressureTooltip buckets={pressureBuckets} maxPressure={maxPressure} />
        )}

        {saving && (
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Saving…</span>
        )}
      </div>

      {/* ── Main canvas ── */}
      <div className="flex-1 relative overflow-hidden">
        <div
          className="absolute inset-0 flex"
          style={{
            opacity: view === 'graph' ? 1 : 0,
            pointerEvents: view === 'graph' ? 'auto' : 'none',
            transition: 'opacity 0.2s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          <GraphView
            tasks={tasks}
            deps={deps}
            selectedTaskId={selectedTaskId}
            hoveredTaskId={hoveredTaskId}
            cascadingIds={cascadingIds}
            onSelectTask={setSelectedTaskId}
            onHoverTask={setHoveredTaskId}
            showPressure={showPressure}
            onEdgeClick={handleEdgeClick}
          />
        </div>

        <div
          className="absolute inset-0 flex"
          style={{
            opacity: view === 'gantt' ? 1 : 0,
            pointerEvents: view === 'gantt' ? 'auto' : 'none',
            transition: 'opacity 0.2s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          <GanttView
            tasks={tasks}
            deps={deps}
            selectedTaskId={selectedTaskId}
            hoveredTaskId={hoveredTaskId}
            cascadingIds={cascadingIds}
            onSelectTask={setSelectedTaskId}
            onHoverTask={setHoveredTaskId}
            showPressure={showPressure}
            onDragDate={handleDateChange}
          />
        </div>
      </div>

      {/* ── Detail Panel ── */}
      <DetailPanel
        task={selectedTask}
        tasks={tasks}
        deps={deps}
        onClose={() => setSelectedTaskId(null)}
        onStatusChange={handleStatusChange}
        onDateChange={handleDateChange}
        onNavigateToTask={navigateToTask}
      />

      {/* ── Violation Dialog (Aeon-inspired resolution UI) ── */}
      {violationDialog && (
        <ViolationDialog
          {...violationDialog}
          onPushForward={handleViolationResolve}
          onDismiss={() => setViolationDialog(null)}
        />
      )}
    </div>
  )
}
