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

interface UseProjectResult {
    project: Project | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useProject(projectId?: string): UseProjectResult {
    const [project, setProject] = useState<Project | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchProject = async () => {
        if (!projectId) {
            setProject(null);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchFromApi(`/api/projects/${projectId}`);
            setProject(response);
        } catch (err) {
            setError(err instanceof Error ? err : new Error(`Failed to fetch project ${projectId}`));
            console.error(`Error fetching project ${projectId}:`, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchProject();
    }, [projectId]);

    return {
        project,
        isLoading,
        error,
        refetch: fetchProject,
    };
}
