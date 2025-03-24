"use client";

import { useEffect, useState } from "react";
import "../lib/promisePolyfill";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "../app/globals.css";

interface PdfViewerProps {
	pdfUrl: string;
}

export function PdfViewer({ pdfUrl }: PdfViewerProps) {
	const [numPages, setNumPages] = useState<number | null>(null);
	const [selectedText, setSelectedText] = useState<string>("");
	const [workerInitialized, setWorkerInitialized] = useState(false);

    // Set up the worker in useEffect to ensure it only runs in the browser
    useEffect(() => {
        if (!workerInitialized) {
            // Use the .mjs worker file we found
            pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.mjs`;
            setWorkerInitialized(true);
        }
    }, [workerInitialized]);

	const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
		setNumPages(numPages);
	};

	const handleTextSelection = () => {
		const selection = window.getSelection();
		if (selection && selection.toString()) {
			setSelectedText(selection.toString());
			console.log("Selected text:", selection.toString());
			// You can add your callback logic here
			// For example, show a popup or trigger some action
		}
	};

	return (
		<div className="flex flex-col items-center gap-4 h-screen w-full overflow-y-auto">
			<Document
				file={pdfUrl}
				onLoadSuccess={onDocumentLoadSuccess}
				onMouseUp={handleTextSelection}
				onLoadError={(error) => console.error("Error loading PDF:", error)}
				onContextMenu={handleTextSelection}
			>
				{Array.from(new Array(numPages || 0), (_, index) => (
					<Page
						key={`page_${index + 1}`}
						pageNumber={index + 1}
						className="mb-4"
						renderTextLayer={true}
						renderAnnotationLayer={true}
					/>
				))}
			</Document>

			{selectedText && (
				<div className="fixed bottom-4 right-4 p-4 bg-white shadow-lg rounded-lg max-w-md">
					<p className="font-bold">Selected Text:</p>
					<p>{selectedText}</p>
				</div>
			)}
		</div>
	);
}