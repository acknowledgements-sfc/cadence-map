import { useState, useEffect } from 'react'

export interface Phase2Answers {
  weeklyHours?: number
  hasCollaborators?: boolean
  isPitching?: boolean
}

interface Phase2PromptsProps {
  onAnswer: (answers: Phase2Answers) => void
  answers: Phase2Answers
}

interface Prompt {
  id: keyof Phase2Answers
  question: string
  options: { label: string; value: boolean | number }[]
}

const PROMPTS: Prompt[] = [
  {
    id: 'weeklyHours',
    question: 'How much time can you realistically commit each week?',
    options: [
      { label: '1–3 hrs / week', value: 2 },
      { label: '4–8 hrs / week', value: 6 },
      { label: '8+ hrs / week', value: 10 },
    ],
  },
  {
    id: 'hasCollaborators',
    question: 'Are you working with collaborators on this release?',
    options: [
      { label: 'Just me', value: false },
      { label: 'Yes — features, mixing, or mastering', value: true },
    ],
  },
  {
    id: 'isPitching',
    question: 'Are you planning to pitch this to playlists or press?',
    options: [
      { label: 'Not this time', value: false },
      { label: 'Yes — I want coverage', value: true },
    ],
  },
]

export default function Phase2Prompts({ onAnswer, answers }: Phase2PromptsProps) {
  const [visible, setVisible] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [fading, setFading] = useState(false)

  // Appear after 10s
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10_000)
    return () => clearTimeout(t)
  }, [])

  // Skip prompts that already have answers
  useEffect(() => {
    if (visible) {
      const next = PROMPTS.findIndex((p, i) => i >= currentIndex && answers[p.id] === undefined)
      if (next === -1) return // all answered
      if (next !== currentIndex) setCurrentIndex(next)
    }
  }, [visible, answers, currentIndex])

  if (!visible) return null

  const current = PROMPTS[currentIndex]
  if (!current || answers[current.id] !== undefined) {
    // Find the next unanswered prompt
    const nextUnanswered = PROMPTS.findIndex(p => answers[p.id] === undefined)
    if (nextUnanswered === -1) return null // all done
  }

  const unansweredIndex = PROMPTS.findIndex(p => answers[p.id] === undefined)
  if (unansweredIndex === -1) return null

  const prompt = PROMPTS[unansweredIndex]
  const progress = PROMPTS.filter(p => answers[p.id] !== undefined).length
  const total = PROMPTS.length

  function handleSelect(value: boolean | number) {
    setFading(true)
    setTimeout(() => {
      onAnswer({ ...answers, [prompt.id]: value })
      setFading(false)
    }, 220)
  }

  return (
    <div
      style={{
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.22s ease',
        marginTop: 20,
      }}
    >
      <div
        className="rounded-xl p-5"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-3">
          {PROMPTS.map((p, _i) => {
            const answered = answers[p.id] !== undefined
            const isCurrent = p.id === prompt.id
            return (
              <div
                key={p.id}
                className="rounded-full transition-all"
                style={{
                  width: isCurrent ? 16 : 6,
                  height: 6,
                  background: answered
                    ? 'var(--color-accent)'
                    : isCurrent
                    ? 'var(--color-accent)'
                    : 'var(--color-border)',
                  opacity: answered ? 0.5 : 1,
                }}
              />
            )
          })}
          <span
            className="text-xs ml-1"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {progress}/{total}
          </span>
        </div>

        {/* Question */}
        <p
          className="text-sm font-medium mb-4 leading-snug"
          style={{ color: 'var(--color-text)' }}
        >
          {prompt.question}
        </p>

        {/* Options */}
        <div className="flex flex-col gap-2">
          {prompt.options.map(opt => (
            <button
              key={String(opt.value)}
              onClick={() => handleSelect(opt.value)}
              className="w-full text-left rounded-lg px-3 py-2.5 text-sm transition-all hover:opacity-80"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
