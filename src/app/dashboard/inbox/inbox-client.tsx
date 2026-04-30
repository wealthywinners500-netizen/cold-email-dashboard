"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Star,
  Archive,
  Send,
  Loader2,
  Inbox as InboxIcon,
  Trash2,
  UserMinus,
  X as XIcon,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import DOMPurify from "isomorphic-dompurify";
import { parseTab, Tab } from "@/lib/inbox/tab-routing";

// Lazy Supabase client for realtime only
function getRealtimeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface Thread {
  id: number;
  subject: string | null;
  snippet: string | null;
  message_count: number;
  participants: string[];
  account_emails: string[] | null;
  has_unread: boolean;
  is_starred: boolean;
  latest_classification: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  latest_message_date: string;
}

interface Message {
  id: number;
  direction: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  classification: string | null;
  classification_confidence: number | null;
  is_read: boolean;
  received_date: string;
  campaign_id: string | null;
}

interface Account {
  id: string;
  email: string;
  display_name: string | null;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  INTERESTED: "bg-green-500/20 text-green-400 border-green-500/30",
  HOT_LEAD: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  NOT_INTERESTED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  OBJECTION: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  AUTO_REPLY: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  BOUNCE: "bg-red-500/20 text-red-400 border-red-500/30",
  STOP: "bg-red-500/20 text-red-400 border-red-500/30",
  SPAM: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const FILTER_TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "warm-up", label: "Warm Up" },
  { key: "interested", label: "Interested" },
  { key: "hot-leads", label: "Hot Leads" },
  { key: "bounced", label: "Bounced" },
  { key: "spam", label: "Spam" },
];

const PAGE_SIZE = 50;

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function ClassificationBadge({ classification }: { classification: string | null }) {
  if (!classification) return null;
  const colors = CLASSIFICATION_COLORS[classification] || CLASSIFICATION_COLORS.NOT_INTERESTED;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors}`}>
      {classification.replace("_", " ")}
    </span>
  );
}

export default function InboxClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = useMemo(() => parseTab(searchParams.get("tab")), [searchParams]);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyAccountId, setReplyAccountId] = useState("");
  const [sending, setSending] = useState(false);
  // V1+b: bulk-select state. Set of thread IDs the user has checked.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  // After a successful unsub on the open thread, flip the button label.
  const [unsubscribedFlag, setUnsubscribedFlag] = useState<string | null>(null);

  const buildQueryParams = useCallback(
    (page: number) => {
      const params = new URLSearchParams();
      params.set("tab", activeTab);
      params.set("page", String(page));
      params.set("per_page", String(PAGE_SIZE));
      if (searchQuery) params.set("search", searchQuery);
      if (fromDate) params.set("from_date", fromDate);
      // Inclusive end-of-day so a same-day to_date returns that day's threads.
      if (toDate) params.set("to_date", `${toDate}T23:59:59.999Z`);
      return params;
    },
    [activeTab, searchQuery, fromDate, toDate]
  );

  // Initial / filter-changed fetch (resets to page 1).
  const fetchThreads = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildQueryParams(1);
      const res = await fetch(`/api/inbox/threads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
        setPagination(data.pagination || null);
      }
    } catch (err) {
      console.error("Failed to fetch threads:", err);
    } finally {
      setLoading(false);
    }
  }, [buildQueryParams]);

  // Append next page (load-more pagination, preserves scroll).
  const loadMoreThreads = useCallback(async () => {
    if (!pagination || pagination.page >= pagination.total_pages) return;
    setLoadingMore(true);
    try {
      const params = buildQueryParams(pagination.page + 1);
      const res = await fetch(`/api/inbox/threads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setThreads((prev) => [...prev, ...(data.threads || [])]);
        setPagination(data.pagination || null);
      }
    } catch (err) {
      console.error("Failed to load more threads:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [pagination, buildQueryParams]);

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/email-accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(Array.isArray(data) ? data : data.accounts || []);
        if (data.length > 0 || data.accounts?.length > 0) {
          const accts = Array.isArray(data) ? data : data.accounts;
          setReplyAccountId(accts[0]?.id || "");
        }
      }
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    }
  }, []);

  // Fetch messages for a thread
  const fetchMessages = useCallback(async (threadId: number) => {
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/inbox/threads/${threadId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Failed to fetch messages:", err);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // Select thread
  const selectThread = useCallback(
    async (thread: Thread) => {
      setSelectedThread(thread);
      // Reset the per-thread unsubscribe flag when switching threads.
      setUnsubscribedFlag(null);
      await fetchMessages(thread.id);

      // Mark as read
      if (thread.has_unread) {
        await fetch(`/api/inbox/threads/${thread.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_read: true }),
        });
        setThreads((prev) =>
          prev.map((t) => (t.id === thread.id ? { ...t, has_unread: false } : t))
        );
      }
    },
    [fetchMessages]
  );

  // Send reply
  const handleSendReply = async () => {
    if (!selectedThread || !replyText.trim() || !replyAccountId) return;

    setSending(true);
    try {
      const res = await fetch(
        `/api/inbox/threads/${selectedThread.id}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: replyAccountId,
            body_html: `<p>${replyText.replace(/\n/g, "<br/>")}</p>`,
            body_text: replyText,
          }),
        }
      );

      if (res.ok) {
        setReplyText("");
        await fetchMessages(selectedThread.id);
      }
    } catch (err) {
      console.error("Failed to send reply:", err);
    } finally {
      setSending(false);
    }
  };

  // Toggle star
  const toggleStar = async (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/inbox/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_starred: !thread.is_starred }),
    });
    setThreads((prev) =>
      prev.map((t) =>
        t.id === thread.id ? { ...t, is_starred: !t.is_starred } : t
      )
    );
  };

  // Archive thread
  const archiveThread = async (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/inbox/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_archived: true }),
    });
    setThreads((prev) => prev.filter((t) => t.id !== thread.id));
    if (selectedThread?.id === thread.id) {
      setSelectedThread(null);
      setMessages([]);
    }
  };

  // V1+b: soft-delete a single thread.
  const deleteThread = async (thread: Thread, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete this thread?\n\n"${thread.subject || "(no subject)"}"`)) {
      return;
    }
    const res = await fetch(`/api/inbox/threads/${thread.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setThreads((prev) => prev.filter((t) => t.id !== thread.id));
      setSelectedIds((prev) => {
        if (!prev.has(thread.id)) return prev;
        const next = new Set(prev);
        next.delete(thread.id);
        return next;
      });
      if (selectedThread?.id === thread.id) {
        setSelectedThread(null);
        setMessages([]);
      }
    }
  };

  // V1+b: bulk soft-delete via checkbox selection.
  const bulkDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (
      !confirm(
        `Delete ${selectedIds.size} selected thread${selectedIds.size === 1 ? "" : "s"}? This cannot be undone from the UI.`
      )
    ) {
      return;
    }
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const res = await fetch("/api/inbox/threads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_ids: ids }),
      });
      if (res.ok) {
        setThreads((prev) => prev.filter((t) => !selectedIds.has(t.id)));
        if (selectedThread && selectedIds.has(selectedThread.id)) {
          setSelectedThread(null);
          setMessages([]);
        }
        setSelectedIds(new Set());
      } else {
        const data = await res.json().catch(() => null);
        alert(`Bulk delete failed: ${data?.error || res.statusText}`);
      }
    } finally {
      setBulkDeleting(false);
    }
  };

  // V1+b: per-row checkbox toggle. Stops propagation so toggling doesn't
  // also open the thread.
  const toggleSelect = (threadId: number, e: React.MouseEvent | React.ChangeEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  };

  // V1+b: manual unsubscribe of the open thread's contact.
  const unsubscribeContact = async () => {
    if (!selectedThread) return;
    const inboundFrom = messages
      .filter((m) => m.direction === "received")
      .slice(-1)[0]?.from_email;
    const target = inboundFrom || selectedThread.participants?.[0] || "this contact";
    if (!confirm(`Unsubscribe ${target}?\n\nThey will be excluded from all future campaign sends.`)) {
      return;
    }
    setUnsubscribing(true);
    try {
      const res = await fetch(
        `/api/inbox/threads/${selectedThread.id}/unsubscribe-contact`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setUnsubscribedFlag(target);
      } else {
        alert(`Unsubscribe failed: ${data?.error || res.statusText}`);
      }
    } finally {
      setUnsubscribing(false);
    }
  };

  // Persist active tab to URL when it changes.
  useEffect(() => {
    const current = searchParams.get("tab");
    if (current === activeTab) return;
    const next = new URLSearchParams(searchParams.toString());
    if (activeTab === "all") {
      next.delete("tab");
    } else {
      next.set("tab", activeTab);
    }
    router.replace(`?${next.toString()}`);
  }, [activeTab, router, searchParams]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Realtime subscription
  useEffect(() => {
    const supabase = getRealtimeClient();
    const channel = supabase
      .channel("inbox-threads-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inbox_threads",
        },
        () => {
          fetchThreads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchThreads]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const hasMore = pagination ? pagination.page < pagination.total_pages : false;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <h1 className="text-2xl font-bold text-white mb-4">Inbox</h1>

      <div className="flex flex-1 rounded-lg border border-gray-800 overflow-hidden">
        {/* Left panel — Thread list */}
        <div className="w-2/5 border-r border-gray-800 flex flex-col bg-gray-900">
          {/* Filter tabs */}
          <div className="flex border-b border-gray-800 px-2">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  // V1+b: clear bulk selection when switching tabs to avoid
                  // accidentally deleting threads from a tab the user is no
                  // longer looking at.
                  setSelectedIds(new Set());
                }}
                className={`px-3 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? "text-blue-400 border-b-2 border-blue-400"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* V1+b bulk-action toolbar — only visible when ≥1 thread selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-blue-500/5">
              <span className="text-xs text-blue-300">
                {selectedIds.size} selected
              </span>
              <button
                onClick={bulkDeleteSelected}
                disabled={bulkDeleting}
                className="ml-auto flex items-center gap-1.5 px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-50 rounded text-xs text-red-300 border border-red-500/30 transition-colors"
              >
                {bulkDeleting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                Delete selected
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
              >
                <XIcon className="w-3 h-3" />
                Clear
              </button>
            </div>
          )}

          {/* Search */}
          <div className="p-2 border-b border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchThreads()}
                placeholder="Search inbox..."
                className="w-full pl-9 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Date range */}
          <div className="px-2 pb-2 border-b border-gray-800 flex items-center gap-2 text-xs text-gray-400">
            <span className="text-gray-500">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {(fromDate || toDate) && (
              <button
                onClick={() => {
                  setFromDate("");
                  setToDate("");
                }}
                className="ml-auto text-gray-500 hover:text-gray-300 text-xs"
              >
                Clear
              </button>
            )}
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <InboxIcon className="w-12 h-12 mb-3" />
                <p className="text-sm">No threads found</p>
              </div>
            ) : (
              <>
                {threads.map((thread) => (
                  <div
                    key={thread.id}
                    onClick={() => selectThread(thread)}
                    className={`group px-4 py-3 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50 transition-colors ${
                      selectedThread?.id === thread.id
                        ? "bg-gray-800"
                        : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* V1+b checkbox for bulk select */}
                      <div
                        className="flex-shrink-0 pt-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(thread.id)}
                          onChange={(e) => toggleSelect(thread.id, e)}
                          aria-label={`Select thread ${thread.id}`}
                          className="w-4 h-4 cursor-pointer accent-blue-500"
                        />
                      </div>

                      {/* Avatar */}
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center">
                        <span className="text-sm font-medium text-white">
                          {(thread.participants?.[0] || "?")[0].toUpperCase()}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Top row: sender + time */}
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-sm truncate ${
                              thread.has_unread
                                ? "font-semibold text-white"
                                : "text-gray-300"
                            }`}
                          >
                            {thread.participants?.[0] || "Unknown"}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {thread.has_unread && (
                              <div className="w-2 h-2 rounded-full bg-blue-500" />
                            )}
                            <span className="text-xs text-gray-500">
                              {timeAgo(thread.latest_message_date)}
                            </span>
                          </div>
                        </div>

                        {/* Subject */}
                        <p
                          className={`text-sm truncate mt-0.5 ${
                            thread.has_unread ? "text-gray-200" : "text-gray-400"
                          }`}
                        >
                          {thread.subject || "(no subject)"}
                        </p>

                        {/* Snippet + badges */}
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-gray-500 truncate flex-1">
                            {thread.snippet || ""}
                          </p>
                          <ClassificationBadge
                            classification={thread.latest_classification}
                          />
                        </div>

                        {/* Campaign name */}
                        {thread.campaign_name && (
                          <p className="text-xs text-blue-400/60 mt-1 truncate">
                            {thread.campaign_name}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={(e) => toggleStar(thread, e)}
                          className="p-1 hover:bg-gray-700 rounded"
                          aria-label="Toggle star"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              thread.is_starred
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-gray-600"
                            }`}
                          />
                        </button>
                        <button
                          onClick={(e) => archiveThread(thread, e)}
                          className="p-1 hover:bg-gray-700 rounded"
                          aria-label="Archive thread"
                        >
                          <Archive className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                        <button
                          onClick={(e) => deleteThread(thread, e)}
                          className="p-1 hover:bg-red-700/40 rounded"
                          aria-label="Delete thread"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-gray-600 hover:text-red-300" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Load more */}
                {hasMore && (
                  <div className="p-3 flex justify-center border-t border-gray-800">
                    <button
                      onClick={loadMoreThreads}
                      disabled={loadingMore}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                        </>
                      ) : (
                        <>
                          Load more ({pagination!.total - threads.length} remaining)
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right panel — Message view */}
        <div className="flex-1 flex flex-col bg-gray-950">
          {!selectedThread ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <InboxIcon className="w-16 h-16 mb-4" />
              <p className="text-lg">Select a thread to view messages</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-6 py-4 border-b border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white truncate flex-1">
                    {selectedThread.subject || "(no subject)"}
                  </h2>
                  {/* V1+b: manual unsubscribe button + manual delete button */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={unsubscribeContact}
                      disabled={unsubscribing || unsubscribedFlag !== null}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-50 disabled:hover:bg-orange-500/10 rounded text-xs text-orange-300 border border-orange-500/30 transition-colors"
                      title="Unsubscribe this contact (excludes from future campaign sends)"
                    >
                      {unsubscribing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <UserMinus className="w-3 h-3" />
                      )}
                      {unsubscribedFlag ? "Unsubscribed" : "Unsubscribe"}
                    </button>
                    <button
                      onClick={(e) => deleteThread(selectedThread, e)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 rounded text-xs text-red-300 border border-red-500/30 transition-colors"
                      title="Delete this thread"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-gray-400">
                    {selectedThread.message_count} message
                    {selectedThread.message_count !== 1 ? "s" : ""}
                  </span>
                  <ClassificationBadge
                    classification={selectedThread.latest_classification}
                  />
                </div>
                {selectedThread.campaign_name && (
                  <div className="mt-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-md">
                    <span className="text-xs text-blue-400">
                      Campaign: {selectedThread.campaign_name}
                    </span>
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {messagesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-lg border ${
                        msg.direction === "sent"
                          ? "border-blue-500/20 bg-blue-500/5 ml-12"
                          : "border-gray-800 bg-gray-900"
                      } p-4`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">
                            {msg.direction === "sent"
                              ? "You"
                              : msg.from_name || msg.from_email}
                          </span>
                          {msg.direction === "sent" && (
                            <span className="text-xs text-blue-400">
                              ({msg.from_email})
                            </span>
                          )}
                          <ClassificationBadge
                            classification={msg.classification}
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(msg.received_date).toLocaleString()}
                        </span>
                      </div>

                      {/* Email body — sanitized with DOMPurify */}
                      {msg.body_html ? (
                        <div
                          className="text-sm text-gray-300 prose prose-invert prose-sm max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(msg.body_html, {
                              ALLOWED_TAGS: [
                                "p","br","div","span","a","b","i","u","strong","em",
                                "h1","h2","h3","h4","ul","ol","li","table","thead",
                                "tbody","tr","td","th","img","blockquote","pre","code","hr",
                              ],
                              ALLOWED_ATTR: [
                                "href","src","alt","style","class","target","width","height",
                              ],
                            }),
                          }}
                        />
                      ) : (
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">
                          {msg.body_text || "(no content)"}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Reply composer */}
              <div className="border-t border-gray-800 px-6 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <label className="text-xs text-gray-500">From:</label>
                  <select
                    value={replyAccountId}
                    onChange={(e) => setReplyAccountId(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.display_name
                          ? `${acc.display_name} (${acc.email})`
                          : acc.email}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={handleSendReply}
                    disabled={sending || !replyText.trim()}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-sm font-medium text-white transition-colors"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Send Reply
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

