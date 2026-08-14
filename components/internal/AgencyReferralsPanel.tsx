"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { formatDateOnly } from "@/lib/dates";

// ─── Types ────────────────────────────────────────────────────────────────────
// July 2026: statuses now match the six Airtable Appointment Status values
// 1:1. Order in the union = display order in filter pills and STATUS_CONFIG.

export type ReferralStatus =
  | "Unscheduled"
  | "Pending Schedule"
  | "Scheduled"
  | "Cancelled"
  | "Completed"
  | "No Show";

export interface AgencyReferral {
  id: string;                        // Airtable record ID
  clientName: string;                // Client Referrals → "Client Name" field
  submittedBy: string;               // Client Referrals → "Submitted By" (Agency User name)
  referralDate: string;              // Submission date (ISO)
  appointmentDate: string | null;    // Scheduled appt date (ISO) — null until scheduled
  status: ReferralStatus;
}

interface AgencyReferralsPanelProps {
  referrals: AgencyReferral[];
}

// ─── Status config ─────────────────────────────────────────────────────────────
// Colors match the accent scheme used across the Dawson admin views.
// July 2026: No Show switched from purple → FA gold (#C9A84C) to match the
// history page's pill color for cross-page consistency. Uses inline style
// (`pillStyle`) because Tailwind's amber palette is a green-tinted yellow
// that doesn't match the FA warm gold exactly.

type StatusStyle = {
  label: string;
  pill: string;                              // Tailwind classes (when set)
  pillStyle?: React.CSSProperties;           // inline style override (when set, wins over `pill`)
  dot: string;
};

const STATUS_CONFIG: Record<ReferralStatus, StatusStyle> = {
  Unscheduled: {
    label: "Unscheduled",
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
  Cancelled: {
    label: "Cancelled",
    pill: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-400",
  },
  Completed: {
    label: "Completed",
    pill: "bg-gray-100 text-gray-600 border-gray-200",
    dot: "bg-gray-400",
  },
  "No Show": {
    label: "No show",
    // Match history page: bg rgba(201,168,76,0.15), text #C9A84C, border same gold @ 30% alpha
    pill: "",
    pillStyle: {
      backgroundColor: "rgba(201,168,76,0.15)",
      color: "#C9A84C",
      borderColor: "rgba(201,168,76,0.3)",
    },
    dot: "bg-[#C9A84C]",
  },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as ReferralStatus[];
const FILTER_OPTIONS: Array<{ value: ReferralStatus | "All"; label: string }> =
  [
    { value: "All", label: "All" },
    ...ALL_STATUSES.map((s) => ({ value: s, label: STATUS_CONFIG[s].label })),
  ];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Appointment Date / Referral Date are Airtable date-only fields; parsing them
// with `new Date()` anchors at UTC midnight and prints the previous day in any
// US zone.
function formatDate(iso: string): string {
  return formatDateOnly(iso, {
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
          {/* Unscheduled alert badge — visible even when collapsed.
              This is the new "attention required" state, replacing the
              old Pending Review badge. */}
          {(counts["Unscheduled"] ?? 0) > 0 && (
            <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {counts["Unscheduled"]} unscheduled
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
                          {r.submittedBy} ·{" "}
                          {r.appointmentDate ? (
                            <>Appt Date {formatDate(r.appointmentDate)}</>
                          ) : (
                            <>Submission Date {formatDate(r.referralDate)}</>
                          )}
                        </p>
                      </div>
                      <span
                        className={`ml-4 shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${cfg.pill}`}
                        style={cfg.pillStyle}
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
