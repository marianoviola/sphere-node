// Cloudflare Workers entrypoint: fetch(), routing, and binding wiring.
//
// The router `handleRequest` takes injected ports (Deps), so it is fully
// testable without a Cloudflare runtime. The default export builds Deps from the
// Worker `env` via the adapters and delegates. Cloudflare types are allowed here
// (this is the platform layer); core/ never imports them.

import { buildDiscovery } from "../../core/discovery.ts";
import { gateContent } from "../../core/gate.ts";
import { getContent } from "../../core/fragments.ts";
import { makeEvent, recordEvent, type EventType } from "../../core/ledger.ts";
import type {
  BlobStore,
  EventStore,
  FragmentStore,
  KvStore,
  PaymentStore,
} from "../../core/ports.ts";
import {
  d1EventStore,
  d1FragmentStore,
  d1PaymentStore,
  kvStore,
  r2BlobStore,
} from "./adapters.ts";

const DISCOVERY_CACHE_KEY = "discovery:v1";
const DISCOVERY_CACHE_TTL_SECONDS = 60;
const TOP_FRAGMENTS_LIMIT = 5;

export interface NodeConfig {
  publisherName: string;
  defaultLicense: string;
  ownerToken: string;
}

export interface Deps {
  blobs: BlobStore;
  cache: KvStore;
  events: EventStore;
  fragments: FragmentStore;
  payments: PaymentStore;
  config: NodeConfig;
}

/** Minimal slice of Cloudflare's ExecutionContext, so the router stays portable. */
export interface RequestContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface Env {
  SPHERE_DB: D1Database;
  SPHERE_CONTENT: R2Bucket;
  SPHERE_CACHE: KVNamespace;
  SPHERE_PUBLISHER_NAME: string;
  SPHERE_DEFAULT_LICENSE: string;
  SPHERE_OWNER_TOKEN: string;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function logEvent(
  deps: Deps,
  ctx: RequestContext,
  request: Request,
  fragmentId: string | null,
  eventType: EventType,
): void {
  const event = makeEvent({
    ts: Date.now(),
    fragmentId,
    eventType,
    userAgent: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
  });
  ctx.waitUntil(recordEvent(deps.events, event));
}

async function handleDiscovery(deps: Deps, ctx: RequestContext, request: Request): Promise<Response> {
  logEvent(deps, ctx, request, null, "discovery");

  const cached = await deps.cache.get(DISCOVERY_CACHE_KEY);
  if (cached) {
    return new Response(cached, {
      headers: { "content-type": "application/json; charset=utf-8", "x-sphere-cache": "hit" },
    });
  }

  const fragments = await deps.fragments.list();
  const doc = buildDiscovery(
    { publisherName: deps.config.publisherName, defaultLicense: deps.config.defaultLicense },
    fragments,
  );
  const body = JSON.stringify(doc);
  ctx.waitUntil(deps.cache.put(DISCOVERY_CACHE_KEY, body, { expirationTtl: DISCOVERY_CACHE_TTL_SECONDS }));

  return new Response(body, {
    headers: { "content-type": "application/json; charset=utf-8", "x-sphere-cache": "miss" },
  });
}

async function handleManifest(
  deps: Deps,
  ctx: RequestContext,
  request: Request,
  id: string,
): Promise<Response> {
  const fragment = await deps.fragments.get(id);
  if (!fragment) return json({ error: "fragment_not_found", id }, 404);

  logEvent(deps, ctx, request, id, "manifest");
  return json(fragment.manifest);
}

async function handleContent(
  deps: Deps,
  ctx: RequestContext,
  request: Request,
  id: string,
): Promise<Response> {
  const fragment = await deps.fragments.get(id);
  if (!fragment) return json({ error: "fragment_not_found", id }, 404);

  const content = await getContent(deps.blobs, fragment);
  if (content === null) return json({ error: "content_not_found", id }, 404);

  const result = gateContent(fragment.manifest, content);
  logEvent(deps, ctx, request, id, result.eventType);

  const headers: Record<string, string> = { "content-type": result.contentType };
  if (result.wwwAuthenticate) headers["www-authenticate"] = result.wwwAuthenticate;

  return new Response(result.body, { status: result.status, headers });
}

function isOwner(deps: Deps, request: Request): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const expected = `Bearer ${deps.config.ownerToken}`;
  return auth === expected;
}

async function handleOwnerSummary(deps: Deps): Promise<Response> {
  const [fragmentCount, summary, top, paymentTotal, payments] = await Promise.all([
    deps.fragments.count(),
    deps.events.summary(),
    deps.events.topFragments(TOP_FRAGMENTS_LIMIT),
    deps.payments.total(),
    deps.payments.list(),
  ]);

  // Enrich top fragments with titles where available.
  const topWithTitles = await Promise.all(
    top.map(async (t) => {
      const f = await deps.fragments.get(t.fragmentId);
      return { id: t.fragmentId, title: f?.manifest.title ?? null, events: t.count };
    }),
  );

  return json({
    publisher: deps.config.publisherName,
    fragment_count: fragmentCount,
    events: { total: summary.total, by_type: summary.byType },
    top_fragments: topWithTitles,
    revenue: { total: paymentTotal, currency: "USD", payments: payments.length },
  });
}

async function handleOwnerUsage(deps: Deps, id: string): Promise<Response> {
  const points = await deps.events.usageForFragment(id);
  return json({
    fragment_id: id,
    points: points.map((p) => ({ day: p.day, event_type: p.eventType, count: p.count })),
  });
}

async function handleOwnerPayments(deps: Deps): Promise<Response> {
  const [payments, total] = await Promise.all([deps.payments.list(), deps.payments.total()]);
  return json({ payments, total });
}

/**
 * Platform-neutral router. Tests call this directly with in-memory ports.
 */
export async function handleRequest(
  request: Request,
  deps: Deps,
  ctx: RequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
  }

  // Public face.
  if (path === "/.well-known/sphere.json") {
    return handleDiscovery(deps, ctx, request);
  }

  const manifestMatch = path.match(/^\/fragments\/([^/]+)\/sphere\.json$/);
  if (manifestMatch) {
    return handleManifest(deps, ctx, request, decodeURIComponent(manifestMatch[1]!));
  }

  const contentMatch = path.match(/^\/fragments\/([^/]+)\/content\.md$/);
  if (contentMatch) {
    return handleContent(deps, ctx, request, decodeURIComponent(contentMatch[1]!));
  }

  // Owner face. Read-only, bearer-gated, no ledger events.
  if (path.startsWith("/owner/")) {
    if (!isOwner(deps, request)) {
      return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });
    }

    if (path === "/owner/summary") return handleOwnerSummary(deps);
    if (path === "/owner/payments") return handleOwnerPayments(deps);

    const usageMatch = path.match(/^\/owner\/fragments\/([^/]+)\/usage$/);
    if (usageMatch) return handleOwnerUsage(deps, decodeURIComponent(usageMatch[1]!));

    return json({ error: "not_found" }, 404);
  }

  return json({ error: "not_found" }, 404);
}

/** Build Deps from Worker bindings. */
export function depsFromEnv(env: Env): Deps {
  return {
    blobs: r2BlobStore(env.SPHERE_CONTENT),
    cache: kvStore(env.SPHERE_CACHE),
    events: d1EventStore(env.SPHERE_DB),
    fragments: d1FragmentStore(env.SPHERE_DB),
    payments: d1PaymentStore(env.SPHERE_DB),
    config: {
      publisherName: env.SPHERE_PUBLISHER_NAME ?? "Sphere Node",
      defaultLicense: env.SPHERE_DEFAULT_LICENSE ?? "CC-BY",
      ownerToken: env.SPHERE_OWNER_TOKEN ?? "",
    },
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, depsFromEnv(env), ctx);
  },
};
