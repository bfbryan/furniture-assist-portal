// components/agency/HelpAccordion.tsx
//
// One accordion section on the agency Help page (app/(agency)/help/page.tsx).
// Rows default collapsed — nothing auto-opens. Open state is a Set of row
// ids kept in this component, not in the page, so each section is
// independent and the page itself stays a server component.
//
// Card / heading treatment matches Team and Dashboard: white card, 12px
// radius, the same soft shadow, Montserrat 600/700 navy headings.

'use client'

import { useState, type ReactNode } from 'react'

export type HelpItem = {
  id: string
  question: string
  answer: ReactNode
}

const CARD: React.CSSProperties = {
  background: 'white',
  borderRadius: '12px',
  boxShadow: '0 2px 12px rgba(27,43,75,0.07)',
  overflow: 'hidden',
}

export default function HelpAccordion({ title, items }: { title: string; items: HelpItem[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section>
      <h2 style={{ fontFamily: 'var(--font-montserrat)', fontSize: '15px', fontWeight: 600, color: '#1B2B4B', margin: '0 0 10px' }}>
        {title}
      </h2>
      <div style={CARD}>
        {items.map((item, i) => {
          const isOpen = open.has(item.id)
          return (
            <div key={item.id} style={{ borderTop: i === 0 ? 'none' : '1px solid #EDE9E1' }}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={isOpen}
                aria-controls={`help-panel-${item.id}`}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '16px 20px',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13.5px', color: '#1B2B4B' }}>
                  {item.question}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#7A8899"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    flexShrink: 0,
                    transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s',
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {isOpen && (
                <div
                  id={`help-panel-${item.id}`}
                  style={{ padding: '0 20px 18px', fontSize: '13px', color: '#2C3A4A', lineHeight: 1.6 }}
                >
                  {item.answer}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
