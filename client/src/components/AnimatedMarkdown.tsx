'use client';

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import Markdown, { Components } from 'react-markdown';
import { PluggableList } from 'unified';
import { Copy, Check, Download } from 'lucide-react';


// Define a simple CSS-in-JS for the blinking cursor animation
const cursorStyle = `
  @keyframes blink {
    50% { opacity: 0; }
  }
  .blinking-cursor {
    animation: blink 1s step-end infinite;
  }
`;

// Extract table data as TSV (tab-separated values)
function extractTableData(tableElement: HTMLTableElement): string {
    const rows: string[][] = [];

    // Process header rows
    const thead = tableElement.querySelector('thead');
    if (thead) {
        thead.querySelectorAll('tr').forEach(tr => {
            const cells: string[] = [];
            tr.querySelectorAll('th, td').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            if (cells.length > 0) rows.push(cells);
        });
    }

    // Process body rows
    const tbody = tableElement.querySelector('tbody');
    if (tbody) {
        tbody.querySelectorAll('tr').forEach(tr => {
            const cells: string[] = [];
            tr.querySelectorAll('th, td').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            if (cells.length > 0) rows.push(cells);
        });
    }

    // If no thead/tbody, try direct tr children
    if (rows.length === 0) {
        tableElement.querySelectorAll('tr').forEach(tr => {
            const cells: string[] = [];
            tr.querySelectorAll('th, td').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            if (cells.length > 0) rows.push(cells);
        });
    }

    return rows.map(row => row.join('\t')).join('\n');
}

// Convert table data to CSV format
function tableDataToCsv(tableElement: HTMLTableElement): string {
    const rows: string[][] = [];

    const processRow = (tr: Element) => {
        const cells: string[] = [];
        tr.querySelectorAll('th, td').forEach(cell => {
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            let cellText = (cell.textContent || '').trim();
            if (cellText.includes('"') || cellText.includes(',') || cellText.includes('\n')) {
                cellText = '"' + cellText.replace(/"/g, '""') + '"';
            }
            cells.push(cellText);
        });
        if (cells.length > 0) rows.push(cells);
    };

    const thead = tableElement.querySelector('thead');
    if (thead) thead.querySelectorAll('tr').forEach(processRow);

    const tbody = tableElement.querySelector('tbody');
    if (tbody) tbody.querySelectorAll('tr').forEach(processRow);

    if (rows.length === 0) {
        tableElement.querySelectorAll('tr').forEach(processRow);
    }

    return rows.map(row => row.join(',')).join('\n');
}

// Copyable table wrapper component
export function CopyableTable({ children, className, ...props }: React.TableHTMLAttributes<HTMLTableElement> & { children?: React.ReactNode }) {
    const tableRef = useRef<HTMLTableElement>(null);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        if (!tableRef.current) return;

        const tableData = extractTableData(tableRef.current);

        try {
            await navigator.clipboard.writeText(tableData);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy table data:', err);
        }
    }, []);

    const handleExportCsv = useCallback(() => {
        if (!tableRef.current) return;

        const csvData = tableDataToCsv(tableRef.current);
        const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'table-data.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, []);

    return (
        <div className="group/table">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-accent/50 rounded-t-md border border-b-0 border-border/50 opacity-0 group-hover/table:opacity-100 transition-opacity duration-200">
                <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy to clipboard"
                    type="button"
                >
                    {copied ? (
                        <>
                            <Check className="h-3.5 w-3.5 text-green-500" />
                            <span className="text-green-500">Copied</span>
                        </>
                    ) : (
                        <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy</span>
                        </>
                    )}
                </button>
                <button
                    onClick={handleExportCsv}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Export as CSV"
                    type="button"
                >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export CSV</span>
                </button>
            </div>
            {/* Table */}
            <div className="overflow-x-auto border border-border/50 rounded-b-md group-hover/table:rounded-b-md group-hover/table:rounded-t-none rounded-md px-3">
                <table ref={tableRef} className={className ?? "min-w-full border-collapse"} {...props}>
                    {children}
                </table>
            </div>
        </div>
    );
}

interface AnimatedMarkdownProps {
    content: string;
    remarkPlugins?: PluggableList;
    rehypePlugins?: PluggableList;
    components?: Components;
    className?: string;
    typewriterSpeed?: number;
    enableAnimation?: boolean;
}


// Default components with copyable table
const defaultComponents: Components = {
    table: CopyableTable,
};

export function AnimatedMarkdown({
    content,
    remarkPlugins = [[remarkMath, { singleDollarTextMath: false }], remarkGfm],
    rehypePlugins = [rehypeKatex],
    components,
    className = '',
    typewriterSpeed = 30,
    enableAnimation = true,
}: AnimatedMarkdownProps) {
    const [stableContent, setStableContent] = useState('');
    const [liveContent, setLiveContent] = useState('');
    const liveContentTargetRef = useRef('');

    // Merge default components with user-provided components
    const mergedComponents = useMemo(() => ({
        ...defaultComponents,
        ...components,
    }), [components]);

    // Effect 1: Split incoming content into "stable" and "live" parts.
    useEffect(() => {
        if (!enableAnimation) {
            setStableContent(content);
            setLiveContent('');
            return;
        }

        // Heuristic: A "stable" block is a chunk of markdown ending in a double newline.
        const lastStableIndex = content.lastIndexOf('\n\n');

        let newStableContent = '';
        let newLiveContentTarget = content;

        if (lastStableIndex !== -1) {
            // Split content at the last stable point
            newStableContent = content.substring(0, lastStableIndex + 2);
            newLiveContentTarget = content.substring(lastStableIndex + 2);
        }

        // Update the stable content if it has grown. This "locks in" the previous blocks.
        if (newStableContent.length > stableContent.length) {
            setStableContent(newStableContent);
            // The new live part starts fresh
            setLiveContent('');
        }

        liveContentTargetRef.current = newLiveContentTarget;

    }, [content, stableContent, enableAnimation]);

    // Effect 2: Animate the "live" part using a typewriter effect.
    useEffect(() => {
        if (!enableAnimation) return;

        // If the live content has caught up to the target, we stop.
        if (liveContent.length >= liveContentTargetRef.current.length) {
            return;
        }

        const animationTimeout = setTimeout(() => {
            setLiveContent(prevLiveContent => {
                const target = liveContentTargetRef.current;
                const nextChunkSize = Math.min(3, target.length - prevLiveContent.length);
                return target.substring(0, prevLiveContent.length + nextChunkSize);
            });
        }, typewriterSpeed);

        return () => clearTimeout(animationTimeout);
    }, [liveContent, enableAnimation, typewriterSpeed]);

    // Memoize the final rendered components for performance.
    const StableMarkdown = useMemo(() => (
        <Markdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={mergedComponents}
        >
            {stableContent}
        </Markdown>
    ), [stableContent, remarkPlugins, rehypePlugins, mergedComponents]);

    const LiveMarkdown = useMemo(() => (
        <Markdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={mergedComponents}
        >
            {/* Add a blinking cursor for a classic typewriter feel */}
            {liveContent ? `${liveContent}` : ''}
        </Markdown>
    ), [liveContent, remarkPlugins, rehypePlugins, mergedComponents]);

    // The cursor is handled separately to prevent re-rendering the entire LiveMarkdown component on each blink
    const Cursor = useMemo(() => <span className="blinking-cursor">▋</span>, []);

    return (
        <div className={`${className} prose dark:prose-invert !max-w-full w-full text-primary`}>
            {/* Inject the keyframes for the cursor animation */}
            <style>{cursorStyle}</style>
            {StableMarkdown}
            {/* We render the live part and the cursor as siblings */}
            {liveContent && <div style={{ display: 'inline' }}>{LiveMarkdown}{Cursor}</div>}
        </div>
    );
}
