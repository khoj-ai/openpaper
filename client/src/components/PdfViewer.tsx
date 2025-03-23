"use client";

import "../app/globals.css";

interface PdfViewerProps {
  pdfUrl: string;
}

export function PdfViewer({ pdfUrl }: PdfViewerProps) {

  return (
    <div className="flex flex-col items-center gap-4 h-full w-full">
      <embed src={pdfUrl} className='w-full h-full'>
      </embed>
    </div>
  );
} 