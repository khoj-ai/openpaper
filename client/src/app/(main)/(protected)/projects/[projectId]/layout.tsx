"use client";

import { ReactNode } from "react";
import { useParams } from "next/navigation";
import {
    ProjectWorkspaceProvider,
    useProjectWorkspace,
} from "@/components/project/ProjectWorkspaceProvider";
import { ProjectHeader } from "@/components/project/ProjectHeader";
import { ProjectRail } from "@/components/project/ProjectRail";
import { ReaderPanel } from "@/components/project/ReaderPanel";
import { ArtifactsPanel } from "@/components/project/ArtifactsPanel";
import { AddPapersSheet } from "@/components/project/AddPapersSheet";
import PdfUploadTracker from "@/components/PdfUploadTracker";

// Shared workspace shell for every project route: breadcrumb header on top,
// papers + chats rail on the left, route content in the middle, and the
// on-demand reader panel on the right. Reader tabs, the artifacts drawer, and
// in-flight uploads persist across navigation within the project.
function WorkspaceShell({ children }: { children: ReactNode }) {
    const { uploadJobs, refetchPapers } = useProjectWorkspace();

    return (
        <div className="flex h-[calc(100svh-3rem)] flex-col overflow-hidden">
            <ProjectHeader />
            <div className="flex min-h-0 flex-1">
                <aside className="hidden border-r md:flex">
                    <ProjectRail />
                </aside>
                <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    {uploadJobs.length > 0 && (
                        <div className="shrink-0 px-4 pt-3">
                            <PdfUploadTracker initialJobs={uploadJobs} onComplete={refetchPapers} />
                        </div>
                    )}
                    {children}
                </main>
                {/* Right slot: reader and artifacts share it, one visible at a time */}
                <ReaderPanel />
                <ArtifactsPanel />
            </div>
            <AddPapersSheet />
        </div>
    );
}

export default function ProjectWorkspaceLayout({ children }: { children: ReactNode }) {
    const params = useParams();
    const projectId = params.projectId as string;

    return (
        <ProjectWorkspaceProvider projectId={projectId}>
            <WorkspaceShell>{children}</WorkspaceShell>
        </ProjectWorkspaceProvider>
    );
}
