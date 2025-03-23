"use client";

import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';

interface PaperData {
    id: string;
    title: string;
    // other paper details
}

export default function PaperView() {
    const router = useRouter();
    const { id } = router.query;
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Only fetch data when id is available (after hydration)
        if (!id) return;

        async function fetchPaper() {
            try {
                // Replace with your actual data fetching logic
                // Example: const response = await fetch(`/api/papers/${id}`);
                console.log(`Fetching paper with ID: ${id}`);

                if (typeof id !== 'string') {
                    console.error('Invalid paper ID');
                    return;
                }

                // Simulate paper data for now
                setPaperData({
                    id,
                    title: `Paper ${id}`,
                    // other paper details
                });
            } catch (error) {
                console.error('Error fetching paper:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchPaper();
    }, [id]);

    if (!id) return <div>Loading...</div>;

    if (loading) return <div>Loading paper data...</div>;

    if (!paperData) return <div>Paper not found</div>;

    return (
        <div className="paper-view-container">
            <h1>Paper View</h1>
            <div className="paper-details">
                <h2>{paperData.title}</h2>
                <p>Paper ID: {id}</p>
                {/* Render your paper content here */}
            </div>
        </div>
    );
}