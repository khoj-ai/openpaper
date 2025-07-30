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
        if (!hasInitialized.current) {
            if (pathname.includes('/paper/')) {
                setOpen(false);
            } else if (pathname === '/' && !user) {
                setOpen(false);
            }
            hasInitialized.current = true;
        }
        setOpenMobile(false);
    }, [pathname, setOpen, setOpenMobile, user]);

    return <>{children}</>;
}
