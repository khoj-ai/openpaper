import { Compass, FileText, FolderKanban, Home, TelescopeIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SidebarNavItem {
    title: string;
    url: string;
    icon: LucideIcon;
    requiresAuth: boolean;
    isNew?: boolean;
}

export const navItems: SidebarNavItem[] = [
    {
        title: "Home",
        url: "/",
        icon: Home,
        requiresAuth: false,
    },
    {
        title: "Library",
        url: "/papers",
        icon: FileText,
        requiresAuth: true,
    },
    {
        title: "Projects",
        url: "/projects",
        icon: FolderKanban,
        requiresAuth: true,
    },
    {
        title: "Ask",
        url: "/understand",
        icon: TelescopeIcon,
        requiresAuth: true,
    },
    {
        title: "Discover",
        url: "/discover",
        icon: Compass,
        requiresAuth: true,
        isNew: true,
    },
];
