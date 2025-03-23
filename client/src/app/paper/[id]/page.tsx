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
        <div className="w-full h-100vh grid grid-cols-2 items-center justify-center gap-4">
            <div className="flex flex-col items-center gap-4 h-full w-full">
                {paperData.url && (
                    <div className="w-full h-full">
                        <PdfViewer pdfUrl={paperData.url} />
                    </div>
                )}
            </div>
            <div className="flex flex-col items-center gap-4">
                <h2>Paper Metadata</h2>
                <p>Filename: {paperData.filename}</p>
                <p>URL: {paperData.url}</p>
                <p>Document ID: {id}</p>
                {/* Add more metadata fields as needed */}
                <h2>Additional Metadata</h2>
                <p>Author: {/* Add author name here */}</p>
                <p>Published Date: {/* Add published date here */}</p>
                <p>Journal: {/* Add journal name here */}</p>
                <p>DOI: {/* Add DOI here */}</p>
                <p>Abstract: {/* Add abstract here */}</p>
                <p>Keywords: {/* Add keywords here */}</p>
                <p>References: {/* Add references here */}</p>
            </div>
        </div>
    );
}