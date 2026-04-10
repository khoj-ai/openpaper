import React from 'react';
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { CitePaperButton } from '@/components/CitePaperButton';
import { Eye, EyeOff } from 'lucide-react';

interface PaperSidebarProps {
    rightSideFunction: string;
    setRightSideFunction: (value: string) => void;
    PaperToolset: {
        nav: {
            name: string;
            icon: React.ComponentType<{ className?: string }>;
        }[];
    };
    showAnnotationCards: boolean;
    onToggleAnnotationCards: () => void;
}

function NavButton({ item, rightSideFunction, setRightSideFunction }: {
    item: { name: string; icon: React.ComponentType<{ className?: string }> };
    rightSideFunction: string;
    setRightSideFunction: (value: string) => void;
}) {
    return (
        <Tooltip key={item.name}>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    className={`h-7 w-7 p-0 rounded-md ${
                        item.name === rightSideFunction
                            ? 'bg-blue-500 dark:bg-blue-500 text-blue-100 dark:text-blue-100 hover:bg-blue-600 dark:hover:bg-blue-600'
                            : 'text-secondary-foreground hover:bg-blue-100 dark:hover:bg-blue-800'
                    }`}
                    onClick={() => setRightSideFunction(item.name)}
                >
                    <item.icon className="h-4 w-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
                {item.name}
            </TooltipContent>
        </Tooltip>
    );
}

export function PaperSidebar({ rightSideFunction, setRightSideFunction, PaperToolset, showAnnotationCards, onToggleAnnotationCards }: PaperSidebarProps) {
    const beforeFocus = PaperToolset.nav.filter(item => item.name !== 'Focus');
    const focusTool = PaperToolset.nav.find(item => item.name === 'Focus');

    return (
        <TooltipProvider>
            <div className="absolute right-2 top-14 z-20 flex flex-col gap-0.5 p-1 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-md">
                {beforeFocus.map((item) => (
                    <NavButton key={item.name} item={item} rightSideFunction={rightSideFunction} setRightSideFunction={setRightSideFunction} />
                ))}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            <CitePaperButton iconOnly />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                        Cite
                    </TooltipContent>
                </Tooltip>
                {/* Annotation cards visibility toggle */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            className={`h-7 w-7 p-0 rounded-md ${
                                showAnnotationCards
                                    ? 'text-secondary-foreground hover:bg-blue-100 dark:hover:bg-blue-800'
                                    : 'text-muted-foreground hover:bg-muted'
                            }`}
                            onClick={onToggleAnnotationCards}
                        >
                            {showAnnotationCards
                                ? <Eye className="h-4 w-4" />
                                : <EyeOff className="h-4 w-4" />
                            }
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                        {showAnnotationCards ? 'Hide annotations' : 'Show annotations'}
                    </TooltipContent>
                </Tooltip>
                {focusTool && (
                    <NavButton item={focusTool} rightSideFunction={rightSideFunction} setRightSideFunction={setRightSideFunction} />
                )}
            </div>
        </TooltipProvider>
    );
}
