"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Sigma } from "lucide-react";
import { ChartArtifact } from "@/lib/schema";

function numeric(value?: string): number | null {
    if (!value) return null;
    const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
}

export function ChartArtifactCard({ artifact }: { artifact: ChartArtifact }) {
    const [open, setOpen] = useState(() => Object.keys(artifact.coverage.excluded).length > 0);
    const points = useMemo(() => artifact.records
        .filter(record => !record.exclusion_reason)
        .map(record => ({
            record,
            x: record.values[artifact.plan.x.key]?.value ?? "",
            y: numeric(record.values[artifact.plan.y.key]?.value),
        }))
        .filter((point): point is { record: ChartArtifact["records"][number]; x: string; y: number } => point.y !== null),
    [artifact]);
    const ys = points.map(point => point.y);
    const xs = points.map(point => numeric(point.x));
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 1);
    const range = maxY - minY || 1;
    const yFor = (value: number) => 148 - ((value - minY) / range) * 118;
    const numericXs = xs.filter((value): value is number => value !== null);
    const minX = Math.min(...numericXs, 0);
    const maxX = Math.max(...numericXs, 1);
    const xFor = (point: typeof points[number], index: number) => artifact.plan.chart_type === "scatter" && numeric(point.x) !== null
        ? 48 + ((numeric(point.x)! - minX) / (maxX - minX || 1)) * 250
        : 48 + index * (250 / Math.max(points.length - 1, 1));

    return (
        <section className="mt-3 overflow-hidden rounded-lg border bg-card p-3 text-card-foreground">
            <div className="flex items-start gap-2">
                <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{artifact.plan.title}</h3>
                    <p className="text-xs text-muted-foreground">
                        {artifact.plan.chart_type} · {artifact.coverage.included_paper_ids.length} of {artifact.coverage.searched_paper_ids.length} papers charted
                    </p>
                </div>
            </div>
            {points.length > 0 ? (
                <svg viewBox="0 0 320 180" className="mt-3 h-44 w-full" role="img" aria-label={artifact.plan.title}>
                    <line x1="34" y1="148" x2="310" y2="148" className="stroke-border" />
                    <line x1="34" y1="20" x2="34" y2="148" className="stroke-border" />
                    <text x="4" y="28" className="fill-muted-foreground text-[9px]">{maxY.toPrecision(3)}</text>
                    <text x="4" y="150" className="fill-muted-foreground text-[9px]">{minY.toPrecision(3)}</text>
                    {artifact.plan.chart_type === "bar" && points.map((point, index) => {
                        const width = Math.max(12, 240 / points.length - 8);
                        const x = 43 + index * (250 / points.length);
                        return <rect key={point.record.paper_id} x={x} y={yFor(point.y)} width={width} height={148 - yFor(point.y)} rx="2" className="fill-blue-500" />;
                    })}
                    {artifact.plan.chart_type !== "bar" && points.map((point, index) => {
                        const x = xFor(point, index);
                        return <g key={point.record.paper_id}>
                            {artifact.plan.chart_type === "line" && index > 0 && <line x1={xFor(points[index - 1], index - 1)} y1={yFor(points[index - 1].y)} x2={x} y2={yFor(point.y)} className="stroke-blue-500" strokeWidth="2" />}
                            <circle cx={x} cy={yFor(point.y)} r="4" className="fill-blue-500" />
                        </g>;
                    })}
                    {points.map((point, index) => <text key={`${point.record.paper_id}-label`} x={xFor(point, index)} y="164" textAnchor="middle" className="fill-muted-foreground text-[8px]">{point.x.slice(0, 10)}</text>)}
                </svg>
            ) : <p className="mt-3 text-xs text-muted-foreground">No directly quoted values could be plotted.</p>}
            <button type="button" onClick={() => setOpen(value => !value)} className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-300">
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {open ? "Hide sources and coverage" : "Show sources and coverage"}
            </button>
            {open && <div className="mt-2 space-y-2 border-t pt-2 text-xs">
                {artifact.plan.calculation && <p className="flex gap-1 text-muted-foreground"><Sigma className="h-3.5 w-3.5 shrink-0" />{artifact.plan.calculation.spec}</p>}
                {artifact.computation?.script && <details className="rounded bg-muted/60 p-2"><summary className="cursor-pointer font-medium">View calculation code</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px]">{artifact.computation.script}</pre></details>}
                {artifact.records.map(record => record.exclusion_reason ? (
                    <p key={record.paper_id} className="text-muted-foreground">{record.paper_title}: {record.exclusion_reason}</p>
                ) : (
                    <div key={record.paper_id} className="rounded bg-muted/60 p-2">
                        <p className="font-medium">{record.paper_title}</p>
                        {Object.entries(record.values).map(([key, value]) => <p key={key} className="mt-1 text-muted-foreground"><span className="font-medium text-foreground">{key}: {value.value}</span> — “{value.quote}”{value.line_number ? ` (line ${value.line_number})` : ""}</p>)}
                    </div>
                ))}
                {artifact.warnings.map(warning => <p key={warning} className="text-amber-700 dark:text-amber-300">{warning}</p>)}
            </div>}
        </section>
    );
}
