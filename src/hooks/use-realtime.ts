"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

// Lazy-init pattern: create client only when hooks actually mount in browser
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
}

/**
 * Subscribe to Supabase Realtime changes on a table.
 * Calls router.refresh() on any change — works with server-component pages.
 */
export function useRealtimeRefresh(table: string) {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, router]);
}

/**
 * Subscribe to Supabase Realtime changes on a table and call a callback.
 * Use this when the page is fully client-rendered and you need to trigger
 * a data re-fetch (not just router.refresh).
 *
 * Optional filter: e.g., { column: "job_id", value: "some-uuid" }
 */
export function useRealtimeCallback(
  table: string,
  callback: () => void,
  filter?: { column: string; value: string }
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const supabase = getSupabase();
    const channelName = filter
      ? `${table}-${filter.column}-${filter.value}`
      : `${table}-all-changes`;

    const pgFilter = filter
      ? `${filter.column}=eq.${filter.value}`
      : undefined;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(pgFilter ? { filter: pgFilter } : {}),
        },
        () => {
          callbackRef.current();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter?.column, filter?.value]);
}
