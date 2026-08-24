'use client'

// components/internal/StaffMatchHint.tsx
//
// The one line that says why an agency is still on screen when the thing you
// typed was a person's name. Rendered by all four Dawson agency list pages,
// and only when the agency's OWN fields did not match - see
// components/internal/useAgencyStaffSearch.ts.
//
// Nothing renders for an empty list, so this costs no height on a page nobody
// has searched, which is how it stays out of the way on the screens Dawson
// works from.

import { formatStaffHint } from './useAgencyStaffSearch'

export default function StaffMatchHint({ names }: { names: string[] }) {
  if (names.length === 0) return null

  return (
    <div
      title={names.join(', ')}
      style={{
        fontSize: '11px',
        color: '#7A8899',
        marginTop: '4px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span style={{ fontWeight: 700, color: '#2A7F6F' }}>Staff: </span>
      {formatStaffHint(names)}
    </div>
  )
}
