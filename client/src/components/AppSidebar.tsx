"use client"

import { Calendar, FileText, Home, Inbox, Moon, Search, Settings, Sun } from "lucide-react";

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
        title: "Search",
        url: "#",
        icon: Search,
    },
    {
        title: "Settings",
        url: "#",
        icon: Settings,
    },
]

interface PaperItem {
    id: string
    filename: string
    title: string
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
        // Check for system preference or stored preference
        const isDarkMode = localStorage.getItem('darkMode') === 'dark' ||
            (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

        setDarkMode(isDarkMode);

        // Apply dark mode class if needed
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }

        // Define an async function inside useEffect
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/all");
                setAllPapers(response.papers);
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
                                    <FileText size={16} />
                                    <span>Papers</span>
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
