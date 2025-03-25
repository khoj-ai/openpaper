"use client";

import { DataFetcher } from "@/components/DataFetcher";
import { Button } from "@/components/ui/button";
import { useRef } from "react";
import Image from "next/image";
import { fetchFromApi } from "@/lib/api";

interface PdfUploadResponse {
	filename: string;
	url: string;
	document_id: string;
}

export default function Home() {
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileUpload = async (file: File) => {
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
		}
	};

	const handlePdfUrl = async (url: string) => {
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

				<DataFetcher />
			</main>
			<footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
				<a
					className="flex items-center gap-2 hover:underline hover:underline-offset-4"
					href="https://docs.annotatedpdf.com"
					target="_blank"
					rel="noopener noreferrer"
				>
					<Image
						aria-hidden
						src="/file.svg"
						alt="File icon"
						width={16}
						height={16}
					/>
					Learn
				</a>
			</footer>
		</div>
	);
}
