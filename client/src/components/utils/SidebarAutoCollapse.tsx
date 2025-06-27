'use client';

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

export function SidebarController({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { setOpenMobile, setOpen } = useSidebar();
    const { user } = useAuth();
    const hasInitialized = useRef(false);

    useEffect(() => {
        // Set initial state on first render for paper pages
        if (!hasInitialized.current) {
            if (pathname.includes('/paper/')) {
                // Set initial state without triggering transition
                setOpen(false);
                setOpenMobile(false);
            } else if (pathname === '/' && !user) {
                // If on the home page and not logged in, collapse sidebar
                setOpen(false);
                setOpenMobile(false);
            }
            hasInitialized.current = true;
        }
    }, [pathname, setOpen, setOpenMobile, user]);

    return <>{children}</>;
}
