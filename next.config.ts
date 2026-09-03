import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,

  async redirects() {
    // Sep 2026: the four Agencies list pages collapsed into /dawson/agencies.
    // These three are gone; redirect rather than 404 in case Dawson bookmarked
    // one. Pending Approval kept its own route (unlinked) and is NOT redirected
    // — it folds into a Needs Action page later.
    //
    // permanent: false (307/308-not-permanent): this is a consolidation, and a
    // permanent redirect gets hard-cached by browsers, which would fight a
    // future change to the shape of this area.
    return [
      { source: "/dawson/agencies/active", destination: "/dawson/agencies", permanent: false },
      { source: "/dawson/agencies/unclaimed", destination: "/dawson/agencies", permanent: false },
      { source: "/dawson/agencies/inactive", destination: "/dawson/agencies", permanent: false },

      // Sep 2026: Scheduled and History collapsed into one /dawson/referrals
      // page — same records, one lookup screen with a status filter and a date
      // range instead of two destinations. permanent: false for the same
      // reason as above (a permanent redirect hard-caches and would fight a
      // later change to this area).
      { source: "/dawson/referrals/scheduled", destination: "/dawson/referrals", permanent: false },
      { source: "/dawson/referrals/history", destination: "/dawson/referrals", permanent: false },

      // Sep 2026: Awaiting Review and Pending Approval folded into the Needs
      // Action page — each became one of its five cards. Same permanent: false
      // reasoning as above.
      { source: "/dawson/referrals/review", destination: "/dawson/needs-action", permanent: false },
      { source: "/dawson/agencies/pending", destination: "/dawson/needs-action", permanent: false },
    ];
  },
};

export default nextConfig;
