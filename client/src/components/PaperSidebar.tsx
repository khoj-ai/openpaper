import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuItem,
    SidebarProvider
} from "@/components/ui/sidebar";
import { LucideIcon, Share, FolderCode } from 'lucide-react';

interface PaperSidebarProps {
    rightSideFunction: string;
    setRightSideFunction: (value: string) => void;
    PaperToolset: {
        nav: {
            name: string;
            icon: LucideIcon;
        }[];
    };
}

export function PaperSidebar({ rightSideFunction, setRightSideFunction, PaperToolset }: PaperSidebarProps) {
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);

    return (
        <div
            className={`flex flex-col h-[calc(100vh-128px)] md:h-[calc(100vh-64px)] absolute right-0 top-0 bg-background z-20 transition-all duration-300 ease-in-out`}
            onMouseEnter={() => setIsSidebarHovered(true)}
            onMouseLeave={() => setIsSidebarHovered(false)}
        >
            <SidebarProvider className="items-start h-[calc(100vh-128px)] md:h-[calc(100vh-64px)] min-h-fit">
                <Sidebar collapsible="none" className="flex transition-all duration-300 ease-in-out" style={{ width: isSidebarHovered ? '180px' : '60px' }}>
                    <SidebarContent>
                        <SidebarGroup>
                            <SidebarGroupLabel className={`transition-opacity duration-300 ${isSidebarHovered ? 'opacity-100' : 'opacity-50'}`}>Tools</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {PaperToolset.nav.map((item) => (
                                        <SidebarMenuItem key={item.name}>
                                            <Button
                                                variant="ghost"
                                                className={`h-10 p-2 rounded-lg flex items-center overflow-hidden transition-colors duration-200 ${isSidebarHovered ? 'w-full justify-start' : 'w-fit justify-center'} ${item.name === rightSideFunction ? 'bg-blue-500 dark:bg-blue-500 text-blue-100 dark:text-blue-100' : 'text-secondary-foreground hover:bg-blue-200 dark:hover:bg-blue-800'}`}
                                                onClick={() => {
                                                    setRightSideFunction(item.name);
                                                }}
                                            >
                                                <item.icon className={`h-5 w-5 flex-shrink-0 ${isSidebarHovered ? "mr-2" : ""}`} />
                                                {isSidebarHovered && <span className="ml-2 whitespace-nowrap transition-opacity duration-300 opacity-100">{item.name}</span>}
                                            </Button>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    </SidebarContent>
                </Sidebar>
            </SidebarProvider>
        </div>
    );
}
