"use client";

import { useState, useEffect } from "react";
import { Loader2, Download, Table as TableIcon, CheckCircle2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnDefinition } from "./DataTableSchemaModal";
import { PaperItem, Citation, Reference } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import CustomCitationLink from "@/components/utils/CustomCitationLink";
import Markdown from "react-markdown";

export interface DataTableRow {
    paperId: string;
    paperTitle: string;
    data: { [columnId: string]: string | number };
    references?: { [columnId: string]: Reference };
    isLoading: boolean;
    isComplete: boolean;
}

interface DataTableGenerationViewProps {
    columns: ColumnDefinition[];
    papers: PaperItem[];
    onClose: () => void;
    onCitationClick?: (paperId: string, searchTerm: string) => void;
}

export default function DataTableGenerationView({
    columns,
    papers,
    onClose,
    onCitationClick
}: DataTableGenerationViewProps) {
    const [rows, setRows] = useState<DataTableRow[]>([]);
    const [currentPaperIndex, setCurrentPaperIndex] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [highlightedCitation, setHighlightedCitation] = useState<{ paperId: string; citationKey: string } | null>(null);

    // Initialize rows
    useEffect(() => {
        const initialRows = papers.map(paper => ({
            paperId: paper.id,
            paperTitle: paper.title,
            data: {},
            references: {},
            isLoading: false,
            isComplete: false,
        }));
        setRows(initialRows);
    }, [papers]);

    // Simulate data generation
    useEffect(() => {
        if (currentPaperIndex >= papers.length) {
            setIsComplete(true);
            return;
        }

        const paper = papers[currentPaperIndex];

        // Mark current paper as loading
        setRows(prevRows =>
            prevRows.map((row, idx) =>
                idx === currentPaperIndex ? { ...row, isLoading: true } : row
            )
        );

        // Simulate data extraction for each column
        const generateColumnData = async () => {
            const newData: { [columnId: string]: string | number } = {};
            const newReferences: { [columnId: string]: Reference } = {};

            for (const column of columns) {
                // Simulate processing time
                await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

                // Generate mock data based on type
                if (column.type === 'number') {
                    newData[column.id] = Math.floor(Math.random() * 1000);
                    // Add mock citation for numbers
                    newReferences[column.id] = {
                        citations: [{
                            key: '1',
                            paper_id: paper.id,
                            reference: `This value was extracted from the methodology section of ${paper.title}.`
                        }]
                    };
                } else {
                    const mockStrings = [
                        'Randomized controlled trial with double-blind methodology [^1]',
                        'Sample included 150 participants from diverse backgrounds [^1]',
                        'Results showed statistically significant improvement (p < 0.05) [^1]',
                        'Data collected over 6-month period [^1]',
                        'Analysis performed using standard statistical methods [^1]',
                        'Findings consistent with previous research [^1]',
                        'Novel approach demonstrated in experimental setup [^1]',
                        'Longitudinal study design with quarterly assessments [^1]',
                        'Meta-analysis of 25 previous studies [^1]',
                        'Qualitative analysis using thematic coding [^1]',
                    ];
                    const selectedString = mockStrings[Math.floor(Math.random() * mockStrings.length)];
                    newData[column.id] = selectedString;

                    // Add mock citation for text fields
                    newReferences[column.id] = {
                        citations: [{
                            key: '1',
                            paper_id: paper.id,
                            reference: `Extracted from: "${selectedString.replace(/\[\^\d+\]/g, '').trim()}" - ${paper.title}`
                        }]
                    };
                }

                // Update the row with new column data progressively
                setRows(prevRows =>
                    prevRows.map((row, idx) =>
                        idx === currentPaperIndex
                            ? { ...row, data: { ...row.data, ...newData }, references: { ...row.references, ...newReferences } }
                            : row
                    )
                );
            }

            // Mark row as complete
            setRows(prevRows =>
                prevRows.map((row, idx) =>
                    idx === currentPaperIndex
                        ? { ...row, isLoading: false, isComplete: true }
                        : row
                )
            );

            // Move to next paper
            setCurrentPaperIndex(prev => prev + 1);
        };

        generateColumnData();
    }, [currentPaperIndex, papers, columns]);

    const downloadCSV = () => {
        // Create CSV content
        const headers = ['Paper', ...columns.map(col => col.label)];
        const csvRows = [
            headers.join(','),
            ...rows.filter(row => row.isComplete).map(row => {
                const values = [
                    `"${row.paperTitle.replace(/"/g, '""')}"`,
                    ...columns.map(col => {
                        const value = row.data[col.id];
                        if (value === undefined) return '';
                        if (col.type === 'number') return value;
                        return `"${String(value).replace(/"/g, '""')}"`;
                    })
                ];
                return values.join(',');
            })
        ];

        const csvContent = csvRows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'data-table.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const completedRows = rows.filter(row => row.isComplete).length;
    const totalRows = rows.length;
    const progress = totalRows > 0 ? (completedRows / totalRows) * 100 : 0;

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
                            <h3 className="text-lg font-semibold">Data Table Generation</h3>
                            <p className="text-sm text-muted-foreground">
                                {isComplete
                                    ? 'Generation complete!'
                                    : `Extracting data from papers... (${completedRows}/${totalRows})`
                                }
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        {isComplete && (
                            <Button onClick={downloadCSV} variant="outline" size="sm">
                                <Download className="mr-2 h-4 w-4" />
                                Download CSV
                            </Button>
                        )}
                        <Button onClick={onClose} variant={isComplete ? "default" : "secondary"} size="sm">
                            {isComplete ? 'Done' : 'Close'}
                        </Button>
                    </div>
                </div>

                {/* Progress Bar */}
                {!isComplete && (
                    <div className="w-full">
                        <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden bg-card">
                <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50 border-b">
                                <tr>
                                    <th className="text-left p-3 font-medium sticky left-0 bg-muted/50 z-10 min-w-[200px] max-w-[300px]">
                                        Paper
                                    </th>
                                    {columns.map((column) => (
                                        <th key={column.id} className="text-left p-3 font-medium min-w-[150px]">
                                            <div className="flex flex-col gap-1">
                                                <span>{column.label}</span>
                                                <span className="text-xs text-muted-foreground font-normal">
                                                    {column.type}
                                                </span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, rowIndex) => (
                                    <tr
                                        key={row.paperId}
                                        className={`border-b last:border-b-0 ${
                                            row.isLoading ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                                        }`}
                                    >
                                        <td className="p-3 sticky left-0 bg-card z-10 min-w-[200px] max-w-[300px]">
                                            <div className="flex items-start gap-2">
                                                {row.isComplete ? (
                                                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                                                ) : row.isLoading ? (
                                                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin mt-0.5 flex-shrink-0" />
                                                ) : (
                                                    <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 rounded-full mt-0.5 flex-shrink-0" />
                                                )}
                                                <span className="line-clamp-2 text-xs leading-relaxed">
                                                    {row.paperTitle}
                                                </span>
                                            </div>
                                        </td>
                                        {columns.map((column) => {
                                            const cellReferences = row.references?.[column.id];

                                            return (
                                                <td key={column.id} className="p-3 min-w-[150px] align-top">
                                                    {row.data[column.id] !== undefined ? (
                                                        <div className="text-foreground prose prose-sm dark:prose-invert max-w-none">
                                                            <Markdown
                                                                components={{
                                                                    p: (props) => (
                                                                        <CustomCitationLink
                                                                            {...props}
                                                                            handleCitationClick={(key) => {
                                                                                const citation = cellReferences?.citations.find(c => c.key === key);
                                                                                if (citation && citation.paper_id) {
                                                                                    setHighlightedCitation({ paperId: citation.paper_id, citationKey: key });

                                                                                    // Scroll to reference section
                                                                                    const refElement = document.getElementById(`ref-${citation.paper_id}-${key}`);
                                                                                    if (refElement) {
                                                                                        refElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                    }

                                                                                    if (onCitationClick) {
                                                                                        onCitationClick(citation.paper_id, citation.reference);
                                                                                    }
                                                                                }
                                                                            }}
                                                                            messageIndex={rowIndex}
                                                                            citations={cellReferences?.citations || []}
                                                                            papers={papers}
                                                                        />
                                                                    ),
                                                                }}
                                                            >
                                                                {String(row.data[column.id])}
                                                            </Markdown>
                                                        </div>
                                                    ) : row.isLoading ? (
                                                        <div className="flex items-center gap-2 text-muted-foreground">
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                            <span className="text-xs">Extracting...</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            {/* References Section */}
            {completedRows > 0 && (() => {
                // Collect all citations from completed rows
                const allCitations: { citation: Citation; paper: PaperItem }[] = [];
                rows.filter(row => row.isComplete).forEach(row => {
                    if (row.references) {
                        Object.values(row.references).forEach(ref => {
                            ref.citations.forEach(citation => {
                                const paper = papers.find(p => p.id === citation.paper_id);
                                if (paper && !allCitations.some(c => c.citation.key === citation.key && c.citation.paper_id === citation.paper_id)) {
                                    allCitations.push({ citation, paper });
                                }
                            });
                        });
                    }
                });

                if (allCitations.length === 0) return null;

                // Group by paper
                const citationsByPaper = allCitations.reduce((acc, { citation, paper }) => {
                    if (!acc[paper.id]) {
                        acc[paper.id] = { paper, citations: [] };
                    }
                    acc[paper.id].citations.push(citation);
                    return acc;
                }, {} as Record<string, { paper: PaperItem; citations: Citation[] }>);

                return (
                    <div className="mt-6 space-y-4">
                        <div className="border-t pt-6">
                            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <BookOpen className="w-5 h-5" />
                                References
                            </h3>
                            <div className="space-y-6">
                                {Object.values(citationsByPaper).map(({ paper, citations }) => {
                                    const isHighlighted = highlightedCitation?.paperId === paper.id;
                                    return (
                                        <div
                                            key={paper.id}
                                            className={`space-y-3 p-4 rounded-lg border transition-all duration-500 ${
                                                isHighlighted
                                                    ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
                                                    : 'bg-card border-border'
                                            }`}
                                        >
                                            {/* Paper Info */}
                                            <div className="flex items-start gap-3 pb-3 border-b">
                                                <div className="flex-1">
                                                    <h4 className="font-medium text-sm line-clamp-2">{paper.title}</h4>
                                                    {paper.authors && paper.authors.length > 0 && (
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {paper.authors.join(', ')}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Citations */}
                                            <div className="space-y-2">
                                                {citations.map((citation) => {
                                                    const isCitationHighlighted =
                                                        highlightedCitation?.paperId === paper.id &&
                                                        highlightedCitation?.citationKey === citation.key;
                                                    return (
                                                        <div
                                                            key={citation.key}
                                                            id={`ref-${citation.paper_id}-${citation.key}`}
                                                            className={`p-3 rounded-md transition-all duration-500 ${
                                                                isCitationHighlighted
                                                                    ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 shadow-sm'
                                                                    : 'bg-muted/30 hover:bg-muted/50'
                                                            }`}
                                                        >
                                                            <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 mr-2">
                                                                [{citation.key}]
                                                            </span>
                                                            <span className="text-sm text-foreground">{citation.reference}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Summary */}
            {isComplete && (
                <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-lg">
                    <div className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                        <div>
                            <h3 className="font-medium text-green-900 dark:text-green-100 mb-1">
                                Data extraction complete
                            </h3>
                            <p className="text-sm text-green-800 dark:text-green-200">
                                Successfully extracted {columns.length} fields from {totalRows} papers. You can now download the data as CSV or close this view.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
