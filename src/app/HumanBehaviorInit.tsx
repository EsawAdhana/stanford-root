"use client";

import Script from "next/script";
import { useCallback } from "react";

import { startRecorder, type HumanBehaviorLoader } from "@/lib/humanbehavior";

/**
 * Human Behavior recording, loaded from the CDN rather than bundled from npm.
 *
 * Why the CDN and not `import { HumanBehaviorTracker } from "humanbehavior-js"`:
 * a bundled copy is frozen at whatever version the lockfile resolved, so it only
 * moves when this app is reinstalled and redeployed. This app sat on 0.8.2 for
 * five releases that way. The CDN loader is a small shim that fetches the real
 * recorder from a channel URL cached for 60s, so a recorder published by the
 * Human Behavior team reaches this app on the next page load with no redeploy.
 *
 * The tradeoff is a third-party script request. If it is blocked (content
 * blocker, or a CSP without the CDN host) nothing is recorded — the loader says
 * so on the console. That is the same outcome as the bundled build being blocked
 * from reaching the ingestion host, so it does not lose coverage that the npm
 * path had.
 */

declare global {
  interface Window {
    HumanBehaviorTracker?: HumanBehaviorLoader;
  }
}

const LOADER_SRC = "https://cdn.humanbehavior.co/v1/loader.js";

export function HumanBehaviorInit() {
  const apiKey = process.env.NEXT_PUBLIC_HUMANBEHAVIOR_API_KEY;

  // `init` is called from onLoad rather than an effect: the loader defines
  // window.HumanBehaviorTracker as it executes, so an effect racing the script
  // would have to poll for it.
  const start = useCallback(() => {
    // The bot guard and `init` call live in lib/humanbehavior so the policy is
    // unit-testable without a DOM. Returns false when it declined to start,
    // which is either a missing key or a crawler.
    startRecorder(apiKey, window.HumanBehaviorTracker, {
      ingestionUrl: process.env.NEXT_PUBLIC_HUMANBEHAVIOR_INGESTION_URL,
    });
  }, [apiKey]);

  // No key configured (local checkouts, CI): render nothing rather than
  // requesting a script that could not be initialised anyway.
  if (!apiKey) return null;

  return (
    <Script
      src={LOADER_SRC}
      strategy="afterInteractive"
      onLoad={start}
      onError={() => {
        console.warn(
          "[HumanBehavior] loader script failed to load, so nothing will be recorded. Usually a content blocker or a Content-Security-Policy that omits cdn.humanbehavior.co.",
        );
      }}
    />
  );
}
