// Package build: bundle the Worker entry and the publish CLI with esbuild, then
// emit type declarations with tsc. Output lands in dist/ (gitignored).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

// Worker entry: platform-neutral ESM. The consumer's wrangler bundles it again,
// so this only needs to be a single self-contained module.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
});

// Contract entry: types only. The runtime module is intentionally empty; it
// exists so "@sphere-pub/node/contract" resolves for bundlers as well as tsc.
await build({
  entryPoints: ["src/contract.ts"],
  outfile: "dist/contract.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
});

// Publish CLI: runs under Node and shells out to wrangler. It reads
// spec/fragment.schema.json relative to its own location (dist/ -> ../spec/),
// so the spec directory ships alongside it in the package.
await build({
  entryPoints: ["scripts/publish.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
});

execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
