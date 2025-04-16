"use client";

import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";
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
import { FileText, Highlighter, Loader2, LucideFileWarning, MessageSquareText } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface PdfUploadResponse {
	filename: string;
	url: string;
	document_id: string;
}

export default function Home() {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [loadingMessage, setLoadingMessage] = useState("Preparing your paper...");
	const [isDialogOpen, setIsDialogOpen] = useState(false);

	const [pdfUrl, setPdfUrl] = useState("");
	const [showErrorAlert, setShowErrorAlert] = useState(false);

	const { user, loading: authLoading } = useAuth();
	const isMobile = useIsMobile();

	// Loading messages to cycle through
	const loadingMessages = [
		"Crunching the numbers...",
		"Building an index...",
		"Squeezing the database...",
		"Analyzing content...",
		"Processing pages...",
		"Extracting insights...",
		"Preparing annotations...",
		"Organizing references...",
		"Setting up your workspace...",
		"Almost there..."
	];

	// Cycle through loading messages
	useEffect(() => {
		if (!isUploading) return;

		const interval = setInterval(() => {
			const randomIndex = Math.floor(Math.random() * loadingMessages.length);
			setLoadingMessage(loadingMessages[randomIndex]);
		}, 3000);

		return () => clearInterval(interval);
	}, [isUploading]);

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

			const redirectUrl = new URL(`/paper/${response.document_id}`, window.location.origin);
			window.location.href = redirectUrl.toString();
		} catch (error) {
			console.error('Error uploading file:', error);
			alert('Failed to upload PDF');
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
			console.error('Error processing PDF URL:', error);
			setShowErrorAlert(true);
			setIsUploading(false);
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleLinkClick = () => {
		setIsDialogOpen(true);
	};

	const handleDialogConfirm = async () => {
		if (pdfUrl) {
			await handlePdfUrl(pdfUrl);
		}
		setIsDialogOpen(false);
		setPdfUrl("");
	};

	if (!user && !authLoading) {
		return (

			<div className="grid grid-rows-[1fr_auto] min-h-[calc(100vh-64px)]">
				<main className="max-w-6xl mx-auto space-y-24 p-8">
					{
						isMobile && (
							<Dialog open={true}>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>The Annotated Paper</DialogTitle>
										<DialogDescription>
											This application is not optimized for mobile devices. Please use a desktop or tablet for the best experience.
										</DialogDescription>
									</DialogHeader>
								</DialogContent>
							</Dialog>
						)
					}
					{/* Hero Section */}
					<div className="flex flex-col items-center text-center space-y-8">
						<h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
							Your Research Papers,{" "}
							<span className="text-primary">Supercharged with AI</span>
						</h1>
						<p className="text-xl text-muted-foreground max-w-2xl">
							Upload your papers to one secure place. Read, annotate, and understand them deeply with the help of AI-powered insights.
						</p>
						<div className="flex gap-4">
							<Button size="lg" asChild>
								<a href="/login">Get Started</a>
							</Button>
							<Button size="lg" variant="outline" asChild>
								<a href="https://github.com/sabaimran/annotated-paper">View on GitHub</a>
							</Button>
						</div>
					</div>

					{/* Features Grid */}
					<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
						<div className="space-y-4">
							<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
								<FileText className="h-5 w-5 text-primary" />
							</div>
							<h3 className="text-xl font-semibold">Centralized Library</h3>
							<p className="text-muted-foreground">
								Keep all your research papers organized in one place. No more scattered PDFs across devices.
							</p>
						</div>
						<div className="space-y-4">
							<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
								<Highlighter className="h-5 w-5 text-primary" />
							</div>
							<h3 className="text-xl font-semibold">Smart Annotations</h3>
							<p className="text-muted-foreground">
								Highlight key insights and add notes that stay in sync with your papers. Never lose track of important information again.
							</p>
						</div>
						<div className="space-y-4">
							<div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
								<MessageSquareText className="h-5 w-5 text-primary" />
							</div>
							<h3 className="text-xl font-semibold">AI-Powered Understanding</h3>
							<p className="text-muted-foreground">
								Ask questions about your papers and get intelligent responses based on the content. Go deeper while staying focused.
							</p>
						</div>
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

				<footer className="p-8 text-center text-muted-foreground border-t">
					<p>
						Made with ❤️ in{" "}
						<a
							href="https://github.com/sabaimran/annotated-paper"
							target="_blank"
							rel="noopener noreferrer"
							className="underline hover:text-foreground transition-colors"
						>
							San Francisco
						</a>
					</p>
				</footer>
			</div>
		);
	}

	return (
		<div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center h-[calc(100vh-64px)] p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
			<main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start w-full max-w-6xl">

				<header className="text-2xl font-bold">
					The Annotated Paper
				</header>
				{
					isMobile && (
						<Dialog open={true}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>The Annotated Paper</DialogTitle>
									<DialogDescription>
										This application is not optimized for mobile devices. Please use a desktop or tablet for the best experience.
									</DialogDescription>
								</DialogHeader>
							</DialogContent>
						</Dialog>
					)
				}
				<div className="flex gap-4 items-center flex-col sm:flex-row">
					<input
						type="file"
						ref={fileInputRef}
						accept=".pdf"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) {
								handleFileUpload(file);
							}
						}}
					/>
					<Button onClick={handleImportClick}>
						Import PDF
					</Button>
					<Button onClick={handleLinkClick}>
						Link to a PDF
					</Button>
				</div>
			</main>
			<footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
				<p>
					Made with ❤️ in{" "} <a href="https://github.com/sabaimran/annotated-paper" target="_blank" rel="noopener noreferrer">San Francisco</a>
				</p>
			</footer>

			{showErrorAlert && (
				<Dialog open={showErrorAlert} onOpenChange={setShowErrorAlert}>
					<DialogContent>
						<DialogTitle>Failed to fetch PDF</DialogTitle>
						<DialogDescription className="space-y-4 inline-flex">
							<LucideFileWarning className="h-6 w-6 text-red-500 mr-2" />
							We were unable to download the PDF from the provided URL. This might be due to security restrictions on the server.
						</DialogDescription>
						<div>
							Try downloading the PDF to your computer first and then use the{" "}
							<button
								className="text-primary underline hover:text-primary/80"
								onClick={() => {
									setShowErrorAlert(false);
									handleImportClick();
								}}
							>
								Import PDF
							</button>
							{" "}button to upload it.
						</div>
					</DialogContent>
				</Dialog>
			)}

			{/* Dialog for PDF URL */}
			<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Link to a PDF</DialogTitle>
						<DialogDescription>
							Enter the URL of the PDF you want to upload.
						</DialogDescription>
					</DialogHeader>
					<Input
						type="url"
						placeholder="https://example.com/document.pdf"
						value={pdfUrl}
						onChange={(e) => setPdfUrl(e.target.value)}
						className="mt-4"
					/>
					<div className="flex justify-end gap-2 mt-4">
						<Button variant="secondary" onClick={() => setIsDialogOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleDialogConfirm}>
							Submit
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={isUploading} onOpenChange={(open) => !open && setIsUploading(false)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="text-center">Processing Your Paper</DialogTitle>
						<DialogDescription className="text-center">
							This will just take a moment
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col items-center justify-center py-8 space-y-6">
						<Loader2 className="h-12 w-12 animate-spin text-primary" />
						<p className="text-center text-lg transition-all duration-500 ease-in-out">
							{loadingMessage}
						</p>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
