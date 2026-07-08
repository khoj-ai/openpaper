"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    AlertCircle,
    ArrowLeft,
    BookOpen,
    Info,
    Library,
    Loader2,
    PlusCircle,
    UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { fetchFromApi } from "@/lib/api";
import { MinimalJob } from "@/lib/schema";
import { uploadFromUrlWithFallbackForProject } from "@/lib/uploadUtils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import AddFromLibrary from "@/components/AddFromLibrary";
import { PdfDropzone } from "@/components/PdfDropzone";
import { ZoteroUploadCta } from "@/components/zotero";
import { isPaperUploadAtLimit, useSubscription } from "@/hooks/useSubscription";
import {
    PROJECT_PAPER_HARD_LIMIT,
    PROJECT_PAPER_WARNING_LIMIT,
    useProjectWorkspace,
} from "@/components/project/ProjectWorkspaceProvider";

// The full "add papers to project" flow: choose upload vs. library, drop PDFs,
// import from URL — with per-project and per-plan limit handling. Opened from
// anywhere in the workspace via setAddPapersOpen.
export function AddPapersSheet() {
    const {
        projectId,
        papers,
        refetchPapers,
        addPapersOpen,
        setAddPapersOpen,
        addPapersInitialView,
        addUploadJobs,
    } = useProjectWorkspace();
    const { subscription } = useSubscription();

    const [view, setView] = useState<"initial" | "upload" | "library">("initial");

    // Deep-link: land on the view the opener asked for (upload/library).
    useEffect(() => {
        if (addPapersOpen) {
            setView(addPapersInitialView);
        }
    }, [addPapersOpen, addPapersInitialView]);
    const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
    const [pdfUrl, setPdfUrl] = useState("");
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const currentPaperCount = papers.length;
    const isAtPaperWarningLimit = currentPaperCount >= PROJECT_PAPER_WARNING_LIMIT;
    const isAtPaperHardLimit = currentPaperCount >= PROJECT_PAPER_HARD_LIMIT;
    const remainingPaperSlots = Math.max(0, PROJECT_PAPER_HARD_LIMIT - currentPaperCount);

    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen && isAtPaperHardLimit) {
            toast.error(`This project has reached the maximum of ${PROJECT_PAPER_HARD_LIMIT} papers. Remove some papers before adding more.`);
            return;
        }
        setAddPapersOpen(isOpen);
        if (!isOpen) {
            setView("initial");
        }
    };

    const handleFileSelect = async (files: File[]) => {
        if (isAtPaperHardLimit) {
            toast.error(`This project has reached the maximum of ${PROJECT_PAPER_HARD_LIMIT} papers. Remove some papers before adding more.`);
            return;
        }
        if (isPaperUploadAtLimit(subscription)) {
            setUploadError("You have reached your paper upload limit. Please upgrade your plan to upload more papers.");
            return;
        }
        if (files.length > remainingPaperSlots) {
            toast.error(`You can only add ${remainingPaperSlots} more paper${remainingPaperSlots === 1 ? "" : "s"} to this project (limit: ${PROJECT_PAPER_HARD_LIMIT}).`);
            return;
        }
        setUploadError(null);
        const newJobs: MinimalJob[] = [];
        if (files.length > 0) {
            setAddPapersOpen(false);
        }
        for (const file of files) {
            const formData = new FormData();
            formData.append("file", file);

            try {
                const response = await fetchFromApi(`/api/paper/upload?project_id=${projectId}`, {
                    method: "POST",
                    body: formData,
                });
                newJobs.push({ jobId: response.job_id, fileName: file.name });
            } catch (err) {
                setUploadError(`Failed to upload file: ${file.name}. Please try again.`);
                console.error(err);
            }
        }
        addUploadJobs(newJobs);
    };

    const handlePdfUrl = async (url: string) => {
        if (isAtPaperHardLimit) {
            toast.error(`This project has reached the maximum of ${PROJECT_PAPER_HARD_LIMIT} papers. Remove some papers before adding more.`);
            setIsUrlDialogOpen(false);
            return;
        }
        if (isPaperUploadAtLimit(subscription)) {
            setUploadError("You have reached your paper upload limit. Please upgrade your plan to upload more papers.");
            setIsUrlDialogOpen(false);
            return;
        }
        setIsUploading(true);
        try {
            const job = await uploadFromUrlWithFallbackForProject(url, projectId);
            addUploadJobs([{ jobId: job.jobId, fileName: job.fileName }]);
            setAddPapersOpen(false);
        } catch (serverError) {
            console.error("Both client and server-side fetches failed:", serverError);
            setUploadError(`Failed to upload file from url: ${url}. Please try again.`);
        } finally {
            setIsUploading(false);
            setIsUrlDialogOpen(false);
        }
    };

    const handleDialogConfirm = async () => {
        if (pdfUrl) {
            await handlePdfUrl(pdfUrl);
        }
        setIsUrlDialogOpen(false);
        setPdfUrl("");
    };

    const viewTitle =
        view === "upload" ? "Upload Papers" : view === "library" ? "Add from Library" : "Add Papers";
    const viewDescription =
        view === "upload"
            ? "Uploads go to your library and are added to this project."
            : view === "library"
                ? "Choose from papers already in your library."
                : "Bring papers into this project.";

    return (
        <>
            <Sheet open={addPapersOpen} onOpenChange={handleOpenChange}>
                <SheetContent className="sm:max-w-[90vw]! w-[90vw] overflow-y-auto">
                    <SheetHeader className="border-b px-6 pb-3">
                        <div className="flex items-center gap-2">
                            {view !== "initial" && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="-ml-2 h-7 w-7"
                                    onClick={() => setView("initial")}
                                    aria-label="Back"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </Button>
                            )}
                            <SheetTitle>{viewTitle}</SheetTitle>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {viewDescription}{" "}
                            <span className="text-muted-foreground/70">
                                {currentPaperCount} / {PROJECT_PAPER_HARD_LIMIT} papers in this project.
                            </span>
                        </p>
                    </SheetHeader>
                    <div className="px-6">
                        {/* Limit callout only when it actually matters */}
                        {(isAtPaperHardLimit || isAtPaperWarningLimit) && (
                            <div className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${isAtPaperHardLimit ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300' : 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'}`}>
                                <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                {isAtPaperHardLimit ? (
                                    <p>You&apos;ve reached the maximum of {PROJECT_PAPER_HARD_LIMIT} papers. Remove papers to add more.</p>
                                ) : (
                                    <p>
                                        {remainingPaperSlots} slot{remainingPaperSlots === 1 ? "" : "s"} left. Large paper counts may impact response quality — for higher limits, contact <a href="mailto:saba@openpaper.ai" className="font-medium underline">saba@openpaper.ai</a>
                                    </p>
                                )}
                            </div>
                        )}

                        {view === "initial" && (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <button
                                    onClick={() => setView("upload")}
                                    className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                                >
                                    <div className="relative">
                                        <UploadCloud className="w-12 h-12 text-gray-400 group-hover:text-blue-500 mb-4 transition-colors" />
                                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                            <span className="text-xs font-medium text-blue-600 dark:text-blue-300"><PlusCircle className="h-4 w-4" /></span>
                                        </div>
                                    </div>
                                    <h3 className="text-lg font-semibold group-hover:text-blue-600 transition-colors">Upload New Papers</h3>
                                    <p className="text-sm text-gray-500 text-center mt-1">
                                        Upload PDFs from your computer or URL
                                    </p>
                                    <p className="text-xs mt-2 font-medium">
                                        Drag &amp; drop or browse →
                                    </p>
                                </button>
                                <button
                                    onClick={() => setView("library")}
                                    className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                                >
                                    <div className="relative">
                                        <Library className="w-12 h-12 text-gray-400 group-hover:text-blue-500 mb-4 transition-colors" />
                                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                            <span className="text-xs font-medium text-blue-600 dark:text-blue-300"><BookOpen className="h-4 w-4" /></span>
                                        </div>
                                    </div>
                                    <h3 className="text-lg font-semibold group-hover:text-blue-600 transition-colors">Add from Library</h3>
                                    <p className="text-sm text-gray-500 text-center mt-1">
                                        Choose from papers already in your library
                                    </p>
                                    <p className="text-xs mt-2 font-medium">
                                        Browse existing papers →
                                    </p>
                                </button>
                            </div>
                        )}

                        {view === "upload" && (
                            <div>
                                <PdfDropzone onFileSelect={handleFileSelect} onUrlClick={() => setIsUrlDialogOpen(true)} disabled={isPaperUploadAtLimit(subscription) || isAtPaperHardLimit} />
                                <ZoteroUploadCta className="max-w-lg mx-auto w-full mt-6" />
                                {isPaperUploadAtLimit(subscription) && (
                                    <Alert variant="destructive" className="mt-4">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertTitle>Upload Limit Reached</AlertTitle>
                                        <AlertDescription>
                                            You have reached your paper upload limit. Please{" "}
                                            <Link href="/pricing" className="font-bold underline">
                                                upgrade your plan
                                            </Link>{" "}
                                            to upload more papers.
                                        </AlertDescription>
                                    </Alert>
                                )}
                                {uploadError && <p className="text-red-500 mt-4">{uploadError}</p>}
                            </div>
                        )}

                        {view === "library" && (
                            <AddFromLibrary projectId={projectId} onPapersAdded={refetchPapers} projectPaperIds={papers.map(p => p.id)} onUploadClick={() => setView("upload")} remainingPaperSlots={remainingPaperSlots} paperHardLimit={PROJECT_PAPER_HARD_LIMIT} />
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            <Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Import PDF from URL</DialogTitle>
                        <DialogDescription>
                            Enter the public URL of the PDF you want to upload.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        type="url"
                        placeholder="https://arxiv.org/pdf/1706.03762v7"
                        value={pdfUrl}
                        onChange={(e) => setPdfUrl(e.target.value)}
                        className="mt-4"
                    />
                    <div className="flex justify-end gap-2 mt-4">
                        <Button variant="secondary" onClick={() => setIsUrlDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleDialogConfirm} disabled={!pdfUrl || isUploading}>
                            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Submit
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
