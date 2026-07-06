"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { fetchFromApi } from "@/lib/api";
import { AudioOverview } from "@/lib/schema";
import { Button } from "@/components/ui/button";
import { RichAudioOverview } from "@/components/RichAudioOverview";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

// Center-pane view of an audio overview's transcript — same paradigm as data
// tables: artifacts render in the middle, citations open in the reader panel.
export default function ProjectAudioOverviewPage() {
    const params = useParams();
    const router = useRouter();
    const audioId = params.audioId as string;
    const { projectId, papers, openPaper, setCrumb } = useProjectWorkspace();

    const [overview, setOverview] = useState<AudioOverview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchOverview = useCallback(async () => {
        try {
            setIsLoading(true);
            // No single-overview endpoint; the project list carries full objects.
            const overviews: AudioOverview[] = await fetchFromApi(`/api/projects/audio/${projectId}`);
            const match = overviews.find((o) => o.id === audioId);
            if (!match) {
                setError("Audio overview not found.");
                return;
            }
            setOverview(match);
            setError(null);
        } catch (err) {
            console.error("Failed to fetch audio overview:", err);
            setError("Failed to load audio overview. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [projectId, audioId]);

    useEffect(() => {
        fetchOverview();
    }, [fetchOverview]);

    useEffect(() => {
        setCrumb(overview?.title || "Audio Overview");
        return () => setCrumb(null);
    }, [overview?.title, setCrumb]);

    if (isLoading) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    <p className="text-muted-foreground">Loading audio overview...</p>
                </div>
            </div>
        );
    }

    if (error || !overview) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4">
                <p className="text-red-600 dark:text-red-400">{error || "Audio overview not found"}</p>
                <Button variant="outline" onClick={() => router.push(`/projects/${projectId}`)}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Project
                </Button>
            </div>
        );
    }

    return (
        <div className="min-h-0 flex-1 overflow-hidden">
            <div className="mx-auto h-full max-w-4xl">
                <RichAudioOverview
                    audioOverview={overview}
                    papers={papers}
                    onOpenPaperExternal={openPaper}
                />
            </div>
        </div>
    );
}
