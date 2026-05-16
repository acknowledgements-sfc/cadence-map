import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { isOverdue, isDueSoon } from '../lib/cascadeEngine'

export interface NotificationItem {
  id: string
  taskId: string
  taskTitle: string
  releaseId: string
  releaseTitle: string
  type: 'overdue' | 'due_soon'
  dueDate: string | null
}

export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastSeen, setLastSeen] = useState<Date>(() => {
    const stored = localStorage.getItem('cadence_notif_seen')
    return stored ? new Date(stored) : new Date(0)
  })

  const fetch = useCallback(async () => {
    setLoading(true)

    const [releasesRes, tasksRes] = await Promise.all([
      supabase.from('releases').select('id, title'),
      supabase
        .from('tasks')
        .select('id, title, due_date, release_id, status')
        .neq('status', 'complete')
        .neq('status', 'skipped')
        .not('due_date', 'is', null),
    ])

    const releaseMap = new Map(
      (releasesRes.data ?? []).map(r => [r.id, r.title])
    )

    const notifs: NotificationItem[] = []

    for (const t of tasksRes.data ?? []) {
      if (isOverdue(t.due_date)) {
        notifs.push({
          id: `overdue-${t.id}`,
          taskId: t.id,
          taskTitle: t.title,
          releaseId: t.release_id,
          releaseTitle: releaseMap.get(t.release_id) ?? 'Unknown',
          type: 'overdue',
          dueDate: t.due_date,
        })
      } else if (isDueSoon(t.due_date, 7)) {
        notifs.push({
          id: `soon-${t.id}`,
          taskId: t.id,
          taskTitle: t.title,
          releaseId: t.release_id,
          releaseTitle: releaseMap.get(t.release_id) ?? 'Unknown',
          type: 'due_soon',
          dueDate: t.due_date,
        })
      }
    }

    // Sort: overdue first, then by date
    notifs.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'overdue' ? -1 : 1
      return (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    })

    setItems(notifs)
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const markAllRead = useCallback(() => {
    const now = new Date()
    setLastSeen(now)
    localStorage.setItem('cadence_notif_seen', now.toISOString())
  }, [])

  // Show badge count until the panel has been opened at least once this session
  const unreadCount = lastSeen.getTime() === new Date(0).getTime() ? items.length : 0

  return { items, loading, unreadCount, markAllRead, refresh: fetch }
}
