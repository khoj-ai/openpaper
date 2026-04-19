import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import React from 'react';

/** Primary panels where the toolbar sits higher (less gap under the top bar). */
const COMPACT_TOP_OFFSET_TOOLS = new Set(['Chat', 'Annotations', 'Audio']);

interface PaperSidebarProps {
    rightSideFunction: string;
    setRightSideFunction: (value: string) => void;
    PaperToolset: {
        nav: {
            name: string;
            /** Tooltip / display name; falls back to `name` when omitted */
            label?: string;
            icon: React.ComponentType<{ className?: string }>;
        }[];
    };
    /** Margin annotation cards visibility (PDF reader); omit to hide the control. */
    showAnnotationCards?: boolean;
    onToggleAnnotationCards?: () => void;
}

function NavButton({ item, rightSideFunction, setRightSideFunction }: {
    item: { name: string; label?: string; icon: React.ComponentType<{ className?: string }> };
    rightSideFunction: string;
    setRightSideFunction: (value: string) => void;
}) {
    const tooltipLabel = item.label ?? item.name;
    return (
        <Tooltip key={item.name}>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    className={`h-8 w-8 p-0 rounded-md ${
                        item.name === rightSideFunction
                            ? 'bg-blue-500 text-blue-100 hover:bg-blue-600 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500'
                            : 'text-secondary-foreground hover:bg-blue-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-foreground'
                    }`}
                    onClick={() => setRightSideFunction(item.name)}
                    aria-label={tooltipLabel}
                >
                    <item.icon className="h-5 w-5" />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="left" sideOffset={8}>
                {tooltipLabel}
            </TooltipContent>
        </Tooltip>
    );
}

export function PaperSidebar({
    rightSideFunction,
    setRightSideFunction,
    PaperToolset,
    showAnnotationCards = true,
    onToggleAnnotationCards,
}: PaperSidebarProps) {
    const beforeReadTool = PaperToolset.nav.filter(item => item.name !== 'Read');
    const readTool = PaperToolset.nav.find(item => item.name === 'Read');

    const toolbarTopClass = COMPACT_TOP_OFFSET_TOOLS.has(rightSideFunction) ? 'top-2' : 'top-14';

    return (
        <TooltipProvider>
            <div
                className={cn(
                    'absolute right-2 z-20 flex flex-col gap-1 p-1 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg transition-[top] duration-200 dark:bg-zinc-900/95 dark:border-zinc-600 dark:ring-1 dark:ring-white/10 dark:shadow-black/40',
                    toolbarTopClass,
                )}
            >
                {beforeReadTool.map((item) => (
                    <NavButton key={item.name} item={item} rightSideFunction={rightSideFunction} setRightSideFunction={setRightSideFunction} />
                ))}
                {readTool && (
                    <NavButton item={readTool} rightSideFunction={rightSideFunction} setRightSideFunction={setRightSideFunction} />
                )}
                {onToggleAnnotationCards && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                className={cn(
                                    'h-8 w-8 p-0 rounded-md',
                                    showAnnotationCards
                                        ? 'text-secondary-foreground hover:bg-blue-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-foreground'
                                        : 'text-muted-foreground hover:bg-blue-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                                )}
                                onClick={onToggleAnnotationCards}
                                aria-label={
                                    showAnnotationCards ? 'Hide inline annotations' : 'Show inline annotations'
                                }
                            >
                                {showAnnotationCards ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left" sideOffset={8}>
                            {showAnnotationCards ? 'Hide inline annotations' : 'Show inline annotations'}
                        </TooltipContent>
                    </Tooltip>
                )}
            </div>
        </TooltipProvider>
    );
}
