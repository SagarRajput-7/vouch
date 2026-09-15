import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @electric-sql/pglite ships pre-minified ESM whose Emscripten WASM glue does not survive
  // Turbopack's production bundling (a minifier alpha-rename breaks its instantiateWasm hook).
  // tesseract.js, @napi-rs/canvas, unpdf, and pdfjs-dist all ship native binaries or worker/wasm
  // assets that don't survive bundling either, so they stay external and are require()'d from
  // node_modules at runtime instead.
  serverExternalPackages: ["@electric-sql/pglite", "tesseract.js", "@napi-rs/canvas", "unpdf", "pdfjs-dist"],
  // The samples power the "load samples" route and the mock model's ground-truth lookup at
  // runtime, so they must ship in the serverless bundle, not just exist in the repo checkout.
  outputFileTracingIncludes: {
    "/api/**": ["./samples/manifest.json", "./samples/out/**", "./samples/ground-truth/**", "./samples/recordings/**"],
  },
};

export default nextConfig;
