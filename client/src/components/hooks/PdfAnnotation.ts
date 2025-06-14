import {
    AIPaperHighlightAnnotation,
    PaperHighlightAnnotation
} from '@/lib/schema';
import { fetchFromApi } from '@/lib/api';
import { useEffect, useState } from 'react';

export function useAnnotations(paperId: string) {
    const [annotations, setAnnotations] = useState<PaperHighlightAnnotation[]>([]);
    const [aiAnnotations, setAIAnnotations] = useState<AIPaperHighlightAnnotation[]>([]);

    const addAnnotation = async (highlightId: string, content: string) => {
        const newAnnotation: Partial<PaperHighlightAnnotation> = {
            highlight_id: highlightId,
            paper_id: paperId,
            content,
        };

        try {
            const savedAnnotation: PaperHighlightAnnotation = await fetchFromApi('/api/annotation/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(newAnnotation),
            });
            setAnnotations(prev => [...prev, savedAnnotation]);
            return savedAnnotation;
        } catch (error) {
            console.error('Error saving annotation:', error);
            throw error;
        }
    };

    const removeAnnotation = async (annotationId: string) => {
        try {
            await fetchFromApi(`/api/annotation/${annotationId}`, {
                method: 'DELETE',
            });

            const updatedAnnotations = annotations.filter(a => a.id !== annotationId);
            setAnnotations(updatedAnnotations);
        } catch (error) {
            console.error('Error removing annotation:', error);
            throw error;
        }
    };

    const updateAnnotation = async (annotationId: string, content: string) => {
        try {
            const updatedAnnotation: PaperHighlightAnnotation = await fetchFromApi(`/api/annotation/${annotationId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content,
                }),
            });

            const updatedAnnotations = annotations.map(a =>
                a.id === annotationId ? updatedAnnotation : a
            );

            setAnnotations(updatedAnnotations);
            return updatedAnnotation;
        } catch (error) {
            console.error('Error updating annotation:', error);
            throw error;
        }
    };

    const loadAnnotationsFromServer = async () => {
        try {
            const loadedAnnotations: PaperHighlightAnnotation[] = await fetchFromApi(`/api/annotation/${paperId}`, {
                method: 'GET',
            });

            setAnnotations(loadedAnnotations);
            return loadedAnnotations;
        } catch (error) {
            console.error('Error loading annotations:', error);
            throw error;
        }
    };

    const loadAIAnnotationsFromServer = async () => {
        try {
            const loadedAIAnnotations: AIPaperHighlightAnnotation[] = await fetchFromApi(`/api/ai_annotation/${paperId}`, {
                method: 'GET',
            });

            setAIAnnotations(loadedAIAnnotations);
            return loadedAIAnnotations;
        } catch (error) {
            console.error('Error loading AI annotations:', error);
            throw error;
        }
    };

    const renderAnnotations = (highlights: PaperHighlightAnnotation[]) => {
        for (const h of highlights) {
            const highlightAnnotations = annotations.filter(a => a.highlight_id === h.id);
            if (highlightAnnotations.length > 0) {
                // Find the highlight in the DOM, identified by the `data-highlight-id` attribute
                const highlightElement = document.querySelector(`[data-highlight-id="${h.id}"]`);
                if (highlightElement) {

                    const existingAnnotations = highlightElement.getElementsByClassName('annotation-tooltip');
                    if (existingAnnotations.length > 0) {
                        return; // Annotations already rendered
                    }
                    // Create a new div element for the annotation
                    const annotationElement = document.createElement('div');
                    annotationElement.classList.add('annotation-tooltip', 'absolute', 'bg-white', 'border', 'rounded', 'p-2', 'shadow-md', 'top-2', '-right-2', 'z-10', 'bg-yellow-300', 'rounded-full', 'w-4', 'h-4', 'z-10');

                    // Append the annotation element to the highlight element
                    highlightElement.appendChild(annotationElement);
                }
            }
        }
    };

    const getAnnotationsForHighlight = (highlightId: string) => {
        return annotations.filter(a => a.highlight_id === highlightId);
    };

    useEffect(() => {
        loadAnnotationsFromServer();
        loadAIAnnotationsFromServer();
    }, []);

    return {
        annotations,
        aiAnnotations,
        setAnnotations,
        addAnnotation,
        removeAnnotation,
        updateAnnotation,
        loadAnnotationsFromServer,
        loadAIAnnotationsFromServer,
        getAnnotationsForHighlight,
        renderAnnotations,
    };
}
