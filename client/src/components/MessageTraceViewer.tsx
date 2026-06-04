"use client";

import { MessageTrace } from '@/lib/schema';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

function prettyToolName(name: string): string {
    return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function summarizeArgs(args?: Record<string, unknown>): string {
    if (!args) return '';
    if (typeof args.query === 'string') return `: “${args.query}”`;
    if (typeof args.style === 'string') return `: ${args.style}`;
    return '';
}

interface MessageTraceViewerProps {
    trace?: MessageTrace;
}

export function MessageTraceViewer({ trace }: MessageTraceViewerProps) {
    const [open, setOpen] = useState(false);

    const statusMessages = trace?.status_messages ?? [];
    const toolCalls = trace?.tool_calls ?? [];
    const citations = trace?.citations ?? [];

    if (
        statusMessages.length === 0 &&
        toolCalls.length === 0 &&
        citations.length === 0
    ) {
        return null;
    }

    const stepCount = statusMessages.length || toolCalls.length;

    return (
        <div className="not-prose mb-2">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                {open ? (
                    <ChevronUp className="h-3 w-3" />
                ) : (
                    <ChevronDown className="h-3 w-3" />
                )}
                Thinking trace{stepCount > 0 ? ` (${stepCount} steps)` : ''}
            </button>

            {open && (
                <div className="mt-2 space-y-3 text-xs">
                    {/* The live "thinking" the user saw during streaming. */}
                    {statusMessages.length > 0 ? (
                        <ul className="border-l border-gray-300 dark:border-gray-600 space-y-1">
                            {statusMessages.map((msg, i) => (
                                <li
                                    key={i}
                                    className="relative ml-4 text-muted-foreground"
                                >
                                    <div className="absolute w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full top-1 -left-5" />
                                    {msg}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        toolCalls.length > 0 && (
                            <ul className="space-y-1">
                                {toolCalls.map((tc, i) => (
                                    <li key={i} className="text-muted-foreground">
                                        <span className="font-medium text-foreground">
                                            {prettyToolName(tc.name)}
                                        </span>
                                        {summarizeArgs(tc.args)}
                                    </li>
                                ))}
                            </ul>
                        )
                    )}

                    {/* Per-citation subagent traces. */}
                    {citations.map((c, i) => (
                        <div
                            key={i}
                            className="border-l-2 border-gray-200 dark:border-gray-700 pl-2"
                        >
                            <div className="font-medium text-foreground">
                                Citation · {c.method} · {c.preferred_style}
                            </div>
                            <ul className="mt-1 space-y-0.5">
                                {c.steps.map((s, j) => (
                                    <li key={j} className="text-muted-foreground">
                                        {s.detail}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
