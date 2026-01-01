"use client";

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { SquareLibrary } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchFromApi } from '@/lib/api';
import { PaperData } from '@/lib/schema';
import Link from 'next/link';

export function CitationGraphButton() {
    const pathname = usePathname();
    const [paperId, setPaperId] = useState<string | null>(null);
    const [paperDoi, setPaperDoi] = useState<string | null>(null);

    useEffect(() => {
        if (pathname) {
            const segments = pathname.split('/');
            if (segments[1] === 'paper' && segments.length === 3 && segments[2]) {
                setPaperId(segments[2]);
            } else {
                setPaperId(null);
            }
        }
    }, [pathname]);

    useEffect(() => {
        if (!paperId) return;

        const fetchPaperData = async () => {
            try {
                const data: PaperData = await fetchFromApi(`/api/paper?id=${paperId}`);
                setPaperDoi(data.doi || null);
            } catch {
                setPaperDoi(null);
            }
        };

        fetchPaperData();
    }, [paperId]);

    // Only show button if paper has a DOI
    if (!paperId || !paperDoi) {
        return null;
    }

    return (
        <Button variant="ghost" size="sm" asChild>
            <Link href={`/graph?doi=${encodeURIComponent(paperDoi)}`}>
                <SquareLibrary className="h-4 w-4 mr-2" />
                Graph
            </Link>
        </Button>
    );
}
