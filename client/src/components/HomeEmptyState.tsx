"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Globe2, BookOpen, Sparkles, FileText, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadModal } from "@/components/UploadModal";
import Link from "next/link";

interface HomeEmptyStateProps {
    onUploadComplete?: () => void;
    onUploadStart?: (files: File[], onComplete: (paperId: string) => void) => void;
}

export function HomeEmptyState({ onUploadComplete, onUploadStart }: HomeEmptyStateProps) {
    const router = useRouter();
    const [isUploadModalOpen, setUploadModalOpen] = useState(false);

    // Use custom upload handling if provided (for home page experience)
    const useCustomUpload = !!onUploadStart;

    const handleUploadComplete = (paperId: string) => {
        router.push(`/paper/${paperId}`);
        onUploadComplete?.();
    };

    const handleUploadClick = () => {
        if (useCustomUpload) {
            // Trigger file input for custom upload handling
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.pdf';
            input.multiple = false;
            input.onchange = (e) => {
                const files = Array.from((e.target as HTMLInputElement).files || []);
                if (files.length > 0 && onUploadStart) {
                    onUploadStart(files, handleUploadComplete);
                }
            };
            input.click();
        } else {
            setUploadModalOpen(true);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center max-w-2xl mx-auto">
            {/* Floating Icon Group */}
            <div className="relative mb-8">
                <div className="relative w-32 h-32 mx-auto">
                    {/* Background gradient circle */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-primary/5 to-transparent rounded-full blur-2xl" />

                    {/* Main icon container */}
                    <div className="relative w-full h-full bg-gradient-to-br from-blue-500/5 to-primary/10 dark:from-blue-500/10 dark:to-primary/20 rounded-2xl flex items-center justify-center border border-blue-500/10 shadow-sm">
                        <BookOpen className="w-14 h-14 text-primary" strokeWidth={1.5} />
                    </div>

                    {/* Floating accent icons */}
                    <div className="absolute -top-2 -right-2 w-12 h-12 bg-background dark:bg-card rounded-xl flex items-center justify-center border border-blue-500/20 shadow-md">
                        <Sparkles className="w-6 h-6 text-blue-500" strokeWidth={2} />
                    </div>
                    <div className="absolute -bottom-1 -left-2 w-10 h-10 bg-background dark:bg-card rounded-lg flex items-center justify-center border border-border shadow-md">
                        <FileText className="w-5 h-5 text-muted-foreground" strokeWidth={2} />
                    </div>
                </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground mb-3">
                Welcome to Open Paper
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md">
                Your AI-powered research companion. Upload papers to get AI-generated summaries,
                chat with your documents, and organize your research into projects.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                <Button
                    size="lg"
                    className="flex-1 bg-primary hover:bg-primary/90"
                    onClick={handleUploadClick}
                >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload your first paper
                </Button>
                <Button
                    size="lg"
                    variant="outline"
                    className="flex-1"
                    asChild
                >
                    <Link href="/finder">
                        <Globe2 className="h-4 w-4 mr-2" />
                        Find papers
                    </Link>
                </Button>
            </div>

            {/* Feature highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-12 w-full max-w-lg">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-500/10 text-blue-500 mb-2">
                        <Sparkles className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">AI Summaries</p>
                    <p className="text-xs text-muted-foreground">Instant paper insights</p>
                </div>
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 text-primary mb-2">
                        <FolderKanban className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Projects</p>
                    <p className="text-xs text-muted-foreground">Organize research</p>
                </div>
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-green-500/10 text-green-500 mb-2">
                        <BookOpen className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium">Chat</p>
                    <p className="text-xs text-muted-foreground">Ask questions</p>
                </div>
            </div>

            {/* Link to manifesto */}
            <div className="mt-12 pt-8 border-t border-border/50 w-full">
                <p className="text-sm text-muted-foreground">
                    Curious about our mission?{" "}
                    <Link href="/blog/manifesto" className="text-primary hover:underline">
                        Read the manifesto →
                    </Link>
                </p>
            </div>

            {!useCustomUpload && (
                <UploadModal
                    open={isUploadModalOpen}
                    onOpenChange={setUploadModalOpen}
                    onUploadComplete={handleUploadComplete}
                />
            )}
        </div>
    );
}
