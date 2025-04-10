"use client"

import { Clock, FileText, Home, Moon, Sun } from "lucide-react";

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";

// Menu items.
const items = [
    {
        title: "Home",
        url: "/",
        icon: Home,
    },
    {
        title: "Papers",
        url: "/papers",
        icon: FileText,
    }
]

export interface PaperItem {
    id: string
    filename: string
    title: string
    abstract?: string
    authors?: string[]
    keywords?: string[]
    institutions?: string[]
    summary?: string
    created_at?: string
}

export function AppSidebar() {
    const [allPapers, setAllPapers] = useState<PaperItem[]>([])
    const [darkMode, setDarkMode] = useState<boolean>(false);

    // Function to toggle dark mode
    const toggleDarkMode = () => {
        const newDarkMode = !darkMode;
        setDarkMode(newDarkMode);

        // Update document class
        if (newDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        // Save preference to localStorage
        localStorage.setItem('darkMode', newDarkMode ? 'dark' : 'light');
    };

    useEffect(() => {
        // First check if there's a stored preference in localStorage
        const storedPreference = localStorage.getItem('darkMode');

        if (storedPreference) {
            // If user has explicitly set a preference, use that
            const isDarkMode = storedPreference === 'dark';
            setDarkMode(isDarkMode);

            if (isDarkMode) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        } else {
            // If no stored preference, check system preference
            const prefersDark = window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches;

            setDarkMode(prefersDark);

            if (prefersDark) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }

            // Save system preference as initial setting
            localStorage.setItem('darkMode', prefersDark ? 'dark' : 'light');
        }

        // Listen for changes in system preference
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            // Only update if user hasn't set an explicit preference
            if (!localStorage.getItem('darkMode')) {
                const newDarkMode = e.matches;
                setDarkMode(newDarkMode);

                if (newDarkMode) {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            }
        };

        // Add listener for system preference changes
        if (mediaQuery?.addEventListener) {
            mediaQuery.addEventListener('change', handleChange);
        }


        // Define an async function inside useEffect
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all");
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setAllPapers(sortedPapers);
            } catch (error) {
                console.error("Error fetching papers:", error)
            }
        }

        // Call the async function
        fetchPapers();
    }, [])

    return (
        <Sidebar variant="floating">
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>The Annotated Paper</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild>
                                        <a href={item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                            {/* Dark Mode Toggle */}
                            <SidebarMenuItem>
                                <SidebarMenuButton onClick={toggleDarkMode}>
                                    {darkMode ? <Sun size={16} /> : <Moon size={16} />}
                                    <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                            <SidebarMenuItem>
                                <SidebarMenuButton>
                                    <Clock size={16} />
                                    <span>Recent</span>
                                </SidebarMenuButton>
                                <SidebarMenuSub>
                                    {
                                        allPapers && allPapers.length > 0 &&
                                        allPapers.map((paper) => (
                                            <SidebarMenuSubItem key={paper.id}>
                                                <SidebarMenuSubButton asChild>
                                                    <a
                                                        href={`/paper/${paper.id}`}
                                                        className="text-xs font-medium w-full h-fit my-1"
                                                    >
                                                        {paper.title || paper.filename}
                                                    </a>
                                                </SidebarMenuSubButton>
                                            </SidebarMenuSubItem>
                                        ))
                                    }
                                </SidebarMenuSub>
                            </SidebarMenuItem>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
