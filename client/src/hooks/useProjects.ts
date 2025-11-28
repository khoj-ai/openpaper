"use client";

import { useState, useEffect } from "react";
import { fetchFromApi } from "@/lib/api";
import { Project } from "@/lib/schema";

interface UseProjectsResult {
    projects: Project[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useProjects(): UseProjectsResult {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchProjects = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchFromApi("/api/projects");
            setProjects(response || []);
        } catch (err) {
            setError(err instanceof Error ? err : new Error("Failed to fetch projects"));
            console.error("Error fetching projects:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    return {
        projects,
        isLoading,
        error,
        refetch: fetchProjects,
    };
}
