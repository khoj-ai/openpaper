import { useEffect, useRef, useState } from "react";

export function usePdfNavigation(numPages: number | null) {
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [scale, setScale] = useState(1.2);
    const [width, setWidth] = useState<number>(0);
    const pagesRef = useRef<(HTMLDivElement | null)[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    // Set up page refs when numPages changes
    useEffect(() => {
        if (numPages) {
            pagesRef.current = new Array(numPages).fill(null);
        }
    }, [numPages]);

    // Calculate container width for responsive sizing
    useEffect(() => {
        const updateWidth = () => {
            const container = document.getElementById('pdf-container');
            if (container) {
                setWidth(container.clientWidth - 32);
            }
        };

        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, []);

    // Update current page when scrolling
    useEffect(() => {
        const handleScroll = () => {
            if (!containerRef.current || pagesRef.current.length === 0) return;

            let maxVisiblePage = 1;
            let maxVisibleArea = 0;

            pagesRef.current.forEach((pageRef, index) => {
                if (!pageRef) return;

                const rect = pageRef.getBoundingClientRect();
                const containerRect = containerRef.current!.getBoundingClientRect();
                const visibleTop = Math.max(rect.top, containerRect.top);
                const visibleBottom = Math.min(rect.bottom, containerRect.bottom);

                if (visibleBottom > visibleTop) {
                    const visibleArea = visibleBottom - visibleTop;
                    if (visibleArea > maxVisibleArea) {
                        maxVisibleArea = visibleArea;
                        maxVisiblePage = index + 1;
                    }
                }
            });

            if (maxVisiblePage !== currentPage) {
                setCurrentPage(maxVisiblePage);
            }
        };

        containerRef.current?.addEventListener('scroll', handleScroll);
        return () => containerRef.current?.removeEventListener('scroll', handleScroll);
    }, [currentPage]);

    const goToPreviousPage = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1);
            pagesRef.current[currentPage - 2]?.scrollIntoView({ behavior: 'smooth' });
        }
    };

    const goToNextPage = () => {
        if (numPages && currentPage < numPages) {
            setCurrentPage(currentPage + 1);
            pagesRef.current[currentPage]?.scrollIntoView({ behavior: 'smooth' });
        }
    };

    const zoomIn = () => setScale(prev => Math.min(prev + 0.2, 2.5));
    const zoomOut = () => setScale(prev => Math.max(prev - 0.2, 0.7));

    return {
        currentPage,
        scale,
        width,
        pagesRef,
        containerRef,
        goToPreviousPage,
        goToNextPage,
        zoomIn,
        zoomOut,
    };
}
