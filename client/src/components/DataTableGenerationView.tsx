"use client";

import { useState, useMemo } from "react";
import { Download, Table as TableIcon, Calculator, List, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

SyntaxHighlighter.registerLanguage("python", python);
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PaperItem, DataTableResult, Citation } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import { ProjectPaperPreview } from "@/components/ProjectPaperPreview";
import Link from "next/link";

interface DataTableGenerationViewProps {
    dataTableResult: DataTableResult;
    papers: PaperItem[];
    onClose: () => void;
    onCitationClick?: (paperId: string, searchTerm: string) => void;
    projectId?: string;
}

// Wrapper component to handle owned vs non-owned papers
const PaperLinkWrapper = ({
    paper,
    projectId,
    children
}: {
    paper: PaperItem;
    projectId?: string;
    children: React.ReactNode;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const isOwner = paper.is_owner !== false; // Default to true if not specified

    if (isOwner) {
        return (
            <Link
                href={`/paper/${paper.id}`}
                className="hover:underline font-medium"
                target="_blank"
            >
                {children}
            </Link>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <button className="hover:underline font-medium text-left cursor-pointer">
                    {children}
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-[90vw] sm:max-w-[90vw] h-[90vh] overflow-y-auto p-0">
                <ProjectPaperPreview paper={paper} projectId={projectId!} />
            </DialogContent>
        </Dialog>
    );
};

export default function DataTableGenerationView({
    dataTableResult,
    papers,
    onClose,
    onCitationClick,
    projectId,
}: DataTableGenerationViewProps) {
    const [highlightedPaper, setHighlightedPaper] = useState<string | null>(null);
    const { darkMode } = useIsDarkMode();

    const { columns, rows, title } = dataTableResult;

    // label -> plan entry for compute-agent columns ("view code" badges).
    const computedColumns = useMemo(
        () => new Map(
            (dataTableResult.column_plan ?? [])
                .filter(spec => spec.kind === 'computed')
                .map(spec => [spec.label, spec])
        ),
        [dataTableResult.column_plan]
    );
    const computeProvenance = dataTableResult.compute_provenance;
    const [codeDialogOpen, setCodeDialogOpen] = useState(false);
    const listColumns = useMemo(
        () => new Set(
            (dataTableResult.column_plan ?? [])
                .filter(spec => spec.kind === 'list')
                .map(spec => spec.label)
        ),
        [dataTableResult.column_plan]
    );

    // Create a map of paper_id to paper for quick lookup
    const paperMap = new Map(papers.map(paper => [paper.id, paper]));

    // Convert DataTableCitations to Citation format for ReferencePaperCards
    const citations = useMemo(() => {
        const result: Citation[] = [];
        // The same quote can back several cells in a row (e.g. one sentence
        // reporting two columns' values) — dedupe for the references section.
        const seen = new Set<string>();
        const addCitation = (paperId: string, citation: { index: number; text: string }) => {
            const dedupeKey = `${paperId}::${citation.index}::${citation.text}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            result.push({
                key: String(citation.index),
                paper_id: paperId,
                reference: citation.text
            });
        };
        rows.forEach((row) => {
            columns.forEach((columnName) => {
                const cellValue = row.values?.[columnName];
                cellValue?.citations.forEach((citation) => addCitation(row.paper_id, citation));
                // List cells cite through their per-element entries.
                cellValue?.entries?.forEach((entry) => {
                    entry.citations.forEach((citation) => addCitation(row.paper_id, citation));
                });
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
                    const value = cellValue.entries?.length
                        ? cellValue.entries
                            .map((entry) => (entry.key ? `${entry.key}: ${entry.value}` : entry.value))
                            .join('; ')
                        : cellValue.value;
                    return `"${String(value).replace(/"/g, '""')}"`;
                });
                return [`"${paperTitle.replace(/"/g, '""')}"`, ...values].join(',');
            })
        ];

        // Note computed columns below the data so exported tables don't
        // present computed output as extracted values.
        if (computedColumns.size > 0) {
            csvRows.push('');
            csvRows.push('"Computed columns (calculated from extracted values, not stated in papers):"');
            computedColumns.forEach((spec) => {
                const inputs = (spec.inputs ?? []).join('; ');
                const note = `${spec.label}: ${spec.spec ?? ''}${inputs ? ` (from: ${inputs})` : ''}`;
                csvRows.push(`"${note.replace(/"/g, '""')}"`);
            });
        }

        const csvContent = csvRows.join('\n');
        // Prepend a UTF-8 BOM so Excel detects the encoding (preserving accented
        // characters) and correctly auto-detects the delimiter on localized installs.
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
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
                                {columns.map((columnName) => {
                                    const computedSpec = computedColumns.get(columnName);
                                    return (
                                        <th key={columnName} className="text-left p-3 font-medium min-w-[200px]">
                                            <span className="inline-flex items-center gap-1.5">
                                                {columnName}
                                                {listColumns.has(columnName) && (
                                                    <span
                                                        title="List column — one cited entry per instance found in the paper. Entries are independent of other list columns: rows do not align across lists."
                                                        className="inline-flex items-center px-1 py-0.5 rounded cursor-default bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300"
                                                    >
                                                        <List className="h-3.5 w-3.5" />
                                                    </span>
                                                )}
                                                {computedSpec && (
                                                    <HoverCard openDelay={100} closeDelay={150}>
                                                        <HoverCardTrigger asChild>
                                                            <button
                                                                type="button"
                                                                aria-label={`Computed column${computeProvenance?.script ? ' — view the code that produced it' : ''}`}
                                                                onClick={() => computeProvenance?.script && setCodeDialogOpen(true)}
                                                                className={`inline-flex items-center px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 ${computeProvenance?.script ? 'cursor-pointer hover:bg-purple-200 dark:hover:bg-purple-900/60' : 'cursor-default'}`}
                                                            >
                                                                <Calculator className="h-3.5 w-3.5" />
                                                            </button>
                                                        </HoverCardTrigger>
                                                        <HoverCardContent className="w-96 p-3 shadow-md bg-accent space-y-2">
                                                            <p className="text-xs font-semibold text-accent-foreground uppercase tracking-wide">
                                                                Computed column
                                                            </p>
                                                            <p className="text-sm text-accent-foreground">
                                                                {computedSpec.spec}
                                                            </p>
                                                            {Array.isArray(computedSpec.inputs) && computedSpec.inputs.length > 0 && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    from: {computedSpec.inputs.join(', ')}
                                                                </p>
                                                            )}
                                                            {computeProvenance?.script && (
                                                                <p className="text-xs text-muted-foreground">
                                                                    Click the badge to view the code that produced these values.
                                                                </p>
                                                            )}
                                                        </HoverCardContent>
                                                    </HoverCard>
                                                )}
                                            </span>
                                        </th>
                                    );
                                })}
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
                                                <PaperLinkWrapper paper={paper} projectId={projectId}>
                                                    {paper.title}
                                                </PaperLinkWrapper>
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
                                                            <div className="text-foreground flex items-center gap-1.5">
                                                                {cellValue.entries && cellValue.entries.length > 0 ? (
                                                                    <div className="space-y-1">
                                                                        {cellValue.entries.map((entry, entryIdx) => (
                                                                            <div key={entryIdx} className="flex items-center gap-1.5">
                                                                                <span>
                                                                                    {entry.key && (
                                                                                        <span className="text-muted-foreground">{entry.key}: </span>
                                                                                    )}
                                                                                    {entry.value}
                                                                                </span>
                                                                                {entry.citations.map((citation, citationIdx) => (
                                                                                    <button
                                                                                        key={citationIdx}
                                                                                        title={citation.text}
                                                                                        onClick={() => {
                                                                                            if (onCitationClick) {
                                                                                                onCitationClick(row.paper_id, citation.text);
                                                                                            }
                                                                                            setHighlightedPaper(row.paper_id);
                                                                                        }}
                                                                                        className="text-xs px-1 py-0.5 rounded transition-colors bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                                                                                    >
                                                                                        [{citation.index}]
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    cellValue.value
                                                                )}
                                                            </div>
                                                            {cellCitations.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {cellCitations.map((citation, citationIdx) => (
                                                                        <HoverCard
                                                                            key={citationIdx}
                                                                            openDelay={100}
                                                                            closeDelay={100}
                                                                        >
                                                                            <HoverCardTrigger asChild>
                                                                                <button
                                                                                    onClick={() => {
                                                                                        // Open PDF viewer with the citation text
                                                                                        if (onCitationClick) {
                                                                                            onCitationClick(row.paper_id, citation.text);
                                                                                        }
                                                                                        setHighlightedPaper(row.paper_id);
                                                                                    }}
                                                                                    className="text-xs px-1.5 py-0.5 rounded transition-colors bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                                                                                >
                                                                                    [{citation.index}]
                                                                                </button>
                                                                            </HoverCardTrigger>
                                                                            <HoverCardContent className="w-80 p-2 shadow-md bg-accent">
                                                                                {paper && <p className="text-sm font-bold text-accent-foreground mb-1">{paper.title}</p>}
                                                                                <p className="text-sm text-accent-foreground">{citation.text}</p>
                                                                            </HoverCardContent>
                                                                        </HoverCard>
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

            {/* Compute-agent provenance: the script that produced the computed
                columns, with its output — the "shown work" for those values. */}
            {computeProvenance?.script && (
                <Dialog open={codeDialogOpen} onOpenChange={setCodeDialogOpen}>
                    <DialogContent className="sm:max-w-[min(64rem,95vw)] max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>How the computed columns were calculated</DialogTitle>
                            <DialogDescription>
                                This script ran in a sandbox against the extracted table values —
                                only the columns listed as inputs. Its output filled the computed columns.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 text-sm">
                            {(computeProvenance.specs ?? []).map((spec) => (
                                <div key={spec.label} className="text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{spec.label}</span>
                                    {' — '}{spec.spec}
                                    {spec.inputs.length > 0 && <> (from: {spec.inputs.join(', ')})</>}
                                </div>
                            ))}
                            <SyntaxHighlighter
                                language="python"
                                style={darkMode ? oneDark : oneLight}
                                wrapLongLines
                                customStyle={{
                                    margin: 0,
                                    borderRadius: '0.375rem',
                                    fontSize: '0.75rem',
                                }}
                            >
                                {computeProvenance.script}
                            </SyntaxHighlighter>
                            {computeProvenance.stdout && (
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                        Script output
                                    </p>
                                    <pre className="bg-muted/50 rounded-md p-3 text-xs whitespace-pre-wrap break-words">
                                        {computeProvenance.stdout}
                                    </pre>
                                </div>
                            )}
                            {(computeProvenance.warnings ?? []).length > 0 && (
                                <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                                    {(computeProvenance.warnings ?? []).map((warning, idx) => (
                                        <p key={idx} className="flex gap-1.5">
                                            <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                            {warning}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}

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
