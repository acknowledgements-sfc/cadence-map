// ============================================================
// CADENCE — HorizonMap (Overdrive Edition)
//
// Subway-style multi-release timeline (birds-eye view).
// Each release gets its own horizontal track. A pulsing NOW
// line anchors the current date. Task dots are colored by status:
//   grey filled  = complete
//   hollow ring  = pending
//   amber filled = in_progress
//   red filled   = overdue OR violated dependency
//
// Overdrive features:
//   • Pan/zoom via scroll + drag (pointer events, passive: false wheel)
//   • Live cursor line + date tooltip tracking the mouse
//   • CSS @property animated conflict glow on violated tasks
//   • Spring-reflow of task dots and bars on resize (motion/react)
//
// The time window (7d → 1yr) is controlled by the parent.
// Clicking a track navigates to that release's detail page.
// ============================================================

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { motion } from 'motion/react'
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

const SPRING_DOT  = { type: 'spring' as const, stiffness: 220, damping: 28 }
const SPRING_LINE = { type: 'spring' as const, stiffness: 180, damping: 26 }

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
  const svgRef       = useRef<SVGSVGElement>(null)
  const [svgWidth, setSvgWidth] = useState(600)

  // ── Pan / zoom state ────────────────────────────────────
  const [panOffsetMs, setPanOffsetMs] = useState(0)
  const [zoomScale,   setZoomScale]   = useState(1)

  // ── Interaction state ───────────────────────────────────
  const [cursorX,    setCursorX]    = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef      = useRef<{ startX: number; startPan: number } | null>(null)
  const hasDraggedRef = useRef(false)

  // ── Reduced motion ──────────────────────────────────────
  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )
  const dotTransition  = prefersReducedMotion ? { duration: 0 } : SPRING_DOT
  const lineTransition = prefersReducedMotion ? { duration: 0 } : SPRING_LINE

  // ── Respond to container resize ─────────────────────────
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

  // ── Reset pan/zoom when parent window changes ───────────
  useEffect(() => {
    setPanOffsetMs(0)
    setZoomScale(1)
  }, [windowDays])

  // ── Date math ───────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0]
  const todayMs  = new Date(todayStr + 'T12:00:00Z').getTime()

  const effectiveWindowMs = (windowDays * 86_400_000) / zoomScale
  const effectiveStartMs  = todayMs + panOffsetMs
  const effectiveEndMs    = effectiveStartMs + effectiveWindowMs

  const chartW = Math.max(0, svgWidth - LABEL_W - RIGHT_PAD)

  const toX = (isoDate: string): number => {
    const ms  = new Date(isoDate + 'T12:00:00Z').getTime()
    const pct = (ms - effectiveStartMs) / (effectiveEndMs - effectiveStartMs)
    return LABEL_W + pct * chartW
  }

  // ── Month gridlines ─────────────────────────────────────
  const monthLines = useMemo(() => {
    const lines: Date[] = []
    const start = new Date(effectiveStartMs)
    let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    while (m.getTime() <= effectiveEndMs) {
      lines.push(new Date(m))
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
    }
    return lines
  }, [effectiveStartMs, effectiveEndMs])

  // ── Violated task IDs ────────────────────────────────────
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

  // ── Tasks indexed by release ─────────────────────────────
  const tasksByRelease = useMemo(() => {
    const map = new Map<string, HorizonTask[]>()
    for (const t of tasks) {
      if (!map.has(t.release_id)) map.set(t.release_id, [])
      map.get(t.release_id)!.push(t)
    }
    return map
  }, [tasks])

  // ── Derived geometry ─────────────────────────────────────
  const nowX        = toX(todayStr)
  const showNowLine = nowX >= LABEL_W && nowX <= svgWidth - RIGHT_PAD
  const totalH      = TOP_PAD + releases.length * (TRACK_H + TRACK_GAP) - TRACK_GAP + 10

  // ── Cursor date label ────────────────────────────────────
  const cursorDate = cursorX !== null ? (() => {
    const pct = (cursorX - LABEL_W) / chartW
    const ms  = effectiveStartMs + pct * (effectiveEndMs - effectiveStartMs)
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    })
  })() : null

  // ── Mouse hover handlers ─────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isDragging) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    setCursorX(x >= LABEL_W && x <= svgWidth - RIGHT_PAD ? x : null)
  }

  const handleMouseLeave = () => setCursorX(null)

  // ── Pointer drag handlers ────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    if (x < LABEL_W) return
    svgRef.current?.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startPan: panOffsetMs }
    hasDraggedRef.current = false
    setIsDragging(true)
    setCursorX(null)
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || chartW === 0) return
    const deltaX = e.clientX - dragRef.current.startX
    if (Math.abs(deltaX) > 3) hasDraggedRef.current = true
    const msDelta = -(deltaX / chartW) * effectiveWindowMs
    setPanOffsetMs(dragRef.current.startPan + msDelta)
  }

  const handlePointerUp = () => {
    dragRef.current = null
    setIsDragging(false)
  }

  // ── Wheel zoom (non-passive, zoom toward cursor) ─────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || chartW === 0) return
    const x = e.clientX - rect.left
    if (x < LABEL_W || x > svgWidth - RIGHT_PAD) return

    // Normalise across deltaMode
    const delta = e.deltaY * (e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 400 : 1)
    const newZoom = Math.max(0.3, Math.min(10, zoomScale * (1 - delta * 0.0012)))

    // Preserve the date under the cursor
    const cursorPct  = (x - LABEL_W) / chartW
    const cursorMs   = effectiveStartMs + cursorPct * effectiveWindowMs
    const newWinMs   = (windowDays * 86_400_000) / newZoom
    const newStartMs = cursorMs - cursorPct * newWinMs

    setZoomScale(newZoom)
    setPanOffsetMs(newStartMs - todayMs)
  }, [
    zoomScale, effectiveStartMs, effectiveWindowMs,
    chartW, svgWidth, windowDays, todayMs,
  ])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // ── Empty state ──────────────────────────────────────────
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
      {/* ── Styles ── */}
      <style>{`
        /* cadence-now-pulse is unique to HorizonMap — cadence-live-pulse and
           cadence-alert-in have been moved to index.css */
        @keyframes cadence-now-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .cadence-now { animation: cadence-now-pulse 2.5s ease-in-out infinite; }

        /* CSS @property lets the browser interpolate --glow-r as a length,
           enabling the smooth outward-ripple on violated task dots */
        @property --glow-r {
          syntax: '<length>';
          initial-value: 5px;
          inherits: false;
        }
        @keyframes cadence-conflict-glow {
          0%, 100% { --glow-r: 5px;  opacity: 0.65; }
          50%       { --glow-r: 13px; opacity: 0;    }
        }
        .cadence-conflict-ring {
          animation: cadence-conflict-glow 2.2s ease-in-out infinite;
          r: var(--glow-r);
        }

        .horizon-chart          { cursor: grab; }
        .horizon-chart.dragging { cursor: grabbing; }

        @media (prefers-reduced-motion: reduce) {
          .cadence-now            { animation: none; opacity: 0.6; }
          .cadence-conflict-ring  { animation: none; r: 8px; opacity: 0.3; }
        }
      `}</style>

      <svg
        ref={svgRef}
        width={svgWidth}
        height={totalH}
        viewBox={`0 0 ${svgWidth} ${totalH}`}
        className={`horizon-chart${isDragging ? ' dragging' : ''}`}
        style={{ display: 'block', overflow: 'visible', userSelect: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="img"
        aria-label="Release timeline"
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

          const hasViolation = relTasks.some(t => violatedIds.has(t.id))
          const diamondColor = hasViolation ? '#E24B4A' : color

          // Completed progress bar
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
              style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
              onClick={() => {
                if (hasDraggedRef.current) return
                onReleaseClick(rel.id)
              }}
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

              {/* Completed segment — spring-reflows on resize */}
              {completedBar && completedBar.x2 > completedBar.x1 && (
                <motion.line
                  y1={midY} y2={midY}
                  stroke={color}
                  strokeWidth={2.5}
                  opacity={0.3}
                  animate={{ x1: completedBar.x1, x2: completedBar.x2 }}
                  transition={lineTransition}
                />
              )}

              {/* Task dots */}
              {relTasks.map(task => {
                if (!task.due_date) return null
                const x = toX(task.due_date)
                // Cull well outside visible range (still render ±32px for spring overshoot)
                if (x < LABEL_W - 32 || x > svgWidth + 32) return null

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
                    {/* Conflict glow ring — CSS @property animates r outward */}
                    {isViolated && !isDone && (
                      <circle
                        className="cadence-conflict-ring"
                        cx={x}
                        cy={midY}
                        r={5}
                        fill="none"
                        stroke="#E24B4A"
                        strokeWidth={1.5}
                      />
                    )}

                    {/* Task dot — springs to new x on resize */}
                    <motion.circle
                      cy={midY}
                      r={4}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={1.5}
                      animate={{ cx: x }}
                      transition={dotTransition}
                    />

                    {/* Alert indicator */}
                    {(isUrgent || isOD || isViolated) && !isDone && (
                      <text
                        x={x} y={midY - 8}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={600}
                        fill="#E24B4A"
                        fontFamily="inherit"
                        style={{ pointerEvents: 'none' }}
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

        {/* ── TODAY line ── */}
        {showNowLine && (
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
        )}

        {/* ── Cursor tracker ── */}
        {cursorX !== null && !isDragging && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={cursorX} y1={TOP_PAD - 4}
              x2={cursorX} y2={totalH}
              stroke="var(--color-text-muted)"
              strokeWidth={0.5}
              strokeDasharray="2 3"
              opacity={0.45}
            />
            {/* Date pill */}
            <rect
              x={cursorX - 25} y={1}
              width={50} height={13}
              rx={3}
              fill="var(--color-surface-2)"
              opacity={0.92}
            />
            <text
              x={cursorX} y={10.5}
              textAnchor="middle"
              fontSize={8}
              fill="var(--color-text-muted)"
              fontFamily="inherit"
            >
              {cursorDate}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
