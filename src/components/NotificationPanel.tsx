import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NotificationItem } from '../hooks/useNotifications'
import { formatDate } from '../lib/cascadeEngine'

interface NotificationPanelProps {
  items: NotificationItem[]
  loading: boolean
  onClose: () => void
  onMarkRead: () => void
}

export default function NotificationPanel({
  items,
  loading,
  onClose,
  onMarkRead,
}: NotificationPanelProps) {
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid the same click that opened the panel closing it
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 100)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handler)
    }
  }, [onClose])

  // Mark as read when panel opens
  useEffect(() => {
    onMarkRead()
  }, [onMarkRead])

  const overdue = items.filter(i => i.type === 'overdue')
  const soon = items.filter(i => i.type === 'due_soon')

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.2)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 340,
          background: 'var(--color-bg)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.25)',
          animation: 'slideInRight 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Notifications</h2>
            {items.length > 0 && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {overdue.length > 0 ? `${overdue.length} overdue` : ''}
                {overdue.length > 0 && soon.length > 0 ? ', ' : ''}
                {soon.length > 0 ? `${soon.length} due soon` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-70"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 text-lg"
                style={{ background: 'var(--color-surface)' }}
              >
                ✓
              </div>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>All caught up</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                No overdue or upcoming tasks this week.
              </p>
            </div>
          ) : (
            <div className="px-4 py-4 flex flex-col gap-2">
              {/* Overdue section */}
              {overdue.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider px-1 mt-1 mb-1" style={{ color: '#f87171' }}>
                    Overdue
                  </p>
                  {overdue.map(item => (
                    <NotifCard
                      key={item.id}
                      item={item}
                      onNavigate={(releaseId) => { navigate(`/releases/${releaseId}`); onClose() }}
                    />
                  ))}
                </>
              )}

              {/* Due soon section */}
              {soon.length > 0 && (
                <>
                  <p
                    className="text-xs font-semibold uppercase tracking-wider px-1 mt-3 mb-1"
                    style={{ color: '#f59e0b' }}
                  >
                    Due This Week
                  </p>
                  {soon.map(item => (
                    <NotifCard
                      key={item.id}
                      item={item}
                      onNavigate={(releaseId) => { navigate(`/releases/${releaseId}`); onClose() }}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => { navigate('/tasks'); onClose() }}
            className="w-full rounded-lg py-2 text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-accent)', color: 'white' }}
          >
            View all tasks →
          </button>
        </div>
      </div>
    </>
  )
}

// ── Sub-component ──────────────────────────────────────────────
function NotifCard({
  item,
  onNavigate,
}: {
  item: NotificationItem
  onNavigate: (releaseId: string) => void
}) {
  return (
    <button
      onClick={() => onNavigate(item.releaseId)}
      className="w-full text-left rounded-xl px-3 py-3 flex items-start gap-3 transition-opacity hover:opacity-80"
      style={{
        background: item.type === 'overdue' ? 'rgba(248,113,113,0.07)' : 'rgba(245,158,11,0.07)',
        border: `1px solid ${item.type === 'overdue' ? 'rgba(248,113,113,0.2)' : 'rgba(245,158,11,0.2)'}`,
      }}
    >
      <div
        className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
        style={{ background: item.type === 'overdue' ? '#f87171' : '#f59e0b' }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-snug truncate" style={{ color: 'var(--color-text)' }}>
          {item.taskTitle}
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          {item.releaseTitle}
        </p>
        <p
          className="text-xs mt-0.5 font-medium"
          style={{ color: item.type === 'overdue' ? '#f87171' : '#f59e0b' }}
        >
          {item.type === 'overdue' ? '⚠ Overdue' : `Due ${formatDate(item.dueDate)}`}
        </p>
      </div>
    </button>
  )
}
