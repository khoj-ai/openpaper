'use client';

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarController({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { setOpenMobile, setOpen } = useSidebar();
    const hasInitialized = useRef(false);

    useEffect(() => {
        // Set initial state on first render for paper pages
        if (!hasInitialized.current) {
            if (pathname.includes('/paper/')) {
                // Set initial state without triggering transition
                setOpen(false);
                setOpenMobile(false);
            }
            hasInitialized.current = true;
        }
    }, [pathname, setOpen, setOpenMobile]);

    return <>{children}</>;
}
