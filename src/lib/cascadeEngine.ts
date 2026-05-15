// ============================================================
// CADENCE — Dependency Cascade Engine
//
// When a task's due_date changes, walk the dependency graph
// forward and recalculate all downstream tasks.
//
// Also handles: release date changes (recalculates all tasks
// from their offset), and "what would slip?" preview.
// ============================================================

export interface CascadeTask {
  id: string
  template_key: string | null
  due_date: string           // ISO date string
  due_date_offset: number | null
  status: string
}

export interface CascadeDependency {
  task_id: string            // this task...
  depends_on_task_id: string // ...depends on this one
  lag_days: number
}

export interface CascadeResult {
  // Map of task_id → new due_date ISO string
  updates: Record<string, string>
  // How many tasks shifted
  affectedCount: number
}

// ============================================================
// Core cascade: given a changed task, propagate forward
// ============================================================
export function cascadeFromTask(
  changedTaskId: string,
  newDueDate: string,
  allTasks: CascadeTask[],
  allDeps: CascadeDependency[]
): CascadeResult {
  const taskMap = new Map<string, CascadeTask>()
  allTasks.forEach(t => taskMap.set(t.id, { ...t }))

  // Working copy of due dates
  const dueDates = new Map<string, string>()
  allTasks.forEach(t => dueDates.set(t.id, t.due_date))

  // Apply the change
  dueDates.set(changedTaskId, newDueDate)

  // Build adjacency: task_id → list of tasks that depend on it
  const downstreamMap = new Map<string, string[]>()
  allDeps.forEach(dep => {
    const list = downstreamMap.get(dep.depends_on_task_id) ?? []
    list.push(dep.task_id)
    downstreamMap.set(dep.depends_on_task_id, list)
  })

  // Build "what does this task depend on?" map
  const depMap = new Map<string, CascadeDependency[]>()
  allDeps.forEach(dep => {
    const list = depMap.get(dep.task_id) ?? []
    list.push(dep)
    depMap.set(dep.task_id, list)
  })

  // BFS forward from the changed task
  const queue: string[] = [changedTaskId]
  const visited = new Set<string>()
  const updates: Record<string, string> = {}

  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)

    // For each task that depends on currentId, recalculate its due date
    const downstream = downstreamMap.get(currentId) ?? []
    for (const downstreamId of downstream) {
      // Earliest this task can start = latest "depends_on" date + lag
      const deps = depMap.get(downstreamId) ?? []
      let latestPrereqDate = ''

      for (const dep of deps) {
        const prereqDate = dueDates.get(dep.depends_on_task_id) ?? ''
        if (!prereqDate) continue

        const afterLag = addDays(prereqDate, dep.lag_days)
        if (!latestPrereqDate || afterLag > latestPrereqDate) {
          latestPrereqDate = afterLag
        }
      }

      if (latestPrereqDate) {
        const currentDate = dueDates.get(downstreamId) ?? ''
        // Only push dates forward, never pull them earlier
        // (pulling earlier would be a separate "optimize" feature)
        if (latestPrereqDate > currentDate) {
          dueDates.set(downstreamId, latestPrereqDate)
          updates[downstreamId] = latestPrereqDate
          queue.push(downstreamId)
        }
      }
    }
  }

  // Remove the originally changed task from updates (caller already knows)
  delete updates[changedTaskId]
  updates[changedTaskId] = newDueDate

  return {
    updates,
    affectedCount: Object.keys(updates).length - 1, // -1 for the directly changed task
  }
}

// ============================================================
// Recalculate ALL tasks when the release date changes
// Uses due_date_offset to recompute from scratch
// ============================================================
export function recalculateFromReleaseDate(
  newReleaseDateStr: string,
  allTasks: CascadeTask[]
): Record<string, string> {
  const releaseDate = new Date(newReleaseDateStr + 'T12:00:00Z')
  const updates: Record<string, string> = {}

  for (const task of allTasks) {
    if (task.due_date_offset !== null && task.due_date_offset !== undefined) {
      const newDate = new Date(releaseDate)
      newDate.setDate(newDate.getDate() + task.due_date_offset)
      updates[task.id] = newDate.toISOString().split('T')[0]
    }
  }

  return updates
}

// ============================================================
// Preview: "what if this task slips by N days?"
// Returns a list of affected tasks with their new dates
// ============================================================
export interface SlipPreview {
  taskId: string
  taskTitle: string
  currentDate: string
  newDate: string
  daysSlipped: number
}

export function previewSlip(
  changedTaskId: string,
  slipDays: number,
  allTasks: CascadeTask[],
  allDeps: CascadeDependency[],
  taskTitles: Record<string, string>
): SlipPreview[] {
  const task = allTasks.find(t => t.id === changedTaskId)
  if (!task) return []

  const newDate = addDays(task.due_date, slipDays)
  const result = cascadeFromTask(changedTaskId, newDate, allTasks, allDeps)

  return Object.entries(result.updates)
    .filter(([id]) => id !== changedTaskId)
    .map(([id, newDateStr]) => {
      const t = allTasks.find(t => t.id === id)!
      return {
        taskId: id,
        taskTitle: taskTitles[id] ?? 'Unknown task',
        currentDate: t.due_date,
        newDate: newDateStr,
        daysSlipped: daysBetween(t.due_date, newDateStr),
      }
    })
    .sort((a, b) => a.newDate.localeCompare(b.newDate))
}

// ============================================================
// Date utilities
// ============================================================
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

export function daysBetween(isoA: string, isoB: string): number {
  const a = new Date(isoA + 'T12:00:00Z')
  const b = new Date(isoB + 'T12:00:00Z')
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24))
}

export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateShort(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.split('-').map(Number)
  const d = new Date(year, month - 1, day)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function isOverdue(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(isoDate + 'T00:00:00')
  return due < today
}

export function isDueSoon(isoDate: string | null | undefined, withinDays = 7): boolean {
  if (!isoDate) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const threshold = new Date(today)
  threshold.setDate(threshold.getDate() + withinDays)
  const due = new Date(isoDate + 'T00:00:00')
  return due >= today && due <= threshold
}
