'use client';

/**
 * Phase 3 — GrammarCheck panel.
 *
 * Debounced 800ms call to /api/ai/grammar-check on text change. Renders
 * a list of issues with click-to-apply suggestions. If upstream rate-limits,
 * a subtle banner appears in place of the list.
 *
 * Feature-flag-gated. NOT mounted in Phase 3.
 */

import * as React from 'react';
import { isFeatureEnabledSync } from '@/lib/featureFlags';

interface Issue {
  offset: number;
  length: number;
  message: string;
  suggestions: string[];
}

interface ResponseBody {
  issues: Issue[];
  rateLimited?: boolean;
}

export interface GrammarCheckProps {
  text: string;
  lang?: string;
  onApplySuggestion: (offset: number, length: number, replacement: string) => void;
  debounceMs?: number;
  className?: string;
}

export function GrammarCheck({
  text,
  lang = 'en-US',
  onApplySuggestion,
  debounceMs = 800,
  className,
}: GrammarCheckProps) {
  const [issues, setIssues] = React.useState<Issue[]>([]);
  const [rateLimited, setRateLimited] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  // Refs guard against stale responses when text changes mid-flight.
  const latestTextRef = React.useRef(text);
  latestTextRef.current = text;

  React.useEffect(() => {
    if (!isFeatureEnabledSync('campaigns_v2')) return;
    if (!text || !text.trim()) {
      setIssues([]);
      setRateLimited(false);
      return;
    }
    const handle = setTimeout(async () => {
      setPending(true);
      try {
        const resp = await fetch('/api/ai/grammar-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, lang }),
        });
        if (!resp.ok) {
          setIssues([]);
          return;
        }
        const data = (await resp.json()) as ResponseBody;
        // Drop result if text changed while we were waiting.
        if (latestTextRef.current !== text) return;
        setIssues(data.issues ?? []);
        setRateLimited(Boolean(data.rateLimited));
      } catch {
        setIssues([]);
      } finally {
        setPending(false);
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [text, lang, debounceMs]);

  if (!isFeatureEnabledSync('campaigns_v2')) return null;

  if (rateLimited) {
    return (
      <div className={`rounded border bg-yellow-50 p-2 text-xs text-yellow-900 ${className ?? ''}`}>
        Grammar check is paused (upstream rate limit). Will retry shortly.
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className={`text-xs text-muted-foreground ${className ?? ''}`}>
        {pending ? 'Checking grammar…' : 'No issues found.'}
      </div>
    );
  }

  return (
    <ul className={`space-y-1 text-xs ${className ?? ''}`}>
      {issues.map((issue, i) => (
        <li key={i} className="rounded border p-2">
          <div className="mb-1 text-muted-foreground">
            Offset {issue.offset}: {issue.message}
          </div>
          {issue.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {issue.suggestions.slice(0, 3).map((s, j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() => onApplySuggestion(issue.offset, issue.length, s)}
                  className="rounded border px-2 py-0.5 hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default GrammarCheck;
