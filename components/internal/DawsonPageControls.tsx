// components/internal/DawsonPageControls.tsx
//
// The one row of page-level controls — count chips, Refresh buttons, the
// Show/Hide Past Dates toggle, the dashboard date — that used to sit in each
// Dawson page's own <header> next to the title. The title moved to the shell
// bar (DawsonPageBar); this is where everything else from those headers went.
//
// One shared component, not hand-rolled per page, so the gutter, alignment and
// gap below the bar stay identical across the ~11 pages that use it. Left
// aligned, source order, wraps on a narrow window. It sits directly below the
// bar, above the page's existing content container.
//
// Renders nothing when it has no children (e.g. a list page still loading, so
// its count chips haven't rendered yet) rather than leaving an empty strip.

export default function DawsonPageControls({
  children,
}: {
  children?: React.ReactNode
}) {
  const hasContent =
    Array.isArray(children)
      ? children.some(Boolean)
      : Boolean(children)

  if (!hasContent) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px 12px',
        padding: '16px 32px 0',
      }}
    >
      {children}
    </div>
  )
}
