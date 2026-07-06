"use client";

import {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { fetchFromApi, getProjectPaperFileUrl } from "@/lib/api";
import { Conversation, MinimalJob, PaperItem, Project } from "@/lib/schema";
import {
    useProject,
    useProjectConversations,
    useProjectPapers,
} from "@/hooks/useProjects";

// Client-side paper limits per project
export const PROJECT_PAPER_WARNING_LIMIT = 75;
export const PROJECT_PAPER_HARD_LIMIT = 100;

// What the right pane is currently showing: paper reader tabs, the artifacts
// panel, or nothing (collapsed).
export type RightPanelMode = "reader" | "artifacts" | null;

interface ProjectWorkspaceValue {
    projectId: string;
    // Shared data — fetched once for all project routes (rail, header, pages).
    project: Project | null;
    isProjectLoading: boolean;
    projectError: Error | null;
    refetchProject: () => Promise<void>;
    papers: PaperItem[];
    isPapersLoading: boolean;
    refetchPapers: () => Promise<void>;
    updatePaper: (paperId: string, patch: Partial<PaperItem>) => void;
    conversations: Conversation[];
    isConversationsLoading: boolean;
    refetchConversations: () => Promise<void>;
    // In-page reader panel (open papers as tabs).
    openPaperIds: string[];
    activePaperId: string | null;
    readerSearchTerm: string | null;
    openPaper: (paper: PaperItem, searchTerm?: string | null) => void;
    activatePaper: (paperId: string) => void;
    closePaper: (paperId: string) => void;
    closeReader: () => void;
    // Fetch a fresh presigned file URL and patch it into the papers list.
    refreshPaperUrl: (paperId: string) => Promise<string | null>;
    // Workspace chrome state.
    crumb: string | null;
    setCrumb: (crumb: string | null) => void;
    rightPanel: RightPanelMode;
    toggleArtifacts: () => void;
    closeArtifacts: () => void;
    railCollapsed: boolean;
    toggleRail: () => void;
    // Reader → chat scoping: the page owning a composer registers a handler;
    // the reader panel calls it to @-scope the chat to the open paper.
    hasChatScopeHandler: boolean;
    setChatScopeHandler: (handler: ((paper: PaperItem) => void) | null) => void;
    requestChatScope: (paper: PaperItem) => void;
    addPapersOpen: boolean;
    setAddPapersOpen: (open: boolean) => void;
    hasCollaborators: boolean;
    setHasCollaborators: (has: boolean) => void;
    // In-flight PDF upload jobs surfaced by PdfUploadTracker in the layout.
    uploadJobs: MinimalJob[];
    addUploadJobs: (jobs: MinimalJob[]) => void;
}

const ProjectWorkspaceContext = createContext<ProjectWorkspaceValue | null>(null);

export function useProjectWorkspace(): ProjectWorkspaceValue {
    const context = useContext(ProjectWorkspaceContext);
    if (!context) {
        throw new Error("useProjectWorkspace must be used within a ProjectWorkspaceProvider");
    }
    return context;
}

interface ProjectWorkspaceProviderProps {
    projectId: string;
    children: ReactNode;
}

export function ProjectWorkspaceProvider({ projectId, children }: ProjectWorkspaceProviderProps) {
    const { project, isLoading: isProjectLoading, error: projectError, refetch: refetchProject } = useProject(projectId);
    const { papers, isLoading: isPapersLoading, refetch: refetchPapers, updatePaper } = useProjectPapers(projectId);
    const { conversations, isLoading: isConversationsLoading, refetch: refetchConversations } = useProjectConversations(projectId);

    const [openPaperIds, setOpenPaperIds] = useState<string[]>([]);
    const [activePaperId, setActivePaperId] = useState<string | null>(null);
    const [readerSearchTerm, setReaderSearchTerm] = useState<string | null>(null);
    const [crumb, setCrumb] = useState<string | null>(null);
    const [rightPanel, setRightPanel] = useState<RightPanelMode>(null);
    // Desktop rail collapse, persisted across sessions.
    const [railCollapsed, setRailCollapsed] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return localStorage.getItem("project-rail-collapsed") === "true";
    });
    const [addPapersOpen, setAddPapersOpen] = useState(false);
    const [hasCollaborators, setHasCollaborators] = useState(false);
    const [uploadJobs, setUploadJobs] = useState<MinimalJob[]>([]);

    const openPaper = useCallback((paper: PaperItem, searchTerm: string | null = null) => {
        setOpenPaperIds((prev) => (prev.includes(paper.id) ? prev : [...prev, paper.id]));
        setActivePaperId(paper.id);
        setReaderSearchTerm(searchTerm);
        setRightPanel("reader");
    }, []);

    const activatePaper = useCallback((paperId: string) => {
        setActivePaperId(paperId);
        // A manual tab switch shouldn't replay a stale citation search.
        setReaderSearchTerm(null);
        setRightPanel("reader");
    }, []);

    const closePaper = useCallback((paperId: string) => {
        setOpenPaperIds((prev) => {
            const next = prev.filter((id) => id !== paperId);
            setActivePaperId((active) => (active === paperId ? (next[next.length - 1] ?? null) : active));
            if (next.length === 0) {
                setRightPanel((mode) => (mode === "reader" ? null : mode));
            }
            return next;
        });
    }, []);

    const closeReader = useCallback(() => {
        setOpenPaperIds([]);
        setActivePaperId(null);
        setReaderSearchTerm(null);
        setRightPanel((mode) => (mode === "reader" ? null : mode));
    }, []);

    const toggleArtifacts = useCallback(() => {
        setRightPanel((mode) => {
            if (mode === "artifacts") {
                // Fall back to the reader when paper tabs are still open.
                return openPaperIds.length > 0 ? "reader" : null;
            }
            return "artifacts";
        });
    }, [openPaperIds.length]);

    const closeArtifacts = useCallback(() => {
        setRightPanel((mode) => {
            if (mode !== "artifacts") return mode;
            return openPaperIds.length > 0 ? "reader" : null;
        });
    }, [openPaperIds.length]);

    const toggleRail = useCallback(() => {
        setRailCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem("project-rail-collapsed", String(next));
            return next;
        });
    }, []);

    const chatScopeHandlerRef = useRef<((paper: PaperItem) => void) | null>(null);
    const [hasChatScopeHandler, setHasChatScopeHandler] = useState(false);

    const setChatScopeHandler = useCallback((handler: ((paper: PaperItem) => void) | null) => {
        chatScopeHandlerRef.current = handler;
        setHasChatScopeHandler(handler !== null);
    }, []);

    const requestChatScope = useCallback((paper: PaperItem) => {
        chatScopeHandlerRef.current?.(paper);
    }, []);

    const refreshPaperUrl = useCallback(async (paperId: string): Promise<string | null> => {
        try {
            const fileUrl = await getProjectPaperFileUrl(projectId, paperId);
            if (fileUrl) {
                updatePaper(paperId, { file_url: fileUrl });
                return fileUrl;
            }
            return null;
        } catch (error) {
            console.error("Error refreshing paper URL:", error);
            return null;
        }
    }, [projectId, updatePaper]);

    const addUploadJobs = useCallback((jobs: MinimalJob[]) => {
        setUploadJobs((prev) => [...prev, ...jobs]);
    }, []);

    // Rehydrate the upload tracker after a refresh: in-flight jobs are
    // otherwise only held in local state and lost on navigation.
    useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        (async () => {
            try {
                const response = await fetchFromApi(`/api/projects/papers/${projectId}/pending-jobs`);
                if (cancelled || !response?.jobs?.length) return;
                const restoredJobs: MinimalJob[] = response.jobs.map((job: { job_id: string; title: string | null }) => ({
                    jobId: job.job_id,
                    fileName: job.title || "Uploading paper…",
                }));
                setUploadJobs((prevJobs) => {
                    const known = new Set(prevJobs.map((j) => j.jobId));
                    const newOnes = restoredJobs.filter((j) => !known.has(j.jobId));
                    return newOnes.length ? [...prevJobs, ...newOnes] : prevJobs;
                });
            } catch (err) {
                console.error("Failed to fetch pending upload jobs for project", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    const value = useMemo<ProjectWorkspaceValue>(() => ({
        projectId,
        project,
        isProjectLoading,
        projectError,
        refetchProject,
        papers,
        isPapersLoading,
        refetchPapers,
        updatePaper,
        conversations,
        isConversationsLoading,
        refetchConversations,
        openPaperIds,
        activePaperId,
        readerSearchTerm,
        openPaper,
        activatePaper,
        closePaper,
        closeReader,
        refreshPaperUrl,
        crumb,
        setCrumb,
        rightPanel,
        toggleArtifacts,
        closeArtifacts,
        railCollapsed,
        toggleRail,
        hasChatScopeHandler,
        setChatScopeHandler,
        requestChatScope,
        addPapersOpen,
        setAddPapersOpen,
        hasCollaborators,
        setHasCollaborators,
        uploadJobs,
        addUploadJobs,
    }), [
        projectId, project, isProjectLoading, projectError, refetchProject,
        papers, isPapersLoading, refetchPapers, updatePaper,
        conversations, isConversationsLoading, refetchConversations,
        openPaperIds, activePaperId, readerSearchTerm,
        openPaper, activatePaper, closePaper, closeReader, refreshPaperUrl,
        crumb, rightPanel, toggleArtifacts, closeArtifacts, railCollapsed, toggleRail,
        hasChatScopeHandler, setChatScopeHandler, requestChatScope, addPapersOpen, hasCollaborators,
        uploadJobs, addUploadJobs,
    ]);

    return (
        <ProjectWorkspaceContext.Provider value={value}>
            {children}
        </ProjectWorkspaceContext.Provider>
    );
}
