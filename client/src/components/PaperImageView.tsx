import { fetchFromApi } from '@/lib/api';
import { PaperImage } from '@/lib/schema';
import { Loader } from 'lucide-react';
import React from 'react';
import { useState } from 'react';
import { useEffect } from 'react';

interface PaperImageViewProps {
    paperId: string;
}

export default function PaperImageView({ paperId }: PaperImageViewProps) {
    const [loadingImages, setLoadingImages] = useState(true);
    const [paperImages, setPaperImages] = useState<PaperImage[]>([]);


    useEffect(() => {

        async function fetchPaperImages() {
            setLoadingImages(true);
            try {
                const response: PaperImage[] = await fetchFromApi(`/api/paper/image/paper/${paperId}`);
                setPaperImages(response);
            } catch (error) {
                console.error('Error fetching paper images:', error);
                setPaperImages([]);
            } finally {
                setLoadingImages(false);
            }
        }

        fetchPaperImages();
    }, [paperId]);

    if (paperImages.length === 0 && !loadingImages) {
        return <div>No images found.</div>;
    }

    return (
        <>
            {
                paperImages.length > 0 && (
                    <div className="my-6">
                        <h3 className="text-lg font-semibold mb-4">Figures and Images</h3>
                        {loadingImages ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader className="animate-spin h-6 w-6 text-gray-500" />
                                <span className="ml-2 text-gray-500">Loading images...</span>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {paperImages
                                    .sort((a, b) => {
                                        // First sort by page number, then by image index
                                        if (a.page_number !== b.page_number) {
                                            return a.page_number - b.page_number;
                                        }
                                        return a.image_index - b.image_index;
                                    })
                                    .map((image, index) => (
                                        <div key={`${image.paper_id}-${image.image_index}`} className="border rounded-lg p-3 bg-background">
                                            <div className="relative">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={image.image_url}
                                                    alt={image.caption || `Figure ${index + 1}`}
                                                    className="w-full h-auto rounded-md"
                                                    style={{ maxHeight: '300px', objectFit: 'contain' }}
                                                />
                                                <div className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                                                    Page {image.page_number}
                                                </div>
                                            </div>
                                            {image.caption && (
                                                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 italic">
                                                    {image.caption}
                                                </p>
                                            )}
                                            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                                                <span>{image.format?.toUpperCase()}</span>
                                                <span>{image.width} × {image.height}</span>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                )
            }
        </>
    )
}
