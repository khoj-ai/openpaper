"use client"

import {
    SidebarMenuItem,
    SidebarMenuButton,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import React from "react";

interface CollapsibleSidebarMenuProps<T extends { id: string; title?: string; }> {
    icon: React.ElementType;
    title: string;
    url: string;
    items: T[];
    viewAllUrl: string;
    viewAllText: string;
    getItemUrl: (item: T) => string;
    getItemName?: (item: T) => string;
    defaultOpen?: boolean;
    maxItems?: number;
    tag?: string;
}

export function CollapsibleSidebarMenu<T extends { id: string; title?: string; }>({
    icon: Icon,
    title,
    url,
    items,
    viewAllUrl,
    viewAllText,
    getItemUrl,
    getItemName,
    defaultOpen = false,
    maxItems = 7,
    tag,
}: CollapsibleSidebarMenuProps<T>) {
    return (
        <Collapsible asChild defaultOpen={defaultOpen} className="group/collapsible">
            <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                    <Link href={url}>
                        <SidebarMenuButton>
                            <Icon />
                            <span>{title}</span>
                            {tag && (
                                <span className="ml-1 text-xs text-yellow-500 bg-yellow-100 dark:bg-yellow-800 dark:text-yellow-200 px-1 rounded">
                                    {tag}
                                </span>
                            )}
                            <ChevronDown className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                        </SidebarMenuButton>
                    </Link>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <SidebarMenuSub>
                        {items.slice(0, maxItems).map((item) => (
                            <SidebarMenuSubItem key={item.id}>
                                <SidebarMenuSubButton asChild>
                                    <Link href={getItemUrl(item)} className="text-xs font-medium w-full h-fit my-1">
                                        <p className="line-clamp-3">{getItemName ? getItemName(item) : item.title}</p>
                                    </Link>
                                </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                        ))}
                        {items.length > maxItems && (
                            <SidebarMenuSubItem>
                                <SidebarMenuSubButton asChild>
                                    <Link href={viewAllUrl} className="text-xs font-medium h-fit my-1">
                                        {viewAllText} <ArrowRight className="inline h-3 w-3 ml-1" />
                                    </Link>
                                </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                        )}
                    </SidebarMenuSub>
                </CollapsibleContent>
            </SidebarMenuItem>
        </Collapsible>
    );
}
