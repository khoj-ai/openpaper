"use client"

import { AlertTriangle, ArrowRight, ChevronDown, ChevronsUpDown, Clock, FileText, Globe2, Home, LogOut, MessageCircleQuestion, Moon, Route, Sun, TelescopeIcon, User, X } from "lucide-react";

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
import { useSubscription, isStorageAtLimit, isPaperUploadAtLimit, isStorageNearLimit, isPaperUploadNearLimit, isChatCreditAtLimit, isChatCreditNearLimit } from "@/hooks/useSubscription";
import Image from "next/image";
import Link from "next/link";
import { PaperStatus } from "@/components/utils/PdfStatus";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Conversation } from "@/lib/schema";

// Menu items.
const items = [
    {
        title: "Home",
        url: "/",
        icon: Home,
        requiresAuth: false,
        beta: false,
    },
    {
        title: "Find Papers",
        url: "/finder",
        icon: Globe2,
        requiresAuth: false,
        beta: false,
    },
    {
        title: "Library",
        url: "/papers",
        icon: FileText,
        requiresAuth: true,
        beta: false,
    },
    {
        title: "Ask",
        url: "/understand",
        icon: TelescopeIcon,
        requiresAuth: true,
        beta: true,
    },
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
    const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
    const [everythingConversations, setEverythingConversations] = useState<Conversation[]>([]);
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

        const fetchEverythingConversations = async () => {
            try {
                const response = await fetchFromApi("/api/conversation/everything");
                setEverythingConversations(response);
            } catch (error) {
                console.error("Error fetching everything conversations");
                setEverythingConversations([]);
            }
        }

        // Call the async function
        if (!user) return;
        fetchPapers();
        fetchEverythingConversations();
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

        if (isChatCreditAtLimit(subscription)) {
            return {
                type: 'error' as const,
                key: 'chat-credit-limit',
                title: 'Chat credits exhausted',
                description: 'Upgrade your plan to continue using chat features.',
            }
        }

        if (isChatCreditNearLimit(subscription)) {
            return {
                type: 'warning' as const,
                key: 'chat-credit-near-limit',
                title: 'Chat credits nearly exhausted',
                description: 'Consider upgrading your plan to avoid interruptions.',
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
                                            <Link href={item.requiresAuth && !user ? "/login" : item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                                {
                                                    item.beta && (
                                                        <span className="ml-1 text-xs text-yellow-500 bg-yellow-100 dark:bg-yellow-800 dark:text-yellow-200 px-1 rounded">
                                                            Beta
                                                        </span>
                                                    )
                                                }
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                {allPapers.length > 0 && (
                    <Collapsible defaultOpen className="group/collapsible">
                        <SidebarGroup>
                            <CollapsibleTrigger>
                                <SidebarMenuButton asChild>
                                    <span className="flex items-center gap-2 w-full">
                                        Recent
                                        <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                                    </span>
                                </SidebarMenuButton>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <SidebarGroupContent>
                                    <>
                                        <SidebarMenuItem>
                                            <SidebarMenuSub>
                                                {allPapers.slice(0, 7).map((paper) => (
                                                    <SidebarMenuSubItem key={paper.id}>
                                                        <SidebarMenuSubButton asChild>
                                                            <Link
                                                                href={`/paper/${paper.id}`}
                                                                className="text-xs font-medium w-full h-fit my-1"
                                                            >
                                                                <p className="line-clamp-3">
                                                                    {paper.title}
                                                                </p>
                                                            </Link>
                                                        </SidebarMenuSubButton>
                                                    </SidebarMenuSubItem>
                                                ))}
                                            </SidebarMenuSub>
                                        </SidebarMenuItem>
                                        {allPapers.length > 7 && (
                                            <SidebarMenuItem>
                                                <SidebarMenuButton asChild>
                                                    <Link href="/papers" className="text-xs font-medium h-fit my-1">
                                                        {allPapers.length} Papers <ArrowRight className="inline h-3 w-3 ml-1" />
                                                    </Link>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        )}
                                    </>
                                </SidebarGroupContent>
                            </CollapsibleContent>
                        </SidebarGroup>
                    </Collapsible>
                )}
                {everythingConversations.length > 0 && (
                    <Collapsible className="group/collapsible">
                        <SidebarGroup>
                            <CollapsibleTrigger>
                                <SidebarMenuButton asChild>
                                    <span className="flex items-center gap-2 w-full">
                                        Discover
                                        <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                                    </span>
                                </SidebarMenuButton>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <SidebarGroupContent>
                                    <>
                                        <SidebarMenuItem>
                                            <SidebarMenuSub>
                                                {everythingConversations.filter(conversation => conversation.title).slice(0, 7).map((conversation) => (
                                                    <SidebarMenuSubItem key={conversation.id}>
                                                        <SidebarMenuSubButton asChild>
                                                            <Link
                                                                href={`/everything/${conversation.id}`}
                                                                className="text-xs font-medium w-full h-fit my-1"
                                                            >
                                                                <p className="line-clamp-3">
                                                                    {conversation.title}
                                                                </p>
                                                            </Link>
                                                        </SidebarMenuSubButton>
                                                    </SidebarMenuSubItem>
                                                ))}
                                            </SidebarMenuSub>
                                        </SidebarMenuItem>
                                        {everythingConversations.length > 7 && (
                                            <SidebarMenuItem>
                                                <SidebarMenuButton asChild>
                                                    <Link href="/ask" className="text-xs font-medium h-fit my-1">
                                                        {everythingConversations.length} Explorations <ArrowRight className="inline h-3 w-3" />
                                                    </Link>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        )}
                                    </>
                                </SidebarGroupContent>
                            </CollapsibleContent>
                        </SidebarGroup>
                    </Collapsible>
                )}
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
                                    <span className="flex items-center gap-2 truncate">
                                        <Avatar className="h-6 w-6">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {user.picture ? (<img src={user.picture} alt={user.name} />) : (<User size={16} />)}
                                        </Avatar>
                                        <span className="truncate">{user.name}</span>
                                    </span>
                                    <ChevronsUpDown className="h-4 w-4 ml-auto" />
                                </SidebarMenuButton>
                            </PopoverTrigger>
                            <PopoverContent className="w-60 p-1" align="start">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-3 p-3">
                                        <Avatar className="h-10 w-10">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            {user.picture ? (<img src={user.picture} alt={user.name} />) : (<User size={24} />)}
                                        </Avatar>
                                        <div>
                                            <h3 className="font-medium">{user.name}</h3>
                                            <p className="text-sm text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                    {/* Feedback section */}
                                    <Link href="https://github.com/khoj-ai/openpaper/issues" target="_blank" className="w-full">
                                        <Button variant="ghost" className="w-full justify-start">
                                            <MessageCircleQuestion size={16} className="mr-2" />
                                            Feedback
                                        </Button>
                                    </Link>
                                    <Link href="/pricing" className="w-full">
                                        <Button
                                            variant="ghost"
                                            className="w-full justify-start"
                                        >
                                            <Route size={16} className="mr-2" />
                                            Plans
                                        </Button>
                                    </Link>
                                    {/* Dark Mode Toggle */}
                                    <Button onClick={toggleDarkMode} variant="ghost" className="w-full justify-start">
                                        {darkMode ? <Sun size={16} className="mr-2" /> : <Moon size={16} className="mr-2" />}
                                        {darkMode ? 'Light Mode' : 'Dark Mode'}
                                    </Button>
                                    <Button
                                        variant="ghost"
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
        </Sidebar >
    )
}
