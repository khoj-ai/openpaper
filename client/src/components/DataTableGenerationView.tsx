"use client";

import { useState, useEffect } from "react";
import { Loader2, Download, Table as TableIcon, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColumnDefinition } from "./DataTableSchemaModal";
import { PaperItem } from "@/lib/schema";

export interface DataTableRow {
    paperId: string;
    paperTitle: string;
    data: { [columnId: string]: string | number };
    isLoading: boolean;
    isComplete: boolean;
}

interface DataTableGenerationViewProps {
    columns: ColumnDefinition[];
    papers: PaperItem[];
    onClose: () => void;
}

export default function DataTableGenerationView({
    columns,
    papers,
    onClose
}: DataTableGenerationViewProps) {
    const [rows, setRows] = useState<DataTableRow[]>([]);
    const [currentPaperIndex, setCurrentPaperIndex] = useState(0);
    const [isComplete, setIsComplete] = useState(false);

    // Initialize rows
    useEffect(() => {
        const initialRows = papers.map(paper => ({
            paperId: paper.id,
            paperTitle: paper.title,
            data: {},
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

            for (const column of columns) {
                // Simulate processing time
                await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

                // Generate mock data based on type
                if (column.type === 'number') {
                    newData[column.id] = Math.floor(Math.random() * 1000);
                } else {
                    const mockStrings = [
                        'Example value',
                        'Sample result',
                        'Test data',
                        'Extracted content',
                        'N/A',
                        'See paper for details',
                        'Multiple findings',
                        'Yes',
                        'No',
                        'Partial',
                    ];
                    newData[column.id] = mockStrings[Math.floor(Math.random() * mockStrings.length)];
                }

                // Update the row with new column data progressively
                setRows(prevRows =>
                    prevRows.map((row, idx) =>
                        idx === currentPaperIndex
                            ? { ...row, data: { ...row.data, ...newData } }
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
                                        {columns.map((column) => (
                                            <td key={column.id} className="p-3 min-w-[150px]">
                                                {row.data[column.id] !== undefined ? (
                                                    <span className="text-foreground">
                                                        {String(row.data[column.id])}
                                                    </span>
                                                ) : row.isLoading ? (
                                                    <div className="flex items-center gap-2 text-muted-foreground">
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                        <span className="text-xs">Extracting...</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground">—</span>
                                                )}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            {/* Summary */}
            {isComplete && (
                <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-lg">
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
