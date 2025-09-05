"use client"

import {
    AlertTriangle,
    ArrowRight,
    ChevronDown,
    ChevronsUpDown,
    FileText,
    FolderCodeIcon,
    Globe2,
    Home,
    LogOut,
    MessageCircleQuestion,
    Moon,
    Route,
    Sun,
    TelescopeIcon,
    User as UserIcon,
    X
} from "lucide-react";

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
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
import { useAuth, User } from "@/lib/auth";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Sheet,
    SheetContent,
    SheetTrigger,
} from "@/components/ui/sheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useIsDarkMode } from "@/hooks/useDarkMode";
import { useSubscription, isStorageAtLimit, isPaperUploadAtLimit, isStorageNearLimit, isPaperUploadNearLimit, isChatCreditAtLimit, isChatCreditNearLimit } from "@/hooks/useSubscription";
import Link from "next/link";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Conversation, PaperItem } from "@/lib/schema";
import { useIsMobile } from "@/hooks/use-mobile";

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
    // {
    //     title: "Projects",
    //     url: "/projects",
    //     icon: FolderCodeIcon,
    //     requiresAuth: true,
    //     beta: true,
    // },
    {
        title: "Find Papers",
        url: "/finder",
        icon: Globe2,
        requiresAuth: false,
        beta: false,
    },
]

const UserMenuContent = ({
    user,
    handleLogout,
    toggleDarkMode,
    darkMode,
}: {
    user: User,
    handleLogout: () => void,
    toggleDarkMode: () => void,
    darkMode: boolean
}) => (
    <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 p-3">
            <Avatar className="h-10 w-10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {user.picture ? (<img src={user.picture} alt={user.name} />) : (<UserIcon size={24} />)}
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
)




export function AppSidebar() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
    const [everythingConversations, setEverythingConversations] = useState<Conversation[]>([]);
    const { darkMode, toggleDarkMode } = useIsDarkMode();
    const { subscription, loading: subscriptionLoading } = useSubscription();
    const [dismissedWarning, setDismissedWarning] = useState<string | null>(null);
    const isMobile = useIsMobile();

    useEffect(() => {
        if (!user) {
            setAllPapers([]);
            setEverythingConversations([]);
            return;
        }

        const fetchData = async () => {
            try {
                const [papersResponse, conversationsResponse] = await Promise.all([
                    fetchFromApi("/api/paper/active"),
                    fetchFromApi("/api/conversation/everything"),
                ]);

                if (papersResponse.papers) {
                    const sortedPapers = papersResponse.papers.sort((a: PaperItem, b: PaperItem) => {
                        return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
                    });
                    setAllPapers(sortedPapers);
                } else {
                    setAllPapers([]);
                }
                setEverythingConversations(conversationsResponse || []);
            } catch (error) {
                console.error("Error fetching sidebar data:", error);
                setAllPapers([]);
                setEverythingConversations([]);
            }
        };

        fetchData();
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
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {items.map((item) => {
                                if (item.title === "Library") {
                                    return (
                                        <Collapsible key={item.title} asChild defaultOpen={true} className="group/collapsible">
                                            <SidebarMenuItem>
                                                <CollapsibleTrigger asChild>
                                                    <Link href='/papers'>
                                                        <SidebarMenuButton>
                                                            <item.icon />
                                                            <span>{item.title}</span>
                                                            <ChevronDown className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                                                        </SidebarMenuButton>
                                                    </Link>
                                                </CollapsibleTrigger>
                                                <CollapsibleContent>
                                                    <SidebarMenuSub>
                                                        {allPapers.slice(0, 7).map((paper) => (
                                                            <SidebarMenuSubItem key={paper.id}>
                                                                <SidebarMenuSubButton asChild>
                                                                    <Link href={`/paper/${paper.id}`} className="text-xs font-medium w-full h-fit my-1">
                                                                        <p className="line-clamp-3">{paper.title}</p>
                                                                    </Link>
                                                                </SidebarMenuSubButton>
                                                            </SidebarMenuSubItem>
                                                        ))}
                                                        {allPapers.length > 7 && (
                                                            <SidebarMenuSubItem>
                                                                <SidebarMenuSubButton asChild>
                                                                    <Link href="/papers" className="text-xs font-medium h-fit my-1">
                                                                        View all papers <ArrowRight className="inline h-3 w-3 ml-1" />
                                                                    </Link>
                                                                </SidebarMenuSubButton>
                                                            </SidebarMenuSubItem>
                                                        )}
                                                    </SidebarMenuSub>
                                                </CollapsibleContent>
                                            </SidebarMenuItem>
                                        </Collapsible>
                                    )
                                }
                                if (item.title === "Ask") {
                                    return (
                                        <Collapsible key={item.title} asChild defaultOpen={false} className="group/collapsible">
                                            <SidebarMenuItem>
                                                <CollapsibleTrigger asChild>
                                                    <Link href='/understand'>
                                                        <SidebarMenuButton>
                                                            <item.icon />
                                                            <span>{item.title}</span>
                                                            <ChevronDown className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                                                        </SidebarMenuButton>
                                                    </Link>
                                                </CollapsibleTrigger>
                                                <CollapsibleContent>
                                                    <SidebarMenuSub>
                                                        {everythingConversations.slice(0, 7).map((convo) => (
                                                            <SidebarMenuSubItem key={convo.id}>
                                                                <SidebarMenuSubButton asChild>
                                                                    <Link href={`/understand?id=${convo.id}`} className="text-xs font-medium w-full h-fit my-1">
                                                                        <p className="line-clamp-3">{convo.title}</p>
                                                                    </Link>
                                                                </SidebarMenuSubButton>
                                                            </SidebarMenuSubItem>
                                                        ))}
                                                        {everythingConversations.length > 7 && (
                                                            <SidebarMenuSubItem>
                                                                <SidebarMenuSubButton asChild>
                                                                    <Link href="/understand/past" className="text-xs font-medium h-fit my-1">
                                                                        View all chats <ArrowRight className="inline h-3 w-3 ml-1" />
                                                                    </Link>
                                                                </SidebarMenuSubButton>
                                                            </SidebarMenuSubItem>
                                                        )}
                                                    </SidebarMenuSub>
                                                </CollapsibleContent>
                                            </SidebarMenuItem>
                                        </Collapsible>
                                    )
                                }
                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild>
                                            <Link href={item.requiresAuth && !user ? "/login" : item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                                {item.beta && (
                                                    <span className="ml-1 text-xs text-yellow-500 bg-yellow-100 dark:bg-yellow-800 dark:text-yellow-200 px-1 rounded">
                                                        Beta
                                                    </span>
                                                )}
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            })}
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

                <OnboardingChecklist />

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
                        {isMobile ? (
                            <Sheet>
                                <SheetTrigger asChild>
                                    <SidebarMenuButton className="flex items-center gap-2">
                                        <span className="flex items-center gap-2 truncate">
                                            <Avatar className="h-6 w-6">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                {user.picture ? <img src={user.picture} alt={user.name} /> : <UserIcon size={16} />}
                                            </Avatar>
                                            <span className="truncate">{user.name}</span>
                                        </span>
                                        <ChevronsUpDown className="h-4 w-4 ml-auto" />
                                    </SidebarMenuButton>
                                </SheetTrigger>
                                <SheetContent side="bottom">
                                    <UserMenuContent user={user} handleLogout={handleLogout} toggleDarkMode={toggleDarkMode} darkMode={darkMode} />
                                </SheetContent>
                            </Sheet>
                        ) : (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <SidebarMenuButton className="flex items-center gap-2">
                                        <span className="flex items-center gap-2 truncate">
                                            <Avatar className="h-6 w-6">
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                {user.picture ? (<img src={user.picture} alt={user.name} />) : (<UserIcon size={16} />)}
                                            </Avatar>
                                            <span className="truncate">{user.name}</span>
                                        </span>
                                        <ChevronsUpDown className="h-4 w-4 ml-auto" />
                                    </SidebarMenuButton>
                                </PopoverTrigger>
                                <PopoverContent className="w-60 p-1" align="start">
                                    <UserMenuContent user={user} handleLogout={handleLogout} toggleDarkMode={toggleDarkMode} darkMode={darkMode} />
                                </PopoverContent>
                            </Popover>
                        )}
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
                                <UserIcon size={16} />
                                <span className="font-medium">Sign In</span>
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
            </SidebarFooter>
        </Sidebar >
    )
}
