import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @electric-sql/pglite ships pre-minified ESM whose Emscripten WASM glue does not survive
  // Turbopack's production bundling (a minifier alpha-rename breaks its instantiateWasm hook).
  // Marking it external makes Next require() it from node_modules at runtime instead.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The samples power the "load samples" route and the mock model's ground-truth lookup at
  // runtime, so they must ship in the serverless bundle, not just exist in the repo checkout.
  outputFileTracingIncludes: {
    "/api/**": ["./samples/manifest.json", "./samples/out/**", "./samples/ground-truth/**"],
  },
};

export default nextConfig;
