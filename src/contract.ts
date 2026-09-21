// The fragment contract as types, with no Cloudflare or runtime dependencies.
//
// Consumers that only need to READ or WRITE fragments — the authoring plugin,
// an importer, a CLI — import from "@sphere-pub/node/contract" and the schema
// from "@sphere-pub/node/spec/fragment.schema.json", instead of vendoring
// either. The JSON Schema stays the source of truth for structure; these types
// mirror it for TypeScript consumers.

export type {
  AccessBlock,
  AccessPolicy,
  FragmentManifest,
  PaymentMetadata,
  PublisherRef,
  RelationEdge,
  SourceRef,
  SourceType,
  StoredFragment,
} from "./core/types.ts";
export type { PaymentRecord } from "./core/ports.ts";
export type { FragmentUsage, PaymentStatus, PublisherSummary, PublishResult } from "./core/owner-api.ts";
