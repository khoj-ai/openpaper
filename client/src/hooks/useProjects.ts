"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchFromApi } from "@/lib/api";
import { Project, PaperItem, Conversation } from "@/lib/schema";

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

interface UseProjectPapersResult {
    papers: PaperItem[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useProjectPapers(projectId?: string): UseProjectPapersResult {
    const [papers, setPapers] = useState<PaperItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchPapers = useCallback(async () => {
        if (!projectId) {
            setPapers([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchFromApi(`/api/projects/papers/${projectId}`);
            setPapers(response.papers || []);
        } catch (err) {
            setError(err instanceof Error ? err : new Error(`Failed to fetch papers for project ${projectId}`));
            console.error(`Error fetching papers for project ${projectId}:`, err);
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        fetchPapers();
    }, [fetchPapers]);

    return {
        papers,
        isLoading,
        error,
        refetch: fetchPapers,
    };
}

interface UseProjectConversationsResult {
    conversations: Conversation[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

export function useProjectConversations(projectId?: string): UseProjectConversationsResult {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchConversations = useCallback(async () => {
        if (!projectId) {
            setConversations([]);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetchFromApi(`/api/projects/conversations/${projectId}`);
            setConversations(response || []);
        } catch (err) {
            setError(err instanceof Error ? err : new Error(`Failed to fetch conversations for project ${projectId}`));
            console.error(`Error fetching conversations for project ${projectId}:`, err);
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    return {
        conversations,
        isLoading,
        error,
        refetch: fetchConversations,
    };
}
