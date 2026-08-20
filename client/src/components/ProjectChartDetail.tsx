"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { ChartArtifact } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChartArtifactCard } from "@/components/ChartArtifactCard";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

export function ProjectChartDetail({ artifactId }: { artifactId: string }) {
    const router = useRouter();
    const { projectId, papers, openPaper, setCrumb } = useProjectWorkspace();
    const [artifact, setArtifact] = useState<ChartArtifact | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadArtifact = useCallback(async () => {
        try {
            const response = await fetchFromApi(`/api/projects/artifacts/${projectId}/${artifactId}`);
            setArtifact(response.payload);
            setError(null);
        } catch (err) {
            console.error("Failed to load chart artifact:", err);
            setError("Chart not found.");
        }
    }, [artifactId, projectId]);

    useEffect(() => {
        loadArtifact();
    }, [loadArtifact]);

    useEffect(() => {
        setCrumb(artifact?.plan.title || "Chart");
        return () => setCrumb(null);
    }, [artifact?.plan.title, setCrumb]);

    const openChartPaper = useCallback((paperId: string, searchTerm?: string) => {
        const paper = papers.find((candidate) => candidate.id === paperId);
        if (paper) openPaper(paper, searchTerm ?? null);
    }, [openPaper, papers]);

    if (error) {
        return <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => router.push(`/projects/${projectId}`)}>
                <X className="mr-2 h-4 w-4" />
                Close
            </Button>
        </div>;
    }

    if (!artifact) {
        return <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>;
    }

    return <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
            <Button variant="ghost" size="sm" className="mb-5 -ml-2 text-muted-foreground" onClick={() => router.push(`/projects/${projectId}`)}>
                <X className="mr-1.5 h-4 w-4" />
                Close
            </Button>
            <ChartArtifactCard artifact={artifact} onOpenPaper={openChartPaper} display="full" />
        </div>
    </div>;
}
