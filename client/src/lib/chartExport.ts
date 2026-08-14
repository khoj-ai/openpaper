/** Render a chart artifact to a PNG.
 *
 * Drawn onto a canvas from the same point data the figure renders, rather than
 * rasterizing the DOM: no extra dependency, no dependence on which stylesheet
 * happened to load, and the exported image can carry its own title and
 * provenance line so a chart pasted into a doc still says where it came from.
 * Scales and number formatting are imported from the figure so the picture and
 * the page can never disagree about a value.
 */

import { ChartArtifact } from "@/lib/schema";
import { ChartPoint, compactNumber, seriesKeys, seriesLabel, seriesPalette } from "@/components/ChartFigure";

const SCALE = 2;
const WIDTH = 920;
const PAD = 32;
const ROW = 30;
// A study series is drawn on its own line under the category, so the row grows
// and the gutter widens to hold a paper title rather than clip it.
const ROW_WITH_SERIES = 38;
const LABEL_COLUMN = 0.28;
const LABEL_COLUMN_WITH_SERIES = 0.4;
const VALUE_COLUMN = 92;
const MARK = "#3b82f6";
const LEGEND_ROW = 22;

interface Palette {
    background: string;
    ink: string;
    muted: string;
    border: string;
}

const LIGHT: Palette = { background: "#ffffff", ink: "#0f172a", muted: "#64748b", border: "#e2e8f0" };
const DARK: Palette = { background: "#2b2e33", ink: "#f8fafc", muted: "#94a3b8", border: "#41454b" };

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

function font(size: number, weight: number | string = 400): string {
    return `${weight} ${size}px ${SANS}`;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let clipped = text;
    while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
        clipped = clipped.slice(0, -1);
    }
    return `${clipped}…`;
}

function decadeTicks(min: number, max: number): number[] {
    const ticks: number[] = [];
    for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e += 1) {
        ticks.push(10 ** e);
    }
    return ticks;
}

interface LegendEntry {
    label: string;
    /** Position in the series order, so a wrapped entry keeps its own colour —
     * the hue follows the entity, never the slot it lands in. */
    index: number;
}

/** Break the legend into lines that fit the canvas.
 *
 * The canvas is a fixed width and a series can now be a paper title, so a
 * single row of swatches walks straight off the right edge. Laying it out
 * before the canvas is sized lets the image grow a band per line instead.
 */
function layoutLegend(
    ctx: CanvasRenderingContext2D,
    groups: string[],
    maxWidth: number,
): LegendEntry[][] {
    ctx.font = font(11);
    const lines: LegendEntry[][] = [[]];
    let cursor = 0;
    groups.forEach((group, index) => {
        const label = truncate(ctx, seriesLabel(group), maxWidth - 12);
        const width = 12 + ctx.measureText(label).width + 16;
        if (cursor > 0 && cursor + width > maxWidth) {
            lines.push([]);
            cursor = 0;
        }
        lines[lines.length - 1].push({ label, index });
        cursor += width;
    });
    return lines;
}

export interface ChartExportOptions {
    artifact: ChartArtifact;
    /** The rows the plot drew, which may be fewer than the chart has. */
    points: ChartPoint[];
    /** How many points exist in total, so the image can say what it left out. */
    total?: number;
    /** Whether those rows are the largest values or merely the first. */
    ranked?: boolean;
    log: boolean;
    isXY: boolean;
    dark: boolean;
}

export function drawChart({ artifact, points, total, ranked, log, isXY, dark }: ChartExportOptions): HTMLCanvasElement {
    const theme = dark ? DARK : LIGHT;
    const groups = seriesKeys(points);
    const palette = seriesPalette(dark);
    const colorFor = (point: ChartPoint) => {
        const index = point.series ? groups.indexOf(point.series) : -1;
        return index < 0 ? MARK : palette[index % palette.length];
    };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    // Measured before the canvas is sized, because how tall the image has to be
    // depends on how many lines the legend and the labels actually take. Sizing
    // resets the context, so nothing may be drawn until after it.
    const legendLines = groups.length > 1 ? layoutLegend(ctx, groups, WIDTH - PAD * 2) : [];
    const legendBand = legendLines.length * LEGEND_ROW;
    const hasSeries = points.some(point => point.series);
    const row = hasSeries ? ROW_WITH_SERIES : ROW;
    const labelWidth = (WIDTH - PAD * 2) * (hasSeries ? LABEL_COLUMN_WITH_SERIES : LABEL_COLUMN);
    const plotHeight = isXY ? 300 : points.length * row;
    const tickBand = log && !isXY ? 22 : 0;
    const height = PAD + 58 + legendBand + plotHeight + tickBand + 26 + PAD;

    canvas.width = WIDTH * SCALE;
    canvas.height = height * SCALE;
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "middle";

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, WIDTH, height);

    const yLabel = artifact.plan.y.unit
        ? `${artifact.plan.y.label} (${artifact.plan.y.unit})`
        : artifact.plan.y.label;

    ctx.fillStyle = theme.ink;
    ctx.font = font(19, 600);
    ctx.textAlign = "left";
    ctx.fillText(truncate(ctx, artifact.plan.title, WIDTH - PAD * 2), PAD, PAD + 10);

    ctx.fillStyle = theme.muted;
    ctx.font = font(12);
    // The count is the chart's, not the picture's. An image that says "24 data
    // points" when 412 were found misreports the evidence, so the total is what
    // is stated and the shortfall is named alongside it.
    const drawn = total !== undefined && total > points.length
        ? ` · ${ranked ? "top" : "first"} ${points.length} shown`
        : "";
    const found = total ?? points.length;
    const subtitle = `${artifact.plan.chart_type} · ${found} data point${found === 1 ? "" : "s"} from ${artifact.coverage.included_paper_ids.length} of ${artifact.coverage.searched_paper_ids.length} papers${drawn}`;
    ctx.fillText(subtitle, PAD, PAD + 34);

    // A legend is always present for two or more series.
    ctx.font = font(11);
    ctx.textAlign = "left";
    legendLines.forEach((entries, line) => {
        const top = PAD + 52 + line * LEGEND_ROW;
        let cursor = PAD;
        for (const entry of entries) {
            ctx.fillStyle = palette[entry.index % palette.length];
            ctx.fillRect(cursor, top, 8, 8);
            ctx.fillStyle = theme.muted;
            ctx.fillText(entry.label, cursor + 12, top + 4);
            cursor += 12 + ctx.measureText(entry.label).width + 16;
        }
    });

    const top = PAD + 58 + legendBand;

    if (isXY) {
        drawXY(ctx, points, log, theme, top, plotHeight, artifact.plan.chart_type === "line", colorFor);
    } else {
        drawCategorical(ctx, points, log, theme, top, colorFor, row, labelWidth);
    }

    if (log && !isXY) {
        const values = points.map(point => point.value).filter(value => value > 0);
        const ticks = decadeTicks(Math.min(...values), Math.max(...values));
        const trackLeft = PAD + labelWidth + 12;
        const trackRight = WIDTH - PAD - VALUE_COLUMN;
        const span = Math.log10(ticks[ticks.length - 1]) - Math.log10(ticks[0]);
        ctx.fillStyle = theme.muted;
        ctx.font = font(10);
        ctx.textAlign = "center";
        for (const tick of ticks) {
            const fraction = span > 0 ? (Math.log10(tick) - Math.log10(ticks[0])) / span : 0;
            ctx.fillText(compactNumber(tick), trackLeft + (trackRight - trackLeft) * fraction, top + plotHeight + 11);
        }
    }

    ctx.fillStyle = theme.muted;
    ctx.font = font(11);
    ctx.textAlign = "left";
    ctx.fillText(`${yLabel}${log ? " · log scale" : ""}`, PAD, top + plotHeight + tickBand + 14);
    ctx.textAlign = "right";
    ctx.fillText("Every value quoted from a cited paper · Open Paper", WIDTH - PAD, top + plotHeight + tickBand + 14);

    return canvas;
}

function drawCategorical(
    ctx: CanvasRenderingContext2D,
    points: ChartPoint[],
    log: boolean,
    palette: Palette,
    top: number,
    colorFor: (point: ChartPoint) => string,
    row: number,
    labelWidth: number,
): void {
    const trackLeft = PAD + labelWidth + 12;
    const trackRight = WIDTH - PAD - VALUE_COLUMN;
    const trackWidth = trackRight - trackLeft;
    const values = points.map(point => point.value);
    const max = Math.max(...values);
    const positive = values.filter(value => value > 0);
    const ticks = log && positive.length ? decadeTicks(Math.min(...positive), Math.max(...positive)) : [];
    const floor = ticks.length ? ticks[0] : Math.min(...positive, 1);
    const ceiling = ticks.length ? ticks[ticks.length - 1] : max;

    const fraction = (value: number) => {
        if (!log) return max > 0 ? value / max : 0;
        if (value <= 0) return 0;
        const span = Math.log10(ceiling) - Math.log10(floor);
        return span > 0 ? (Math.log10(value) - Math.log10(floor)) / span : 0;
    };

    points.forEach((point, index) => {
        const centre = top + index * row + row / 2;

        ctx.textAlign = "left";
        if (point.series) {
            // Stacked rather than joined by a separator: a category and a paper
            // title on one line only ever truncates to the category plus a few
            // characters of the study, which is the half that identifies it.
            ctx.fillStyle = palette.ink;
            ctx.font = font(12);
            ctx.fillText(truncate(ctx, point.label, labelWidth), PAD, centre - 7);
            // Measured against the gutter rather than pre-capped: the export
            // has far more width here than the sidebar figure does, and a
            // shortened title is only worth showing if it still names a study.
            ctx.fillStyle = palette.muted;
            ctx.font = font(11);
            ctx.fillText(truncate(ctx, point.series, labelWidth), PAD, centre + 7);
        } else {
            ctx.fillStyle = palette.muted;
            ctx.font = font(12);
            ctx.fillText(truncate(ctx, point.label, labelWidth), PAD, centre);
        }

        if (log) {
            ctx.strokeStyle = palette.border;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(trackLeft, centre);
            ctx.lineTo(trackRight, centre);
            ctx.stroke();
            ctx.fillStyle = colorFor(point);
            ctx.beginPath();
            ctx.arc(trackLeft + trackWidth * fraction(point.value), centre, 5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 4px rounded data-end, square against the baseline.
            const width = Math.max(trackWidth * fraction(point.value), 2);
            ctx.fillStyle = colorFor(point);
            if (typeof ctx.roundRect === "function") {
                ctx.beginPath();
                ctx.roundRect(trackLeft, centre - 8, width, 16, [0, 4, 4, 0]);
                ctx.fill();
            } else {
                ctx.fillRect(trackLeft, centre - 8, width, 16);
            }
        }

        ctx.fillStyle = palette.ink;
        ctx.font = font(12);
        ctx.textAlign = "right";
        ctx.fillText(compactNumber(point.value), WIDTH - PAD, centre);
    });
}

function drawXY(
    ctx: CanvasRenderingContext2D,
    points: ChartPoint[],
    log: boolean,
    palette: Palette,
    top: number,
    plotHeight: number,
    line: boolean,
    colorFor: (point: ChartPoint) => string,
): void {
    const left = PAD + 52;
    const right = WIDTH - PAD;
    const bottom = top + plotHeight - 26;
    // Series first so each one is a contiguous run to stroke.
    const ordered = [...points].sort((a, b) =>
        (a.series ?? "").localeCompare(b.series ?? "") || (a.x ?? 0) - (b.x ?? 0),
    );
    const ys = ordered.map(point => point.value);
    const xs = ordered.map(point => point.x ?? 0);
    const positive = ys.filter(value => value > 0);
    const yFloor = log && positive.length ? 10 ** Math.floor(Math.log10(Math.min(...positive))) : 0;
    const yCeiling = log && positive.length ? 10 ** Math.ceil(Math.log10(Math.max(...ys))) : Math.max(...ys, 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);

    const yFor = (value: number) => {
        if (!log) return bottom - (value / (yCeiling || 1)) * (bottom - top);
        if (value <= 0) return bottom;
        const span = Math.log10(yCeiling) - Math.log10(yFloor);
        return bottom - (span > 0 ? (Math.log10(value) - Math.log10(yFloor)) / span : 0) * (bottom - top);
    };
    const xFor = (value: number) => left + ((value - minX) / (maxX - minX || 1)) * (right - left);

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.fillStyle = palette.muted;
    ctx.font = font(10);
    ctx.textAlign = "right";
    ctx.fillText(compactNumber(yCeiling), left - 8, top + 4);
    ctx.fillText(log ? compactNumber(yFloor) : "0", left - 8, bottom);

    if (line && ordered.length > 1) {
        // One stroke per series: a segment across a series boundary would draw
        // a trend between two papers that never measured each other.
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ordered.forEach((point, index) => {
            const previous = index > 0 ? ordered[index - 1] : null;
            if (!previous || previous.series !== point.series) {
                if (previous) ctx.stroke();
                ctx.strokeStyle = point.series ? colorFor(point) : MARK;
                ctx.beginPath();
                ctx.moveTo(xFor(point.x ?? 0), yFor(point.value));
                return;
            }
            ctx.lineTo(xFor(point.x ?? 0), yFor(point.value));
        });
        ctx.stroke();
    }

    for (const point of ordered) {
        ctx.fillStyle = colorFor(point);
        ctx.beginPath();
        ctx.arc(xFor(point.x ?? 0), yFor(point.value), 5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = palette.muted;
    ctx.font = font(10);
    ctx.textAlign = "left";
    ctx.fillText(compactNumber(minX), left, bottom + 16);
    ctx.textAlign = "right";
    ctx.fillText(compactNumber(maxX), right, bottom + 16);
}

export function chartFileName(artifact: ChartArtifact): string {
    const slug = artifact.plan.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
    return `${slug || "chart"}.png`;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

export async function downloadChartPng(options: ChartExportOptions): Promise<void> {
    const blob = await toBlob(drawChart(options));
    if (!blob) throw new Error("Could not render the chart image");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = chartFileName(options.artifact);
    link.click();
    URL.revokeObjectURL(url);
}

export async function copyChartPng(options: ChartExportOptions): Promise<void> {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("This browser can't copy images to the clipboard");
    }
    // Safari drops the clipboard permission if the write is awaited behind an
    // async gap, so hand it the promise rather than the resolved blob.
    await navigator.clipboard.write([
        new ClipboardItem({
            "image/png": toBlob(drawChart(options)).then(blob => {
                if (!blob) throw new Error("Could not render the chart image");
                return blob;
            }),
        }),
    ]);
}
