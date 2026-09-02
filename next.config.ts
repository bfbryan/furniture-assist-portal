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
    ];
  },
};

export default nextConfig;
