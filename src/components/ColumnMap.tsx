// ============================================================
// CADENCE — ColumnMap
//
// Vertical-card timeline view inspired by stacked project plans.
// Each release becomes a colored semi-transparent card whose:
//   • left  edge = earliest task due_date (or relX - 60px if none)
//   • right edge = release_date
//   • height     = staggered across 6 levels for visual depth
//
// Cards can overlap — later releases render on top, creating
// the layered look from the reference design.
//
// Reuses the same HorizonRelease/HorizonTask/HorizonDep types
// exported by HorizonMap.tsx.
// ============================================================

import { useRef, useEffect, useState, useMemo } from 'react'
import { isOverdue } from '../lib/cascadeEngine'
import type { HorizonRelease, HorizonTask, HorizonDep } from './HorizonMap'

// ─────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────

export interface ColumnMapProps {
  releases:       HorizonRelease[]
  tasks:          HorizonTask[]
  deps:           HorizonDep[]
  windowDays:     number
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

// 6 staggered heights cycle by index — creates the rising step effect
const CARD_HEIGHTS = [140, 180, 220, 160, 200, 240]

const SVG_H      = 400   // total SVG height
const AXIS_Y     = 300   // Y position of the horizontal axis
const PAD        = 14    // internal card padding
const MIN_CARD_W = 52    // minimum card width (very short window)
const RIGHT_PAD  = 12
const LABEL_BELOW = 56   // space below axis for labels

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// ─────────────────────────────────────────────────────────
// ColumnMap
// ─────────────────────────────────────────────────────────

export default function ColumnMap({
  releases,
  tasks,
  deps: _deps,
  windowDays,
  onReleaseClick,
}: ColumnMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgWidth, setSvgWidth] = useState(600)

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
  const todayMs = new Date(
    new Date().toISOString().split('T')[0] + 'T12:00:00Z'
  ).getTime()
  const endMs  = todayMs + windowDays * 86_400_000
  const chartW = Math.max(0, svgWidth - RIGHT_PAD)

  const toX = (isoDate: string): number => {
    const ms  = new Date(isoDate + 'T12:00:00Z').getTime()
    const pct = (ms - todayMs) / (endMs - todayMs)
    return pct * chartW
  }

  // ── Tasks indexed by release ────────────────────────────
  const tasksByRelease = useMemo(() => {
    const map = new Map<string, HorizonTask[]>()
    for (const t of tasks) {
      if (!map.has(t.release_id)) map.set(t.release_id, [])
      map.get(t.release_id)!.push(t)
    }
    return map
  }, [tasks])

  // ── Releases visible in window (include a little before today) ──
  const visibleReleases = useMemo(() => {
    return releases.filter(r => {
      if (!r.release_date) return false
      const ms = new Date(r.release_date + 'T12:00:00Z').getTime()
      return ms >= todayMs - 14 * 86_400_000 && ms <= endMs
    })
  }, [releases, todayMs, endMs]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Empty state ─────────────────────────────────────────
  if (visibleReleases.length === 0) {
    return (
      <div ref={containerRef} style={{ padding: '24px 0', textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No releases in this window — try expanding the time range.
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <svg
        width={svgWidth}
        height={SVG_H}
        viewBox={`0 0 ${svgWidth} ${SVG_H}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* ── Month gridlines ── */}
        {monthLines.map((m, i) => {
          const x = toX(m.toISOString().split('T')[0])
          if (x < 2 || x > svgWidth - RIGHT_PAD) return null
          const label = m.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
          return (
            <g key={i}>
              <line
                x1={x} y1={0}
                x2={x} y2={AXIS_Y + LABEL_BELOW}
                stroke="var(--color-border)"
                strokeWidth={0.5}
                strokeDasharray="3,4"
              />
              <text x={x + 3} y={14} fontSize={9} fill="var(--color-text-muted)" fontFamily="inherit">
                {label}
              </text>
            </g>
          )
        })}

        {/* ── Horizontal axis ── */}
        <line
          x1={0} y1={AXIS_Y}
          x2={svgWidth} y2={AXIS_Y}
          stroke="var(--color-border)"
          strokeWidth={1}
        />

        {/* ── Release cards ── */}
        {visibleReleases.map((rel, i) => {
          const color   = TRACK_COLORS[i % TRACK_COLORS.length]
          const cardH   = CARD_HEIGHTS[i % CARD_HEIGHTS.length]
          const cardY   = AXIS_Y - cardH

          const relTasks      = tasksByRelease.get(rel.id) ?? []
          const taskDates     = relTasks.filter(t => t.due_date).map(t => t.due_date!).sort()
          const taskCount     = relTasks.length
          const completeCount = relTasks.filter(t => t.status === 'complete').length
          const hasOverdue    = relTasks.some(
            t => t.due_date && t.status !== 'complete' && isOverdue(t.due_date)
          )

          // Card x bounds
          const relX   = rel.release_date ? toX(rel.release_date) : null
          if (relX === null) return null

          const rawStartX = taskDates.length > 0
            ? toX(taskDates[0])
            : relX - 60

          const startX = Math.max(-4, rawStartX)
          const endX   = relX
          const cardW  = Math.max(MIN_CARD_W, endX - startX)

          // Skip if entirely off screen
          if (startX > svgWidth + 4 || endX < -4) return null

          const pct  = taskCount > 0 ? completeCount / taskCount : 0
          const barW = Math.max(0, (cardW - PAD * 2) * pct)
          const maxChars = Math.max(6, Math.floor(cardW / 7.5))

          return (
            <g
              key={rel.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onReleaseClick(rel.id)}
            >
              {/* Card body */}
              <rect
                x={startX} y={cardY}
                width={cardW} height={cardH}
                rx={10} ry={10}
                fill={color}
                opacity={0.86}
              />

              {/* Overdue stripe at top of card */}
              {hasOverdue && (
                <rect
                  x={startX} y={cardY}
                  width={cardW} height={5}
                  rx={2}
                  fill="#E24B4A"
                  opacity={0.95}
                />
              )}

              {/* Title */}
              <text
                x={startX + PAD} y={cardY + 22}
                fontSize={10} fontWeight={700}
                fill="white"
                fontFamily="inherit"
              >
                {truncate(rel.title, maxChars)}
              </text>

              {/* Release type */}
              <text
                x={startX + PAD} y={cardY + 36}
                fontSize={8}
                fill="rgba(255,255,255,0.65)"
                fontFamily="inherit"
              >
                {rel.release_type}
              </text>

              {/* Task count + progress bar (only if card is tall enough) */}
              {taskCount > 0 && cardH >= 120 && (
                <>
                  <text
                    x={startX + PAD} y={cardY + cardH - 20}
                    fontSize={8}
                    fill="rgba(255,255,255,0.65)"
                    fontFamily="inherit"
                  >
                    {completeCount}/{taskCount} done
                  </text>
                  {/* track */}
                  <rect
                    x={startX + PAD} y={cardY + cardH - 11}
                    width={cardW - PAD * 2} height={3}
                    rx={1.5}
                    fill="rgba(255,255,255,0.2)"
                  />
                  {/* fill */}
                  <rect
                    x={startX + PAD} y={cardY + cardH - 11}
                    width={barW} height={3}
                    rx={1.5}
                    fill="rgba(255,255,255,0.85)"
                  />
                </>
              )}

              {/* Drop line to axis */}
              <line
                x1={relX} y1={AXIS_Y}
                x2={relX} y2={AXIS_Y + 20}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.8}
              />
              {/* Fork bracket */}
              <line
                x1={relX - 7} y1={AXIS_Y + 20}
                x2={relX + 7} y2={AXIS_Y + 20}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.8}
              />

              {/* Date below axis */}
              {rel.release_date && (
                <text
                  x={relX} y={AXIS_Y + 34}
                  textAnchor="middle"
                  fontSize={8}
                  fill="var(--color-text-muted)"
                  fontFamily="inherit"
                >
                  {new Date(rel.release_date + 'T12:00:00Z').toLocaleDateString(
                    'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }
                  )}
                </text>
              )}

              {/* Release name label below axis */}
              <text
                x={relX} y={AXIS_Y + 47}
                textAnchor="middle"
                fontSize={7}
                fontWeight={600}
                fill="var(--color-text-muted)"
                fontFamily="inherit"
              >
                {truncate(rel.title, 14).toUpperCase()}
              </text>
            </g>
          )
        })}

        {/* ── TODAY marker ── */}
        <line
          x1={1} y1={0}
          x2={1} y2={AXIS_Y + LABEL_BELOW}
          stroke="#888780"
          strokeWidth={1.5}
          strokeDasharray="4,3"
          opacity={0.6}
        />
        <text x={6} y={22} fontSize={9} fill="#888780" fontFamily="inherit">
          today
        </text>
      </svg>
    </div>
  )
}
