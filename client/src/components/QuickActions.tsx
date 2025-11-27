"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FolderPlus, Globe2, Sparkles } from "lucide-react";
import { UploadModal } from "@/components/UploadModal";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { fetchFromApi } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QuickActionCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    variant?: "default" | "primary";
    badge?: string;
}

function QuickActionCard({ icon, title, description, onClick, variant = "default", badge }: QuickActionCardProps) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "group relative flex flex-col items-start gap-3 p-5 rounded-xl border-2 transition-all duration-200 text-left w-full",
                "hover:shadow-md hover:-translate-y-0.5",
                variant === "primary"
                    ? "border-primary/20 bg-primary/5 hover:border-primary/40 hover:bg-primary/10"
                    : "border-border/50 bg-card hover:border-border hover:bg-accent/50"
            )}
        >
            {badge && (
                <span className="absolute top-3 right-3 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    {badge}
                </span>
            )}
            <div className={cn(
                "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
                variant === "primary"
                    ? "bg-primary/10 text-primary group-hover:bg-primary/20"
                    : "bg-muted text-muted-foreground group-hover:bg-accent group-hover:text-foreground"
            )}>
                {icon}
            </div>
            <div>
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            </div>
        </button>
    );
}

interface QuickActionsProps {
    onUploadComplete?: () => void;
    onProjectCreated?: () => void;
}

export function QuickActions({ onUploadComplete, onProjectCreated }: QuickActionsProps) {
    const router = useRouter();
    const [isUploadModalOpen, setUploadModalOpen] = useState(false);
    const [isCreateProjectOpen, setCreateProjectOpen] = useState(false);

    const handleUploadComplete = (paperId: string) => {
        router.push(`/paper/${paperId}`);
        onUploadComplete?.();
    };

    const handleCreateProject = async (title: string, description: string) => {
        try {
            const response = await fetchFromApi("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, description }),
            });

            if (response?.id) {
                toast.success("Project created successfully!");
                setCreateProjectOpen(false);
                router.push(`/project/${response.id}`);
                onProjectCreated?.();
            }
        } catch (error) {
            console.error("Error creating project:", error);
            toast.error("Failed to create project. Please try again.");
        }
    };

    const handleFindPapers = () => {
        router.push("/finder");
    };

    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                <QuickActionCard
                    icon={<Upload className="h-5 w-5" />}
                    title="Upload Paper"
                    description="Add a PDF to your library"
                    onClick={() => setUploadModalOpen(true)}
                    variant="primary"
                />
                <QuickActionCard
                    icon={<FolderPlus className="h-5 w-5" />}
                    title="New Project"
                    description="Organize your research"
                    onClick={() => setCreateProjectOpen(true)}
                    badge="New"
                />
                <QuickActionCard
                    icon={<Globe2 className="h-5 w-5" />}
                    title="Find Papers"
                    description="Search academic databases"
                    onClick={handleFindPapers}
                />
            </div>

            <UploadModal
                open={isUploadModalOpen}
                onOpenChange={setUploadModalOpen}
                onUploadComplete={handleUploadComplete}
            />

            <CreateProjectDialog
                open={isCreateProjectOpen}
                onOpenChange={setCreateProjectOpen}
                onSubmit={handleCreateProject}
            />
        </>
    );
}
