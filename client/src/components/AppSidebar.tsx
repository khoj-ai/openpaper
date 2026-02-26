"use client"

import {
    AlertTriangle,
    ChevronsUpDown,
    FileText,
    FolderKanban,
    Compass,
    Globe2,
    Home,
    LogOut,
    MessageCircleQuestion,
    Moon,
    Route,
    Settings,
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
} from "@/components/ui/sidebar";
import { useEffect, useState } from "react";
import { fetchFromApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useAuth, User } from "@/lib/auth";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { useSubscription, isStorageAtLimit, isPaperUploadAtLimit, isStorageNearLimit, isPaperUploadNearLimit, isChatCreditAtLimit, isChatCreditNearLimit, formatFileSize, getStorageUsagePercentage, getPaperUploadPercentage, getChatCreditUsagePercentage, getAudioOverviewUsagePercentage, getProjectUsagePercentage, getDataTableUsagePercentage, getDiscoverSearchUsagePercentage } from "@/hooks/useSubscription";
import Link from "next/link";
import { Conversation, PaperItem, Project, SubscriptionData } from "@/lib/schema";
import { useIsMobile } from "@/hooks/use-mobile";
import { CollapsibleSidebarMenu } from "./CollapsibleSidebarMenu";

// Menu items.
const items = [
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
    {
        title: "Find Papers",
        url: "/finder",
        icon: Globe2,
        requiresAuth: false,
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
                {user.picture ? (<img src={user.picture} alt={user.name || user.email} />) : (<UserIcon size={24} />)}
            </Avatar>
            <div>
                <h3 className="font-medium">{user.name || user.email}</h3>
                <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
        </div>
        <Link href="/settings" className="w-full">
            <Button variant="ghost" className="w-full justify-start">
                <Settings size={16} className="mr-2" />
                Settings
            </Button>
        </Link>
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

const UsageLimitCard = ({
    subscription,
    loading
}: {
    subscription: SubscriptionData | null,
    loading: boolean
}) => {
    if (loading || !subscription) {
        return (
            <div className="p-4 space-y-3">
                <div className="text-sm font-medium">Loading usage data...</div>
            </div>
        );
    }

    const formatUsage = (used: number, total: number, unit: string = "") => {
        return `${used}${unit} / ${total}${unit}`;
    };

    const UsageItem = ({
        label,
        used,
        total,
        unit = "",
        percentage,
        formatValue
    }: {
        label: string,
        used: number,
        total: number,
        unit?: string,
        percentage: number,
        formatValue?: (value: number) => string
    }) => (
        <div className="space-y-2">
            <div className="flex justify-between items-center">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">
                    {formatValue ?
                        `${formatValue(used)} / ${formatValue(total)}` :
                        formatUsage(used, total, unit)
                    }
                </span>
            </div>
            <div className="relative">
                <Progress value={Math.min(percentage, 100)} className="h-2" />
            </div>
            <div className="text-xs text-muted-foreground">
                {percentage.toFixed(1)}% used
            </div>
        </div>
    );

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Usage Limits</h3>
                <Badge variant={subscription.plan === 'researcher' ? "default" : "secondary"}>
                    {subscription.plan === 'researcher' ? 'Researcher' : 'Basic'}
                </Badge>
            </div>

            <div className="space-y-4">
                <UsageItem
                    label="Paper Uploads"
                    used={subscription.usage.paper_uploads}
                    total={subscription.limits.paper_uploads}
                    percentage={getPaperUploadPercentage(subscription)}
                />

                <UsageItem
                    label="Storage"
                    used={subscription.usage.knowledge_base_size}
                    total={subscription.limits.knowledge_base_size}
                    percentage={getStorageUsagePercentage(subscription)}
                    formatValue={formatFileSize}
                />

                <UsageItem
                    label="Weekly Chat Credits"
                    used={subscription.usage.chat_credits_used}
                    total={subscription.limits.chat_credits_weekly}
                    percentage={getChatCreditUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Weekly Audio Overviews"
                    used={subscription.usage.audio_overviews_used}
                    total={subscription.limits.audio_overviews_weekly}
                    percentage={getAudioOverviewUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Weekly Data Tables"
                    used={subscription.usage.data_tables_used}
                    total={subscription.limits.data_tables_weekly}
                    percentage={getDataTableUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Weekly Discover Searches"
                    used={subscription.usage.discover_searches_used}
                    total={subscription.limits.discover_searches_weekly}
                    percentage={getDiscoverSearchUsagePercentage(subscription)}
                />

                <UsageItem
                    label="Projects"
                    used={subscription.usage.projects}
                    total={subscription.limits.projects}
                    percentage={getProjectUsagePercentage(subscription)}
                />
            </div>

            <div className="pt-2 border-t">
                <Link href="/pricing" className="w-full">
                    <Button size="sm" className="w-full">
                        {subscription.plan === 'researcher' ? 'Manage' : 'Upgrade'}
                    </Button>
                </Link>
            </div>
        </div>
    );
}




export function AppSidebar() {
    const router = useRouter();
    const { user, logout } = useAuth();
    const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
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
                const [papersResponse, conversationsResponse, projectsResponse] = await Promise.all([
                    fetchFromApi("/api/paper/active"),
                    fetchFromApi("/api/conversation/everything"),
                    fetchFromApi("/api/projects"),
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
                setProjects(projectsResponse || []);
            } catch (error) {
                console.error("Error fetching sidebar data:", error);
                setAllPapers([]);
                setEverythingConversations([]);
                setProjects([]);
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
                                        <CollapsibleSidebarMenu
                                            key={item.title}
                                            title={item.title}
                                            icon={item.icon}
                                            url={item.url}
                                            items={allPapers}
                                            getItemUrl={(paper) => `/paper/${paper.id}`}
                                            viewAllUrl="/papers"
                                            viewAllText="View all papers"
                                            defaultOpen={true}
                                        />
                                    )
                                }
                                if (item.title === "Ask") {
                                    return (
                                        <CollapsibleSidebarMenu
                                            key={item.title}
                                            title={item.title}
                                            icon={item.icon}
                                            url={item.url}
                                            items={everythingConversations}
                                            getItemUrl={(convo) => `/understand?id=${convo.id}`}
                                            viewAllUrl="/understand/past"
                                            viewAllText="View all chats"
                                            defaultOpen={false}
                                        />
                                    )
                                }
                                if (item.title === "Projects") {
                                    return (
                                        <CollapsibleSidebarMenu
                                            key={item.title}
                                            title={item.title}
                                            icon={item.icon}
                                            url={item.url}
                                            items={projects}
                                            getItemUrl={(project) => `/projects/${project.id}`}
                                            getItemName={(project) => project.title}
                                            viewAllUrl="/projects"
                                            viewAllText="View all projects"
                                            defaultOpen={false}
                                            maxItems={3}
                                        />
                                    )
                                }
                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton asChild>
                                            <Link href={item.requiresAuth && !user ? "/login" : item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                                {item.isNew && (
                                                    <Badge className="ml-auto text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900">
                                                        New
                                                    </Badge>
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

                {/* User Status Badge */}
                {user && (
                    <div className="px-2 py-1">
                        <Popover>
                            <PopoverTrigger asChild>
                                <Badge
                                    variant={user.is_active ? "default" : "secondary"}
                                    className={`w-fit justify-center cursor-pointer hover:opacity-80 transition-opacity ${user.is_active ? "bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-200" : "bg-gray-100 text-gray-800"}`}
                                >
                                    {user.is_active ? "Researcher" : "Basic"}
                                </Badge>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 p-0" align="start">
                                <UsageLimitCard subscription={subscription} loading={subscriptionLoading} />
                            </PopoverContent>
                        </Popover>
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
                                                {user.picture ? <img src={user.picture} alt={user.name || user.email} /> : <UserIcon size={16} />}
                                            </Avatar>
                                            <span className="truncate">{user.name || user.email}</span>
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
                                                {user.picture ? (<img src={user.picture} alt={user.name || user.email} />) : (<UserIcon size={16} />)}
                                            </Avatar>
                                            <span className="truncate">{user.name || user.email}</span>
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
