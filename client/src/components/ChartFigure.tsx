"use client";

import { useMemo, useState } from "react";
import { ChartArtifact } from "@/lib/schema";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface ChartPoint {
    recordId: string;
    paperId: string;
    paperTitle: string;
    label: string;
    value: number;
    x: number | null;
    cells: Array<{ key: string; value: string; quote: string; lineNumber?: string | null }>;
}

export function numeric(raw?: string): number | null {
    if (!raw) return null;
    const match = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/);
    return match ? Number(match[0]) : null;
}

/** Compact form for marks and ticks, where width is scarce. */
export function compactNumber(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toPrecision(3)));
}

/** Exact form for the tooltip and the table, where precision is the point. */
export function exactNumber(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function chartPoints(artifact: ChartArtifact): ChartPoint[] {
    const points: ChartPoint[] = [];
    for (const record of artifact.records) {
        if (record.exclusion_reason) continue;
        const value = numeric(record.values[artifact.plan.y.key]?.value);
        if (value === null) continue;
        const label = record.values[artifact.plan.x.key]?.value ?? "";
        points.push({
            recordId: record.record_id,
            paperId: record.paper_id,
            paperTitle: record.paper_title,
            label,
            value,
            x: numeric(label),
            cells: Object.entries(record.values).map(([key, cell]) => ({
                key,
                value: cell.value,
                quote: cell.quote,
                lineNumber: cell.line_number,
            })),
        });
    }
    return points;
}

/** Orders of magnitude between the smallest and largest plotted value. */
function spread(points: ChartPoint[]): number {
    const values = points.map(point => point.value).filter(value => value > 0);
    if (values.length < 2) return 1;
    return Math.max(...values) / Math.min(...values);
}

function decadeTicks(min: number, max: number): number[] {
    const ticks: number[] = [];
    for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent += 1) {
        ticks.push(10 ** exponent);
    }
    return ticks;
}

const ROW_HEIGHT = 28;
// The readout is line-clamped to a predictable height so it can be kept inside
// the plot instead of being cropped by it.
const TOOLTIP_HEIGHT = 108;
const COMPACT_ROWS = 6;

function Tooltip({ point, yLabel, xLabel, top }: {
    point: ChartPoint;
    yLabel: string;
    xLabel: string;
    top: number;
}) {
    return (
        <div
            role="tooltip"
            style={{ top }}
            className="pointer-events-none absolute right-0 z-10 w-56 max-w-full rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
        >
            <p className="m-0 text-sm font-semibold tabular-nums">{exactNumber(point.value)}</p>
            <p className="m-0 text-[11px] text-muted-foreground">{yLabel}</p>
            <p className="m-0 mt-1 truncate text-xs font-medium">{point.label}</p>
            <p className="m-0 text-[11px] text-muted-foreground">{xLabel}</p>
            <p className="m-0 mt-1 line-clamp-2 border-t pt-1 text-[11px] text-muted-foreground">{point.paperTitle}</p>
        </div>
    );
}

/** Categorical form: one row per point, label in the gutter, value at the tip.
 *
 * Horizontal rather than vertical because the categories are entity names
 * pulled out of papers — "TAU-bench Airline", "menstrual cycles" — which
 * collide on a shared x-axis long before the plot runs out of room. */
function CategoricalPlot({ points, log, yLabel, xLabel, onOpenPaper }: {
    points: ChartPoint[];
    log: boolean;
    yLabel: string;
    xLabel: string;
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
}) {
    const [active, setActive] = useState<number | null>(null);
    const values = points.map(point => point.value);
    const max = Math.max(...values);
    const positive = values.filter(value => value > 0);
    const min = positive.length ? Math.min(...positive) : 1;
    const ticks = log ? decadeTicks(min, max) : [];
    const floor = ticks.length ? ticks[0] : min;
    const ceiling = ticks.length ? ticks[ticks.length - 1] : max;

    // Linear bars grow from zero, so length is the value. On a log axis length
    // from an arbitrary origin means nothing, so the mark becomes a dot and
    // position alone carries the value.
    const fraction = (value: number) => {
        if (!log) return max > 0 ? Math.max(value / max, 0) : 0;
        if (value <= 0) return 0;
        const span = Math.log10(ceiling) - Math.log10(floor);
        return span > 0 ? (Math.log10(value) - Math.log10(floor)) / span : 0;
    };

    return (
        <div className="relative mt-3" onMouseLeave={() => setActive(null)}>
            <ol className="m-0 list-none p-0">
                {points.map((point, index) => (
                    <li key={point.recordId} className="m-0 p-0">
                        <button
                            type="button"
                            style={{ height: ROW_HEIGHT }}
                            className={`flex w-full items-center gap-2 rounded-sm px-1 text-left transition-colors ${active === index ? "bg-muted" : ""}`}
                            onMouseEnter={() => setActive(index)}
                            onFocus={() => setActive(index)}
                            onBlur={() => setActive(null)}
                            onClick={() => onOpenPaper(point.paperId, point.cells[0]?.quote)}
                        >
                            <span className="w-[30%] shrink-0 truncate text-[11px] text-muted-foreground" title={point.label}>
                                {point.label}
                            </span>
                            <span className="relative h-4 flex-1">
                                {log ? (
                                    <>
                                        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
                                        <span
                                            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-blue-500"
                                            style={{ left: `calc(${fraction(point.value) * 100}% - 4px)` }}
                                        />
                                    </>
                                ) : (
                                    <span
                                        className="absolute inset-y-0 left-0 rounded-r bg-blue-500"
                                        style={{ width: `max(${fraction(point.value) * 100}%, 2px)` }}
                                    />
                                )}
                            </span>
                            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                                {compactNumber(point.value)}
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
            {log && (
                <div className="mt-1 flex items-center gap-2 px-1 text-[10px] text-muted-foreground">
                    <span className="w-[30%] shrink-0" />
                    <span className="relative h-3 flex-1">
                        {ticks.map(tick => (
                            <span
                                key={tick}
                                className="absolute -translate-x-1/2 tabular-nums"
                                style={{ left: `${fraction(tick) * 100}%` }}
                            >
                                {compactNumber(tick)}
                            </span>
                        ))}
                    </span>
                    <span className="w-16 shrink-0" />
                </div>
            )}
            {active !== null && (
                <Tooltip
                    point={points[active]}
                    yLabel={yLabel}
                    xLabel={xLabel}
                    top={Math.min(
                        Math.max(active * ROW_HEIGHT + ROW_HEIGHT / 2 - TOOLTIP_HEIGHT / 2, 0),
                        Math.max(points.length * ROW_HEIGHT - TOOLTIP_HEIGHT, 0),
                    )}
                />
            )}
        </div>
    );
}

/** XY form, for the genuinely numeric x of a scatter or line plan. */
function XYPlot({ points, chartType, log, yLabel, xLabel }: {
    points: ChartPoint[];
    chartType: "line" | "scatter";
    log: boolean;
    yLabel: string;
    xLabel: string;
}) {
    const [active, setActive] = useState<number | null>(null);
    const ordered = useMemo(
        () => [...points].sort((a, b) => (a.x ?? 0) - (b.x ?? 0)),
        [points],
    );
    const ys = ordered.map(point => point.value);
    const xs = ordered.map(point => point.x ?? 0);
    const positive = ys.filter(value => value > 0);
    const yFloor = log && positive.length ? 10 ** Math.floor(Math.log10(Math.min(...positive))) : 0;
    const yCeiling = log && positive.length ? 10 ** Math.ceil(Math.log10(Math.max(...ys))) : Math.max(...ys, 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);

    const yFor = (value: number) => {
        if (!log) return 148 - ((value - 0) / (yCeiling || 1)) * 118;
        if (value <= 0) return 148;
        const span = Math.log10(yCeiling) - Math.log10(yFloor);
        return 148 - (span > 0 ? (Math.log10(value) - Math.log10(yFloor)) / span : 0) * 118;
    };
    const xFor = (value: number) => 48 + ((value - minX) / (maxX - minX || 1)) * 250;

    return (
        <div className="relative mt-3">
            <svg viewBox="0 0 320 186" className="w-full" role="img" aria-label={`${yLabel} against ${xLabel}`}>
                <line x1="34" y1="148" x2="310" y2="148" className="stroke-border" strokeWidth="1" />
                <line x1="34" y1="20" x2="34" y2="148" className="stroke-border" strokeWidth="1" />
                <text x="2" y="24" className="fill-muted-foreground text-[9px]">{compactNumber(yCeiling)}</text>
                <text x="2" y="152" className="fill-muted-foreground text-[9px]">{log ? compactNumber(yFloor) : "0"}</text>
                {chartType === "line" && ordered.slice(1).map((point, index) => (
                    <line
                        key={point.recordId}
                        x1={xFor(ordered[index].x ?? 0)}
                        y1={yFor(ordered[index].value)}
                        x2={xFor(point.x ?? 0)}
                        y2={yFor(point.value)}
                        className="stroke-blue-500"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                ))}
                {ordered.map((point, index) => (
                    <g key={point.recordId}>
                        <circle
                            cx={xFor(point.x ?? 0)}
                            cy={yFor(point.value)}
                            r={active === index ? 6 : 4}
                            className="fill-blue-500 stroke-card"
                            strokeWidth="2"
                        />
                        {/* Hit target well past the mark, per the 24px minimum. */}
                        <circle
                            cx={xFor(point.x ?? 0)}
                            cy={yFor(point.value)}
                            r="12"
                            fill="transparent"
                            tabIndex={0}
                            role="button"
                            aria-label={`${point.label}: ${exactNumber(point.value)}`}
                            onMouseEnter={() => setActive(index)}
                            onMouseLeave={() => setActive(null)}
                            onFocus={() => setActive(index)}
                            onBlur={() => setActive(null)}
                        />
                    </g>
                ))}
                <text x="172" y="182" textAnchor="middle" className="fill-muted-foreground text-[9px]">{xLabel}</text>
            </svg>
            {active !== null && (
                <Tooltip point={ordered[active]} yLabel={yLabel} xLabel={xLabel} top={24} />
            )}
        </div>
    );
}

export interface ChartView {
    points: ChartPoint[];
    isXY: boolean;
    canLog: boolean;
    defaultLog: boolean;
}

/** Everything both the figure and the PNG export need to agree on. */
export function chartView(artifact: ChartArtifact): ChartView {
    const derived = chartPoints(artifact);
    // Sorted by magnitude: the reader's job on a categorical chart is ranking,
    // and the paper roster's order carries no meaning.
    const points = artifact.plan.chart_type === "bar" || derived.some(point => point.x === null)
        ? [...derived].sort((a, b) => b.value - a.value)
        : derived;
    const canLog = points.every(point => point.value > 0) && points.length > 1;
    return {
        points,
        isXY: artifact.plan.chart_type !== "bar" && points.length > 0 && points.every(point => point.x !== null),
        canLog,
        defaultLog: canLog && spread(points) >= 100,
    };
}

export function ChartFigure({ artifact, view, log, onToggleLog, onOpenPaper, display = "full" }: {
    artifact: ChartArtifact;
    view: ChartView;
    log: boolean;
    onToggleLog: (log: boolean) => void;
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
    display?: "compact" | "full";
}) {
    const { points: all, isXY, canLog } = view;
    if (all.length === 0) return null;
    // The panel card is a preview, not a workspace: show the leaders and let
    // the title carry the reader to the full chart rather than stacking 20 rows
    // and a scale control into a sidebar.
    const truncated = display === "compact" && !isXY && all.length > COMPACT_ROWS;
    const points = truncated ? all.slice(0, COMPACT_ROWS) : all;
    const yLabel = artifact.plan.y.unit ? `${artifact.plan.y.label} (${artifact.plan.y.unit})` : artifact.plan.y.label;

    return (
        <figure className="m-0">
            {isXY ? (
                <XYPlot
                    points={points}
                    chartType={artifact.plan.chart_type === "line" ? "line" : "scatter"}
                    log={log}
                    yLabel={yLabel}
                    xLabel={artifact.plan.x.label}
                />
            ) : (
                <CategoricalPlot
                    points={points}
                    log={log}
                    yLabel={yLabel}
                    xLabel={artifact.plan.x.label}
                    onOpenPaper={onOpenPaper}
                />
            )}
            <figcaption className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                    {yLabel}
                    {truncated ? ` · top ${COMPACT_ROWS} of ${all.length}` : ""}
                </span>
                {canLog && display === "full" && (
                    <Tabs value={log ? "log" : "linear"} onValueChange={value => onToggleLog(value === "log")}>
                        <TabsList className="h-6 p-0.5">
                            <TabsTrigger
                                value="linear"
                                className="px-2 py-0 text-[11px]"
                                title="Bars grow from zero, so length is the value"
                            >
                                Linear
                            </TabsTrigger>
                            <TabsTrigger
                                value="log"
                                className="px-2 py-0 text-[11px]"
                                title="Each step is 10×. A log axis has no zero, so the mark becomes a dot — position is the value, not length"
                            >
                                Log
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}
            </figcaption>
        </figure>
    );
}
