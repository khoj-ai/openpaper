"use client";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { ArrowRight, FileText, Loader2, MessageCircleWarning, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { PdfDropzone } from "@/components/PdfDropzone";
import Link from "next/link";
import EnigmaticLoadingExperience from "@/components/EnigmaticLoadingExperience";
import { PaperItem } from "@/lib/schema";
import PaperCard from "@/components/PaperCard";
import { JobStatusType, JobStatusResponse } from "@/lib/schema";
import { toast } from "sonner";
import { useSubscription, isStorageAtLimit, isPaperUploadAtLimit, isPaperUploadNearLimit, isStorageNearLimit } from "@/hooks/useSubscription";

interface PdfUploadResponse {
	message: string;
	job_id: string;
}

const DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE = "We encountered an error processing your request. Please check the file or URL and try again.";

export default function Home() {
	const [isUploading, setIsUploading] = useState(false);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [jobUploadStatus, setJobUploadStatus] = useState<JobStatusType | null>(null);

	const [pdfUrl, setPdfUrl] = useState("");
	const [relevantPapers, setRelevantPapers] = useState<PaperItem[]>([]);
	const [showErrorAlert, setShowErrorAlert] = useState(false);
	const [errorAlertMessage, setErrorAlertMessage] = useState(DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE);
	const [showPricingOnError, setShowPricingOnError] = useState(false);

	const { user, loading: authLoading } = useAuth();
	const { subscription, loading: subscriptionLoading } = useSubscription();
	const router = useRouter();

	// Toast notifications for subscription limits
	useEffect(() => {
		if (!subscriptionLoading && subscription && user) {
			// Check for at-limit conditions (error styling)
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
			}
			// Check for near-limit conditions (warning styling)
			else if (isStorageNearLimit(subscription)) {
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

	// New state for loading experience
	const [elapsedTime, setElapsedTime] = useState(0);
	const [messageIndex, setMessageIndex] = useState(0);
	const [fileSize, setFileSize] = useState<number | null>(null);
	const [fileLength, setFileLength] = useState<string | null>(null);
	const [displayedMessage, setDisplayedMessage] = useState("");
	const [celeryMessage, setCeleryMessage] = useState<string | null>(null);

	// Ref to access latest celeryMessage value in intervals
	const celeryMessageRef = useRef<string | null>(null);

	// Keep ref in sync with state
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
				// Check if celery message is set using ref
				if (celeryMessageRef.current) {
					// Clear the message timer if celery message is available
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
			// Use celery message if available, otherwise use the cycling message
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

			// Update celery message if available
			if (response.celery_progress_message) {
				setCeleryMessage(response.celery_progress_message);
			}

			if (response.paper_id) {
				// Success - redirect to paper
				const redirectUrl = new URL(`/paper/${response.paper_id}`, window.location.origin);
				redirectUrl.searchParams.append('job_id', jobId);
				setTimeout(() => {
					window.location.href = redirectUrl.toString();
				}, 500);
			} else if (response.status === 'failed') {
				// Failed - show error
				console.error('Upload job failed');
				setShowErrorAlert(true);
				setIsUploading(false);
				setJobUploadStatus(null);
			} else {
				// Still processing - poll again
				setTimeout(() => pollJobStatus(jobId), 2000);
			}
		} catch (error) {
			console.error('Error polling job status:', error);
			setShowErrorAlert(true);
			setIsUploading(false);
		}
	};

	useEffect(() => {
		if (!user) return;

		// Define an async function inside useEffect
		const fetchPapers = async () => {
			try {
				const response = await fetchFromApi("/api/paper/relevant");
				const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
					return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
				});
				setRelevantPapers(sortedPapers);
			} catch (error) {
				console.error("Error fetching papers:", error);
				setRelevantPapers([]);
			}
		}

		// Call the async function
		fetchPapers();
	}, [user]);


	const handleFileUpload = async (files: File[]) => {
		// Handle only the first file if multiple files are selected
		const file = files[0];
		if (!file) return;

		setIsUploading(true);
		setFileSize(file.size);
		setCeleryMessage(null); // Reset celery message

		file.text().then(text => {
			setFileLength(text.length.toString());
		}).catch(err => {
			console.error('Error reading file text:', err);
			setFileLength('lots of');
		});

		const formData = new FormData();
		formData.append('file', file);

		try {
			const response: PdfUploadResponse = await fetchFromApi('/api/paper/upload/', {
				method: 'POST',
				body: formData,
				headers: {
					Accept: 'application/json',
				},
			});

			// Start polling job status
			pollJobStatus(response.job_id);
		} catch (error) {
			console.error('Error uploading file:', error);
			setShowErrorAlert(true);
			setErrorAlertMessage(error instanceof Error ? error.message : DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE);
			if (error instanceof Error && error.message.includes('upgrade') && error.message.includes('upload limit')) {
				setShowPricingOnError(true);
			} else {
				setShowPricingOnError(false);
			}
			setIsUploading(false);
		}
	};

	const handlePdfUrl = async (url: string) => {
		setIsUploading(true);
		setFileSize(null);
		setCeleryMessage(null); // Reset celery message
		try {
			const response = await fetch(url, {
				method: 'GET',
			});

			// Check if the response is OK
			if (!response.ok) throw new Error('Failed to fetch PDF');

			const contentDisposition = response.headers.get('content-disposition');
			const randomFilename = Math.random().toString(36).substring(2, 15) + '.pdf';
			let filename = randomFilename;

			if (contentDisposition && contentDisposition.includes('attachment')) {
				const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
				const matches = filenameRegex.exec(contentDisposition);
				if (matches != null && matches[1]) {
					filename = matches[1].replace(/['"]/g, '');
				}
			} else {
				const urlParts = url.split('/');
				const urlFilename = urlParts[urlParts.length - 1];
				if (urlFilename && urlFilename.toLowerCase().endsWith('.pdf')) {
					filename = urlFilename;
				}
			}

			const blob = await response.blob();
			const file = new File([blob], filename, { type: 'application/pdf' });

			await handleFileUpload([file]); // Pass as array
		} catch (error) {
			console.log('Client-side fetch failed, trying server-side fetch...', error);

			try {
				// Fallback to server-side fetch
				const response: PdfUploadResponse = await fetchFromApi('/api/paper/upload/from-url', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ url }),
				});

				// Start polling job status
				pollJobStatus(response.job_id);

			} catch (serverError) {
				console.error('Both client and server-side fetches failed:', serverError);
				setShowErrorAlert(true);
				setIsUploading(false);
			}
		}
	};

	const handleLinkClick = () => {
		setIsUrlDialogOpen(true);
	};

	const handleDialogConfirm = async () => {
		if (pdfUrl) {
			await handlePdfUrl(pdfUrl);
		}
		setIsUrlDialogOpen(false);
		setPdfUrl("");
	};

	if (authLoading) {
		// Maybe show a loading spinner or skeleton
		return null;
	}

	if (!user && !authLoading) {
		router.push('/home');
		return null;
	}

	return (
		<div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center h-[calc(100vh-64px)] p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
			<main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start w-full max-w-6xl">

				<div className="flex flex-col items-center gap-4 mx-auto">
					{relevantPapers.length > 0 && (
						<Badge asChild variant="outline" className="cursor-pointer bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white hover:text-primary">
							<Link href="/projects" className="flex items-center gap-1">
								<Sparkles className="h-3 w-3" />
								Create a research project
							</Link>
						</Badge>
					)}
					<header className="text-2xl font-bold">
						Open Paper
					</header>
				</div>

				{/* Replace buttons with PdfDropzone */}
				<PdfDropzone
					onFileSelect={handleFileUpload}
					onUrlClick={handleLinkClick}
					maxSizeMb={15} // Set desired max size
				/>

				{/* Section break and header for relevant papers */}
				{
					relevantPapers.length > 0 && (
						<>
							{/* Visual separator */}
							<div className="w-full border-t border-border/40 my-8"></div>

							{/* Jump back in section */}
							<div className="w-full flex items-center justify-between">
								<div className="flex flex-col gap-2">
									<h2 className="text-xl font-semibold">Jump back in</h2>
									<p className="text-sm text-muted-foreground">
										Continue reading your recent papers
									</p>
								</div>
								<Button variant="ghost" size="sm" asChild>
									<Link href="/papers" className="flex items-center gap-2">
										View Library
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</div>

							{/* Papers grid */}
							<div className="w-full space-y-4 pb-4">
								{relevantPapers.map((paper) => (
									<PaperCard
										key={paper.id}
										paper={paper}
										setPaper={(paperId: string, updatedPaper: PaperItem) => {
											// Handle paper update logic here if needed
											setRelevantPapers((prev) =>
												prev.map((p) => (p.id === paperId ? { ...p, ...updatedPaper } : p))
											);
										}}
									/>
								))}
							</div>
						</>
					)
				}

			</main >
			{
				relevantPapers.length === 0 && (
					<footer className="row-start-3 grid gap-[24px] items-center justify-center justify-items-center">
						<p>
							Made with ❤️ in{" "}
							<a
								href="https://github.com/khoj-ai/openpaper"
								target="_blank"
								rel="noopener noreferrer"
								className="underline hover:text-foreground transition-colors"
							>
								San Francisco
							</a>
						</p>
						<Button size="lg" className="w-fit" variant="outline" asChild>
							<Link href="/blog/manifesto">
								<FileText className="h-4 w-4 mr-2" />
								Manifesto
							</Link>
						</Button>
					</footer>
				)
			}

			{
				showErrorAlert && (
					<Dialog open={showErrorAlert} onOpenChange={setShowErrorAlert}>
						<DialogContent>
							<DialogTitle>Upload Failed</DialogTitle>
							<DialogDescription className="space-y-4 inline-flex items-center">
								<MessageCircleWarning className="h-6 w-6 text-slate-500 mr-2 flex-shrink-0" />
								{errorAlertMessage ?? DEFAULT_PAPER_UPLOAD_ERROR_MESSAGE}
							</DialogDescription>
							<div className="flex justify-end mt-4">
								{
									showPricingOnError && (
										<Button variant="default" asChild className="mr-2 bg-blue-500 hover:bg-blue-200 dark:bg-blue-600 dark:hover:bg-blue-700 text-white">
											<Link href="/pricing">Upgrade</Link>
										</Button>
									)
								}
							</div>
						</DialogContent>
					</Dialog>
				)
			}

			{/* Dialog for PDF URL */}
			<Dialog open={isUrlDialogOpen} onOpenChange={setIsUrlDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Import PDF from URL</DialogTitle> {/* Updated Title */}
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
		</div >
	);
}
