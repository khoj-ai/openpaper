"use client";

import { useState, useEffect } from "react";
import { Loader2, Download, Table as TableIcon, CheckCircle2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaperItem, DataTableResult, DataTableCitation } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import CustomCitationLink from "@/components/utils/CustomCitationLink";
import Markdown from "react-markdown";
import Link from "next/link";
import { groupConsecutiveNumbers } from "@/lib/utils";

interface DataTableGenerationViewProps {
    dataTableResult: DataTableResult;
    papers: PaperItem[];
    onClose: () => void;
    onCitationClick?: (paperId: string, searchTerm: string) => void;
}

export default function DataTableGenerationView({
    dataTableResult,
    papers,
    onClose,
    onCitationClick
}: DataTableGenerationViewProps) {
    const [highlightedCitation, setHighlightedCitation] = useState<{ rowIndex: number; columnName: string; citationIndex: number } | null>(null);
    const [expandedPaper, setExpandedPaper] = useState<string | null>(null);

    const { columns, rows, title } = dataTableResult;

    // Create a map of paper_id to paper for quick lookup
    const paperMap = new Map(papers.map(paper => [paper.id, paper]));

    const downloadCSV = () => {
        // Create CSV content
        const headers = ['Paper', ...columns];
        const csvRows = [
            headers.join(','),
            ...rows.map(row => {
                const paper = paperMap.get(row.paper_id);
                const paperTitle = paper?.title || 'Unknown Paper';
                const values = columns.map(columnName => {
                    const cellValue = row.values?.[columnName];
                    if (!cellValue) return '';
                    const value = cellValue.value;
                    return `"${String(value).replace(/"/g, '""')}"`;
                });
                return [`"${paperTitle.replace(/"/g, '""')}"`, ...values].join(',');
            })
        ];

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title || 'data-table'}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    console.log("DataTableGenerationView rendered with dataTableResult:", dataTableResult);

    return (
        <div className="mt-6 space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                            <TableIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold">{title || 'Data Table'}</h3>
                            <p className="text-sm text-muted-foreground">
                                {rows.length} {rows.length === 1 ? 'row' : 'rows'} extracted
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={downloadCSV} variant="outline" size="sm">
                            <Download className="mr-2 h-4 w-4" />
                            Download CSV
                        </Button>
                        <Button onClick={onClose} variant="default" size="sm">
                            Done
                        </Button>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 border-b">
                            <tr>
                                <th className="text-left p-3 font-medium min-w-[200px] sticky left-0 bg-muted/50 z-10">
                                    Paper
                                </th>
                                {columns.map((columnName) => (
                                    <th key={columnName} className="text-left p-3 font-medium min-w-[200px]">
                                        {columnName}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, rowIndex) => {
                                const paper = paperMap.get(row.paper_id);
                                return (
                                    <tr
                                        key={rowIndex}
                                        className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                                    >
                                        <td className="p-3 align-top sticky left-0 bg-card z-10">
                                            {paper ? (
                                                <Link
                                                    href={`/paper/${paper.id}`}
                                                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                                                    target="_blank"
                                                >
                                                    {paper.title}
                                                </Link>
                                            ) : (
                                                <span className="text-muted-foreground">Unknown Paper</span>
                                            )}
                                        </td>
                                        {columns.map((columnName) => {
                                            const cellValue = row.values?.[columnName];
                                            const citations = cellValue?.citations || [];

                                            return (
                                                <td key={columnName} className="p-3 align-top">
                                                    {cellValue ? (
                                                        <div className="space-y-2">
                                                            <div className="text-foreground">
                                                                {cellValue.value}
                                                            </div>
                                                            {citations.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {citations.map((citation, citationIdx) => {
                                                                        const isHighlighted =
                                                                            highlightedCitation?.rowIndex === rowIndex &&
                                                                            highlightedCitation?.columnName === columnName &&
                                                                            highlightedCitation?.citationIndex === citationIdx;

                                                                        return (
                                                                            <button
                                                                                key={citationIdx}
                                                                                onClick={() => {
                                                                                    setHighlightedCitation({ rowIndex, columnName, citationIndex: citationIdx });
                                                                                    if (onCitationClick) {
                                                                                        onCitationClick('', citation.text);
                                                                                    }

                                                                                    // Scroll to citation in references
                                                                                    const refElement = document.getElementById(`citation-${rowIndex}-${columnName}-${citationIdx}`);
                                                                                    if (refElement) {
                                                                                        refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                    }
                                                                                }}
                                                                                className={`text-xs px-1.5 py-0.5 rounded transition-colors ${isHighlighted
                                                                                    ? 'bg-blue-500 text-white'
                                                                                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                                                                    }`}
                                                                            >
                                                                                [{citation.index}]
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* References Section */}
            {(() => {
                // Collect all citations grouped by paper
                const citationsByPaper = new Map<string, Array<{
                    rowIndex: number;
                    columnName: string;
                    citationIndex: number;
                    citation: DataTableCitation
                }>>();

                rows.forEach((row, rowIndex) => {
                    columns.forEach((columnName) => {
                        const cellValue = row.values?.[columnName];
                        if (cellValue && cellValue.citations.length > 0) {
                            if (!citationsByPaper.has(row.paper_id)) {
                                citationsByPaper.set(row.paper_id, []);
                            }
                            cellValue.citations.forEach((citation, citationIndex) => {
                                citationsByPaper.get(row.paper_id)!.push({
                                    rowIndex,
                                    columnName,
                                    citationIndex,
                                    citation
                                });
                            });
                        }
                    });
                });

                if (citationsByPaper.size === 0) return null;

                const toggleExpanded = (paperId: string) => {
                    setExpandedPaper(expandedPaper === paperId ? null : paperId);
                };

                return (
                    <div className="mt-6 space-y-4">
                        <div className="border-t pt-6">
                            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <BookOpen className="w-5 h-5" />
                                References
                            </h3>
                            <div className="space-y-4">
                                {Array.from(citationsByPaper.entries()).map(([paperId, citations]) => {
                                    const paper = paperMap.get(paperId);
                                    const citationNumbers = citations.map(c => c.citation.index);
                                    const isExpanded = expandedPaper === paperId;

                                    return (
                                        <div
                                            key={paperId}
                                            className="space-y-3 p-4 rounded-lg border transition-all duration-500 bg-card border-border"
                                        >
                                            {/* Paper Info - Clickable */}
                                            <div
                                                className="flex items-start gap-3 pb-3 border-b cursor-pointer hover:opacity-80 transition-opacity"
                                                onClick={() => toggleExpanded(paperId)}
                                            >
                                                <div className="flex-shrink-0 bg-secondary rounded-lg px-2 py-1">
                                                    <span className="text-xs font-bold text-gray-500">
                                                        {groupConsecutiveNumbers(citationNumbers)}
                                                    </span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    {paper ? (
                                                        <h4 className="font-medium text-sm line-clamp-2">
                                                            {paper.title}
                                                        </h4>
                                                    ) : (
                                                        <h4 className="font-medium text-sm text-muted-foreground">
                                                            Unknown Paper
                                                        </h4>
                                                    )}
                                                    {paper?.authors && paper.authors.length > 0 && (
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {paper.authors.join(', ')}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Citations - Expandable */}
                                            {isExpanded && (
                                                <div className="space-y-2">
                                                    {citations.map(({ rowIndex, columnName, citationIndex, citation }) => {
                                                        const isHighlighted =
                                                            highlightedCitation?.rowIndex === rowIndex &&
                                                            highlightedCitation?.columnName === columnName &&
                                                            highlightedCitation?.citationIndex === citationIndex;

                                                        return (
                                                            <div
                                                                key={`${rowIndex}-${columnName}-${citationIndex}`}
                                                                id={`citation-${rowIndex}-${columnName}-${citationIndex}`}
                                                                className={`p-3 rounded-md transition-all duration-300 ${isHighlighted
                                                                    ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700'
                                                                    : 'bg-muted/30 hover:bg-muted/50'
                                                                    }`}
                                                            >
                                                                <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 mr-2">
                                                                    [{citation.index}]
                                                                </span>
                                                                <span className="text-sm text-foreground">{citation.text}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
