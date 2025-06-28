"use client";

import { Button } from "@/components/ui/button";
import { useState, useEffect, useMemo } from "react";
import { fetchFromApi } from "@/lib/api";
import { useIsMobile } from "@/lib/useMobile";;
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileText, Loader2, LucideFileWarning } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PdfDropzone } from "@/components/PdfDropzone";
import Link from "next/link";
import EnigmaticLoadingExperience from "@/components/EnigmaticLoadingExperience";
import { PaperItem } from "@/components/AppSidebar";
import PaperCard from "@/components/PaperCard";
import { JobStatusType } from "@/lib/schema";
import OpenPaperLanding from "@/components/OpenPaperLanding";

interface PdfUploadResponse {
	message: string;
	job_id: string;
}

interface JobStatusResponse {
	job_id: string;
	status: JobStatusType;
	started_at: string;
	completed_at: string | null;
	paper_id: string | null;
	has_file_url: boolean;
	has_metadata: boolean;
}

export default function Home() {
	const [isUploading, setIsUploading] = useState(false);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const [jobUploadStatus, setJobUploadStatus] = useState<JobStatusType | null>(null);

	const [pdfUrl, setPdfUrl] = useState("");
	const [relevantPapers, setRelevantPapers] = useState<PaperItem[]>([]);
	const [showErrorAlert, setShowErrorAlert] = useState(false);

	const { user, loading: authLoading } = useAuth();
	const isMobile = useIsMobile();

	// New state for loading experience
	const [elapsedTime, setElapsedTime] = useState(0);
	const [messageIndex, setMessageIndex] = useState(0);
	const [fileSize, setFileSize] = useState<number | null>(null);
	const [fileLength, setFileLength] = useState<string | null>(null);
	const [displayedMessage, setDisplayedMessage] = useState("");


	const loadingMessages = useMemo(() => [
		`Processing ${fileLength ? fileLength : 'lots of'} characters`,
		"Uploading to the cloud",
		"Extracting metadata",
		`Processing ${fileSize ? (fileSize / 1024 / 1024).toFixed(2) + 'mb' : '...'} `,
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
			const currentMessage = loadingMessages[messageIndex];
			if (i < currentMessage.length) {
				setDisplayedMessage(currentMessage.slice(0, i + 1));
				i++;
			} else {
				clearInterval(typingTimer);
			}
		}, 50);

		return () => clearInterval(typingTimer);
	}, [messageIndex, loadingMessages]);


	// Poll job status
	const pollJobStatus = async (jobId: string) => {
		try {
			const response: JobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${jobId}`);
			setJobUploadStatus(response.status);

			if (response.status === 'completed' && response.paper_id) {

				// Success - redirect to paper
				const redirectUrl = new URL(`/paper/${response.paper_id}`, window.location.origin);
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


	const handleFileUpload = async (file: File) => {
		setIsUploading(true);
		setFileSize(file.size);

		file.text().then(text => {
			setFileLength(text.length.toString());
		}).catch(err => {
			console.error('Error reading file text:', err);
			setFileLength('lots of');
		});

		const formData = new FormData();
		formData.append('file', file);

		try {
			const response: PdfUploadResponse = await fetchFromApi('/api/paper/upload', {
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
			setIsUploading(false);
		}
	};

	const handlePdfUrl = async (url: string) => {
		setIsUploading(true);
		setFileSize(null);
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

			await handleFileUpload(file);
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
		return (
			<OpenPaperLanding />
		);
	}

	return (
		<div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center h-[calc(100vh-64px)] p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
			<main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start w-full max-w-6xl">

				<header className="text-2xl font-bold mx-auto">
					Open Paper
				</header>
				{
					isMobile && (
						<Dialog open={true}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Open Paper</DialogTitle>
									<DialogDescription>
										This application is not optimized for mobile devices. Please use a desktop or tablet for the best experience.
									</DialogDescription>
								</DialogHeader>
							</DialogContent>
						</Dialog>
					)
				}
				<div className="flex flex-col text-center space-y-8 mx-auto">
					<p className="text-lg text-left text-muted-foreground max-w-2xl">
						Upload a paper to get started.
					</p>
				</div>

				{/* Replace buttons with PdfDropzone */}
				<PdfDropzone
					onFileSelect={handleFileUpload}
					onUrlClick={handleLinkClick}
					maxSizeMb={5} // Set your desired max size
				/>

				{/* Section break and header for relevant papers */}
				{relevantPapers.length > 0 && (
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
									<FileText className="h-4 w-4" />
									View all papers
								</Link>
							</Button>
						</div>

						{/* Papers grid */}
						<div className="w-full space-y-4">
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
				)}

			</main>
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

			{showErrorAlert && (
				<Dialog open={showErrorAlert} onOpenChange={setShowErrorAlert}>
					<DialogContent>
						<DialogTitle>Upload Failed</DialogTitle>
						<DialogDescription className="space-y-4 inline-flex items-center">
							<LucideFileWarning className="h-6 w-6 text-red-500 mr-2 flex-shrink-0" />
							{/* Generic error message (temp) */}
							We encountered an error processing your request. Please check the file or URL and try again.
						</DialogDescription>
						<div className="flex justify-end mt-4">
							<Button variant="outline" onClick={() => setShowErrorAlert(false)}>Close</Button>
						</div>
					</DialogContent>
				</Dialog>
			)}

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
				<DialogContent className="sm:max-w-md" hideCloseButton>
					<DialogHeader>
						<DialogTitle className="text-center">Processing Your Paper</DialogTitle>
						<DialogDescription className="text-center">
							This might take up to two minutes...
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col items-center justify-center py-8 space-y-6 w-full">
						<EnigmaticLoadingExperience />
						<div className="flex items-center justify-center gap-4 font-mono text-lg">
							<Loader2 className="h-6 w-6 animate-spin text-primary" />
							<p className="text-gray-400">
								{elapsedTime}s
							</p>
							<p className="text-white">{displayedMessage}</p>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
