import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["saxon-js"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The /proxy/api/xslt route invokes xslt3.js in a child Node.js process.
  // Next.js cannot infer imports made inside that separate process, so Vercel's
  // traced function must explicitly contain the CLI and its runtime modules.
  outputFileTracingIncludes: {
    "/proxy/api/xslt": [
      "./node_modules/xslt3/**/*",
      "./node_modules/saxon-js/**/*",
      "./node_modules/axios/**/*",
      "./node_modules/follow-redirects/**/*",
      "./node_modules/form-data/**/*",
      "./node_modules/proxy-from-env/**/*",
    ],
  },
};

export default nextConfig;
