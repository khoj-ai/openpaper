'use client';

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

export function SidebarController({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { setOpenMobile, setOpen } = useSidebar();
    const { user } = useAuth();
    const previousPathname = useRef<string | null>(null);

    useEffect(() => {
        // Always close mobile sidebar on navigation
        setOpenMobile(false);

        // Only auto-collapse desktop sidebar if pathname actually changed
        if (previousPathname.current !== pathname) {
            if (pathname.includes('/paper/') || pathname.includes('/projects/') || pathname.endsWith('/papers')) {
                setOpen(false);
            } else if (pathname === '/' && !user) {
                setOpen(false);
            }

            previousPathname.current = pathname;
        }
    }, [pathname, setOpen, setOpenMobile, user]);

    return <>{children}</>;
}
