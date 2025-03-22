"use client";

import { useEffect, useRef, useState } from 'react';

interface PdfViewerProps {
  pdfUrl: string;
}

export function PdfViewer({ pdfUrl }: PdfViewerProps) {

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-4 items-center">
      </div>
      <object data={pdfUrl} className='w-full h-dvh'>

      </object>
    </div>
  );
} 