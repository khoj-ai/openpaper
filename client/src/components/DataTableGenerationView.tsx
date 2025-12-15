"use client";

import { useState, useMemo } from "react";
import { Download, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaperItem, DataTableResult, Citation } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import Link from "next/link";

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
    onCitationClick,
}: DataTableGenerationViewProps) {
    const [highlightedPaper, setHighlightedPaper] = useState<string | null>(null);

    const { columns, rows, title } = dataTableResult;

    // Create a map of paper_id to paper for quick lookup
    const paperMap = new Map(papers.map(paper => [paper.id, paper]));

    // Convert DataTableCitations to Citation format for ReferencePaperCards
    const citations = useMemo(() => {
        const result: Citation[] = [];
        rows.forEach((row) => {
            columns.forEach((columnName) => {
                const cellValue = row.values?.[columnName];
                if (cellValue && cellValue.citations.length > 0) {
                    cellValue.citations.forEach((citation) => {
                        result.push({
                            key: String(citation.index),
                            paper_id: row.paper_id,
                            reference: citation.text
                        });
                    });
                }
            });
        });
        return result;
    }, [rows, columns]);

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
                                                    className="hover:underline font-medium"
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
                                            const cellCitations = cellValue?.citations || [];

                                            return (
                                                <td key={columnName} className="p-3 align-top">
                                                    {cellValue ? (
                                                        <div className="space-y-2">
                                                            <div className="text-foreground">
                                                                {cellValue.value}
                                                            </div>
                                                            {cellCitations.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {cellCitations.map((citation, citationIdx) => (
                                                                        <button
                                                                            key={citationIdx}
                                                                            onClick={() => {
                                                                                // Open PDF viewer with the citation text
                                                                                if (onCitationClick) {
                                                                                    onCitationClick(row.paper_id, citation.text);
                                                                                }
                                                                                // Also highlight the paper card and scroll to it
                                                                                setHighlightedPaper(row.paper_id);
                                                                                const cardId = `datatable-reference-paper-card-${row.paper_id}`;
                                                                                const refElement = document.getElementById(cardId);
                                                                                if (refElement) {
                                                                                    refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                }
                                                                            }}
                                                                            className="text-xs px-1.5 py-0.5 rounded transition-colors bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                                                                        >
                                                                            [{citation.index}]
                                                                        </button>
                                                                    ))}
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
            {citations.length > 0 && (
                <div className="mt-6 space-y-4">
                    <div className="border-t pt-6">
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                            References
                        </h3>
                        <ReferencePaperCards
                            citations={citations}
                            papers={papers}
                            messageId="datatable"
                            messageIndex={0}
                            highlightedPaper={highlightedPaper}
                            onHighlightClear={() => setHighlightedPaper(null)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
