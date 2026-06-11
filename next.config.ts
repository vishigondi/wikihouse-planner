import type { NextConfig } from "next";

// Static export is opt-in (NEXT_STATIC_EXPORT=1) for static hosting builds.
// The default server build is required for API routes (/api/generate-plan).
const nextConfig: NextConfig = {
  output: process.env.NEXT_STATIC_EXPORT ? "export" : undefined,
};

export default nextConfig;
