// components/agency/AgencyPageHeader.tsx
// Universal navy hero used across every agency portal page.
// - Left column: "AGENCY PARTNER" + agency name + address + phone
// - Divider
// - Middle column: "LOGGED IN AS" + user name + phone + role
// - Right column (optional): stat tiles (Total / Active / Completed OR custom)
//
// Pass `stats={null}` to hide the tiles entirely (Profile + Team pages).
// Pass `stats={[...]}` on Active/History pages.


import React from 'react'


type StatTile = {
  label: string
  value: number | string
  emphasized?: boolean // teal highlight, used for "Active"
}


type Props = {
  // Left column
  agencyName: string
  agencyAddress?: string | null
  agencyAddress2?: string | null
  agencyCity?: string | null
  agencyState?: string | null
  agencyZip?: string | null
  agencyPhone?: string | null


  // Middle column
  userName: string
  userPhone?: string | null
  userRole?: string | null


  // Optional page-label override for the left column
  agencyLabel?: string  // default: "Agency Partner"


  // Right column tiles — pass null/undefined to hide
  stats?: StatTile[] | null
}


export default function AgencyPageHeader({
  agencyName,
  agencyAddress,
  agencyAddress2,
  agencyCity,
  agencyState,
  agencyZip,
  agencyPhone,
  userName,
  userPhone,
  userRole,
  agencyLabel = 'Agency Partner',
  stats,
}: Props) {
  const addressLine = [agencyAddress, agencyAddress2].filter(Boolean).join(', ')
  const cityStateZip = [
    agencyCity,
    agencyState && agencyZip ? `${agencyState} ${agencyZip}` : agencyState || agencyZip || '',
  ]
    .filter(Boolean)
    .join(', ')


  const hasStats = Array.isArray(stats) && stats.length > 0


  return (
    <div className="bg-gradient-to-br from-[#1B2B4B] to-[#253F6A] border-b-4 border-[#2A7F6F] px-8 py-9">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6">
        {/* Identity block — agency + logged-in user, always shown */}
        <div className="flex gap-10 flex-wrap">
          {/* Agency */}
          <div>
            <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
              {agencyLabel}
            </span>
            <h1 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
              {agencyName}
            </h1>
            {addressLine && (
              <p className="text-sm text-white/50 font-light">
                {addressLine}
                {cityStateZip ? `, ${cityStateZip}` : ''}
              </p>
            )}
            {agencyPhone && (
              <p className="text-sm text-white/50 font-light">{agencyPhone}</p>
            )}
          </div>


          <div
            style={{
              width: '1px',
              background: 'rgba(255,255,255,0.12)',
              alignSelf: 'stretch',
            }}
          />


          {/* User */}
          <div>
            <span className="text-xs font-bold tracking-widest uppercase text-[#3AA08D] mb-2 block">
              Logged In As
            </span>
            <h2 className="font-montserrat font-extrabold text-2xl text-white tracking-tight mb-1">
              {userName}
            </h2>
            {userPhone && (
              <p className="text-sm text-white/50 font-light">{userPhone}</p>
            )}
            {userRole && (
              <p className="text-sm text-white/50 font-light">{userRole}</p>
            )}
          </div>
        </div>


        {/* Stat tiles — optional */}
        {hasStats && (
          <div className="flex items-center gap-4 flex-wrap">
            {stats!.map((s, i) => (
              <div
                key={i}
                className={`bg-white/8 border rounded-xl px-5 py-3 text-center min-w-[80px] ${
                  s.emphasized
                    ? 'border-[rgba(58,160,141,0.4)]'
                    : 'border-white/12'
                }`}
              >
                <div
                  className={`font-montserrat font-extrabold text-2xl leading-none mb-1 ${
                    s.emphasized ? 'text-[#3AA08D]' : 'text-white'
                  }`}
                >
                  {s.value}
                </div>
                <div className="text-xs font-bold uppercase tracking-wider text-white/45">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
