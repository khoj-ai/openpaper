import { useEffect, useState } from "react";
import { pdfjs } from "react-pdf";


export function usePdfLoader() {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pagesLoaded, setPagesLoaded] = useState<boolean[]>([]);
    const [allPagesLoaded, setAllPagesLoaded] = useState(false);
    const [workerInitialized, setWorkerInitialized] = useState(false);

    // Initialize PDF.js worker
    useEffect(() => {
        if (!workerInitialized) {
            pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.mjs`;
            setWorkerInitialized(true);
        }
    }, [workerInitialized]);

    // Check when all pages are loaded
    useEffect(() => {
        if (pagesLoaded.length > 0 && pagesLoaded.every(loaded => loaded)) {
            setAllPagesLoaded(true);
        }
    }, [pagesLoaded]);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setPagesLoaded(new Array(numPages).fill(false));
    };

    const handlePageLoadSuccess = (pageIndex: number) => {
        if (allPagesLoaded) {
            // Something has triggered a reload of the pages
            // Reset the state
            setAllPagesLoaded(false);
            setPagesLoaded([]);
        }

        setPagesLoaded(prevLoaded => {
            const newLoaded = [...prevLoaded];
            newLoaded[pageIndex] = true;
            return newLoaded;
        });
    };

    return {
        numPages,
        allPagesLoaded,
        workerInitialized,
        onDocumentLoadSuccess,
        handlePageLoadSuccess,
    };
}
