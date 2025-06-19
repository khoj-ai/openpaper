"use client"

import { Clock, FileText, Globe2, Home, LogOut, MessageCircleQuestion, Moon, Route, Sun, User } from "lucide-react";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
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
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import Image from "next/image";
import Link from "next/link";
import { PaperStatus } from "@/components/utils/PdfStatus";

// Menu items.
const items = [
    {
        title: "Home",
        url: "/",
        icon: Home,
        requiresAuth: false,
    },
    {
        title: "Find Papers",
        url: "/finder",
        icon: Globe2,
        requiresAuth: false,
    },
    {
        title: "My Papers",
        url: "/papers",
        icon: FileText,
        requiresAuth: true,
    },
    {
        title: "Feedback",
        url: "https://github.com/khoj-ai/openpaper/issues",
        icon: MessageCircleQuestion,
        requiresAuth: false,
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
    status?: PaperStatus
    preview_url?: string
}

export function AppSidebar() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const [allPapers, setAllPapers] = useState<PaperItem[]>([])
    const { darkMode, toggleDarkMode } = useIsDarkMode();

    useEffect(() => {
        // Define an async function inside useEffect
        const fetchPapers = async () => {
            try {
                const response = await fetchFromApi("/api/paper/active");
                const sortedPapers = response.papers.sort((a: PaperItem, b: PaperItem) => {
                    return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                });
                setAllPapers(sortedPapers);
            } catch (error) {
                console.error("Error fetching papers:", error);
                setAllPapers([]);
            }
        }

        // Call the async function
        fetchPapers();
    }, [user]);

    const handleLogout = async () => {
        await logout();
        router.push('/login');
    }

    return (
        <Sidebar variant="floating">
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel className="flex items-center gap-2">
                        <Image
                            src="/openpaper.svg"
                            width={24}
                            height={24}
                            alt="Open Paper Logo"
                        />
                        <span className="text-sm font-semibold">Open Paper</span>
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild>
                                            <a href={item.requiresAuth && !user ? "/login" : item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                            </a>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                </SidebarMenuItem>
                            ))}
                            {
                                allPapers && allPapers.length > 0 && (
                                    <SidebarMenuItem>
                                        <SidebarMenuButton>
                                            <Clock size={16} />
                                            <span>Queue</span>
                                        </SidebarMenuButton>
                                        <SidebarMenuSub>
                                            {
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
                                )
                            }
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
                {/* Dark Mode Toggle */}
                <SidebarMenuItem>
                    <SidebarMenuButton onClick={toggleDarkMode}>
                        {darkMode ? <Sun size={16} /> : <Moon size={16} />}
                        <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
                    </SidebarMenuButton>
                </SidebarMenuItem>
                {/* User Profile (if logged in) */}
                {user && (
                    <SidebarMenuItem className="mb-2">
                        <Popover>
                            <PopoverTrigger asChild>
                                <SidebarMenuButton className="flex items-center gap-2">
                                    <Avatar className="h-6 w-6">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        {user.picture ? (<img src={user.picture} alt={user.name} /> ) : ( <User size={16} /> )}
                                    </Avatar>
                                    <span className="truncate">{user.name}</span>
                                </SidebarMenuButton>
                            </PopoverTrigger>
                            <PopoverContent className="w-60 p-4" align="start">
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center gap-3">
                                        <Avatar className="h-10 w-10">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {user.picture ? ( <img src={user.picture} alt={user.name} /> ) : ( <User size={24} />)}
                                        </Avatar>
                                        <div>
                                            <h3 className="font-medium">{user.name}</h3>
                                            <p className="text-sm text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                    <Link href="/pricing" className="w-full">
                                        <Button
                                            variant="outline"
                                            className="w-full justify-start"
                                        >
                                            <Route size={16} className="mr-2" />
                                            Plans
                                        </Button>
                                    </Link>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start"
                                        onClick={handleLogout}
                                    >
                                        <LogOut size={16} className="mr-2" />
                                        Sign out
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </SidebarMenuItem>
                )}

                {/* Login button (if not logged in) */}
                {!user && (
                    <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                            <a
                                href="/login"
                                className="w-full flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-2 rounded-md transition-colors"
                            >
                                <User size={16} />
                                <span className="font-medium">Sign In</span>
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
            </SidebarFooter>
        </Sidebar>
    )
}
