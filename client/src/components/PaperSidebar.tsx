import { CitePaperButton } from '@/components/CitePaperButton';
import { HIGHLIGHT_COLOR_SWATCHES } from '@/components/pdf-viewer/highlightColors';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type { HighlightColor } from '@/lib/schema';
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
            icon: React.ComponentType<{ className?: string }>;
        }[];
    };
    highlightColor?: HighlightColor;
    setHighlightColor?: (color: HighlightColor) => void;
    showAnnotationCards?: boolean;
    onToggleAnnotationCards?: () => void;
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
                            ? 'bg-blue-500 text-blue-100 hover:bg-blue-600 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500'
                            : 'text-secondary-foreground hover:bg-blue-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-foreground'
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

export function PaperSidebar({
    rightSideFunction,
    setRightSideFunction,
    PaperToolset,
    highlightColor,
    setHighlightColor,
    showAnnotationCards,
    onToggleAnnotationCards,
}: PaperSidebarProps) {
    const beforeReadTool = PaperToolset.nav.filter(item => item.name !== 'Read');
    const readTool = PaperToolset.nav.find(item => item.name === 'Read');

    const toolbarTopClass = COMPACT_TOP_OFFSET_TOOLS.has(rightSideFunction) ? 'top-2' : 'top-14';
    const currentSwatch =
        HIGHLIGHT_COLOR_SWATCHES.find((c) => c.color === highlightColor) || HIGHLIGHT_COLOR_SWATCHES[2];

    return (
        <TooltipProvider>
            <div
                className={cn(
                    'absolute right-2 z-20 flex flex-col gap-0.5 p-1 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg transition-[top] duration-200 dark:bg-zinc-900/95 dark:border-zinc-600 dark:ring-1 dark:ring-white/10 dark:shadow-black/40',
                    toolbarTopClass,
                )}
            >
                {beforeReadTool.map((item) => (
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
                {readTool && (
                    <NavButton item={readTool} rightSideFunction={rightSideFunction} setRightSideFunction={setRightSideFunction} />
                )}
                {onToggleAnnotationCards && showAnnotationCards !== undefined && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                className={cn(
                                    'h-7 w-7 p-0 rounded-md',
                                    showAnnotationCards
                                        ? 'text-secondary-foreground hover:bg-blue-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-foreground'
                                        : 'text-muted-foreground hover:bg-muted dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                                )}
                                onClick={onToggleAnnotationCards}
                                aria-label={showAnnotationCards ? 'Hide annotations' : 'Show annotations'}
                            >
                                {showAnnotationCards ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left" sideOffset={8}>
                            {showAnnotationCards ? 'Hide annotations' : 'Show annotations'}
                        </TooltipContent>
                    </Tooltip>
                )}
                {highlightColor !== undefined && setHighlightColor && (
                    <DropdownMenu>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-7 w-7 p-0 rounded-full"
                                        aria-label="Highlight color"
                                    >
                                        <span
                                            className={cn(
                                                'block w-4 h-4 rounded-full ring-1 ring-border',
                                                currentSwatch.bg
                                            )}
                                        />
                                    </Button>
                                </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent side="left" sideOffset={8}>
                                Highlight color
                            </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent side="left" align="start" className="min-w-0">
                            <div className="flex gap-1 p-1">
                                {HIGHLIGHT_COLOR_SWATCHES.map(({ color, bg }) => (
                                    <button
                                        key={color}
                                        type="button"
                                        onClick={() => setHighlightColor(color)}
                                        className={`w-6 h-6 rounded-sm ${bg} hover:scale-110 transition-transform ${
                                            highlightColor === color ? 'ring-2 ring-offset-1 ring-gray-400' : ''
                                        }`}
                                        title={color}
                                    />
                                ))}
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </TooltipProvider>
    );
}
