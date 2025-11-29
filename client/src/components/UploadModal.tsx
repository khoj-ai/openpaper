
"use client"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { PdfDropzone } from "@/components/PdfDropzone"
import PdfUploadTracker from "@/components/PdfUploadTracker"
import { MinimalJob } from "@/lib/schema"
import { useState } from "react"
import { uploadFiles, uploadFromUrlWithFallback } from "@/lib/uploadUtils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import LoadingIndicator from "@/components/utils/Loading"

interface UploadModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUploadComplete?: (paperId: string) => void;
}

function UrlImportDialog({
    open,
    onOpenChange,
    onImport,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onImport: (url: string) => void
}) {
    const [url, setUrl] = useState("");

    const handleSubmit = () => {
        if (url) {
            onImport(url);
            onOpenChange(false);
            setUrl("");
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import from URL</DialogTitle>
                    <DialogDescription>
                        Enter the URL of the PDF you want to import.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <Input
                        placeholder="https://arxiv.org/pdf/..."
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    />
                    <Button onClick={handleSubmit}>Import</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function UploadModal({ open, onOpenChange, onUploadComplete }: UploadModalProps) {
    const [jobs, setJobs] = useState<MinimalJob[]>([]);
    const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const UPLOAD_LIMIT = 10;

    const handleFileSelect = async (files: File[]) => {
        setImportError(null);
        if (jobs.length + files.length > UPLOAD_LIMIT) {
            setImportError(`This would exceed the upload limit of ${UPLOAD_LIMIT} files.`);
            return;
        }
        setIsSubmitting(true);
        try {
            const newJobs = await uploadFiles(files);
            setJobs(prevJobs => [...prevJobs, ...newJobs]);
        } finally {
            setIsSubmitting(false);
        }
    }

    const onComplete = (paperId: string) => {
        onUploadComplete?.(paperId);
    }

    const onUrlClick = () => {
        if (jobs.length >= UPLOAD_LIMIT) {
            setImportError(`You have reached the upload limit of ${UPLOAD_LIMIT} files.`);
            return;
        }
        setIsUrlDialogOpen(true);
    }

    const handleUrlImport = async (url: string) => {
        try {
            setImportError(null);
            if (jobs.length >= UPLOAD_LIMIT) {
                setImportError(`You have reached the upload limit of ${UPLOAD_LIMIT} files.`);
                return;
            }
            setIsSubmitting(true);
            const newJob = await uploadFromUrlWithFallback(url);
            setJobs(prevJobs => [...prevJobs, newJob]);
        } catch (error) {
            console.error("Failed to import from URL", error);
            setImportError(
                "Failed to import from URL. Please check the URL and try again."
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Upload Papers</DialogTitle>
                        <DialogDescription>
                            You can click out of this modal while your papers are uploading.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        {isSubmitting ? (
                            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                                <LoadingIndicator />
                                <p className="text-sm text-gray-600 dark:text-gray-400">Processing your papers...</p>
                            </div>
                        ) : (
                            <PdfDropzone
                                onFileSelect={handleFileSelect}
                                onUrlClick={onUrlClick}
                            />
                        )}
                        {importError && (
                            <p className="text-red-500 text-sm mt-2">{importError}</p>
                        )}
                        <PdfUploadTracker initialJobs={jobs} onComplete={onComplete} />
                    </div>
                </DialogContent>
            </Dialog>
            <UrlImportDialog
                open={isUrlDialogOpen}
                onOpenChange={setIsUrlDialogOpen}
                onImport={handleUrlImport}
            />
        </>
    )
}
