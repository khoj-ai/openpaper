"use client"

import { useEffect, useState } from "react";

// Mobile breakpoint (you can adjust this value)
const MOBILE_BREAKPOINT = 768 // Standard tablet/mobile breakpoint

export function useIsMobile() {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        // Check initial size
        const checkMobile = () => {
            setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
        }

        // Run on mount
        checkMobile();

        // Add resize listener
        window.addEventListener('resize', checkMobile);

        // Cleanup
        return () => window.removeEventListener('resize', checkMobile);
    }, [])

    return isMobile
}
