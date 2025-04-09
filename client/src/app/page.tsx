"use client";

import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";
import { fetchFromApi } from "@/lib/api";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface PdfUploadResponse {
	filename: string;
	url: string;
	document_id: string;
}

export default function Home() {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [loadingMessage, setLoadingMessage] = useState("Preparing your paper...");

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
				// Don't set Content-Type header - browser will set it automatically with boundary
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
			// Fetch the PDF file
			const response = await fetch(url);
			if (!response.ok) throw new Error('Failed to fetch PDF');

			// Get the filename from the URL or Content-Disposition header
			const contentDisposition = response.headers.get('content-disposition');
			const randomFilename = Math.random().toString(36).substring(2, 15) + '.pdf';
			let filename = randomFilename;

			if (contentDisposition && contentDisposition.includes('attachment')) {
				// Extract filename from Content-Disposition header
				const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
				const matches = filenameRegex.exec(contentDisposition);
				if (matches != null && matches[1]) {
					filename = matches[1].replace(/['"]/g, '');
				}
			}

			if (contentDisposition) {
				const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(contentDisposition);
				if (matches != null && matches[1]) {
					filename = matches[1].replace(/['"]/g, '');
				}
			} else {
				// Try to get filename from URL
				const urlParts = url.split('/');
				const urlFilename = urlParts[urlParts.length - 1];
				if (urlFilename && urlFilename.toLowerCase().endsWith('.pdf')) {
					filename = urlFilename;
				}
			}

			// Convert the response to a blob
			const blob = await response.blob();

			// Create a File object
			const file = new File([blob], filename, { type: 'application/pdf' });

			// Upload the file
			await handleFileUpload(file);
		} catch (error) {
			console.error('Error processing PDF URL:', error);
			alert('Failed to process PDF URL');
			setIsUploading(false);
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleLinkClick = async () => {
		const url = prompt('Enter PDF URL:');
		if (url) {
			await handlePdfUrl(url);
		}
	};

	return (
		<div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
			<main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start w-full max-w-6xl">
				<header className="text-2xl font-bold">
					The Annotated Paper
				</header>

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
