'use client';

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarController({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { setOpenMobile, setOpen } = useSidebar();
    const hasAutoCollapsed = useRef(false);

    useEffect(() => {
        // Auto-collapse sidebar only on first load when on paper pages
        if (pathname.includes('/paper/') && !hasAutoCollapsed.current) {
            setOpen(false);
            setOpenMobile(false);
            hasAutoCollapsed.current = true;
        }
    }, [pathname, setOpen, setOpenMobile]);

    return <>{children}</>;
}
