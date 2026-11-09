"use client";

import { useEffect, useRef, useState } from "react";

import { isNewMessagesEvent, MESSAGES_CHANGED_EVENT } from "@/lib/unread-events";

/** Several triggers close together (an edit plus a new message) cause one reload, not several. */
const RELOAD_DEBOUNCE_MS = 1000;

/** Last list per URL, kept for the whole browser session so coming back to a page is instant. */
const sessionCache = new Map<string, unknown[]>();

function rememberRows(url: string, rows: unknown[]) {
  sessionCache.set(url, rows);
}

/**
 * Loads a complete list from an API route once, keeps it in memory for the
 * session (so coming back is instant) and reloads it when the server sends
 * fresh page data or a new message arrives. Delivery-status changes (sent →
 * read) don't change these lists, so they don't cause a reload; neither does
 * focusing the window, since the message check already runs when the tab is
 * shown again.
 */
export function useAllRows<T>(url: string, field: string, refreshKey: unknown): T[] | null {
  const [rows, setRows] = useState<T[] | null>(() => (sessionCache.get(url) as T[] | undefined) ?? null);
  // Set by the effect below; lets the refreshKey effect ask for a (debounced) reload.
  const scheduleReloadRef = useRef<(() => void) | null>(null);
  const lastKeyRef = useRef(refreshKey);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    async function load() {
      controller?.abort(); // a newer reload replaces one still in flight
      const current = new AbortController();
      controller = current;
      try {
        const response = await fetch(url, { cache: "no-store", signal: current.signal });
        if (!response.ok) return;
        const data = (await response.json()) as Record<string, unknown>;
        const list = Array.isArray(data[field]) ? (data[field] as T[]) : null;
        if (cancelled || !list) return;
        rememberRows(url, list);
        setRows(list);
      } catch {
        // Offline, signed out or replaced by a newer reload: the server-rendered page keeps working.
      }
    }

    function scheduleReload() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, RELOAD_DEBOUNCE_MS);
    }

    function onMessagesChanged(event: Event) {
      if (isNewMessagesEvent(event)) scheduleReload();
    }

    void load();
    scheduleReloadRef.current = scheduleReload;
    window.addEventListener(MESSAGES_CHANGED_EVENT, onMessagesChanged);
    return () => {
      cancelled = true;
      scheduleReloadRef.current = null;
      if (timer !== null) window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener(MESSAGES_CHANGED_EVENT, onMessagesChanged);
    };
  }, [url, field]);

  // Fresh server data (after an edit or delete): reload the full list too.
  // The first value is the initial render, already covered by the load above.
  useEffect(() => {
    if (lastKeyRef.current === refreshKey) return;
    lastKeyRef.current = refreshKey;
    scheduleReloadRef.current?.();
  }, [refreshKey]);

  return rows;
}
