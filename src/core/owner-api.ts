// Response shapes of the owner face (spec/node-api.md, "Owner face"). The
// worker handlers are typed against these, and the authoring plugin reads them
// through the package's `contract` entry, so the two sides cannot drift apart
// silently. Zero Cloudflare names or imports.

import type { PaymentRecord } from "./ports.ts";

/** GET /owner/summary */
export interface PublisherSummary {
  publisher: string;
  fragment_count: number;
  events: {
    total: number;
    by_type: Record<string, number>;
  };
  top_fragments: Array<{
    id: string;
    title: string | null;
    events: number;
  }>;
  revenue: {
    total: number;
    currency: string;
    payments: number;
  };
}

/** GET /owner/fragments/{id}/usage */
export interface FragmentUsage {
  fragment_id: string;
  points: Array<{
    day: string;
    event_type: string;
    count: number;
  }>;
}

/** GET /owner/payments — dormant in v1: `payments` is empty and `total` is 0. */
export interface PaymentStatus {
  payments: PaymentRecord[];
  total: number;
}

/** PUT /owner/fragments/{id} — success body. */
export interface PublishResult {
  id: string;
  /** The fragment's absolute canonical URL on this node. */
  canonical: string;
  mediaCount: number;
  updatedTs: number;
}
