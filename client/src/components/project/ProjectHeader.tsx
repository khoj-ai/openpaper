"use client";

import { PanelLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { ProjectCollaborators } from "@/components/ProjectCollaborators";
import { ProjectRail } from "@/components/project/ProjectRail";
import { EditProjectButton } from "@/components/project/EditProjectDialog";
import { useProjectWorkspace } from "@/components/project/ProjectWorkspaceProvider";
import { ProjectRole } from "@/lib/schema";
import { Skeleton } from "@/components/ui/skeleton";

// Compact breadcrumb bar shared by every project route. Navigation lives on
// the left (mobile rail toggle + breadcrumb); project-level actions on the right.
export function ProjectHeader() {
    const {
        projectId,
        project,
        isProjectLoading,
        crumb,
        rightPanel,
        toggleArtifacts,
        railCollapsed,
        toggleRail,
        setHasCollaborators,
    } = useProjectWorkspace();
    const [isMobileRailOpen, setIsMobileRailOpen] = useState(false);

    return (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-4">
            {/* Mobile: papers + chats rail lives behind a toggle */}
            <Sheet open={isMobileRailOpen} onOpenChange={setIsMobileRailOpen}>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" aria-label="Open project navigation">
                        <PanelLeft className="h-4 w-4" />
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0">
                    <SheetHeader className="sr-only">
                        <SheetTitle>Project navigation</SheetTitle>
                    </SheetHeader>
                    <ProjectRail onNavigate={() => setIsMobileRailOpen(false)} />
                </SheetContent>
            </Sheet>
            {/* Desktop: collapse/expand the rail */}
            <Button
                variant="ghost"
                size="icon"
                className="hidden h-7 w-7 md:inline-flex"
                onClick={toggleRail}
                aria-label={railCollapsed ? "Expand project navigation" : "Collapse project navigation"}
                title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
                <PanelLeft className="h-4 w-4" />
            </Button>

            <Breadcrumb className="group/crumb min-w-0 flex-1">
                <BreadcrumbList className="flex-nowrap">
                    <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                            <Link href="/projects">Projects</Link>
                        </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0">
                        {isProjectLoading && !project ? (
                            <Skeleton className="h-4 w-32" />
                        ) : crumb ? (
                            // Client-side Link keeps the workspace mounted, so open
                            // reader tabs survive breadcrumb navigation.
                            <BreadcrumbLink asChild className="truncate">
                                <Link href={`/projects/${projectId}`}>{project?.title}</Link>
                            </BreadcrumbLink>
                        ) : (
                            <BreadcrumbPage className="truncate font-medium">{project?.title}</BreadcrumbPage>
                        )}
                        {project && project.role !== ProjectRole.Viewer && (
                            <EditProjectButton className="ml-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/crumb:opacity-100" />
                        )}
                    </BreadcrumbItem>
                    {crumb && (
                        <>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem className="min-w-0">
                                <BreadcrumbPage className="truncate font-medium">{crumb}</BreadcrumbPage>
                            </BreadcrumbItem>
                        </>
                    )}
                </BreadcrumbList>
            </Breadcrumb>

            <div className="flex shrink-0 items-center gap-2">
                <ProjectCollaborators
                    projectId={projectId}
                    setHasCollaborators={setHasCollaborators}
                    currentUserIsAdmin={project?.role === "admin"}
                />
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        "h-7 gap-1.5 px-2.5 text-xs",
                        rightPanel === "artifacts" && "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/30",
                    )}
                    onClick={toggleArtifacts}
                >
                    <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                    Artifacts
                </Button>
            </div>
        </div>
    );
}
