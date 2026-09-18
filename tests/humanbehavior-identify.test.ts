import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * These cases are the ways the identify hand-off actually breaks in a browser,
 * not the happy path: the loader arriving after auth, a second auth event on
 * the same page, a visitor with no email, and a tracker that rejects.
 */

type Mod = typeof import("@/lib/humanbehavior");

async function freshModule(): Promise<Mod> {
  vi.resetModules();
  return import("@/lib/humanbehavior");
}

function fakeTracker() {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    identifyUser: vi.fn((props: Record<string, unknown>) => {
      calls.push(props);
      return Promise.resolve("ok");
    }),
  };
}

describe("identifyVisitor", () => {
  let mod: Mod;

  beforeEach(async () => {
    mod = await freshModule();
  });

  it("buffers an identity that arrives before the tracker and flushes it once", () => {
    const tracker = fakeTracker();
    mod.identifyVisitor({ email: "a@stanford.edu", name: "A", userId: "u1" });
    expect(tracker.identifyUser).not.toHaveBeenCalled();

    mod.registerHumanBehaviorTracker(tracker);
    expect(tracker.calls).toEqual([
      { email: "a@stanford.edu", name: "A", userId: "u1" },
    ]);
  });

  it("does not re-send the same visitor when auth fires twice on one page", () => {
    const tracker = fakeTracker();
    mod.registerHumanBehaviorTracker(tracker);
    mod.identifyVisitor({ email: "a@stanford.edu", userId: "u1" });
    mod.identifyVisitor({ email: "a@stanford.edu", userId: "u1" });
    expect(tracker.identifyUser).toHaveBeenCalledTimes(1);
  });

  it("sends again when a different account signs in on the same page", () => {
    const tracker = fakeTracker();
    mod.registerHumanBehaviorTracker(tracker);
    mod.identifyVisitor({ email: "a@stanford.edu", userId: "u1" });
    mod.identifyVisitor({ email: "b@stanford.edu", userId: "u2" });
    expect(tracker.identifyUser).toHaveBeenCalledTimes(2);
  });

  it("ignores a session with no email rather than creating an empty identity", () => {
    const tracker = fakeTracker();
    mod.registerHumanBehaviorTracker(tracker);
    mod.identifyVisitor({ email: "", userId: "u1" });
    expect(tracker.identifyUser).not.toHaveBeenCalled();
  });

  it("survives a tracker whose identifyUser rejects", async () => {
    const tracker = {
      identifyUser: vi.fn(() => Promise.reject(new Error("network down"))),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mod.registerHumanBehaviorTracker(tracker);
    expect(() =>
      mod.identifyVisitor({ email: "a@stanford.edu", userId: "u1" }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ignores a blocked loader that never produced a real tracker", () => {
    expect(() => mod.registerHumanBehaviorTracker(undefined)).not.toThrow();
    expect(() => mod.registerHumanBehaviorTracker({})).not.toThrow();
    expect(() =>
      mod.identifyVisitor({ email: "a@stanford.edu", userId: "u1" }),
    ).not.toThrow();
  });

  it("flushes only the newest buffered identity when the tracker is late", () => {
    const tracker = fakeTracker();
    mod.identifyVisitor({ email: "a@stanford.edu", userId: "u1" });
    mod.identifyVisitor({ email: "b@stanford.edu", userId: "u2" });
    mod.registerHumanBehaviorTracker(tracker);
    expect(tracker.calls).toEqual([{ email: "b@stanford.edu", name: undefined, userId: "u2" }]);
  });
});
