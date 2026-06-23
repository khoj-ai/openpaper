"use client"

import Link from "next/link";
import {
    Gift,
    LogOut,
    MessageCircleQuestion,
    Moon,
    Route,
    Settings,
    Sun,
    User as UserIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { User } from "@/lib/auth";
import { ReferralEntry } from "./referralEntry";

export const UserMenuContent = ({
    user,
    handleLogout,
    toggleDarkMode,
    darkMode,
    referralEntry,
}: {
    user: User,
    handleLogout: () => void,
    toggleDarkMode: () => void,
    darkMode: boolean,
    referralEntry: ReferralEntry | null,
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
        {referralEntry && (
            <Button
                variant="ghost"
                className="w-full justify-start h-auto py-2"
                onClick={referralEntry.onClick}
            >
                <Gift size={16} className="mr-2" />
                <span className="flex flex-col items-start">
                    <span>{referralEntry.label}</span>
                    {referralEntry.sublabel && (
                        <span className="text-xs text-muted-foreground font-normal">
                            {referralEntry.sublabel}
                        </span>
                    )}
                </span>
            </Button>
        )}
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
        <div className="px-3 py-2">
            <p className="text-sm text-muted-foreground px-1 mb-1.5">What&apos;s new</p>
            <div className="relative ml-2">
                <Link href="/settings#zotero" className="block">
                    <div className="relative ml-3 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors">
                        <span
                            aria-hidden
                            className="absolute -left-3 top-1/2 -translate-y-1/2 size-1.5 rounded-full bg-muted-foreground/50"
                        />
                        Zotero Integration
                    </div>
                </Link>
            </div>
        </div>
    </div>
)
