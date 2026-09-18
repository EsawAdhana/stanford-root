/**
 * Tells Human Behavior who the signed-in visitor is.
 *
 * Recording captures the page, never the account: an email only reaches Human
 * Behavior if this app hands it over after login. Without this module every
 * signed-in student shows up in the dashboard as an anonymous cookie with a
 * generated name, which is exactly what happened for the first 8,986 visitors.
 *
 * Two calls have to meet and the order is not guaranteed — the CDN loader is
 * `afterInteractive`, while Supabase can restore a session before it. So the
 * identity is buffered until the tracker exists, and the tracker flushes it on
 * arrival.
 */

import { isBotClient } from "./bot-agents";

/** The subset of the tracker handle this module uses. */
interface HumanBehaviorHandle {
  identifyUser: (userProperties: Record<string, unknown>) => Promise<unknown>;
}

/** What `v1/loader.js` puts on `window` once it has run. */
export interface HumanBehaviorLoader {
  init: (
    apiKey: string,
    options?: {
      /** Override the ingestion host (local stack or reverse proxy). */
      ingestionUrl?: string;
      /** Pin a recorder version. Leave unset — pinning is what caused the drift. */
      version?: string;
    },
  ) => unknown;
}

export interface VisitorIdentity {
  email: string;
  name?: string;
  /** Supabase user id, so a visitor stays one person across devices. */
  userId: string;
}

let handle: HumanBehaviorHandle | null = null;
let pending: VisitorIdentity | null = null;
/** Last identity actually sent, so a re-render or a second auth event is a no-op. */
let sent: string | null = null;

function send(identity: VisitorIdentity): void {
  if (!handle) return;
  const key = `${identity.userId}:${identity.email}`;
  if (sent === key) return;
  sent = key;
  // Fire-and-forget: identification must never block or break sign-in.
  void Promise.resolve(
    handle.identifyUser({
      email: identity.email,
      name: identity.name,
      userId: identity.userId,
    }),
  ).catch((error: unknown) => {
    console.warn("[HumanBehavior] identify failed", error);
  });
}

/** Called once by HumanBehaviorInit with whatever `init()` returned. */
export function registerHumanBehaviorTracker(tracker: unknown): void {
  if (!tracker || typeof (tracker as HumanBehaviorHandle).identifyUser !== "function") return;
  handle = tracker as HumanBehaviorHandle;
  if (pending) {
    const identity = pending;
    pending = null;
    send(identity);
  }
}

/**
 * Call on every sign-in *and* on a restored session. The restored case is what
 * gives already-registered students an identity without waiting for them to
 * sign in again.
 */
export function identifyVisitor(identity: VisitorIdentity): void {
  if (!identity.email) return;
  if (!handle) {
    pending = identity;
    return;
  }
  send(identity);
}

/**
 * Starts the Human Behavior recorder, unless this client is a crawler.
 * Returns true only if the recorder was actually started.
 *
 * The bot guard lives here rather than in the component so it can be tested
 * without a DOM, because it is the only control this repo has over Human
 * Behavior's numbers. HB ingests straight from the browser to its own
 * endpoint, so there is no server hop where a crawler's events could be
 * dropped the way /api/track drops them, and nothing here can clean its
 * dashboard after the fact.
 *
 * Skipping `init` is sufficient and not merely cosmetic. `v1/loader.js` is a
 * queueing shim: it sets `window.HumanBehaviorTracker` and nothing else, keeps
 * `cfg` null, registers no listeners, and makes no network request. It injects
 * `recorder-<version>.js` only from inside `init()`. So an uninitialised
 * loader downloads no recorder, opens no session and sends no events.
 */
export function startRecorder(
  apiKey: string | undefined,
  tracker: HumanBehaviorLoader | undefined,
  options: { ingestionUrl?: string } = {},
): boolean {
  if (!apiKey || !tracker) return false;

  // A crawler that runs JavaScript takes a fresh HB cookie on every page it
  // touches, so it lands in the dashboard as a new visitor each time. The
  // 2026-09-17 audit attributed 20,383 of 43,307 all-time visitor ids (47%) to
  // crawlers, and HB's own analysis independently described the same
  // population as thousands of single-touch identifiers with a blank browser.
  if (isBotClient()) return false;

  // Deliberately no `version` — omitting it is what keeps this app on the
  // channel's current recorder instead of pinning it again.
  // Keep the handle: it is the only way to tell Human Behavior who the
  // signed-in visitor is, and auth may have resolved before this ran.
  registerHumanBehaviorTracker(tracker.init(apiKey, options));
  return true;
}
