"use client"

import { Calendar, Home, Inbox, Search, Settings } from "lucide-react"

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
} from "@/components/ui/sidebar"
import { useEffect, useState } from "react"
import { fetchFromApi } from "@/lib/api"

// Menu items.
const items = [
    {
        title: "Home",
        url: "/",
        icon: Home,
    },
    {
        title: "Inbox",
        url: "#",
        icon: Inbox,
    },
    {
        title: "Calendar",
        url: "#",
        icon: Calendar,
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
}

export function AppSidebar() {
    const [allPapers, setAllPapers] = useState<PaperItem[]>([])

    useEffect(() => {
        // Define an async function inside useEffect
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/papers");
                setAllPapers(response.papers);
            } catch (error) {
                console.error("Error fetching papers:", error)
            }
        }

        // Call the async function
        fetchPapers();
    }, [])

    return (
        <Sidebar>
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
                            <SidebarMenuItem>
                                <SidebarMenuButton>
                                    <span>My Papers</span>
                                </SidebarMenuButton>
                                <SidebarMenuSub>
                                    {
                                        allPapers && allPapers.length > 0 &&
                                        allPapers.map((paper) => (
                                            <SidebarMenuSubItem key={paper.id}>
                                                <SidebarMenuSubButton asChild>
                                                    <a href={`/paper/${paper.id}`}>
                                                        {paper.filename}
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
