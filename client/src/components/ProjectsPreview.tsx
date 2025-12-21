"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFromApi } from "@/lib/api";
import { Project } from "@/lib/schema";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectsPreviewProps {
    limit?: number;
}

import { ProjectCard } from "@/components/ProjectCard";
import { ArrowRight, FolderKanban } from "lucide-react";

function ProjectCardSkeleton() {
    return (
        <div className="flex items-center gap-4 p-4 rounded-xl border border-border/50 bg-card">
            <Skeleton className="w-10 h-10 rounded-lg" />
            <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
            </div>
        </div>
    );
}

export function ProjectsPreview({ limit = 4 }: ProjectsPreviewProps) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const response = await fetchFromApi("/api/projects?detailed=true&limit=3");
                // Sort by updated_at and take top N
                const sorted = (response || [])
                    .sort((a: Project, b: Project) =>
                        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                    )
                    .slice(0, limit);
                setProjects(sorted);
            } catch (error) {
                console.error("Error fetching projects:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProjects();
    }, [limit]);

    if (isLoading) {
        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-24" />
                </div>
                {[...Array(3)].map((_, i) => (
                    <ProjectCardSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (projects.length === 0) {
        return null; // Don't show section if no projects
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FolderKanban className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">Active Projects</h2>
                </div>
                <Link
                    href="/projects"
                    className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                    View all
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
            </div>

            <div className="space-y-2">
                {projects.map((project) => (
                    <ProjectCard key={project.id} project={project} compact={true} />
                ))}
            </div>
        </div>
    );
}
