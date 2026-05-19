import { useState, useRef, useCallback } from 'react'
import { cascadeFromTask } from '../lib/cascadeEngine'
import type { CascadeTask, CascadeDependency } from '../lib/cascadeEngine'
import { formatDate } from '../lib/cascadeEngine'

// ── Types ──────────────────────────────────────────────────────

export interface DraggableTask {
  key: string
  id: string
  title: string
  phase: string
  effort: number
  dueDate: string   // ISO date string
  status: 'pending' | 'complete'
}

interface DraggableTimelineProps {
  tasks: DraggableTask[]
  onTasksChange: (updated: DraggableTask[]) => void
  showAIWarning?: boolean
  isMobile?: boolean
}

// ── Phase colour lookup ────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  pre:        'var(--color-phase-pre,        #7C6CFC)',
  production: 'var(--color-phase-production, #3B82F6)',
  post:       'var(--color-phase-post,       #10B981)',
  promo:      'var(--color-phase-promo,      #F59E0B)',
  release:    'var(--color-phase-release,    #EF4444)',
  default:    'var(--color-accent)',
}

function phaseColor(phase: string) {
  return PHASE_COLORS[phase.toLowerCase()] ?? PHASE_COLORS.default
}

// ── Build simple sequential deps from task order ───────────────
// Tasks in the onboarding preview are ordered: each task depends
// on the previous one with a 0-day lag, so cascading a drag
// pushes every downstream task forward correctly.

function buildCascadeInputs(tasks: DraggableTask[]): {
  cascadeTasks: CascadeTask[]
  cascadeDeps: CascadeDependency[]
} {
  const cascadeTasks: CascadeTask[] = tasks.map(t => ({
    id: t.id,
    template_key: t.key,
    due_date: t.dueDate,
    due_date_offset: null,
    status: t.status,
  }))

  // Each task depends on the previous one (sequential chain)
  const cascadeDeps: CascadeDependency[] = tasks.slice(1).map((t, i) => ({
    task_id: t.id,
    depends_on_task_id: tasks[i].id,
    lag_days: 0,
  }))

  return { cascadeTasks, cascadeDeps }
}

// ── Main component ─────────────────────────────────────────────

export default function DraggableTimeline({
  tasks,
  onTasksChange,
  showAIWarning = false,
  isMobile = false,
}: DraggableTimelineProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [pulsing, setPulsing] = useState<Set<string>>(new Set())
  const [shiftedIds, setShiftedIds] = useState<Set<string>>(new Set())
  const dragNode = useRef<HTMLDivElement | null>(null)

  // ── Drag handlers ────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      if (tasks[index].status === 'complete') {
        e.preventDefault()
        return
      }
      setDragIndex(index)
      dragNode.current = e.currentTarget
      e.dataTransfer.effectAllowed = 'move'
      // Tiny delay so the ghost image captures before we dim it
      requestAnimationFrame(() => {
        if (dragNode.current) dragNode.current.style.opacity = '0.4'
      })
    },
    [tasks]
  )

  const handleDragEnter = useCallback(
    (index: number) => {
      if (dragIndex === null || index === dragIndex) return
      setOverIndex(index)
    },
    [dragIndex]
  )

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) dragNode.current.style.opacity = '1'
    dragNode.current = null

    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }

    // Reorder
    const reordered = [...tasks]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(overIndex, 0, moved)

    // Cascade: the moved task keeps its date; everything after it may shift
    // We re-cascade from the task at the new drop position
    const { cascadeTasks, cascadeDeps } = buildCascadeInputs(reordered)
    const movedTask = reordered[overIndex]

    const result = cascadeFromTask(
      movedTask.id,
      movedTask.dueDate,
      cascadeTasks,
      cascadeDeps
    )

    // Apply cascade updates
    const updatedTasks = reordered.map(t => {
      const newDate = result.updates[t.id]
      if (newDate && newDate !== t.dueDate) {
        return { ...t, dueDate: newDate }
      }
      return t
    })

    // Collect shifted task IDs (downstream from drop point)
    const shifted = new Set(
      Object.entries(result.updates)
        .filter(([id, date]) => {
          const original = tasks.find(t => t.id === id)
          return original && date !== original.dueDate
        })
        .map(([id]) => id)
    )

    if (shifted.size > 0) {
      setShiftedIds(shifted)
      setPulsing(shifted)
      setTimeout(() => {
        setPulsing(new Set())
        // Keep shifted highlight a bit longer so user can see what changed
        setTimeout(() => setShiftedIds(new Set()), 1200)
      }, 600)
    }

    onTasksChange(updatedTasks)
    setDragIndex(null)
    setOverIndex(null)
  }, [dragIndex, overIndex, tasks, onTasksChange])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  // ── Render ───────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <style>{`
        @keyframes cascadePulse {
          0%   { box-shadow: 0 0 0 0 rgba(124, 108, 252, 0.55); }
          50%  { box-shadow: 0 0 0 6px rgba(124, 108, 252, 0.12); }
          100% { box-shadow: 0 0 0 0 rgba(124, 108, 252, 0); }
        }
        .cascade-pulse {
          animation: cascadePulse 0.6s ease-out;
        }
      `}</style>

      {tasks.map((task, index) => {
        const isDragging = dragIndex === index
        const isOver = overIndex === index
        const isPulsing = pulsing.has(task.id)
        const isShifted = shiftedIds.has(task.id)
        const isDone = task.status === 'complete'
        const color = phaseColor(task.phase)
        const isMastering = task.key?.toLowerCase().includes('master')

        return (
          <div key={task.id}>
            {/* Drop indicator above */}
            {isOver && overIndex! < dragIndex! && (
              <div
                style={{
                  height: 2,
                  borderRadius: 2,
                  background: 'var(--color-accent)',
                  marginBottom: 4,
                  opacity: 0.7,
                }}
              />
            )}

            <div
              draggable={!isDone}
              onDragStart={e => handleDragStart(e, index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              className={isPulsing ? 'cascade-pulse' : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: isMobile ? '10px 14px' : '11px 16px',
                borderRadius: 12,
                background: isDone
                  ? 'transparent'
                  : isShifted
                  ? 'rgba(124,108,252,0.08)'
                  : 'var(--color-surface)',
                border: `1px solid ${
                  isShifted
                    ? 'rgba(124,108,252,0.35)'
                    : isDone
                    ? 'var(--color-border)'
                    : 'var(--color-border)'
                }`,
                opacity: isDragging ? 0.4 : isDone ? 0.5 : 1,
                cursor: isDone ? 'default' : 'grab',
                transition: 'background 0.3s, border-color 0.3s, opacity 0.15s',
                userSelect: 'none',
              }}
            >
              {/* Drag handle + phase dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {!isDone && (
                  <svg
                    width="10"
                    height="14"
                    viewBox="0 0 10 14"
                    style={{ color: 'var(--color-border)', flexShrink: 0 }}
                  >
                    <circle cx="3" cy="2.5" r="1.5" fill="currentColor" />
                    <circle cx="7" cy="2.5" r="1.5" fill="currentColor" />
                    <circle cx="3" cy="7" r="1.5" fill="currentColor" />
                    <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                    <circle cx="3" cy="11.5" r="1.5" fill="currentColor" />
                    <circle cx="7" cy="11.5" r="1.5" fill="currentColor" />
                  </svg>
                )}
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isDone ? 'var(--color-border)' : color,
                    flexShrink: 0,
                  }}
                />
              </div>

              {/* Title + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 500,
                    color: isDone ? 'var(--color-text-muted)' : 'var(--color-text)',
                    textDecoration: isDone ? 'line-through' : 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {task.title}
                </p>
                <p
                  style={{
                    margin: '2px 0 0',
                    fontSize: 11,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {task.phase}
                  {task.effort ? ` · ${task.effort}h` : ''}
                  {isShifted ? ' · shifted' : ''}
                </p>
              </div>

              {/* Due date badge */}
              <div
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 500,
                  color: isShifted ? 'var(--color-accent)' : 'var(--color-text-muted)',
                  transition: 'color 0.3s',
                }}
              >
                {formatDate(task.dueDate)}
              </div>

              {/* Done checkmark */}
              {isDone && (
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: 'var(--color-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              )}
            </div>

            {/* AI Warning card — after mastering task */}
            {showAIWarning && isMastering && (
              <div
                style={{
                  margin: '4px 0 4px 28px',
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.2)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }}>⚠️</span>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                  AI mastering tools are getting better, but professional mastering still
                  gives you the edge for playlist pitching.
                </p>
              </div>
            )}

            {/* Drop indicator below */}
            {isOver && overIndex! > dragIndex! && (
              <div
                style={{
                  height: 2,
                  borderRadius: 2,
                  background: 'var(--color-accent)',
                  marginTop: 4,
                  opacity: 0.7,
                }}
              />
            )}
          </div>
        )
      })}

      {/* Drag hint — only shown when tasks exist and none are being dragged */}
      {tasks.some(t => t.status === 'pending') && dragIndex === null && (
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            textAlign: 'center',
            opacity: 0.6,
          }}
        >
          Drag tasks to reorder — downstream dates update automatically
        </p>
      )}
    </div>
  )
}
