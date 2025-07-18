"use client"

import { AlertTriangle, Clock, FileText, Globe2, Home, LogOut, MessageCircleQuestion, Moon, Route, Sun, User, X } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import { useSubscription, isStorageAtLimit, isPaperUploadAtLimit, isStorageNearLimit, isPaperUploadNearLimit } from "@/hooks/useSubscription";
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
        title: "Understand",
        url: "/understand",
        icon: Route,
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
    title: string
    abstract?: string
    authors?: string[]
    keywords?: string[]
    institutions?: string[]
    summary?: string
    created_at?: string
    status?: PaperStatus
    preview_url?: string
    size_in_kb?: number
}

export function AppSidebar() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const [allPapers, setAllPapers] = useState<PaperItem[]>([])
    const { darkMode, toggleDarkMode } = useIsDarkMode();
    const { subscription, loading: subscriptionLoading } = useSubscription();
    const [dismissedWarning, setDismissedWarning] = useState<string | null>(null);

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

    // Determine current subscription warning state
    const getSubscriptionWarning = () => {
        if (!subscription || !user || subscriptionLoading) return null;

        // Check for critical states first (red warnings)
        if (isStorageAtLimit(subscription)) {
            return {
                type: 'error' as const,
                key: 'storage-limit',
                title: 'Storage limit reached',
                description: 'Upgrade your plan or delete papers to continue.',
            };
        }

        if (isPaperUploadAtLimit(subscription)) {
            return {
                type: 'error' as const,
                key: 'upload-limit',
                title: 'Upload limit reached',
                description: 'Upgrade your plan to upload more.',
            };
        }

        // Check for warning states (yellow warnings)
        if (isStorageNearLimit(subscription)) {
            return {
                type: 'warning' as const,
                key: 'storage-near-limit',
                title: 'Storage nearly full',
                description: 'Consider upgrading your plan.',
            };
        }

        if (isPaperUploadNearLimit(subscription)) {
            return {
                type: 'warning' as const,
                key: 'upload-near-limit',
                title: 'Upload limit approaching',
                description: 'Consider upgrading your plan.',
            };
        }

        return null;
    };

    const currentWarning = getSubscriptionWarning();
    const shouldShowWarning = currentWarning && dismissedWarning !== currentWarning.key;

    // Reset dismissed warning when warning changes
    useEffect(() => {
        if (currentWarning && dismissedWarning && dismissedWarning !== currentWarning.key) {
            setDismissedWarning(null);
        }
    }, [currentWarning?.key, dismissedWarning]);

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
                                                                {paper.title}
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
                {/* Subscription Warning */}
                {shouldShowWarning && (
                    <div className="mb-2">
                        <Alert variant={currentWarning.type === 'error' ? 'destructive' : 'warning'} className="p-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium mb-1">
                                            {currentWarning.title}
                                        </div>
                                        <AlertDescription className="text-xs">
                                            {currentWarning.description}
                                        </AlertDescription>
                                        <Link href="/pricing" className="inline-block mt-2">
                                            <Button size="sm" variant="outline" className="h-6 text-xs px-2">
                                                Upgrade Plan
                                            </Button>
                                        </Link>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-4 w-4 p-0 hover:bg-transparent"
                                    onClick={() => setDismissedWarning(currentWarning.key)}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>
                        </Alert>
                    </div>
                )}

                {/* User Status Badge */}
                {user && (
                    <div className="px-2 py-1">
                        <Badge
                            variant={user.is_active ? "default" : "secondary"}
                            className={`w-fit justify-center ${user.is_active ? "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200" : "bg-gray-100 text-gray-800"}`}
                        >
                            {user.is_active ? "Researcher" : "Basic"}
                        </Badge>
                    </div>
                )}

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
                                    {/* Dark Mode Toggle */}
                                    <Button onClick={toggleDarkMode} className="w-full justify-start">
                                        {darkMode ? <Sun size={16} className="mr-2" /> : <Moon size={16} className="mr-2" />}
                                        {darkMode ? 'Light Mode' : 'Dark Mode'}
                                    </Button>
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
