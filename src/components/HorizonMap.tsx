// ============================================================
// CADENCE — HorizonMap
//
// Subway-style multi-release timeline (birds-eye view).
// Each release gets its own horizontal track. A pulsing NOW
// line anchors the left edge. Task dots are colored by status:
//   grey filled  = complete
//   hollow ring  = pending
//   amber filled = in_progress
//   red filled   = overdue OR violated dependency
//
// The time window (7d → 1yr) is controlled by the parent.
// Clicking a track navigates to that release's detail page.
// ============================================================

import { useRef, useEffect, useState, useMemo } from 'react'
import { addDays, isOverdue, isDueSoon } from '../lib/cascadeEngine'

// ─────────────────────────────────────────────────────────
// Public types (imported by DashboardPage)
// ─────────────────────────────────────────────────────────

export interface HorizonRelease {
  id: string
  title: string
  release_type: string
  release_date: string | null
}

export interface HorizonTask {
  id: string
  title: string
  due_date: string | null
  status: string
  release_id: string
}

export interface HorizonDep {
  task_id: string
  depends_on_task_id: string
  lag_days: number
}

interface HorizonMapProps {
  releases: HorizonRelease[]
  tasks: HorizonTask[]
  deps: HorizonDep[]
  windowDays: number
  onReleaseClick: (releaseId: string) => void
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const TRACK_COLORS = [
  '#1D9E75', // teal
  '#BA7517', // amber
  '#534AB7', // purple
  '#185FA5', // blue
  '#D85A30', // coral
  '#993556', // pink
]

const LABEL_W   = 118
const RIGHT_PAD = 8
const TRACK_H   = 50
const TRACK_GAP = 10
const TOP_PAD   = 26 // room for month labels above first track

function truncate(s: string, max = 17): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ─────────────────────────────────────────────────────────
// HorizonMap
// ─────────────────────────────────────────────────────────

export default function HorizonMap({
  releases,
  tasks,
  deps,
  windowDays,
  onReleaseClick,
}: HorizonMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgWidth, setSvgWidth] = useState(600)

  // Respond to container resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setSvgWidth(el.offsetWidth)
    const ro = new ResizeObserver(entries => {
      setSvgWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Date math ──────────────────────────────────────────
  const todayStr  = new Date().toISOString().split('T')[0]
  const todayMs   = new Date(todayStr + 'T12:00:00Z').getTime()
  const endMs     = todayMs + windowDays * 86_400_000
  const chartW    = Math.max(0, svgWidth - LABEL_W - RIGHT_PAD)

  const toX = (isoDate: string): number => {
    const ms  = new Date(isoDate + 'T12:00:00Z').getTime()
    const pct = (ms - todayMs) / (endMs - todayMs)
    return LABEL_W + pct * chartW
  }

  // ── Month gridlines ─────────────────────────────────────
  const monthLines = useMemo(() => {
    const lines: Date[] = []
    const start = new Date(todayMs)
    let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    while (m.getTime() <= endMs) {
      lines.push(new Date(m))
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
    }
    return lines
  }, [windowDays, todayMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Violated task IDs ───────────────────────────────────
  const violatedIds = useMemo(() => {
    const taskMap = new Map(tasks.map(t => [t.id, t]))
    const violated = new Set<string>()
    for (const dep of deps) {
      const from = taskMap.get(dep.depends_on_task_id)
      const to   = taskMap.get(dep.task_id)
      if (!from?.due_date || !to?.due_date) continue
      if (from.status === 'complete')        continue
      const minDate = addDays(from.due_date, dep.lag_days ?? 0)
      if (to.due_date < minDate) violated.add(dep.task_id)
    }
    return violated
  }, [tasks, deps])

  // ── Tasks indexed by release ────────────────────────────
  const tasksByRelease = useMemo(() => {
    const map = new Map<string, HorizonTask[]>()
    for (const t of tasks) {
      if (!map.has(t.release_id)) map.set(t.release_id, [])
      map.get(t.release_id)!.push(t)
    }
    return map
  }, [tasks])

  const nowX   = LABEL_W // today always anchors the left edge
  const totalH = TOP_PAD + releases.length * (TRACK_H + TRACK_GAP) - TRACK_GAP + 10

  // ── Empty state ─────────────────────────────────────────
  if (releases.length === 0) {
    return (
      <div ref={containerRef} style={{ padding: '24px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No releases yet — create one to see your horizon.
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {/* CSS animations — defined here so they're available globally while Dashboard is mounted */}
      <style>{`
        @keyframes cadence-now-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .cadence-now { animation: cadence-now-pulse 2.5s ease-in-out infinite; }

        @keyframes cadence-live-pulse {
          0%, 100% { opacity: 0.9; }
          50%       { opacity: 0.15; }
        }
        .cadence-live { animation: cadence-live-pulse 2.2s ease-in-out infinite; }

        @keyframes cadence-alert-in {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <svg
        width={svgWidth}
        height={totalH}
        viewBox={`0 0 ${svgWidth} ${totalH}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* ── Month gridlines ── */}
        {monthLines.map((m, i) => {
          const x = toX(m.toISOString().split('T')[0])
          if (x < LABEL_W + 2 || x > svgWidth - RIGHT_PAD) return null
          const label = m.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
          return (
            <g key={i}>
              <line
                x1={x} y1={TOP_PAD - 4}
                x2={x} y2={totalH}
                stroke="var(--color-border)"
                strokeWidth={0.5}
              />
              <text
                x={x + 3} y={TOP_PAD - 9}
                fontSize={9}
                fill="var(--color-text-muted)"
                fontFamily="inherit"
              >
                {label}
              </text>
            </g>
          )
        })}

        {/* ── Release tracks ── */}
        {releases.map((rel, i) => {
          const color    = TRACK_COLORS[i % TRACK_COLORS.length]
          const y        = TOP_PAD + i * (TRACK_H + TRACK_GAP)
          const midY     = y + TRACK_H / 2
          const relTasks = tasksByRelease.get(rel.id) ?? []
          const relX     = rel.release_date ? toX(rel.release_date) : null

          const hasViolation   = relTasks.some(t => violatedIds.has(t.id))
          const diamondColor   = hasViolation ? '#E24B4A' : color

          // Completed progress bar (solid colored segment along track)
          const doneDates = relTasks
            .filter(t => t.status === 'complete' && t.due_date)
            .map(t => t.due_date!)
            .sort()
          const completedBar = doneDates.length > 0
            ? {
                x1: Math.max(LABEL_W, toX(doneDates[0])),
                x2: Math.min(svgWidth - RIGHT_PAD, toX(doneDates[doneDates.length - 1])),
              }
            : null

          return (
            <g
              key={rel.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onReleaseClick(rel.id)}
            >
              {/* Release label */}
              <text
                x={0} y={midY - 6}
                fontSize={11}
                fontWeight={500}
                fill="var(--color-text)"
                fontFamily="inherit"
              >
                {truncate(rel.title)}
              </text>
              <text
                x={0} y={midY + 8}
                fontSize={9}
                fill="var(--color-text-muted)"
                fontFamily="inherit"
              >
                {rel.release_type}
              </text>

              {/* Track background line */}
              <line
                x1={LABEL_W} y1={midY}
                x2={svgWidth - RIGHT_PAD} y2={midY}
                stroke="var(--color-border)"
                strokeWidth={0.75}
              />

              {/* Completed segment */}
              {completedBar && completedBar.x2 > completedBar.x1 && (
                <line
                  x1={completedBar.x1} y1={midY}
                  x2={completedBar.x2} y2={midY}
                  stroke={color}
                  strokeWidth={2.5}
                  opacity={0.3}
                />
              )}

              {/* Task dots */}
              {relTasks.map(task => {
                if (!task.due_date) return null
                const x = toX(task.due_date)
                if (x < LABEL_W - 8 || x > svgWidth + 8) return null

                const isViolated = violatedIds.has(task.id)
                const isDone     = task.status === 'complete'
                const isActive   = task.status === 'in_progress'
                const isOD       = !isDone && isOverdue(task.due_date)
                const isUrgent   = !isDone && !isOD && isDueSoon(task.due_date, 4)

                const fill = isDone
                  ? '#888780'
                  : isViolated || isOD
                    ? '#E24B4A'
                    : isActive
                      ? '#BA7517'
                      : 'var(--color-bg)'

                const stroke = isDone
                  ? '#888780'
                  : isViolated || isOD
                    ? '#E24B4A'
                    : isActive
                      ? '#BA7517'
                      : color

                return (
                  <g key={task.id}>
                    <circle
                      cx={x} cy={midY}
                      r={4}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={1.5}
                    />
                    {(isUrgent || isOD || isViolated) && !isDone && (
                      <text
                        x={x} y={midY - 8}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={600}
                        fill="#E24B4A"
                        fontFamily="inherit"
                      >
                        !
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Release date diamond */}
              {relX != null && relX >= LABEL_W && relX <= svgWidth - RIGHT_PAD && (
                <g>
                  <polygon
                    points={`${relX},${midY - 5} ${relX + 5},${midY} ${relX},${midY + 5} ${relX - 5},${midY}`}
                    fill={diamondColor}
                  />
                  {windowDays <= 120 && rel.release_date && (
                    <text
                      x={relX} y={midY + 17}
                      textAnchor="middle"
                      fontSize={8}
                      fill={diamondColor}
                      fontFamily="inherit"
                    >
                      {new Date(rel.release_date + 'T12:00:00Z').toLocaleDateString(
                        'en-US',
                        { month: 'short', day: 'numeric', timeZone: 'UTC' }
                      )}
                    </text>
                  )}
                </g>
              )}
            </g>
          )
        })}

        {/* ── TODAY line — always at left anchor ── */}
        <g className="cadence-now">
          <line
            x1={nowX} y1={0}
            x2={nowX} y2={totalH}
            stroke="#888780"
            strokeWidth={1.5}
          />
          <text
            x={nowX + 3} y={TOP_PAD - 10}
            fontSize={9}
            fill="#888780"
            fontFamily="inherit"
          >
            today
          </text>
        </g>
      </svg>
    </div>
  )
}
