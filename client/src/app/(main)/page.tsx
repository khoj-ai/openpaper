"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchFromApi } from "@/lib/api";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, MessageCircleWarning, BookOpen, File } from "lucide-react";
import { useAuth } from "@/lib/auth";
import Link from "next/link";
import EnigmaticLoadingExperience from "@/components/EnigmaticLoadingExperience";
import { PaperItem, JobStatusType, JobStatusResponse, Project } from "@/lib/schema";
import { toast } from "sonner";
import { useSubscription, isStorageAtLimit, isPaperUploadAtLimit, isPaperUploadNearLimit, isStorageNearLimit } from "@/hooks/useSubscription";
import { uploadFromUrlWithFallback } from "@/lib/uploadUtils";

// New components for redesigned home
import { HomeSearch } from "@/components/HomeSearch";
import { QuickActions } from "@/components/QuickActions";
import { ProjectsPreview } from "@/components/ProjectsPreview";
import { RecentPapersGrid } from "@/components/RecentPapersGrid";
import { HomeEmptyState } from "@/components/HomeEmptyState";

const DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE = "We encountered an error processing your request. Please check the file or URL and try again.";

export default function Home() {
	const [isUploading, setIsUploading] = useState(false);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [jobUploadStatus, setJobUploadStatus] = useState<JobStatusType | null>(null);

	const [pdfUrl, setPdfUrl] = useState("");
	const [relevantPapers, setRelevantPapers] = useState<PaperItem[]>([]);
	const [projects, setProjects] = useState<Project[]>([]);
	const [isLoadingData, setIsLoadingData] = useState(true);
	const [showErrorAlert, setShowErrorAlert] = useState(false);
	const [errorAlertMessage, setErrorAlertMessage] = useState(DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE);
	const [showPricingOnError, setShowPricingOnError] = useState(false);

	const { user, loading: authLoading } = useAuth();
	const { subscription, loading: subscriptionLoading } = useSubscription();
	const router = useRouter();

	// Toast notifications for subscription limits
	useEffect(() => {
		if (!subscriptionLoading && subscription && user) {
			if (isStorageAtLimit(subscription)) {
				toast.error("Storage limit reached", {
					description: "You've reached your storage limit. Please upgrade your plan or delete some papers to continue.",
					action: {
						label: "Upgrade",
						onClick: () => window.location.href = "/pricing"
					},
				});
			} else if (isPaperUploadAtLimit(subscription)) {
				toast.error("Upload limit reached", {
					description: "You've reached your paper upload limit for this month. Please upgrade your plan to upload more papers.",
					action: {
						label: "Upgrade",
						onClick: () => window.location.href = "/pricing"
					},
				});
			} else if (isStorageNearLimit(subscription)) {
				toast.warning("Storage nearly full", {
					description: "You're approaching your storage limit. Consider upgrading your plan or managing your papers.",
					action: {
						label: "Plans",
						onClick: () => window.location.href = "/pricing"
					},
				});
			} else if (isPaperUploadNearLimit(subscription)) {
				toast.warning("Upload limit approaching", {
					description: "You're approaching your monthly paper upload limit. Consider upgrading your plan.",
					action: {
						label: "Plans",
						onClick: () => window.location.href = "/pricing"
					},
				});
			}
		}
	}, [subscription, subscriptionLoading, user]);

	// Loading experience state
	const [elapsedTime, setElapsedTime] = useState(0);
	const [messageIndex, setMessageIndex] = useState(0);
	const [fileSize, setFileSize] = useState<number | null>(null);
	const [fileLength, setFileLength] = useState<string | null>(null);
	const [displayedMessage, setDisplayedMessage] = useState("");
	const [celeryMessage, setCeleryMessage] = useState<string | null>(null);

	const celeryMessageRef = useRef<string | null>(null);

	useEffect(() => {
		celeryMessageRef.current = celeryMessage;
	}, [celeryMessage]);

	const loadingMessages = useMemo(() => [
		`Processing ${fileLength ? fileLength : 'lots of'} characters`,
		`Processing ${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'mb' : '...'} `,
		"Uploading to the cloud",
		"Extracting metadata",
		"Crafting grounded citations",
	], [fileLength, fileSize]);

	// Effect for timer and message cycling
	useEffect(() => {
		let timer: NodeJS.Timeout | undefined;
		let messageTimer: NodeJS.Timeout | undefined;

		if (isUploading) {
			setElapsedTime(0);
			setMessageIndex(0);

			timer = setInterval(() => {
				setElapsedTime((prevTime) => prevTime + 1);
			}, 1000);

			messageTimer = setInterval(() => {
				if (celeryMessageRef.current) {
					if (messageTimer) {
						clearInterval(messageTimer);
						messageTimer = undefined;
					}
					return;
				}

				setMessageIndex((prevIndex) => {
					if (prevIndex < loadingMessages.length - 1) {
						return prevIndex + 1;
					}
					return prevIndex;
				});
			}, 8000);
		}

		return () => {
			if (timer) clearInterval(timer);
			if (messageTimer) clearInterval(messageTimer);
		};
	}, [isUploading, fileSize, loadingMessages]);

	// Typewriter effect
	useEffect(() => {
		setDisplayedMessage("");
		let i = 0;
		const typingTimer = setInterval(() => {
			const currentMessage = celeryMessage || loadingMessages[messageIndex];
			if (i < currentMessage.length) {
				setDisplayedMessage(currentMessage.slice(0, i + 1));
				i++;
			} else {
				clearInterval(typingTimer);
			}
		}, 50);

		return () => clearInterval(typingTimer);
	}, [messageIndex, loadingMessages, celeryMessage]);

	// Poll job status
	const pollJobStatus = async (jobId: string) => {
		try {
			const response: JobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${jobId}`);
			setJobUploadStatus(response.status);

			if (response.celery_progress_message) {
				setCeleryMessage(response.celery_progress_message);
			}

			if (response.paper_id) {
				const redirectUrl = new URL(`/paper/${response.paper_id}`, window.location.origin);
				redirectUrl.searchParams.append('job_id', jobId);
				setTimeout(() => {
					window.location.href = redirectUrl.toString();
				}, 500);
			} else if (response.status === 'failed') {
				console.error('Upload job failed');
				setShowErrorAlert(true);
				setIsUploading(false);
				setJobUploadStatus(null);
			} else {
				setTimeout(() => pollJobStatus(jobId), 2000);
			}
		} catch (error) {
			console.error('Error polling job status:', error);
			setShowErrorAlert(true);
			setIsUploading(false);
		}
	};

	// Fetch papers and projects
	useEffect(() => {
		if (!user) return;

		const fetchData = async () => {
			setIsLoadingData(true);
			try {
				const [papersResponse, projectsResponse] = await Promise.all([
					fetchFromApi("/api/paper/relevant"),
					fetchFromApi("/api/projects?detailed=true")
				]);
				setRelevantPapers(papersResponse?.papers || []);
				setProjects(projectsResponse || []);
			} catch (error) {
				console.error("Error fetching data:", error);
				setRelevantPapers([]);
				setProjects([]);
			} finally {
				setIsLoadingData(false);
			}
		};

		fetchData();
	}, [user]);

	const refreshData = async () => {
		if (!user) return;
		try {
			const [papersResponse, projectsResponse] = await Promise.all([
				fetchFromApi("/api/paper/relevant"),
				fetchFromApi("/api/projects?detailed=true")
			]);
			setRelevantPapers(papersResponse?.papers || []);
			setProjects(projectsResponse || []);
		} catch (error) {
			console.error("Error refreshing data:", error);
		}
	};

	if (authLoading) {
		return null;
	}

	if (!user && !authLoading) {
		router.push('/home');
		return null;
	}

	const hasContent = relevantPapers.length > 0 || projects.length > 0;

	return (
		<div className="min-h-[calc(100vh-64px)] bg-gradient-to-b from-background to-muted/20 flex flex-col">
			<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 flex-1 w-full">
				{/* Header with branding and search */}
				<header className="mb-10">
					<div className="flex flex-col items-center gap-6">
						{/* Logo and Branding */}
						<div className="flex items-center gap-3">
							<div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100">
								<File className="h-4 w-4 text-blue-500" />
							</div>
							<h1 className="text-2xl font-bold tracking-tight">Open Paper</h1>
						</div>

						{/* Search Bar */}
						<HomeSearch />
					</div>
				</header>

				{/* Main Content */}
				{!isLoadingData && !hasContent ? (
					<HomeEmptyState onUploadComplete={refreshData} />
				) : (
					<div className="space-y-12">
						{/* Quick Actions */}
						<section>
							<QuickActions
								onUploadComplete={refreshData}
								onProjectCreated={refreshData}
							/>
						</section>

						{/* Two Column Layout for Projects and Papers */}
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
							{/* Projects Section */}
							<section>
								<ProjectsPreview limit={4} />
							</section>

							{/* Recent Papers Section */}
							<section>
								<RecentPapersGrid papers={relevantPapers} limit={4} />
							</section>
						</div>
					</div>
				)}
			</div>

			{/* Footer */}
			<footer className="mt-auto border-t border-border/40">
				<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
						<div className="flex items-center gap-4">
							<Link href="/blog/manifesto" className="hover:text-foreground transition-colors">
								Manifesto
							</Link>
							<Link href="/about" className="hover:text-foreground transition-colors">
								About
							</Link>
							<a
								href="https://github.com/khoj-ai/openpaper"
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-foreground transition-colors"
							>
								GitHub
							</a>
						</div>
						<p>
							Made with ❤️
						</p>
					</div>
				</div>
			</footer>

			{/* Error Dialog */}
			{showErrorAlert && (
				<Dialog open={showErrorAlert} onOpenChange={setShowErrorAlert}>
					<DialogContent>
						<DialogTitle>Upload Failed</DialogTitle>
						<DialogDescription className="space-y-4 inline-flex items-center">
							<MessageCircleWarning className="h-6 w-6 text-slate-500 mr-2 flex-shrink-0" />
							{errorAlertMessage ?? DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE}
						</DialogDescription>
						<div className="flex justify-end mt-4">
							{showPricingOnError && (
								<Button variant="default" asChild className="mr-2 bg-blue-500 hover:bg-blue-200 dark:bg-blue-600 dark:hover:bg-blue-700 text-white">
									<Link href="/pricing">Upgrade</Link>
								</Button>
							)}
						</div>
					</DialogContent>
				</Dialog>
			)}

			{/* URL Import Dialog */}
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
						<Button
							onClick={async () => {
								if (pdfUrl) {
									setIsUploading(true);
									setFileSize(null);
									setCeleryMessage(null);
									setIsUrlDialogOpen(false);

									try {
										const job = await uploadFromUrlWithFallback(pdfUrl);
										pollJobStatus(job.jobId);
									} catch (error) {
										console.error('Error uploading from URL:', error);
										setShowErrorAlert(true);
										setErrorAlertMessage(error instanceof Error ? error.message : DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE);
										if (error instanceof Error && error.message.includes('upgrade') && error.message.includes('upload limit')) {
											setShowPricingOnError(true);
										} else {
											setShowPricingOnError(false);
										}
										setIsUploading(false);
									}
								}
								setPdfUrl("");
							}}
							disabled={!pdfUrl || isUploading}
						>
							{isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
							Submit
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Upload Progress Dialog */}
			<Dialog open={isUploading} onOpenChange={(open) => !open && setIsUploading(false)}>
				<DialogContent
					className="sm:max-w-md"
					hideCloseButton
					onInteractOutside={(e) => {
						e.preventDefault();
					}}>
					<DialogHeader>
						<DialogTitle className="text-center">Processing Your Paper</DialogTitle>
						<DialogDescription className="text-center">
							This might take up to two minutes...
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col items-center justify-center py-8 space-y-6 w-full">
						<EnigmaticLoadingExperience />
						<div className="flex items-center justify-center gap-1 font-mono text-lg w-full">
							<div className="flex items-center gap-1 w-14">
								<Loader2 className="h-6 w-6 animate-spin text-primary" />
								<p className="text-gray-400 w-12">
									{elapsedTime}s
								</p>
							</div>
							<p className="text-primary text-right flex-1">{displayedMessage}</p>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
