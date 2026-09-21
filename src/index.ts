// Public package entry for @sphere-pub/node.
//
// A consumer Worker re-exports the default handler and points its own
// wrangler.toml at this package's migrations:
//
//   // src/index.ts
//   export { default } from "@sphere-pub/node";
//
// Everything below this surface (core/, platform/) is internal and may change
// between minor versions. The HTTP contract is versioned in spec/node-api.md.

export { default } from "./platform/cloudflare/worker.ts";
export {
  depsFromEnv,
  handleRequest,
  type Deps,
  type Env,
  type NodeConfig,
  type RequestContext,
} from "./platform/cloudflare/worker.ts";
export type { JsonSchema } from "./core/schema.ts";
export * from "./contract.ts";
