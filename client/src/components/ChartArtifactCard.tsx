"use client";

import { useMemo, useState } from "react";
import { BarChart3, Sigma } from "lucide-react";
import Link from "next/link";
import { ChartArtifact } from "@/lib/schema";
import { MessageTraceViewer } from "@/components/MessageTraceViewer";
import { ChartFigure, chartView } from "@/components/ChartFigure";
import { ChartValuesTable } from "@/components/ChartValuesTable";
import { ChartExportButtons } from "@/components/ChartExportButtons";
import { AnimatedMarkdown } from "@/components/AnimatedMarkdown";

interface QuotedField {
    key: string;
    value: string;
    quote: string;
    lineNumber?: string | null;
}

/** The evidence behind the plot, gathered by paper rather than by point.
 *
 * A paper that reports one measure across thirty benchmarks contributes thirty
 * points, and listing each as its own card repeated that paper's title thirty
 * times and re-quoted the same table line beneath every one of them. The
 * quotable unit is the passage, not the point: a field, its value and the
 * sentence it came from are one piece of evidence however many points rest on
 * it. */
function paperSources(artifact: ChartArtifact) {
    const byPaper = new Map<string, {
        paperId: string;
        title: string;
        points: number;
        fields: QuotedField[];
    }>();
    for (const record of artifact.records) {
        if (record.exclusion_reason) continue;
        let group = byPaper.get(record.paper_id);
        if (!group) {
            group = { paperId: record.paper_id, title: record.paper_title, points: 0, fields: [] };
            byPaper.set(record.paper_id, group);
        }
        group.points += 1;
        for (const [key, value] of Object.entries(record.values)) {
            const seen = group.fields.some(field =>
                field.key === key && field.value === value.value && field.quote === value.quote);
            if (seen) continue;
            group.fields.push({ key, value: value.value, quote: value.quote, lineNumber: value.line_number });
        }
    }
    return [...byPaper.values()];
}

export function ChartArtifactCard({ artifact, onOpenPaper, chatHref, detailHref, display = "compact" }: {
    artifact: ChartArtifact;
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
    chatHref?: string;
    detailHref?: string;
    display?: "compact" | "full";
}) {
    const view = useMemo(() => chartView(artifact), [artifact]);
    const sources = useMemo(() => paperSources(artifact), [artifact]);
    const [log, setLog] = useState(view.defaultLog);
    // Held here rather than in the figure, alongside the log scale and for the
    // same reason: the export has to draw what the reader is looking at.
    const [expanded, setExpanded] = useState(false);
    const shown = display === "full" && expanded ? "all" : display;
    const points = view.points;
    // The title is the affordance for opening the chart, so the card needs no
    // separate link of its own.
    const href = detailHref ?? chatHref;
    const meta = `${artifact.plan.chart_type} · ${points.length} data point${points.length === 1 ? "" : "s"} from ${artifact.coverage.included_paper_ids.length} of ${artifact.coverage.searched_paper_ids.length} papers`;

    return (
        <section className={`not-prose text-card-foreground ${display === "compact" ? "mt-3 overflow-hidden rounded-lg border bg-card p-3" : ""}`}>
            <div className="flex items-start gap-2">
                <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="min-w-0 flex-1">
                    {href
                        ? <Link href={href} className="m-0 text-sm font-semibold hover:underline">{artifact.plan.title}</Link>
                        : <h3 className="m-0 text-sm font-semibold">{artifact.plan.title}</h3>}
                    <p className="text-xs text-muted-foreground">{meta}</p>
                </div>
                {display === "full"
                    ? <ChartExportButtons artifact={artifact} view={view} log={log} display={shown} />
                    : <ChartExportButtons artifact={artifact} view={view} log={log} display={shown} compact />}
            </div>

            <ChartFigure
                artifact={artifact}
                view={view}
                log={log}
                onToggleLog={setLog}
                onOpenPaper={onOpenPaper}
                display={shown}
                onToggleExpanded={setExpanded}
            />

            {points.length === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                    Nothing could be plotted: none of the {artifact.coverage.searched_paper_ids.length} papers
                    searched reported <span className="font-medium">{artifact.plan.y.label}</span> against{" "}
                    <span className="font-medium">{artifact.plan.x.label}</span> in a directly quotable form.
                </p>
            )}

            {display === "full" && <>
                <ChartValuesTable artifact={artifact} points={points} onOpenPaper={onOpenPaper} />

                {(points.length > 0 || artifact.investigation_trace || artifact.warnings.length > 0) && <div className="mt-6 space-y-2 border-t pt-3 text-xs">
                    <h4 className="m-0 text-xs font-semibold">Sources</h4>
                    {artifact.plan.calculation && (
                        <p className="flex gap-1 text-muted-foreground">
                            <Sigma className="h-3.5 w-3.5 shrink-0" />{artifact.plan.calculation.spec}
                        </p>
                    )}
                    {artifact.computation?.script && (
                        <details className="rounded bg-muted/60 p-2">
                            <summary className="cursor-pointer font-medium">View calculation code</summary>
                            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px]">{artifact.computation.script}</pre>
                        </details>
                    )}
                    {artifact.investigation_trace && <MessageTraceViewer trace={artifact.investigation_trace} />}
                    {/* Folded, because the values table above already lists
                        every plotted number against the paper it came from.
                        What is kept here is the wording behind it, which a
                        reader wants for one paper at a time. */}
                    {sources.map(source => (
                        <details key={source.paperId} className="rounded bg-muted/60 p-2">
                            <summary className="cursor-pointer font-medium">
                                {source.title}
                                <span className="ml-1.5 font-normal text-muted-foreground">
                                    {source.points} point{source.points === 1 ? "" : "s"}
                                </span>
                            </summary>
                            {source.fields.map(field => (
                                <p key={`${field.key}:${field.value}:${field.quote}`} className="mt-1 text-muted-foreground">
                                    <button
                                        type="button"
                                        onClick={() => onOpenPaper(source.paperId, field.quote)}
                                        className="text-left hover:text-foreground hover:underline"
                                    >
                                        <span className="font-medium text-foreground">{field.key}: {field.value}</span>
                                        {" — "}&ldquo;{field.quote}&rdquo;
                                        {field.lineNumber ? ` (line ${field.lineNumber})` : ""}
                                    </button>
                                </p>
                            ))}
                        </details>
                    ))}
                    {artifact.warnings.map(warning => (
                        <div key={warning} className="text-amber-700 dark:text-amber-300">
                            <AnimatedMarkdown content={warning} />
                        </div>
                    ))}
                </div>}
            </>}
        </section>
    );
}
