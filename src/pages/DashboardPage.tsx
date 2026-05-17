// ============================================================
// CADENCE — Dashboard (Mission Control)
//
// Layout:
//   ① Window selector + Plan Health ring (header bar)
//   ② Horizon Map — Subway-style multi-release timeline
//   ③ Guardian panel (60%) + Focus / Streak cards (40%)
//
// The Guardian is a proactive watchdog: it surfaces conflicts,
// overdue tasks, and urgent deadlines with a direct voice —
// not a notification list, but an active analyst that tells
// you when you're about to fuck up.
// ============================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import NewReleaseModal from '../components/NewReleaseModal'
import UpgradeModal, { FREE_LIMIT } from '../components/UpgradeModal'
import HorizonMap from '../components/HorizonMap'
import type { HorizonRelease, HorizonTask, HorizonDep } from '../components/HorizonMap'
import {
  addDays,
  formatDateShort,
  isOverdue,
  daysBetween,
} from '../lib/cascadeEngine'

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type WindowSize = 7 | 15 | 30 | 45 | 60 | 90 | 120 | 365

interface GuardianAlert {
  id:        string
  color:     string
  severity:  'critical' | 'warning' | 'success'
  message:   string
  sub:       string
  releaseId?: string
}

interface FocusItem {
  task:    HorizonTask
  release: HorizonRelease
  daysUntil: number
  isOverdue: boolean
}

// ─────────────────────────────────────────────────────────
// Computed metrics
// ─────────────────────────────────────────────────────────

function computePlanHealth(tasks: HorizonTask[], deps: HorizonDep[]): number {
  if (tasks.length === 0) return 100
  const today   = new Date().toISOString().split('T')[0]
  const taskMap = new Map(tasks.map(t => [t.id, t]))
  let score     = 100

  // −15 per dependency violation, max −30
  let violations = 0
  for (const dep of deps) {
    const from = taskMap.get(dep.depends_on_task_id)
    const to   = taskMap.get(dep.task_id)
    if (!from?.due_date || !to?.due_date) continue
    if (from.status === 'complete')       continue
    if (to.due_date < addDays(from.due_date, dep.lag_days ?? 0)) violations++
  }
  score -= Math.min(violations * 15, 30)

  // −8 per overdue task, max −40
  let overdue = 0
  for (const t of tasks) {
    if (t.status === 'complete' || t.status === 'skipped') continue
    if (t.due_date && t.due_date < today) overdue++
  }
  score -= Math.min(overdue * 8, 40)

  // −5 per unstarted task due within 3 days, max −20
  const urgentEdge = addDays(today, 3)
  let urgentUnstarted = 0
  for (const t of tasks) {
    if (t.status !== 'pending') continue
    if (t.due_date && t.due_date <= urgentEdge && t.due_date >= today) urgentUnstarted++
  }
  score -= Math.min(urgentUnstarted * 5, 20)

  return Math.max(0, Math.min(100, score))
}

function computeGuardianAlerts(
  releases: HorizonRelease[],
  tasks:    HorizonTask[],
  deps:     HorizonDep[]
): GuardianAlert[] {
  const today      = new Date().toISOString().split('T')[0]
  const taskMap    = new Map(tasks.map(t => [t.id, t]))
  const releaseMap = new Map(releases.map(r => [r.id, r]))
  const alerts: GuardianAlert[] = []

  // ① Dependency violations (critical)
  for (const dep of deps) {
    const from = taskMap.get(dep.depends_on_task_id)
    const to   = taskMap.get(dep.task_id)
    if (!from?.due_date || !to?.due_date) continue
    if (from.status === 'complete' && to.status === 'complete') continue
    const minDate = addDays(from.due_date, dep.lag_days ?? 0)
    if (to.due_date >= minDate) continue
    const rel = releaseMap.get(to.release_id)
    alerts.push({
      id:        `violation-${dep.task_id}`,
      severity:  'critical',
      color:     '#E24B4A',
      message:   `"${to.title}" is scheduled before "${from.title}" finishes on ${formatDateShort(from.due_date)}. That's a dependency violation — it cannot start on time.`,
      sub:       `${rel?.title ?? 'Unknown release'} · conflict`,
      releaseId: to.release_id,
    })
  }

  // ② Overdue tasks grouped by release (critical)
  const overdueByRelease = new Map<string, number>()
  for (const t of tasks) {
    if (t.status === 'complete' || t.status === 'skipped') continue
    if (!t.due_date || t.due_date >= today) continue
    overdueByRelease.set(t.release_id, (overdueByRelease.get(t.release_id) ?? 0) + 1)
  }
  for (const [rid, count] of overdueByRelease) {
    const rel = releaseMap.get(rid)
    alerts.push({
      id:        `overdue-${rid}`,
      severity:  'critical',
      color:     '#E24B4A',
      message:   `${count} task${count > 1 ? 's' : ''} on "${rel?.title ?? 'this release'}" ${count > 1 ? 'are' : 'is'} overdue and unresolved. Every day you wait risks pushing your release date.`,
      sub:       `${rel?.title ?? ''} · ${count} overdue`,
      releaseId: rid,
    })
  }

  // ③ Unstarted tasks due within 3 days (warning)
  const urgentEdge = addDays(today, 3)
  for (const t of tasks) {
    if (t.status !== 'pending') continue
    if (!t.due_date || t.due_date > urgentEdge || t.due_date < today) continue
    const rel   = releaseMap.get(t.release_id)
    const dLeft = daysBetween(today, t.due_date)
    alerts.push({
      id:        `urgent-${t.id}`,
      severity:  'warning',
      color:     '#BA7517',
      message:   `"${t.title}" is due in ${dLeft} day${dLeft !== 1 ? 's' : ''} and hasn't started. If you miss this, ${rel?.title ?? 'your release'} starts cascading.`,
      sub:       `${rel?.title ?? ''} · due ${formatDateShort(t.due_date)}`,
      releaseId: t.release_id,
    })
  }

  // ④ In-progress tasks due this week (warning, max 1)
  const weekEdge = addDays(today, 7)
  const activeAtRisk = tasks.filter(
    t => t.status === 'in_progress' && t.due_date && t.due_date <= weekEdge && t.due_date >= today
  )
  if (activeAtRisk.length > 0) {
    const t   = activeAtRisk[0]
    const rel = releaseMap.get(t.release_id)
    alerts.push({
      id:        `active-risk-${t.id}`,
      severity:  'warning',
      color:     '#BA7517',
      message:   `"${t.title}" is in progress and due ${formatDateShort(t.due_date!)}. Make sure it lands on time — ${activeAtRisk.length > 1 ? `${activeAtRisk.length - 1} other task${activeAtRisk.length > 2 ? 's are' : ' is'} in the same window` : 'this is your only active task this week'}.`,
      sub:       `${rel?.title ?? ''} · in progress`,
      releaseId: t.release_id,
    })
  }

  // ⑤ Positive momentum (success)
  const completedCount = tasks.filter(t => t.status === 'complete').length
  if (completedCount > 0 && alerts.filter(a => a.severity === 'critical').length === 0) {
    alerts.push({
      id:       'momentum',
      severity: 'success',
      color:    '#3B6D11',
      message:  `${completedCount} task${completedCount > 1 ? 's' : ''} completed across your active releases. No critical issues right now — keep the momentum going.`,
      sub:      'looking good',
    })
  }

  // Sort: critical → warning → success, cap at 5
  const order: Record<string, number> = { critical: 0, warning: 1, success: 2 }
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 5)
}

function computeTodayFocus(
  releases: HorizonRelease[],
  tasks:    HorizonTask[],
  deps:     HorizonDep[]
): FocusItem | null {
  const today      = new Date().toISOString().split('T')[0]
  const taskMap    = new Map(tasks.map(t => [t.id, t]))
  const releaseMap = new Map(releases.map(r => [r.id, r]))

  // Find tasks blocked by an unfinished prerequisite
  const blocked = new Set<string>()
  for (const dep of deps) {
    const prereq = taskMap.get(dep.depends_on_task_id)
    if (prereq && prereq.status !== 'complete' && prereq.status !== 'skipped') {
      blocked.add(dep.task_id)
    }
  }

  const candidates = tasks
    .filter(t => t.status !== 'complete' && t.status !== 'skipped')
    .filter(t => !!t.due_date)
    .filter(t => !blocked.has(t.id))
    .sort((a, b) => {
      const aOD = (a.due_date ?? '') < today
      const bOD = (b.due_date ?? '') < today
      if (aOD && !bOD) return -1
      if (!aOD && bOD) return  1
      return (a.due_date ?? '').localeCompare(b.due_date ?? '')
    })

  if (candidates.length === 0) return null
  const task    = candidates[0]
  const release = releaseMap.get(task.release_id)
  if (!release) return null

  const od       = isOverdue(task.due_date)
  const daysLeft = od
    ? -daysBetween(task.due_date!, today)
    : daysBetween(today, task.due_date!)

  return { task, release, daysUntil: daysLeft, isOverdue: od }
}

function computeStreak(releases: HorizonRelease[], tasks: HorizonTask[]): number {
  const today   = new Date().toISOString().split('T')[0]
  const past    = releases
    .filter(r => r.release_date && r.release_date < today)
    .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))

  let streak = 0
  for (const rel of past) {
    const relTasks = tasks.filter(t => t.release_id === rel.id)
    if (relTasks.length === 0) continue
    const allDone  = relTasks.every(t => t.status === 'complete' || t.status === 'skipped')
    if (allDone) streak++
    else         break
  }
  return streak
}

function healthColor(score: number): string {
  if (score >= 80) return '#1D9E75'
  if (score >= 50) return '#BA7517'
  return '#E24B4A'
}

// ─────────────────────────────────────────────────────────
// Plan Health Ring (animated on mount)
// ─────────────────────────────────────────────────────────

function PlanHealthRing({ score }: { score: number }) {
  const [displayed, setDisplayed] = useState(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (score === 0) return
    let current = 0
    const target    = score
    const increment = Math.max(1, Math.ceil(target / 50))
    const step = () => {
      current = Math.min(current + increment, target)
      setDisplayed(current)
      if (current < target) rafRef.current = requestAnimationFrame(step)
    }
    const t = setTimeout(() => { rafRef.current = requestAnimationFrame(step) }, 250)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(rafRef.current)
    }
  }, [score])

  const R    = 18
  const circ = 2 * Math.PI * R
  const dash = (displayed / 100) * circ
  const col  = healthColor(displayed)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ textAlign: 'right' }}>
        <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 1 }}>Plan health</p>
        <p style={{ fontSize: 22, fontWeight: 600, color: col, lineHeight: 1.1 }}>
          {displayed}
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>/100</span>
        </p>
      </div>
      <svg width={44} height={44} viewBox="0 0 44 44" style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={22} cy={22} r={R}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={4}
        />
        <circle
          cx={22} cy={22} r={R}
          fill="none"
          stroke={col}
          strokeWidth={4}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.05s linear' }}
        />
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Window selector
// ─────────────────────────────────────────────────────────

const WINDOWS: { label: string; days: WindowSize }[] = [
  { label: '7d',   days:   7 },
  { label: '15d',  days:  15 },
  { label: '30d',  days:  30 },
  { label: '45d',  days:  45 },
  { label: '60d',  days:  60 },
  { label: '90d',  days:  90 },
  { label: '120d', days: 120 },
  { label: '1yr',  days: 365 },
]

function WindowSelector({
  value,
  onChange,
}: {
  value: WindowSize
  onChange: (d: WindowSize) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {WINDOWS.map(w => (
        <button
          key={w.days}
          onClick={() => onChange(w.days)}
          style={{
            fontSize:     12,
            padding:      '4px 10px',
            borderRadius: 'var(--border-radius-md)',
            border:       `0.5px solid ${w.days === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
            background:   w.days === value ? 'var(--color-surface-2)' : 'transparent',
            color:        w.days === value ? 'var(--color-text)' : 'var(--color-text-muted)',
            cursor:       'pointer',
            fontWeight:   w.days === value ? 600 : 400,
            transition:   'all 0.12s',
          }}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Guardian panel
// ─────────────────────────────────────────────────────────

function GuardianPanel({
  alerts,
  releaseCount,
  onAlertClick,
}: {
  alerts:       GuardianAlert[]
  releaseCount: number
  onAlertClick: (releaseId?: string) => void
}) {
  return (
    <div
      style={{
        background:   'var(--color-surface)',
        border:       '1px solid var(--color-border)',
        borderRadius: 'var(--border-radius-xl)',
        padding:      '16px 18px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg
          width={15} height={15} viewBox="0 0 24 24"
          fill="none" stroke="var(--color-text-muted)"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
          Guardian
        </span>
        <span
          className="cadence-live"
          style={{ fontSize: 10, color: '#1D9E75', marginLeft: 'auto' }}
        >
          ● watching {releaseCount} plan{releaseCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Alerts */}
      {alerts.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
          No active issues. All your plans look clean.
        </p>
      ) : (
        <div>
          {alerts.map((alert, idx) => (
            <div
              key={alert.id}
              onClick={() => onAlertClick(alert.releaseId)}
              style={{
                display:       'flex',
                alignItems:    'flex-start',
                gap:           10,
                padding:       '10px 0',
                borderBottom:  idx < alerts.length - 1
                  ? '1px solid var(--color-border)'
                  : 'none',
                cursor:        alert.releaseId ? 'pointer' : 'default',
                animation:     `cadence-alert-in 0.3s ease-out ${idx * 60}ms both`,
              }}
            >
              <div
                style={{
                  width:       7,
                  height:      7,
                  borderRadius: '50%',
                  background:  alert.color,
                  flexShrink:  0,
                  marginTop:   5,
                }}
              />
              <div>
                <p style={{ fontSize: 12, color: 'var(--color-text)', lineHeight: 1.6 }}>
                  {alert.message}
                </p>
                <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
                  {alert.sub}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Today's Focus card
// ─────────────────────────────────────────────────────────

function TodayFocusCard({
  focus,
  onNavigate,
}: {
  focus:      FocusItem | null
  onNavigate: (releaseId: string) => void
}) {
  const dueLine = focus
    ? focus.isOverdue
      ? `${focus.daysUntil} day${focus.daysUntil !== 1 ? 's' : ''} overdue`
      : focus.daysUntil === 0
        ? 'due today'
        : `due in ${focus.daysUntil} day${focus.daysUntil !== 1 ? 's' : ''}`
    : null

  const dueColor = focus
    ? focus.isOverdue || focus.daysUntil === 0
      ? '#E24B4A'
      : focus.daysUntil <= 3
        ? '#BA7517'
        : 'var(--color-text-muted)'
    : 'var(--color-text-muted)'

  const progressWidth = focus
    ? focus.task.status === 'in_progress' ? '50%' : '0%'
    : '0%'

  return (
    <div
      style={{
        background:   'var(--color-surface)',
        border:       '1px solid var(--color-border)',
        borderRadius: 'var(--border-radius-xl)',
        padding:      '16px 18px',
        flex:          1,
        cursor:        focus ? 'pointer' : 'default',
      }}
      onClick={() => focus && onNavigate(focus.release.id)}
    >
      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Today's focus
      </p>

      {focus ? (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 2 }}>
            {focus.task.title}
          </p>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            {focus.release.title}
          </p>
          <div
            style={{
              height:       3,
              background:   'var(--color-border)',
              borderRadius: 2,
              overflow:     'hidden',
              marginBottom: 4,
            }}
          >
            <div
              style={{
                width:        progressWidth,
                height:       '100%',
                background:   '#1D9E75',
                borderRadius: 2,
                transition:   'width 0.5s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              {focus.task.status === 'in_progress' ? 'in progress' : 'not started'}
            </p>
            <p style={{ fontSize: 10, fontWeight: 600, color: dueColor }}>
              {dueLine}
            </p>
          </div>
        </>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Nothing blocked. You're either all caught up or no dates are set.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Streak card
// ─────────────────────────────────────────────────────────

function StreakCard({ streak }: { streak: number }) {
  const msg = streak === 0
    ? 'No releases shipped yet — this is where your streak starts.'
    : streak === 1
      ? 'First one down. Ship the next one on time to start a streak.'
      : `${streak} releases shipped on time — don't break it now.`

  const col = streak >= 3 ? '#1D9E75' : streak >= 1 ? '#BA7517' : 'var(--color-text-muted)'

  return (
    <div
      style={{
        background:   'var(--color-surface-2)',
        border:       '1px solid var(--color-border)',
        borderRadius: 'var(--border-radius-xl)',
        padding:      '14px 18px',
      }}
    >
      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
        On-time streak
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: col, lineHeight: 1 }}>
          {streak}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          release{streak !== 1 ? 's' : ''} shipped on time
        </span>
      </div>
      <p style={{ fontSize: 11, color: col }}>{msg}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// DashboardPage
// ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user: _user } = useAuth()
  const navigate   = useNavigate()

  const [windowDays,  setWindowDays]  = useState<WindowSize>(60)
  const [releases,    setReleases]    = useState<HorizonRelease[]>([])
  const [tasks,       setTasks]       = useState<HorizonTask[]>([])
  const [deps,        setDeps]        = useState<HorizonDep[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showModal,   setShowModal]   = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Fetch all data in one round trip
  const fetchData = useCallback(async () => {
    setLoading(true)

    const [relRes, taskRes, depRes] = await Promise.all([
      supabase
        .from('releases')
        .select('id, title, artist, release_type, release_date')
        .order('release_date', { ascending: true }),

      supabase
        .from('tasks')
        .select('id, title, due_date, status, release_id'),

      supabase
        .from('task_dependencies')
        .select('task_id, depends_on_task_id, lag_days'),
    ])

    setReleases(
      (relRes.data ?? []).map(r => ({
        id:           r.id,
        title:        r.title,
        release_type: r.release_type,
        release_date: r.release_date ?? null,
      }))
    )
    setTasks(taskRes.data ?? [])
    setDeps(depRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Computed metrics (all memoized to avoid re-computation on window change)
  const planHealth    = useMemo(() => computePlanHealth(tasks, deps),                    [tasks, deps])
  const guardianAlerts = useMemo(() => computeGuardianAlerts(releases, tasks, deps),    [releases, tasks, deps])
  const todayFocus    = useMemo(() => computeTodayFocus(releases, tasks, deps),          [releases, tasks, deps])
  const streak        = useMemo(() => computeStreak(releases, tasks),                    [releases, tasks])

  const handleNewRelease = useCallback(() => {
    if (releases.length >= FREE_LIMIT) setShowUpgrade(true)
    else setShowModal(true)
  }, [releases.length])

  const handleAlertClick = useCallback((releaseId?: string) => {
    if (releaseId) navigate(`/releases/${releaseId}`)
  }, [navigate])

  // Loading skeleton
  if (loading) {
    return (
      <div className="p-8 max-w-6xl">
        <div style={{ height: 28, width: 220, background: 'var(--color-surface)', borderRadius: 8, marginBottom: 24 }} />
        <div style={{ height: 200, background: 'var(--color-surface)', borderRadius: 16, marginBottom: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12 }}>
          <div style={{ height: 200, background: 'var(--color-surface)', borderRadius: 16 }} />
          <div style={{ height: 200, background: 'var(--color-surface)', borderRadius: 16 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">

      {/* ── ① Header: window selector + health ring ── */}
      <div
        style={{
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'center',
          marginBottom:   16,
          flexWrap:       'wrap',
          gap:            12,
        }}
      >
        <WindowSelector value={windowDays} onChange={setWindowDays} />
        <PlanHealthRing score={planHealth} />
      </div>

      {/* ── ② Horizon Map ── */}
      <div
        style={{
          background:   'var(--color-surface)',
          border:       '1px solid var(--color-border)',
          borderRadius: 'var(--border-radius-xl)',
          padding:      '16px 18px 12px',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
            marginBottom:   12,
          }}
        >
          <p style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
            Horizon — all releases
          </p>
          <button
            onClick={handleNewRelease}
            style={{
              fontSize:     11,
              fontWeight:   600,
              color:        'var(--color-accent)',
              background:   'transparent',
              border:       'none',
              cursor:       'pointer',
              padding:      '2px 0',
            }}
          >
            + New release
          </button>
        </div>

        <HorizonMap
          releases={releases}
          tasks={tasks}
          deps={deps}
          windowDays={windowDays}
          onReleaseClick={id => navigate(`/releases/${id}`)}
        />

        {/* Legend */}
        {releases.length > 0 && (
          <div
            style={{
              display:     'flex',
              alignItems:  'center',
              gap:         14,
              marginTop:   12,
              paddingTop:  10,
              borderTop:   '1px solid var(--color-border)',
              flexWrap:    'wrap',
            }}
          >
            {[
              { color: '#888780',   label: 'complete',    solid: true  },
              { color: '#1D9E75',   label: 'upcoming',    solid: false },
              { color: '#BA7517',   label: 'in progress', solid: true  },
              { color: '#E24B4A',   label: 'conflict / overdue', solid: true },
              { color: '#534AB7',   label: 'release date', diamond: true },
            ].map(item => (
              <div
                key={item.label}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {item.diamond ? (
                  <div style={{ width: 8, height: 8, background: item.color, transform: 'rotate(45deg)' }} />
                ) : item.solid ? (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: item.color }} />
                ) : (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', border: `1.5px solid ${item.color}`, background: 'transparent' }} />
                )}
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{item.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── ③ Bottom row: Guardian + Focus / Streak ── */}
      <div
        style={{
          display:             'grid',
          gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
          gap:                 12,
        }}
      >
        <GuardianPanel
          alerts={guardianAlerts}
          releaseCount={releases.length}
          onAlertClick={handleAlertClick}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TodayFocusCard
            focus={todayFocus}
            onNavigate={id => navigate(`/releases/${id}`)}
          />
          <StreakCard streak={streak} />
        </div>
      </div>

      {showModal && (
        <NewReleaseModal
          onClose={() => setShowModal(false)}
          onCreated={id => navigate(`/releases/${id}`)}
        />
      )}
      {showUpgrade && (
        <UpgradeModal onClose={() => setShowUpgrade(false)} reason="release_limit" />
      )}
    </div>
  )
}
