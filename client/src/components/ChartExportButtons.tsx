"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, Download, Share2 } from "lucide-react";
import { ChartArtifact } from "@/lib/schema";
import { ChartView, plotRows } from "@/components/ChartFigure";
import { copyChartPng, downloadChartPng } from "@/lib/chartExport";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ChartExportButtons({ artifact, view, log, compact = false }: {
    artifact: ChartArtifact;
    view: ChartView;
    log: boolean;
    compact?: boolean;
}) {
    const { darkMode } = useIsDarkMode();
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (view.points.length === 0) return null;

    // Export what is on screen, including the scale the reader chose and the
    // rows the plot actually drew — a canvas tall enough for several hundred
    // rows is one the browser declines to rasterize, and the reader would get a
    // blank image instead of the chart they were looking at.
    const options = {
        artifact,
        points: plotRows(view, "full"),
        total: view.points.length,
        ranked: view.ranked,
        log,
        isXY: view.isXY,
        dark: darkMode,
    };

    const run = async (action: () => Promise<void>, mark?: () => void) => {
        setError(null);
        try {
            await action();
            mark?.();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Export failed");
        }
    };

    const copy = () => run(() => copyChartPng(options), () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    });

    return (
        <div className="flex shrink-0 items-center gap-1">
            {error && !compact && (
                <span className="mr-1 text-xs text-amber-700 dark:text-amber-300">{error}</span>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    {compact ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            title="Export chart"
                            aria-label="Export chart"
                        >
                            {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                            aria-label="Export chart"
                        >
                            {copied ? <Check className="h-3.5 w-3.5" /> : null}
                            {copied ? "Copied" : "Export"}
                            <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                    )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={copy}>
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copy PNG
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => run(() => downloadChartPng(options))}>
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Download PNG
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
