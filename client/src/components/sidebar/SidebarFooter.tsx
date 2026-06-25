"use client"

import Link from "next/link";
import { AlertTriangle, ChevronsUpDown, User as UserIcon, X } from "lucide-react";
import {
    SidebarFooter,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { User } from "@/lib/auth";
import { SubscriptionData } from "@/lib/schema";
import { UserAvatar, UserMenuContent } from "./UserMenuContent";
import { UsageLimitCard } from "./UsageLimitCard";
import { ReferralEntry } from "./referralEntry";
import { SubscriptionWarning } from "./subscriptionWarning";

interface AppSidebarFooterProps {
    user: User | null;
    /** The warning to show, already gated for dismissal (null = show nothing). */
    warning: SubscriptionWarning | null;
    onDismissWarning: (key: string) => void;
    subscription: SubscriptionData | null;
    subscriptionLoading: boolean;
    isMobile: boolean;
    darkMode: boolean;
    onToggleDarkMode: () => void;
    onLogout: () => void;
    referralEntry: ReferralEntry | null;
}

export function AppSidebarFooter({
    user,
    warning,
    onDismissWarning,
    subscription,
    subscriptionLoading,
    isMobile,
    darkMode,
    onToggleDarkMode,
    onLogout,
    referralEntry,
}: AppSidebarFooterProps) {
    return (
        <SidebarFooter>
            {/* Subscription Warning */}
            {warning && (
                <div className="mb-2">
                    <Alert variant={warning.type === 'error' ? 'destructive' : 'warning'} className="p-3">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium mb-1">
                                        {warning.title}
                                    </div>
                                    <AlertDescription className="text-xs">
                                        {warning.description}
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
                                onClick={() => onDismissWarning(warning.key)}
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
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                        <UserAvatar user={user} className="h-6 w-6 shrink-0" iconSize={16} />
                                        <span className="truncate">{user.name || user.email}</span>
                                    </span>
                                    <ChevronsUpDown className="h-4 w-4 shrink-0" />
                                </SidebarMenuButton>
                            </SheetTrigger>
                            <SheetContent side="bottom">
                                <UserMenuContent user={user} handleLogout={onLogout} toggleDarkMode={onToggleDarkMode} darkMode={darkMode} referralEntry={referralEntry} />
                            </SheetContent>
                        </Sheet>
                    ) : (
                        <Popover>
                            <PopoverTrigger asChild>
                                <SidebarMenuButton className="flex items-center gap-2">
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                        <UserAvatar user={user} className="h-6 w-6 shrink-0" iconSize={16} />
                                        <span className="truncate">{user.name || user.email}</span>
                                    </span>
                                    <ChevronsUpDown className="h-4 w-4 shrink-0" />
                                </SidebarMenuButton>
                            </PopoverTrigger>
                            <PopoverContent className="w-60 p-1" align="start">
                                <UserMenuContent user={user} handleLogout={onLogout} toggleDarkMode={onToggleDarkMode} darkMode={darkMode} referralEntry={referralEntry} />
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
    )
}
