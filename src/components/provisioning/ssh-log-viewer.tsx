"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Copy, ArrowDown, Search, X as XIcon } from "lucide-react";

interface LogLine {
  timestamp?: string;
  text: string;
  type: "stdout" | "stderr" | "progress";
}

interface SSHLogViewerProps {
  lines: LogLine[];
  className?: string;
}

function classifyLine(text: string): "stdout" | "stderr" | "progress" {
  if (text.startsWith("[ERROR]") || text.startsWith("Error:") || text.includes("FAILED")) {
    return "stderr";
  }
  if (text.startsWith("[") && text.includes("%")) {
    return "progress";
  }
  return "stdout";
}

function getLineColor(type: "stdout" | "stderr" | "progress"): string {
  switch (type) {
    case "stderr":
      return "text-red-400";
    case "progress":
      return "text-cyan-400";
    default:
      return "text-gray-300";
  }
}

export function SSHLogViewer({ lines, className = "" }: SSHLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  // Auto-scroll when new lines arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Detect manual scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const jumpToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  };

  const copyToClipboard = async () => {
    const text = lines.map((l) => `${l.timestamp ? `[${l.timestamp}] ` : ""}${l.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const filteredLines = searchQuery
    ? lines.filter((l) => l.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : lines;

  return (
    <div className={`flex flex-col bg-gray-950 rounded-lg border border-gray-800 ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-500 font-mono">SSH Output</span>
        <div className="flex items-center gap-2">
          {searchOpen ? (
            <div className="flex items-center gap-1 bg-gray-800 rounded px-2 py-1">
              <Search className="w-3 h-3 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter..."
                className="bg-transparent text-xs text-white border-none outline-none w-32"
                autoFocus
              />
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                className="text-gray-500 hover:text-white"
              >
                <XIcon className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="text-gray-500 hover:text-white p-1"
              title="Search (Ctrl+F)"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={copyToClipboard}
            className="text-gray-500 hover:text-white p-1"
            title="Copy to clipboard"
          >
            {copied ? (
              <span className="text-green-400 text-xs">Copied!</span>
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed min-h-[200px] max-h-[400px]"
      >
        {filteredLines.length === 0 ? (
          <div className="text-gray-600 text-center py-8">
            {searchQuery ? "No matching log lines" : "Waiting for output..."}
          </div>
        ) : (
          filteredLines.map((line, i) => {
            const lineType = line.type || classifyLine(line.text);
            return (
              <div key={i} className={`${getLineColor(lineType)} whitespace-pre-wrap break-all`}>
                {line.timestamp && (
                  <span className="text-gray-600 mr-2">[{line.timestamp}]</span>
                )}
                {line.text}
              </div>
            );
          })
        )}
      </div>

      {/* Jump to bottom button */}
      {!autoScroll && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-14 right-4 bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-1 shadow-lg"
        >
          <ArrowDown className="w-3 h-3" />
          Jump to bottom
        </button>
      )}
    </div>
  );
}
