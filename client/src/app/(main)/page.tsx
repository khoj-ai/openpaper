"use client";

import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
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
import { CheckCircle, FileText, GithubIcon, Globe2, HandCoins, Highlighter, Loader2, LucideFileWarning, MessageSquareText, Mic2, Play, Search, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PdfDropzone } from "@/components/PdfDropzone";
import Link from "next/link";
import EnigmaticLoadingExperience from "@/components/EnigmaticLoadingExperience";
import Image from "next/image";
import { PaperItem } from "@/components/AppSidebar";
import PaperCard from "@/components/PaperCard";
import { JobStatusType } from "@/lib/schema";
import { Progress } from "@/components/ui/progress";

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
	const [loadingMessage, setLoadingMessage] = useState("Preparing your paper...");
	const [loadingProgress, setLoadingProgress] = useState(0);
	const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
	const [jobUploadStatus, setJobUploadStatus] = useState<JobStatusType | null>(null);

	const [pdfUrl, setPdfUrl] = useState("");
	const [relevantPapers, setRelevantPapers] = useState<PaperItem[]>([]);
	const [showErrorAlert, setShowErrorAlert] = useState(false);

	const { user, loading: authLoading } = useAuth();
	const isMobile = useIsMobile();

	// Poll job status
	const pollJobStatus = async (jobId: string) => {
		try {
			const response: JobStatusResponse = await fetchFromApi(`/api/paper/upload/status/${jobId}`);
			setJobUploadStatus(response.status);

			if (response.status === 'completed' && response.paper_id) {

				// Success - redirect to paper
				setLoadingMessage("Paper processed successfully! Redirecting...");
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

				if (response.has_metadata) {
					setLoadingMessage("Completed processing metadata...");
					setLoadingProgress(75);
				} else if (response.has_file_url) {
					setLoadingMessage("Completed pre-processing document...");
					setLoadingProgress(50);
				} else {
					setLoadingMessage("Preparing your paper...");
					setLoadingProgress(25);
				}
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

			<div className="grid grid-rows-[1fr_auto] min-h-[calc(100vh-64px)]">
				<main className="max-w-6xl mx-auto space-y-24 p-8">
					{/* Hero Section */}
					<div className="flex flex-col items-center text-center space-y-8">
						<h1 className="text-6xl sm:text-6xl font-bold tracking-tight *:text-primary flex items-center gap-2">
							<Image
								src="/openpaper.svg"
								width={48}
								height={48}
								alt="Open Paper Logo"
							/>
							Open Paper
						</h1>
						<h2 className="text-4xl sm:text-4xl font-bold tracking-tight">
							Read Research Papers,{" "}
							<span className="text-primary">Supercharged with AI</span>
						</h2>
						<p className="text-xl text-muted-foreground max-w-2xl">
							Read, annotate, and understand papers. Use an AI assistant with contextual citations for responses you can trust.
						</p>
						<div className="flex gap-4">
							<Button
								className="bg-blue-500"
								size="lg"
								asChild
							>
								<a href="/login">
									<Upload className="h-4 w-4 mr-2" />
									Upload
								</a>
							</Button>
						</div>

					</div>

					{/* Video Demo Section */}
					<div className="w-full max-w-3xl mx-auto">
						<div className="aspect-video relative rounded-lg overflow-hidden shadow-lg">
							<iframe
								className="absolute top-0 left-0 w-full h-full"
								src="https://www.youtube.com/embed/fwXzXgmhy08?si=BFasAO--Qr4MRSVG"
								title="Open Paper Demo"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
								referrerPolicy="strict-origin-when-cross-origin"
								allowFullScreen
							></iframe>
						</div>
					</div>

					{/* Features Grid */}
					<div className="grid grid-cols-1 gap-8">
						<div className="space-y-4 flex flex-col lg:flex-row items-center text-center rounded-lg">
							<div className="rounded-lg flex items-center justify-center p-6">
								<Image
									src="https://assets.khoj.dev/openpaper/read_paper_deeply.png"
									width={1280}
									height={640}
									className="rounded-lg"
									alt="Read Papers Deeply"
									unoptimized
								/>
							</div>
							<div className="w-full rounded-lg flex flex-col items-start p-6 space-y-4">
								<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
									<FileText className="h-5 w-5 text-primary" />
								</div>
								<h3 className="text-xl font-semibold">Stay Focused</h3>
								<p className="text-muted-foreground text-left">
									Read your papers side by side with your notes. Effortlessly chat with, annotate, and understand your paper in flow.
								</p>
							</div>
						</div>
						<div className="space-y-4 flex flex-col lg:flex-row items-center text-center">
							<div className="rounded-lg flex items-center justify-center p-6">
								<Image
									src="https://assets.khoj.dev/openpaper/inline_annotations.png"
									width={1280}
									height={640}
									alt="Annotate Papers"
									className="rounded-lg"
									unoptimized
								/>
							</div>
							<div className="w-full rounded-lg flex flex-col items-start p-6 space-y-4">
								<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
									<Highlighter className="h-5 w-5 text-primary" />
								</div>
								<h3 className="text-xl font-semibold">Annotate</h3>
								<p className="text-muted-foreground text-left">
									Highlight key insights and add notes that stay in sync with your papers. Never lose track of important information again.
								</p>
							</div>
						</div>
						<div className="space-y-4 flex flex-col lg:flex-row items-center text-center">
							<div className="rounded-lg flex items-center justify-center p-6">
								<Image
									src="https://assets.khoj.dev/openpaper/grounded_citations.png"
									width={1280}
									height={640}
									alt="Grounded Citations"
									className="rounded-lg"
									unoptimized
								/>
							</div>
							<div className="w-full rounded-lg flex flex-col items-start p-6 space-y-4">
								<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
									<MessageSquareText className="h-5 w-5 text-primary" />
								</div>
								<h3 className="text-xl font-semibold">Get Grounded Insights</h3>
								<p className="text-muted-foreground text-left">
									Ask questions about your papers and get trusted responses with citations linked back to the paper. Go deeper with confidence.
								</p>
							</div>
						</div>
						<div className="space-y-4 flex flex-col lg:flex-row items-center text-center">
							<div className="rounded-lg flex items-center justify-center p-6">
								<Image
									src="https://assets.khoj.dev/openpaper/paper_to_podcast.png"
									width={1280}
									height={640}
									alt="Paper to Podcast"
									className="rounded-lg"
									unoptimized
								/>
							</div>
							<div className="w-full rounded-lg flex flex-col items-start p-6 space-y-4">
								<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
									<Mic2 className="h-5 w-5 text-primary" />
								</div>
								<h3 className="text-xl font-semibold">Listen to Your Paper</h3>
								<p className="text-muted-foreground text-left">
									Get an audio summary that helps you quickly grasp the key points of your paper. Perfect for when you want to catch up on research on your afternoon walk.
								</p>
							</div>
						</div>
						<div className="space-y-4 flex flex-col lg:flex-row items-center text-center">
							<div className="rounded-lg flex items-center justify-center p-6">
								<Image
									src="https://assets.khoj.dev/openpaper/find_related_papers.png"
									width={1280}
									height={640}
									alt="Find Related Research"
									className="rounded-lg"
									unoptimized
								/>
							</div>
							<div className="w-full rounded-lg flex flex-col items-start p-6 space-y-4">
								<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
									<Search className="h-5 w-5 text-primary" />
								</div>
								<h3 className="text-xl font-semibold">Find Related Research</h3>
								<p className="text-muted-foreground text-left">
									Quickly discover papers related to your current research, and dig into Open Access content to expand your understanding.
								</p>
							</div>
						</div>
						<div className="space-y-4 flex flex-col lg:flex-row items-center text-center">
							<div className="rounded-lg flex items-center justify-center p-6">
								<Image
									src="https://assets.khoj.dev/openpaper/share_with_colleagues.png"
									width={1280}
									height={640}
									alt="Find Related Research"
									className="rounded-lg"
									unoptimized
								/>
							</div>
							<div className="w-full rounded-lg flex flex-col items-start p-6 space-y-4">
								<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
									<Globe2 className="h-5 w-5 text-primary" />
								</div>
								<h3 className="text-xl font-semibold">Share Your Annotations</h3>
								<p className="text-muted-foreground text-left">
									Efficiently share your annotations and insights with colleagues or the community. Collaborate on research without losing context.
								</p>
							</div>
						</div>
					</div>

					<div className="flex flex-col items-center text-center space-y-8">
						<div className="flex gap-2">
							<Button
								className="bg-blue-500"
								size="lg"
								asChild>
								<a href="/login">
									<Play className="h-4 w-4" />
									Get Started
								</a>
							</Button>
							<Button
								variant={"outline"}
								size="lg"
								asChild>
								<a href="/pricing">
									<HandCoins className="h-4 w-4" />
									Pricing
								</a>
							</Button>
						</div>
						<h2 className="text-3xl font-bold">Ready to Supercharge Your Research?</h2>
						<p className="text-lg text-muted-foreground">
							Join a community of researchers using Open Paper to read, annotate, and understand papers.
						</p>
					</div>

					{/* Social Proof */}
					{/* <div className="text-center space-y-8">
						<h2 className="text-3xl font-bold">Used by researchers worldwide</h2>
						<div className="flex flex-wrap justify-center gap-12 text-muted-foreground">
							<div className="flex items-center gap-2">
								<Users className="h-5 w-5" />
								<span>1000+ Active Users</span>
							</div>
							<div className="flex items-center gap-2">
								<FileText className="h-5 w-5" />
								<span>10,000+ Papers Analyzed</span>
							</div>
							<div className="flex items-center gap-2">
								<Star className="h-5 w-5" />
								<span>4.9/5 Average Rating</span>
							</div>
						</div>
					</div> */}
				</main>
				<footer className="p-8 text-center text-muted-foreground border-t flex gap-4 flex-col items-center justify-center">
					<p>
						Made with ❤️ in{" "}
						<a
							href="https://github.com/sabaimran/openpaper"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground transition-colors"
						>
							San Francisco
						</a>
					</p>
					<div className="flex gap-4">
						<Button size="lg" className="w-fit" variant="outline" asChild>
							<Link href="/blog/manifesto">
								<FileText className="h-4 w-4 mr-2" />
								Manifesto
							</Link>
						</Button>
						<Button size="lg" variant="outline" asChild>
							<a href="https://github.com/sabaimran/openpaper">
								<GithubIcon className="h-4 w-4 mr-2" />
								GitHub
							</a>
						</Button>
					</div>
				</footer>
			</div>
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
			<footer className="row-start-3 grid gap-[24px] items-center justify-center justify-items-center">
				<p>
					Made with ❤️ in{" "}
					<a
						href="https://github.com/sabaimran/openpaper"
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
					<div className="flex flex-col items-center justify-center py-8 space-y-6">
						<EnigmaticLoadingExperience />
						<div className="flex items-center gap-4 justify-center">
							{
								jobUploadStatus === 'completed' ? (
									<CheckCircle className="h-6 w-6 text-green-500" />
								) : (
									<Loader2 className="h-6 w-6 animate-spin text-primary" />
								)
							}
							<p className="text-center text-lg transition-all duration-500 ease-in-out">
								{loadingMessage}
							</p>
						</div>
						<Progress value={loadingProgress} />
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
