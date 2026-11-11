import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Native / heavy server-only packages must not be bundled.
  serverExternalPackages: [
    "better-sqlite3",
    "playwright",
    "playwright-core",
    "@axe-core/playwright",
    "axe-core",
    "lighthouse",
    "chrome-launcher",
    "exceljs",
    "pngjs",
    "pixelmatch",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
