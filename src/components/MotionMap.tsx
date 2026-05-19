// MotionMap — Ableton-style zoomable/pannable release timeline
//
// Interactions:
//   ⌘/Ctrl + scroll   → zoom in/out (date under cursor stays fixed)
//   scroll / trackpad → pan left/right
//   hover             → card pops forward, others blur
//   click             → navigate to release page
//
// Card sizing:
//   width  = release duration (earliest task → release_date)
//   height = proportional to task count vs busiest release

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'motion/react'
import { Music, Disc, Disc3, Shuffle, Layers, Mic, Headphones } from 'lucide-react'
import type { HorizonRelease, HorizonTask, HorizonDep } from './HorizonMap'

// ─── Constants ───────────────────────────────────────────────────────────────

const DAY_MS     = 86_400_000
const AXIS_Y     = 300   // px from top — where cards sit
const TOTAL_H    = 460   // component height
const LABEL_ZONE = 52    // px below axis for labels
const MIN_CARD_H = 44
const MAX_CARD_H = 200
const MIN_PPD    = 0.25  // pixels per day (most zoomed out)
const MAX_PPD    = 150   // pixels per day (most zoomed in)

// ─── Type icon map ───────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Single:      Music,
  EP:          Disc,
  Album:       Disc3,
  Mixtape:     Shuffle,
  Compilation: Layers,
  Live:        Mic,
  Podcast:     Headphones,
}

const CARD_COLORS = [
  '#7C6CFC', '#3B82F6', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#14B8A6', '#8B5CF6',
  '#06B6D4', '#84CC16',
]

// ─── Tick interval logic ─────────────────────────────────────────────────────

const TICK_STEPS = [1, 7, 14, 30, 91, 182, 365, 730] // days
const MIN_TICK_PX = 72

function tickInterval(ppd: number): number {
  for (const s of TICK_STEPS) {
    if (ppd * s >= MIN_TICK_PX) return s
  }
  return 730
}

function floorToInterval(ms: number, intervalDays: number): number {
  const iMs = intervalDays * DAY_MS
  return Math.ceil(ms / iMs) * iMs
}

function tickLabel(ms: number, intervalDays: number): string {
  const d = new Date(ms)
  if (intervalDays >= 365) return String(d.getFullYear())
  if (intervalDays >= 91)  return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`
  if (intervalDays >= 14)  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  if (intervalDays >= 7)   return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface MotionMapProps {
  releases:       HorizonRelease[]
  tasks:          HorizonTask[]
  deps:           HorizonDep[]
  windowDays:     number
  onReleaseClick: (releaseId: string) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MotionMap({
  releases,
  tasks,
  deps:           _deps,
  windowDays,
  onReleaseClick,
}: MotionMapProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [isLoaded, setIsLoaded]   = useState(false)

  const todayMs = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime()
  }, [])

  // ── View state — refs carry current values into the wheel handler ─────────
  const ppdRef         = useRef(800 / windowDays)
  const vsRef          = useRef(todayMs - 14 * DAY_MS)
  const [ppdState,     setPpdState]     = useState(800 / windowDays)
  const [vsState,      setVsState]      = useState(todayMs - 14 * DAY_MS)
  ppdRef.current = ppdState
  vsRef.current  = vsState

  // ── ResizeObserver ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Calibrate ppd to window width (once, on first real measurement)
  const calibrated = useRef(false)
  useEffect(() => {
    if (width > 100 && !calibrated.current) {
      calibrated.current = true
      const ppd = width / windowDays
      setPpdState(ppd)
      ppdRef.current = ppd
    }
  }, [width, windowDays])

  useEffect(() => {
    const t = setTimeout(() => setIsLoaded(true), 120)
    return () => clearTimeout(t)
  }, [])

  // ── Wheel handler: zoom (⌘/Ctrl+scroll) + pan (scroll) ──────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const ppd    = ppdRef.current
      const vs     = vsRef.current
      const mouseX = e.clientX - rect.left

      if (e.ctrlKey || e.metaKey) {
        // Zoom: keep the date under the cursor pinned
        const anchor = vs + (mouseX / ppd) * DAY_MS
        const factor = e.deltaY > 0 ? 0.82 : 1.22
        const newPpd = Math.max(MIN_PPD, Math.min(MAX_PPD, ppd * factor))
        const newVs  = anchor - (mouseX / newPpd) * DAY_MS
        ppdRef.current = newPpd
        vsRef.current  = newVs
        setPpdState(newPpd)
        setVsState(newVs)
      } else {
        // Pan
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
        const newVs = vs + (delta / ppd) * DAY_MS * 1.6
        vsRef.current = newVs
        setVsState(newVs)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // intentionally empty — reads from refs

  // ── Date → x ────────────────────────────────────────────────────────────
  const dateToX = useCallback(
    (ms: number) => (ms - vsState) / DAY_MS * ppdState,
    [vsState, ppdState]
  )

  // ── Release layout ───────────────────────────────────────────────────────
  const layouts = useMemo(() => {
    const byRelease = new Map<string, HorizonTask[]>()
    for (const r of releases) byRelease.set(r.id, [])
    for (const t of tasks) {
      const arr = byRelease.get(t.release_id)
      if (arr) arr.push(t)
    }

    const counts   = releases.map(r => (byRelease.get(r.id) ?? []).length)
    const maxCount = Math.max(1, ...counts)

    return releases.map((r, i) => {
      const rTasks    = byRelease.get(r.id) ?? []
      const taskCount = rTasks.length

      const taskMsDates = rTasks
        .map(t => t.due_date ? new Date(t.due_date).getTime() : null)
        .filter((ms): ms is number => ms !== null)

      const startMs = taskMsDates.length > 0
        ? Math.min(...taskMsDates)
        : todayMs

      const endMs = r.release_date
        ? new Date(r.release_date).getTime()
        : todayMs + 30 * DAY_MS

      const ratio    = taskCount / maxCount
      const cardH    = Math.round(MIN_CARD_H + ratio * (MAX_CARD_H - MIN_CARD_H))
      const completed = rTasks.filter(t => t.status === 'complete').length
      const progress  = taskCount > 0 ? completed / taskCount : 0
      const daysUntil = Math.round((endMs - todayMs) / DAY_MS)

      return {
        release: r,
        startMs, endMs,
        taskCount, completed, progress,
        cardH, daysUntil,
        color: CARD_COLORS[i % CARD_COLORS.length],
        i,
      }
    })
  }, [releases, tasks, todayMs])

  // ── Tick marks ───────────────────────────────────────────────────────────
  const ticks = useMemo(() => {
    const iDays  = tickInterval(ppdState)
    const iMs    = iDays * DAY_MS
    const endMs  = vsState + (width / ppdState) * DAY_MS
    let   cur    = floorToInterval(vsState, iDays)
    const result: { ms: number; label: string }[] = []
    while (cur < endMs + iMs) {
      result.push({ ms: cur, label: tickLabel(cur, iDays) })
      cur += iMs
    }
    return result
  }, [vsState, ppdState, width])

  const todayX = dateToX(todayMs)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        position:     'relative',
        width:        '100%',
        height:       TOTAL_H,
        background:   '#1A1A1A',
        borderRadius: 14,
        overflow:     'hidden',
        userSelect:   'none',
        cursor:       'default',
      }}
    >
      {/* Grain overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.022,
        backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNhKSIvPjwvc3ZnPg==")`,
      }} />

      {/* ── SVG: axis, ticks, today, connection lines ─────────────────────── */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>

        {/* Axis line */}
        <line x1={0} y1={AXIS_Y} x2={width} y2={AXIS_Y}
          stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

        {/* Grid + tick marks + labels */}
        {ticks.map(tick => {
          const x = dateToX(tick.ms)
          if (x < -80 || x > width + 80) return null
          return (
            <g key={tick.ms}>
              <line x1={x} y1={0} x2={x} y2={AXIS_Y - 4}
                stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
              <line x1={x} y1={AXIS_Y - 4} x2={x} y2={AXIS_Y + 4}
                stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
              <text x={x} y={AXIS_Y + 16}
                fill="rgba(255,255,255,0.32)" fontSize={9}
                fontFamily="system-ui, -apple-system, sans-serif"
                textAnchor="middle" letterSpacing="0.07em">
                {tick.label}
              </text>
            </g>
          )
        })}

        {/* Today marker */}
        {todayX > -2 && todayX < width + 2 && (
          <g>
            <line x1={todayX} y1={0} x2={todayX} y2={TOTAL_H}
              stroke="rgba(124,108,252,0.28)" strokeWidth={1} strokeDasharray="3 3" />
            <text x={todayX + 5} y={14}
              fill="rgba(124,108,252,0.55)" fontSize={8}
              fontFamily="system-ui" letterSpacing="0.12em">TODAY</text>
          </g>
        )}

        {/* Connection lines: card center → label */}
        {layouts.map((layout, i) => {
          const sx = dateToX(layout.startMs)
          const ex = dateToX(layout.endMs)
          const cw = Math.max(4, ex - sx)
          const cx = sx + cw / 2
          const lx = (width / Math.max(1, layouts.length)) * (i + 0.5)
          const isHov = hoveredId === layout.release.id
          const isOth = hoveredId !== null && !isHov

          return (
            <motion.line
              key={`conn-${layout.release.id}`}
              x1={cx} y1={AXIS_Y}
              x2={lx} y2={AXIS_Y + LABEL_ZONE - 6}
              stroke={layout.color}
              strokeWidth={1}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={isLoaded ? {
                pathLength:  1,
                opacity:     isHov ? 0.65 : isOth ? 0.04 : 0.18,
                strokeWidth: isHov ? 2 : 1,
              } : { pathLength: 0, opacity: 0 }}
              transition={{
                pathLength:  { duration: 0.7, delay: 0.5 + i * 0.07 },
                opacity:     { duration: 0.2 },
                strokeWidth: { duration: 0.2 },
              }}
            />
          )
        })}
      </svg>

      {/* ── Cards ─────────────────────────────────────────────────────────── */}
      {layouts.map((layout, i) => {
        const sx = dateToX(layout.startMs)
        const ex = dateToX(layout.endMs)
        const cw = Math.max(18, ex - sx)

        if (sx > width + 240 || ex < -240) return null

        const cardTop = AXIS_Y - layout.cardH
        const isHov   = hoveredId === layout.release.id
        const isOth   = hoveredId !== null && !isHov
        const Icon    = TYPE_ICONS[layout.release.release_type ?? ''] ?? Music
        const narrow  = cw < 56
        const short   = layout.cardH < 70

        return (
          <motion.div
            key={layout.release.id}
            style={{
              position:     'absolute',
              left:         sx,
              top:          cardTop,
              width:        cw,
              height:       layout.cardH,
              borderRadius: 12,
              background:   layout.color,
              cursor:       'pointer',
              overflow:     'hidden',
              padding:      narrow ? 5 : '8px 10px',
              boxSizing:    'border-box',
            }}
            initial={{ opacity: 0, y: 14 }}
            animate={isLoaded ? {
              opacity: isOth ? 0.22 : isHov ? 0.97 : 0.72,
              y:       0,
              scale:   isHov ? 1.04 : 1,
              zIndex:  isHov ? 30 : 5,
              filter:  isOth ? 'blur(1.5px)' : 'blur(0px)',
            } : { opacity: 0, y: 14 }}
            transition={{
              opacity: { duration: 0.22 },
              scale:   { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
              filter:  { duration: 0.22 },
              y:       { duration: 0.5, delay: 0.3 + i * 0.09, ease: [0.16, 1, 0.3, 1] },
            }}
            onHoverStart={() => setHoveredId(layout.release.id)}
            onHoverEnd={() => setHoveredId(null)}
            onClick={() => onReleaseClick(layout.release.id)}
          >
            {!narrow && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: short ? 0 : 4 }}>
                  <Icon size={10} />
                  <span style={{
                    fontSize: 9, fontWeight: 700,
                    color: 'rgba(255,255,255,0.95)',
                    letterSpacing: '0.09em', textTransform: 'uppercase',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    maxWidth: cw - 36,
                  }}>
                    {layout.release.title}
                  </span>
                </div>

                {!short && layout.taskCount > 0 && (
                  <div style={{ height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.18)', marginBottom: 4 }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      background: 'rgba(255,255,255,0.7)',
                      width: `${Math.round(layout.progress * 100)}%`,
                    }} />
                  </div>
                )}

                {!short && layout.taskCount > 0 && (
                  <p style={{ margin: 0, fontSize: 8, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.07em' }}>
                    {layout.completed}/{layout.taskCount} tasks
                  </p>
                )}

                {isHov && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.2 }}
                    style={{
                      marginTop: 5, paddingTop: 5,
                      borderTop: '1px solid rgba(255,255,255,0.2)',
                      fontSize: 8, color: 'rgba(255,255,255,0.75)',
                      letterSpacing: '0.07em', whiteSpace: 'nowrap',
                    }}
                  >
                    {layout.daysUntil > 0
                      ? `${layout.daysUntil}d until release`
                      : layout.daysUntil === 0
                      ? 'Releases today'
                      : `${Math.abs(layout.daysUntil)}d past release`}
                  </motion.div>
                )}
              </>
            )}
          </motion.div>
        )
      })}

      {/* ── Labels row ────────────────────────────────────────────────────── */}
      {layouts.map((layout, i) => {
        const lx    = (width / Math.max(1, layouts.length)) * (i + 0.5)
        const isHov = hoveredId === layout.release.id

        return (
          <motion.div
            key={`lbl-${layout.release.id}`}
            style={{
              position:      'absolute',
              left:          lx,
              top:           AXIS_Y + LABEL_ZONE,
              transform:     'translateX(-50%)',
              padding:       '2px 8px',
              borderRadius:  4,
              fontSize:      8,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              whiteSpace:    'nowrap',
              pointerEvents: 'none',
              border:        `1px solid ${isHov ? layout.color : 'rgba(255,255,255,0.12)'}`,
            }}
            animate={{
              color:       isHov ? '#fff' : 'rgba(255,255,255,0.38)',
              borderColor: isHov ? layout.color : 'rgba(255,255,255,0.12)',
            }}
            transition={{ duration: 0.2 }}
          >
            {layout.release.title}
          </motion.div>
        )
      })}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {releases.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.25)', fontSize: 12, letterSpacing: '0.12em',
        }}>
          NO RELEASES IN WINDOW
        </div>
      )}

      {/* ── Hint ──────────────────────────────────────────────────────────── */}
      <div style={{
        position:      'absolute',
        bottom:        8,
        right:         12,
        fontSize:      8,
        color:         'rgba(255,255,255,0.18)',
        letterSpacing: '0.08em',
        pointerEvents: 'none',
      }}>
        ⌘ scroll to zoom · scroll to pan
      </div>
    </div>
  )
}
