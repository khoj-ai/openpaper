"use client";

import {
    Project,
} from '@/lib/schema';
import {
    Loader,
    ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from "sonner";
import { fetchFromApi, getProjectsForPaper } from '@/lib/api';
import { useSubscription, isProjectAtLimit } from '@/hooks/useSubscription';
import { Button } from './ui/button';
import { CreateProjectDialog } from '@/components/CreateProjectDialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ProjectCard } from './ProjectCard';

interface PaperProjectsProps {
    id: string;
    view?: 'full' | 'compact';
}

export function PaperProjects({ id, view = 'full' }: PaperProjectsProps) {
    const [projects, setProjects] = useState<Project[]>([]);
    const [allProjects, setAllProjects] = useState<Project[]>([]);
    const [isLoadingProjects, setIsLoadingProjects] = useState(false);
    const [addingToProjectId, setAddingToProjectId] = useState<string | null>(null);
    const [isCreateProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
    const [isProjectLimitDialogOpen, setProjectLimitDialogOpen] = useState(false);
    const { subscription } = useSubscription();
    const router = useRouter();

    useEffect(() => {
        if (id) {
            setIsLoadingProjects(true);
            Promise.all([
                getProjectsForPaper(id),
                fetchFromApi("/api/projects?detailed=true"),
            ]).then(([paperProjects, allProjs]) => {
                setProjects(paperProjects || []);
                setAllProjects(allProjs || []);
            }).catch(err => {
                console.error("Error fetching projects", err);
                toast.error("Error fetching projects");
            }).finally(() => {
                setIsLoadingProjects(false);
            });
        }
    }, [id]);

    const handleUnlink = async (projectId: string) => {
        try {
            await fetchFromApi(`/api/projects/papers/${projectId}/${id}`, {
                method: 'DELETE',
            });
            toast.success("Paper unlinked from project successfully!");
            setProjects(prevProjects => prevProjects.filter(p => p.id !== projectId));
        } catch (error) {
            console.error("Failed to unlink paper from project", error);
            toast.error("Failed to unlink paper from project.");
        }
    };

    const handleAddPaperToProject = async (projectId: string) => {
        setAddingToProjectId(projectId);
        try {
            await fetchFromApi(`/api/projects/papers/${projectId}`, {
                method: 'POST',
                body: JSON.stringify({ paper_ids: [id] })
            });
            toast.success("Paper added to project successfully!");

            const projectToAdd = allProjects.find(p => p.id === projectId);
            if (projectToAdd && !projects.some(p => p.id === projectId)) {
                setProjects(prev => [...prev, projectToAdd]);
            }
        } catch (error) {
            console.error("Failed to add paper to project", error);
            toast.error("Failed to add paper to project.");
        } finally {
            setAddingToProjectId(null);
        }
    };

    const handleCreateProjectSubmit = async (title: string, description: string) => {
        try {
            const project = await fetchFromApi("/api/projects", {
                method: "POST",
                body: JSON.stringify({ title, description }),
            });
            toast.success("Project created successfully!");

            await fetchFromApi(`/api/projects/papers/${project.id}`,
                {
                    method: 'POST',
                    body: JSON.stringify({ paper_ids: [id] })
                });
            toast.success("Paper added to project successfully!");


            router.push(`/projects/${project.id}`);
        } catch (error) {
            console.error("Failed to create project", error);
            toast.error("Failed to create project.");
        } finally {
            setCreateProjectDialogOpen(false);
        }
    };

    const projectsToAdd = allProjects.filter(p => !projects.some(pp => pp.id === p.id));

    if (view === 'compact' && !isLoadingProjects && projects.length === 0) {
        return null;
    }

    return (
        <div className="space-y-4">
            {view === 'full' && (
                <>
                    <AlertDialog open={isProjectLimitDialogOpen} onOpenChange={setProjectLimitDialogOpen}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>You&apos;re on a roll!</AlertDialogTitle>
                                <AlertDialogDescription>
                                    You&apos;ve created a lot of great projects. To create more, please upgrade your plan.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <Link href="/pricing">
                                    <AlertDialogAction>Upgrade</AlertDialogAction>
                                </Link>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                    <CreateProjectDialog
                        open={isCreateProjectDialogOpen}
                        onOpenChange={setCreateProjectDialogOpen}
                        onSubmit={handleCreateProjectSubmit}
                    />
                </>
            )}
            {isLoadingProjects ? (
                <div className="flex items-center justify-center py-4">
                    <Loader className="animate-spin mr-2 h-4 w-4" />
                </div>
            ) : projects.length > 0 ? (
                <>
                    <h3 className="text-lg font-semibold">Projects</h3>
                    {view === 'full' && <p className="text-sm text-muted-foreground">This paper is a member of the following projects.</p>}
                    <div className="space-y-2">
                        {projects.map(project => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                onUnlink={() => handleUnlink(project.id)}
                            />
                        ))}
                    </div>
                </>
            ) : (
                <>
                    {view === 'full' && (
                        <div className="text-left">
                            <p className="text-sm text-muted-foreground">Projects help you organize your research. Group papers together to analyze them as a collection.
                            </p>
                            <Link href="/projects" className="block underline">View all projects{" "} <ArrowRight className='inline w-4 h-4' /></Link>
                            <Button
                                onClick={() => {
                                    if (isProjectAtLimit(subscription)) {
                                        setProjectLimitDialogOpen(true);
                                    } else {
                                        setCreateProjectDialogOpen(true);
                                    }
                                }}
                                className="mt-4 w-full"
                            >
                                Create a Project with this Paper
                            </Button>
                        </div>
                    )}
                </>
            )}
            {view === 'full' && projectsToAdd.length > 0 && (
                <div className="pt-4 mt-4 border-t">
                    <h3 className="text-lg font-semibold mb-2">Add to Projects</h3>
                    {isLoadingProjects ? (
                        <div className="flex items-center justify-center py-4">
                            <Loader className="animate-spin mr-2 h-4 w-4" />
                        </div>
                    ) : projectsToAdd.length > 0 ? (
                        <div className="space-y-2">
                            {projectsToAdd.map(project => (
                                <div key={project.id} className="flex items-center justify-between p-2 border rounded-md">
                                    <div className='pr-2'>
                                        <div className="font-semibold">{project.title}</div>
                                        {project.description && <div className="text-sm text-muted-foreground">{project.description}</div>}
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleAddPaperToProject(project.id)}
                                        disabled={addingToProjectId === project.id}
                                        className="flex-shrink-0"
                                    >
                                        {addingToProjectId === project.id ? (
                                            <Loader className="animate-spin h-4 w-4" />
                                        ) : (
                                            "Add"
                                        )}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">This paper has been added to all available projects.</p>
                    )}
                </div>
            )}
        </div>
    )
}
