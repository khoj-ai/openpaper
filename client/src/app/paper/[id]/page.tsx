'use client';

import { PdfViewer } from '@/components/PdfViewer';
import { fetchFromApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';

interface PaperData {
    filename: string;
    url: string;
}

export default function PaperView() {
    const params = useParams();
    const id = params.id as string;
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Only fetch data when id is available
        if (!id) return;

        async function fetchPaper() {
            try {
                console.log(`Fetching paper with ID: ${id}`);

                const response: PaperData = await fetchFromApi(`/api/paper?id=${id}`);
                console.log('Paper data:', response);
                setPaperData(response);
            } catch (error) {
                console.error('Error fetching paper:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchPaper();
    }, [id]);

    if (loading) return <div>Loading paper data...</div>;

    if (!paperData) return <div>Paper not found</div>;

    return (
        <div className="p-10">
            <h1>Paper View</h1>
            <div className="flex flex-col items-center gap-4">
                <h2>{paperData.filename}</h2>
                <p>Paper ID: {id}</p>
                {paperData.url && (
                    <div className="w-full">
                        <PdfViewer pdfUrl={paperData.url} />
                    </div>
                )}
            </div>
        </div>
    );
}