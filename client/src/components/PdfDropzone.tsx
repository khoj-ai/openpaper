"use client";

import React, { useState, useRef, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { UploadCloud } from 'lucide-react';

interface PdfDropzoneProps {
    onFileSelect: (files: File[]) => void;
    onUrlClick: () => void;
    maxSizeMb?: number;
}

export function PdfDropzone({ onFileSelect, onUrlClick, maxSizeMb = 5 }: PdfDropzoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const maxSize = maxSizeMb * 1024 * 1024; // Convert MB to bytes

    const handleFileValidation = (file: File): boolean => {
        if (file.type !== 'application/pdf') {
            setError('Invalid file type. Please upload a PDF.');
            return false;
        }
        if (file.size > maxSize) {
            setError(`File size exceeds the ${maxSizeMb}MB limit.`);
            return false;
        }
        return true;
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.relatedTarget && !(e.currentTarget.contains(e.relatedTarget as Node))) {
            setIsDragging(false);
        } else if (!e.relatedTarget) {
            setIsDragging(false);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        setError(null);

        const files = Array.from(e.dataTransfer.files);
        const validFiles = files.filter(handleFileValidation);

        if (validFiles.length > 0) {
            onFileSelect(validFiles);
        }

        if (e.dataTransfer) {
            e.dataTransfer.items.clear();
        }
    }, [onFileSelect, maxSize, maxSizeMb]);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        const validFiles = files.filter(handleFileValidation);

        if (validFiles.length > 0) {
            onFileSelect(validFiles);
        }

        if (e.target) {
            e.target.value = '';
        }
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className="flex flex-col items-center space-y-6 w-full max-w-lg mx-auto">
            <div
                onClick={handleClick}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                className={`flex flex-col items-center justify-center w-full p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors duration-200 ease-in-out
                    ${isDragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-secondary/50'}
                    ${error ? 'border-destructive' : ''}
                `}
                style={{ minHeight: '200px' }}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileInputChange}
                    multiple
                />
                <UploadCloud className={`h-12 w-12 mb-4 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                <p className="text-center text-lg font-medium">
                    Click to upload, or drag and drop
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                    Attach a PDF file up to {maxSizeMb}MB
                </p>
                {error && <p className="text-sm text-destructive mt-2">{error}</p>}
            </div>
            <div className="flex items-center w-full">
                <div className="flex-grow border-t border-border"></div>
                <span className="flex-shrink mx-4 text-muted-foreground text-sm">or</span>
                <div className="flex-grow border-t border-border"></div>
            </div>
            <Button variant="outline" onClick={onUrlClick}>
                Import from URL
            </Button>
        </div>
    );
}
