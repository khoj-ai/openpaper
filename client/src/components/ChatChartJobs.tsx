"use client";

import { useEffect, useState } from "react";
import { ChartGenerationJob } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { ChartGenerationJobCard } from "@/components/ChartGenerationJobCard";

/** How often to ask whether a turn's chart has finished.
 *
 * A chart is minutes of work, so this is not a progress bar — it is the answer
 * arriving late. Slower than a spinner deserves, fast enough that a finished
 * chart does not sit unseen. */
const POLL_MS = 10_000;

/** The charts a chat turn asked for, while they are still being built.
 *
 * A chart takes minutes, so the turn it belongs to was answered long before it
 * exists. These cards hold that turn's place: they report progress where the
 * chart will be, and become the chart itself — with its own viewer link — the
 * moment the job completes. */
export function ChatChartJobs({ jobs, projectId, onOpenPaper }: {
    jobs: ChartGenerationJob[];
    projectId: string;
    onOpenPaper: (paperId: string, searchTerm?: string) => void;
}) {
    const [live, setLive] = useState(jobs);

    // Jobs arriving from a reload replace what is held here; a streamed job is
    // appended by the parent and shows up the same way.
    useEffect(() => setLive(jobs), [jobs]);

    const waiting = live.some(job => job.status === "pending" || job.status === "running");

    useEffect(() => {
        if (!waiting) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const response = await fetchFromApi(`/api/projects/charts/jobs/${projectId}`);
                if (cancelled) return;
                const byId = new Map<string, ChartGenerationJob>(
                    (response.jobs ?? []).map((job: ChartGenerationJob) => [job.id, job]),
                );
                // Updated in place, so only this turn's jobs are shown: the
                // project feed carries every chart anyone has asked for, and
                // the rest belong to other turns or to the composer.
                setLive(current => current.map(job => byId.get(job.id) ?? job));
            } catch (error) {
                console.error("Failed to refresh chart jobs:", error);
            }
        };
        const interval = setInterval(tick, POLL_MS);
        tick();
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
        // Deliberately not keyed on `live`: the poll rewrites it, and depending
        // on it would tear down and restart the interval on every tick.
    }, [waiting, projectId]);

    if (live.length === 0) return null;

    return <div className="mt-3 space-y-3">
        {live.map(job => (
            <ChartGenerationJobCard key={job.id} job={job} onOpenPaper={onOpenPaper} />
        ))}
    </div>;
}
