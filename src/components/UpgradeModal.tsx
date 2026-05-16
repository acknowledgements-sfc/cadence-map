interface UpgradeModalProps {
  onClose: () => void
  reason?: 'release_limit'
}

const FREE_LIMIT = 3

export { FREE_LIMIT }

export default function UpgradeModal({ onClose, reason = 'release_limit' }: UpgradeModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 flex flex-col items-center text-center"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        {/* Icon */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-2xl"
          style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}
        >
          🚀
        </div>

        <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
          {reason === 'release_limit' ? `${FREE_LIMIT}-release limit reached` : 'Upgrade to Cadence Pro'}
        </h2>

        <p className="text-sm mb-6 leading-relaxed" style={{ color: 'var(--color-text-muted)', maxWidth: 320 }}>
          {reason === 'release_limit'
            ? `The free plan includes up to ${FREE_LIMIT} releases. Upgrade to Pro for unlimited releases, email reminders, and priority support.`
            : 'Unlock unlimited releases, email reminders, and more with Cadence Pro.'
          }
        </p>

        {/* Features list */}
        <div
          className="w-full rounded-xl p-4 mb-6 text-left flex flex-col gap-2"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          {[
            { icon: '♾️', text: 'Unlimited releases' },
            { icon: '📧', text: 'Daily & weekly email digests' },
            { icon: '⚡', text: 'Priority cascade updates' },
            { icon: '📊', text: 'Release analytics dashboard' },
          ].map(f => (
            <div key={f.text} className="flex items-center gap-3">
              <span className="text-base">{f.icon}</span>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{f.text}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <a
          href="mailto:hello@cadenceapp.io?subject=Cadence Pro - Upgrade Request"
          className="w-full rounded-xl py-3 text-sm font-semibold mb-3 flex items-center justify-center transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-accent)', color: 'white' }}
        >
          Get early access — contact us
        </a>

        <button
          onClick={onClose}
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Maybe later
        </button>
      </div>
    </div>
  )
}
