import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev-mode indicator badge has no place in a design screenshot — off
  // in every environment, not just for captures (item 7).
  devIndicators: false,
};

export default nextConfig;
