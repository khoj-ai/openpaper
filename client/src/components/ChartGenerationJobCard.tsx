"use client";

import { BarChart3, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { ChartGenerationJob } from "@/lib/schema";
import { ChartArtifactCard } from "@/components/ChartArtifactCard";
import { MessageTraceViewer } from "@/components/MessageTraceViewer";

export function ChartGenerationJobCard({ job, onOpenPaper }: {
    job: ChartGenerationJob;
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
}) {
    const pending = job.status === "pending" || job.status === "running";
    if (job.artifact) {
        return <ChartArtifactCard
            artifact={job.artifact}
            onOpenPaper={onOpenPaper}
            detailHref={job.artifact_id ? `/projects/${job.project_id}/charts/${job.artifact_id}` : undefined}
        />;
    }
    return <section className="rounded-lg border bg-card p-3 text-card-foreground">
        <div className="flex items-center gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : job.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-amber-600" />}
            <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold">Chart</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
            {job.status_message || (pending ? "Preparing chart generation" : "Chart generation finished")}
        </p>
        {job.error_message && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{job.error_message}</p>}
        {job.trace && <div className="mt-2"><MessageTraceViewer trace={job.trace} /></div>}
    </section>;
}
