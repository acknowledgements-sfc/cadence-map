// ============================================================
// CADENCE — MotionMap
//
// Animated stacked-card release timeline.
// Adapted from the Project Time Plan reference design.
//
// Key mechanics:
//   • Cards stagger in on mount (Framer-spring easing)
//   • Hovered card lifts + focuses; siblings blur + dim
//   • Connection lines run from card → label (diagonal)
//   • Month scale brightens near cursor
//   • Cards span from earliest task date → release date
//   • Background forces dark so colors pop at any theme
// ============================================================

import { useState, useEffect, useRef, useMemo } from 'react'
import { motion }                                from 'motion/react'
import {
  Music, Disc, Disc3, Shuffle, Layers, Mic, Headphones, Music2,
} from 'lucide-react'
import type { HorizonRelease, HorizonTask, HorizonDep } from './HorizonMap'

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const TRACK_COLORS = [
  '#1D9E75', '#BA7517', '#534AB7', '#185FA5', '#D85A30', '#993556',
]

// Vertical offset from axis (px). Negative = above axis.
const CARD_OFFSETS = [-130, -55, 15, -95, -25, 10, -75, -110, 25, -45]

const AXIS_TOP   = 280   // px from top of timeline area
const TOTAL_H    = 480   // total timeline area height
const CARD_H_EST = 110   // estimated card height for line anchor calc

// Release type → lucide icon
const TYPE_ICON: Record<string, typeof Music> = {
  Single:       Music,
  EP:           Disc,
  Album:        Disc3,
  Mixtape:      Shuffle,
  Compilation:  Layers,
  Live:         Mic,
  Podcast:      Headphones,
}

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────

export interface MotionMapProps {
  releases:       HorizonRelease[]
  tasks:          HorizonTask[]
  deps:           HorizonDep[]
  windowDays:     number
  onReleaseClick: (releaseId: string) => void
}

// ─────────────────────────────────────────────────────────
// MotionMap
// ─────────────────────────────────────────────────────────

export default function MotionMap({
  releases,
  tasks,
  deps: _deps,
  windowDays,
  onReleaseClick,
}: MotionMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [mouseX,    setMouseX]    = useState(0)
  const [isLoaded,  setIsLoaded]  = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setIsLoaded(true) }, [])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (containerRef.current) {
      setMouseX(e.clientX - containerRef.current.getBoundingClientRect().left)
    }
  }

  // ── Date math ──────────────────────────────────────────
  const todayMs = useMemo(() => (
    new Date(new Date().toISOString().split('T')[0] + 'T12:00:00Z').getTime()
  ), [])
  const endMs = todayMs + windowDays * 86_400_000

  const toPct = (isoDate: string): number => {
    const ms = new Date(isoDate + 'T12:00:00Z').getTime()
    return ((ms - todayMs) / (endMs - todayMs)) * 100
  }

  // ── Tasks by release ────────────────────────────────────
  const tasksByRelease = useMemo(() => {
    const map = new Map<string, HorizonTask[]>()
    for (const t of tasks) {
      if (!map.has(t.release_id)) map.set(t.release_id, [])
      map.get(t.release_id)!.push(t)
    }
    return map
  }, [tasks])

  // ── Visible releases ────────────────────────────────────
  const vis = useMemo(() => releases.filter(r => {
    if (!r.release_date) return false
    const ms = new Date(r.release_date + 'T12:00:00Z').getTime()
    return ms >= todayMs - 14 * 86_400_000 && ms <= endMs
  }), [releases, todayMs, endMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Month markers ───────────────────────────────────────
  const months = useMemo(() => {
    const marks: { label: string; pct: number }[] = []
    const start = new Date(todayMs)
    let m = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    while (m.getTime() <= endMs) {
      const pct = ((m.getTime() - todayMs) / (endMs - todayMs)) * 100
      if (pct >= -2 && pct <= 102) {
        marks.push({
          label: m.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
          pct,
        })
      }
      m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
    }
    return marks
  }, [windowDays, todayMs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Empty state ─────────────────────────────────────────
  if (vis.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
          No releases in this window — try expanding the time range.
        </p>
      </div>
    )
  }

  const containerW = containerRef.current?.offsetWidth ?? 800

  return (
    <div
      ref={containerRef}
      style={{
        width:        '100%',
        background:   '#181818',
        borderRadius: 16,
        overflow:     'hidden',
        position:     'relative',
        userSelect:   'none',
      }}
      onMouseMove={handleMouseMove}
    >
      {/* ── Grain overlay ── */}
      <div style={{
        position:       'absolute',
        inset:          0,
        opacity:        0.02,
        pointerEvents:  'none',
        backgroundImage: "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbHRlcj0idXJsKCNhKSIvPjwvc3ZnPg==')",
      }} />

      <div style={{ padding: '24px 24px 20px' }}>

        {/* ── Timeline area ── */}
        <div style={{ position: 'relative', height: TOTAL_H, marginBottom: 8 }}>

          {/* Month grid lines */}
          {months.map((m, i) => (
            <motion.div
              key={i}
              style={{
                position:   'absolute',
                left:       `${m.pct}%`,
                top:        0,
                bottom:     0,
                width:      1,
                background: 'rgba(255,255,255,0.06)',
              }}
              initial={{ opacity: 0 }}
              animate={isLoaded ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.6, delay: 0.3 + i * 0.04 }}
            />
          ))}

          {/* Axis line */}
          <motion.div
            style={{
              position:   'absolute',
              left:       0,
              right:      0,
              height:     1,
              background: 'rgba(255,255,255,0.12)',
              top:        AXIS_TOP,
            }}
            initial={{ scaleX: 0 }}
            animate={isLoaded ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut', delay: 0.2 }}
          />

          {/* TODAY tick */}
          <motion.div
            style={{
              position:   'absolute',
              left:       0,
              top:        AXIS_TOP - 10,
              width:      1,
              height:     20,
              background: 'rgba(255,255,255,0.35)',
            }}
            initial={{ opacity: 0 }}
            animate={isLoaded ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 1.4 }}
          />
          <motion.div
            style={{
              position:   'absolute',
              left:       4,
              top:        AXIS_TOP - 16,
              fontSize:   8,
              color:      'rgba(255,255,255,0.35)',
              letterSpacing: '0.08em',
            }}
            initial={{ opacity: 0 }}
            animate={isLoaded ? { opacity: 1 } : { opacity: 0 }}
            transition={{ delay: 1.5 }}
          >
            TODAY
          </motion.div>

          {/* ── Release cards ── */}
          {vis.map((rel, i) => {
            const color   = TRACK_COLORS[i % TRACK_COLORS.length]
            const offset  = CARD_OFFSETS[i % CARD_OFFSETS.length]
            const Icon    = TYPE_ICON[rel.release_type] ?? Music2

            const relTasks      = tasksByRelease.get(rel.id) ?? []
            const taskDates     = relTasks.filter(t => t.due_date).map(t => t.due_date!).sort()
            const taskCount     = relTasks.length
            const completeCount = relTasks.filter(t => t.status === 'complete').length

            const relPct    = rel.release_date ? toPct(rel.release_date) : 50
            const startPct  = taskDates.length > 0
              ? Math.max(0, toPct(taskDates[0]))
              : Math.max(0, relPct - 12)
            const endPct    = Math.min(99, relPct)
            const widthPct  = Math.max(9, endPct - startPct)

            const isHovered      = hoveredId === rel.id
            const isOtherHovered = hoveredId !== null && !isHovered
            const donePct        = taskCount > 0 ? completeCount / taskCount : 0

            return (
              <motion.div
                key={rel.id}
                style={{
                  position:        'absolute',
                  left:            `${startPct}%`,
                  width:           `${widthPct}%`,
                  top:             AXIS_TOP + offset,
                  transformOrigin: 'center center',
                  cursor:          'pointer',
                  zIndex:          isHovered ? 50 : i + 1,
                }}
                initial={{ opacity: 0, y: 40 }}
                animate={isLoaded ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
                transition={{ duration: 0.9, delay: 0.5 + i * 0.13, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ scale: 1.05 }}
                onHoverStart={() => setHoveredId(rel.id)}
                onHoverEnd={() => setHoveredId(null)}
                onClick={() => onReleaseClick(rel.id)}
              >
                <motion.div
                  style={{
                    borderRadius:    18,
                    padding:         '14px 16px',
                    backgroundColor: color,
                    position:        'relative',
                    overflow:        'hidden',
                  }}
                  animate={{
                    opacity: isOtherHovered ? 0.28 : isHovered ? 0.97 : 0.80,
                    filter:  isOtherHovered ? 'blur(1.5px)' : 'blur(0px)',
                  }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  {/* Icon + content */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <motion.div
                      style={{
                        width:           32,
                        height:          32,
                        background:      'rgba(255,255,255,0.22)',
                        borderRadius:    9,
                        display:         'flex',
                        alignItems:      'center',
                        justifyContent:  'center',
                        flexShrink:      0,
                      }}
                      animate={{
                        backgroundColor: isHovered
                          ? 'rgba(255,255,255,0.38)'
                          : 'rgba(255,255,255,0.22)',
                      }}
                    >
                      <Icon size={15} color="white" />
                    </motion.div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize:      9,
                        fontWeight:    700,
                        color:         'white',
                        marginBottom:  3,
                        letterSpacing: '0.06em',
                        whiteSpace:    'nowrap',
                        overflow:      'hidden',
                        textOverflow:  'ellipsis',
                      }}>
                        {rel.title.toUpperCase()}
                      </div>

                      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.65)' }}>
                        {rel.release_type}
                      </div>

                      {/* Progress bar always visible */}
                      {taskCount > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.55)', marginBottom: 3 }}>
                            {completeCount}/{taskCount} done
                          </div>
                          <div style={{ height: 2.5, background: 'rgba(255,255,255,0.18)', borderRadius: 2 }}>
                            <div style={{
                              height:           '100%',
                              width:            `${donePct * 100}%`,
                              background:       'rgba(255,255,255,0.85)',
                              borderRadius:     2,
                              transition:       'width 0.6s ease',
                            }} />
                          </div>
                        </div>
                      )}

                      {/* Release date — revealed on hover */}
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: isHovered ? 1 : 0, height: isHovered ? 'auto' : 0 }}
                        transition={{ duration: 0.2 }}
                        style={{
                          fontSize:      8,
                          color:         'rgba(255,255,255,0.65)',
                          marginTop:     8,
                          paddingTop:    6,
                          borderTop:     '1px solid rgba(255,255,255,0.18)',
                          overflow:      'hidden',
                        }}
                      >
                        {rel.release_date && new Date(rel.release_date + 'T12:00:00Z')
                          .toLocaleDateString('en-US', {
                            month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                          })}
                      </motion.div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )
          })}

          {/* ── Connection lines (card → label) ── */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {vis.map((rel, i) => {
              const relTasks  = tasksByRelease.get(rel.id) ?? []
              const taskDates = relTasks.filter(t => t.due_date).map(t => t.due_date!).sort()
              const offset    = CARD_OFFSETS[i % CARD_OFFSETS.length]

              const relPct   = rel.release_date ? toPct(rel.release_date) : 50
              const startPct = taskDates.length > 0
                ? Math.max(0, toPct(taskDates[0]))
                : Math.max(0, relPct - 12)
              const endPct   = Math.min(99, relPct)
              const widthPct = Math.max(9, endPct - startPct)
              const midPct   = startPct + widthPct / 2

              const labelSpacing    = 100 / vis.length
              const labelCenterPct  = labelSpacing * i + labelSpacing / 2

              const isHovered = hoveredId === rel.id

              // Card bottom anchor
              const cardBottomY = AXIS_TOP + offset + CARD_H_EST

              return (
                <motion.line
                  key={`line-${rel.id}`}
                  x1={`${midPct}%`}
                  y1={cardBottomY}
                  x2={`${labelCenterPct}%`}
                  y2={TOTAL_H - 16}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={isHovered ? 2 : 1}
                  initial={{ opacity: 0 }}
                  animate={isLoaded ? {
                    opacity:      isHovered ? 0.55 : 0.12,
                    strokeWidth:  isHovered ? 2 : 1,
                  } : { opacity: 0 }}
                  transition={{ duration: 1.0, delay: 1.2 + i * 0.08 }}
                />
              )
            })}
          </svg>
        </div>

        {/* ── Month scale ── */}
        <div style={{ position: 'relative', height: 18, marginBottom: 16 }}>
          {months.map((m, i) => {
            const markerX  = (m.pct / 100) * containerW
            const dist     = Math.abs(markerX - mouseX)
            const isNear   = dist < containerW * 0.09

            return (
              <motion.div
                key={i}
                style={{
                  position:      'absolute',
                  left:          `${m.pct}%`,
                  transform:     'translateX(-50%)',
                  fontSize:      8,
                  color:         'rgba(255,255,255,0.4)',
                  letterSpacing: '0.1em',
                  whiteSpace:    'nowrap',
                }}
                animate={{ opacity: isNear ? 1 : 0.38 }}
                transition={{ duration: 0.18 }}
              >
                {m.label}
              </motion.div>
            )
          })}
        </div>

        {/* ── Release labels (evenly spaced below) ── */}
        <motion.div
          style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}
          initial={{ opacity: 0, y: 12 }}
          animate={isLoaded ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.8, delay: 1.6 }}
        >
          {vis.map((rel, i) => {
            const color     = TRACK_COLORS[i % TRACK_COLORS.length]
            const isHovered = hoveredId === rel.id

            return (
              <motion.div
                key={rel.id}
                style={{
                  padding:       '4px 11px',
                  borderRadius:  5,
                  fontSize:      8,
                  fontWeight:    600,
                  letterSpacing: '0.12em',
                  cursor:        'pointer',
                  border:        `1px solid ${isHovered ? color : 'rgba(255,255,255,0.15)'}`,
                  color:         isHovered ? color : 'rgba(255,255,255,0.4)',
                  whiteSpace:    'nowrap',
                }}
                animate={{
                  borderColor: isHovered ? color : 'rgba(255,255,255,0.15)',
                  color:       isHovered ? color : 'rgba(255,255,255,0.4)',
                }}
                transition={{ duration: 0.25 }}
                onHoverStart={() => setHoveredId(rel.id)}
                onHoverEnd={() => setHoveredId(null)}
                onClick={() => onReleaseClick(rel.id)}
              >
                {rel.title.toUpperCase()}
              </motion.div>
            )
          })}
        </motion.div>

      </div>
    </div>
  )
}
