import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useNotifications'
import NotificationPanel from './NotificationPanel'

const navItems = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    to: '/releases',
    label: 'Releases',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 2v2M9 14v2M2 9h2M14 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    to: '/tasks',
    label: 'Tasks',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M3 5h12M3 9h8M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="14" cy="13" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M13 13l.8.8L15.5 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M3.93 3.93l1.06 1.06M13.01 13.01l1.06 1.06M3.93 14.07l1.06-1.06M13.01 4.99l1.06-1.06" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()
  const { items, loading, unreadCount, markAllRead } = useNotifications()
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <>
      <aside
        className="flex flex-col w-56 shrink-0 h-screen sticky top-0"
        style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--color-accent)' }}
          >
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
              <path d="M9 2L9 16M5 6L9 2L13 6M5 12L9 16L13 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-semibold text-base tracking-tight" style={{ color: 'var(--color-text)' }}>Cadence</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'text-white' : ''
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--color-accent)' : 'transparent',
                color: isActive ? 'white' : 'var(--color-text-muted)',
              })}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}

          {/* Notification bell */}
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mt-1 relative"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <span className="relative">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M9 2a6 6 0 0 0-6 6v3l-1.5 2h15L15 11V8a6 6 0 0 0-6-6z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M7.5 14.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-white font-bold"
                  style={{ background: '#f87171', fontSize: 9 }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
            Alerts
            {!loading && items.length > 0 && unreadCount === 0 && (
              <span
                className="ml-auto text-xs rounded-full px-1.5 py-0.5"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-muted)' }}
              >
                {items.length}
              </span>
            )}
          </button>
        </nav>

        {/* User / sign out */}
        <div className="px-4 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-xs truncate mb-2" style={{ color: 'var(--color-text-muted)' }}>{user?.email}</p>
          <button
            onClick={signOut}
            className="text-xs w-full text-left transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Sign out →
          </button>
        </div>
      </aside>

      {/* Notification panel */}
      {panelOpen && (
        <NotificationPanel
          items={items}
          loading={loading}
          onClose={() => setPanelOpen(false)}
          onMarkRead={markAllRead}
        />
      )}
    </>
  )
}
