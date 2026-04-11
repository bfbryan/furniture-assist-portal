"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReferralStatus =
  | "Pending Review"
  | "Pending Schedule"
  | "Scheduled"
  | "Completed"
  | "Cancelled";

export interface AgencyReferral {
  id: string;           // Airtable record ID
  clientName: string;   // Client Referrals → "Client Name" field
  submittedBy: string;  // Client Referrals → "Submitted By" (Agency User name)
  referralDate: string; // ISO date string — display formatted
  status: ReferralStatus;
}

interface AgencyReferralsPanelProps {
  referrals: AgencyReferral[];
}

// ─── Status config ─────────────────────────────────────────────────────────────
// Matches the color accents already in use in ReferralTable.tsx

const STATUS_CONFIG: Record<
  ReferralStatus,
  { label: string; pill: string; dot: string }
> = {
  "Pending Review": {
    label: "Pending review",
    pill: "bg-amber-50 text-amber-800 border-amber-200",
    dot: "bg-amber-400",
  },
  "Pending Schedule": {
    label: "Pending schedule",
    pill: "bg-sky-50 text-sky-800 border-sky-200",
    dot: "bg-sky-400",
  },
  Scheduled: {
    label: "Scheduled",
    pill: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-400",
  },
  Completed: {
    label: "Completed",
    pill: "bg-gray-100 text-gray-600 border-gray-200",
    dot: "bg-gray-400",
  },
  Cancelled: {
    label: "Cancelled",
    pill: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-400",
  },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as ReferralStatus[];
const FILTER_OPTIONS: Array<{ value: ReferralStatus | "All"; label: string }> =
  [
    { value: "All", label: "All" },
    ...ALL_STATUSES.map((s) => ({ value: s, label: STATUS_CONFIG[s].label })),
  ];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgencyReferralsPanel({
  referrals,
}: AgencyReferralsPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ReferralStatus | "All">(
    "All"
  );

  const filtered = useMemo(() => {
    return referrals.filter((r) => {
      const matchStatus =
        activeFilter === "All" || r.status === activeFilter;
      const matchSearch =
        !search.trim() ||
        r.clientName.toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [referrals, search, activeFilter]);

  // Count per status for pill badges
  const counts = useMemo(() => {
    const map: Partial<Record<ReferralStatus | "All", number>> = {
      All: referrals.length,
    };
    for (const s of ALL_STATUSES) {
      map[s] = referrals.filter((r) => r.status === s).length;
    }
    return map;
  }, [referrals]);

  return (
    <section className="mt-6">
      {/* ── Section header (collapse toggle) ─────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-medium text-gray-900">
            Referrals
          </span>
          {/* Always-visible count badge */}
          <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
            {referrals.length} total
          </span>
          {/* Pending Review alert badge — visible even when collapsed */}
          {(counts["Pending Review"] ?? 0) > 0 && (
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {counts["Pending Review"]} pending review
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* ── Collapsible body ──────────────────────────────────────────── */}
      {isOpen && (
        <div className="border border-t-0 border-gray-200 rounded-b-xl overflow-hidden">

          {/* Controls bar */}
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 space-y-2">
            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by client name…"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#2A7F6F] focus:border-[#2A7F6F]"
            />
            {/* Status filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {FILTER_OPTIONS.map(({ value, label }) => {
                const count = counts[value] ?? 0;
                const isActive = activeFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setActiveFilter(value as ReferralStatus | "All")
                    }
                    className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                      isActive
                        ? "bg-[#1B2B4B] text-[#F7F5F1] border-[#1B2B4B]"
                        : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span
                        className={`ml-1.5 ${
                          isActive ? "text-[#C9A84C]" : "text-gray-400"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Referral rows */}
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No referrals match this filter.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const cfg = STATUS_CONFIG[r.status];
                return (
                  <li key={r.id}>
                    <Link
                      href={`/dawson/referrals/${r.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#2A7F6F] group-hover:underline truncate">
                          {r.clientName}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {r.submittedBy} · {formatDate(r.referralDate)}
                        </p>
                      </div>
                      <span
                        className={`ml-4 shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${cfg.pill}`}
                      >
                        {cfg.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Footer — visible count when filtered */}
          {(search || activeFilter !== "All") && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
              Showing {filtered.length} of {referrals.length} referrals
            </div>
          )}
        </div>
      )}
    </section>
  );
}
