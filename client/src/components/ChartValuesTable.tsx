"use client";

import { ChartArtifact } from "@/lib/schema";
import { ChartPoint, exactNumber } from "@/components/ChartFigure";

/** The chart's table twin: every plotted number, exactly, without hovering.
 *
 * A tooltip enhances but must never be the only way to read a value, and the
 * chart's own labels are compacted ("226K") where the reader may want 225,596.
 *
 * It is also where the points the plot could not draw live. The figure shows
 * the leaders because bar lengths stop being comparable past a couple of dozen
 * rows; nothing is dropped from here, so a chart of four hundred points is
 * still fully readable — it just is not fully drawable. */
export function ChartValuesTable({ artifact, points, onOpenPaper }: {
    artifact: ChartArtifact;
    points: ChartPoint[];
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
}) {
    const excluded = artifact.records.filter(record => record.exclusion_reason);
    if (points.length === 0 && excluded.length === 0) return null;

    return (
        <div className="mt-4">
            {points.length > 0 && <div className="max-h-[70vh] overflow-auto">
                <table className="w-full border-collapse text-xs">
                    <caption className="sr-only">{artifact.plan.title}</caption>
                    <thead className="sticky top-0 bg-card">
                        <tr className="border-b text-left text-muted-foreground">
                            <th scope="col" className="py-1 pr-3 font-medium">{artifact.plan.x.label}</th>
                            <th scope="col" className="py-1 pr-3 text-right font-medium">
                                {artifact.plan.y.unit ? `${artifact.plan.y.label} (${artifact.plan.y.unit})` : artifact.plan.y.label}
                            </th>
                            <th scope="col" className="py-1 font-medium">Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {points.map(point => {
                            // A converted number does not match the paper it is
                            // sourced from, which reads as an error unless the
                            // paper's own printing is shown beside it. Keyed off
                            // whether a conversion ran, not off the paper naming
                            // a unit — papers print bare fractions constantly.
                            const cell = point.cells.find(c => c.key === artifact.plan.y.key);
                            const printed = cell?.converted
                                ? `${cell.value}${cell.unit ? ` ${cell.unit}` : ""}`
                                : null;
                            return (
                            <tr key={point.recordId} className="border-b last:border-0 align-top">
                                <td className="py-1.5 pr-3">{point.label}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums">
                                    {exactNumber(point.value)}
                                    {printed && (
                                        <div className="text-[10px] font-normal text-muted-foreground">
                                            {printed} as printed
                                        </div>
                                    )}
                                </td>
                                <td className="py-1.5">
                                    <button
                                        type="button"
                                        onClick={() => onOpenPaper(point.paperId, point.cells[0]?.quote)}
                                        className="text-left hover:underline"
                                    >
                                        {point.paperTitle}
                                    </button>
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>}
            {points.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                    All {points.length} plotted point{points.length === 1 ? "" : "s"}, in the chart's order.
                </p>
            )}
            {excluded.length > 0 && (
                <details className="mt-2" open={points.length === 0}>
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                        {excluded.length} not charted
                    </summary>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {excluded.map(record => (
                            <li key={record.record_id}>
                                <button
                                    type="button"
                                    onClick={() => onOpenPaper(record.paper_id)}
                                    className="text-left font-medium text-foreground hover:underline"
                                >
                                    {record.paper_title}
                                </button>
                                {": "}{record.exclusion_reason}
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}
