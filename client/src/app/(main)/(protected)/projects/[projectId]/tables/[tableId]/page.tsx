"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DataTableResult } from "@/lib/schema";
import DataTableGenerationView from "@/components/DataTableGenerationView";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchFromApi } from "@/lib/api";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";

export default function DataTablePage() {
    const params = useParams();
    const router = useRouter();
    const tableId = params.tableId as string;
    // Citation clicks open papers in the shared workspace reader panel.
    const { projectId, papers, openPaper, setCrumb } = useProjectWorkspace();

    const [dataTableResult, setDataTableResult] = useState<DataTableResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchDataTableResult = useCallback(async () => {
        try {
            setIsLoading(true);
            const result = await fetchFromApi(`/api/projects/tables/results/${tableId}`);
            setDataTableResult(result.data);
            setError(null);
        } catch (err) {
            console.error("Failed to fetch data table result:", err);
            setError("Failed to load data table. Please try again.");
        } finally {
            setIsLoading(false);
        }
    }, [tableId]);

    useEffect(() => {
        if (tableId) {
            fetchDataTableResult();
        }
    }, [tableId, fetchDataTableResult]);

    useEffect(() => {
        setCrumb(dataTableResult?.title || "Data Table");
        return () => setCrumb(null);
    }, [dataTableResult?.title, setCrumb]);

    const handleCitationClick = (paperId: string, searchTerm: string) => {
        const paper = papers.find(p => p.id === paperId);
        if (paper) {
            openPaper(paper, searchTerm);
        }
    };

    const handleClose = () => {
        router.push(`/projects/${projectId}`);
    };

    if (isLoading) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    <p className="text-muted-foreground">Loading data table...</p>
                </div>
            </div>
        );
    }

    if (error || !dataTableResult) {
        return (
            <div className="flex-1 overflow-y-auto">
                <div className="container mx-auto py-8 px-4 max-w-7xl">
                    <div className="mb-6">
                        <Button
                            variant="ghost"
                            onClick={handleClose}
                            className="mb-4"
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back to Project
                        </Button>
                    </div>
                    <div className="flex items-center justify-center min-h-[400px]">
                        <div className="text-center">
                            <p className="text-red-600 dark:text-red-400 mb-4">
                                {error || "Data table not found"}
                            </p>
                            <Button onClick={handleClose}>
                                Return to Project
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="container mx-auto max-w-7xl px-4 py-6">
                <DataTableGenerationView
                    dataTableResult={dataTableResult}
                    papers={papers}
                    onClose={handleClose}
                    onCitationClick={handleCitationClick}
                    projectId={projectId}
                />
            </div>
        </div>
    );
}
