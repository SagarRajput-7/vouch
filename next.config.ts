import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @electric-sql/pglite ships pre-minified ESM whose Emscripten WASM glue does not survive
  // Turbopack's production bundling (a minifier alpha-rename breaks its instantiateWasm hook).
  // Marking it external makes Next require() it from node_modules at runtime instead.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
