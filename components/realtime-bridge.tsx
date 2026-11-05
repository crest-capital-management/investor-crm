"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { isPublicPath } from "@/lib/public-routes";
import { MESSAGES_CHANGED_EVENT, UNREAD_CHANGED_EVENT } from "@/lib/unread-events";

const POLL_INTERVAL_MS = 5000;

/**
 * Checks every few seconds whether WhatsApp messages have changed and tells the
 * rest of the app, so a message that just arrived shows up within seconds
 * instead of at the next refresh. It renders nothing.
 *
 * This is a stand-in for Supabase Realtime, which can't see the Azure database.
 * Only a tiny fingerprint is fetched on each check; the lists reload only when
 * it changes. Checking pauses while the tab is hidden. Server-sent events will
 * replace this later.
 */
export function RealtimeBridge() {
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);

  useEffect(() => {
    if (isPublic) return;

    let cancelled = false;
    let lastFingerprint: string | null = null;
    let timer: number | null = null;

    async function check() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/messages/pulse", { cache: "no-store" });
        if (!response.ok) return; // signed out or offline: the regular refresh timers keep things current
        const data = (await response.json()) as { fingerprint?: string };
        if (cancelled || typeof data.fingerprint !== "string") return;
        // The first check only records the starting point; later changes notify the app.
        if (lastFingerprint !== null && data.fingerprint !== lastFingerprint) {
          window.dispatchEvent(new Event(MESSAGES_CHANGED_EVENT));
          window.dispatchEvent(new Event(UNREAD_CHANGED_EVENT));
        }
        lastFingerprint = data.fingerprint;
      } catch {
        // Network hiccup: try again at the next tick.
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }

    void check();
    timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isPublic]);

  return null;
}
