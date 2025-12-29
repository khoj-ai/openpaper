import {
    PaperHighlight,
} from '@/lib/schema';

import { useEffect, useState, useRef } from "react";
import { Button } from "./ui/button";
import { CommandShortcut, localizeCommandToOS } from "./ui/command";
import { Bookmark, Copy, Highlighter, MessageCircle, Minus, X } from "lucide-react";

interface InlineAnnotationMenuProps {
    selectedText: string;
    tooltipPosition: { x: number; y: number } | null;
    setSelectedText: (text: string) => void;
    setTooltipPosition: (position: { x: number; y: number } | null) => void;
    setIsAnnotating: (isAnnotating: boolean) => void;
    highlights: Array<PaperHighlight>;
    setHighlights: (highlights: Array<PaperHighlight>) => void;
    isHighlightInteraction: boolean;
    activeHighlight: PaperHighlight | null;
    addHighlight: (selectedText: string, startOffset?: number, endOffset?: number, pageNumber?: number, doAnnotate?: boolean) => void;
    removeHighlight: (highlight: PaperHighlight) => void;
    setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
}

// Estimated height of the menu (5-6 buttons at ~36px each + padding)
const MENU_HEIGHT = 280;
const MENU_WIDTH = 220;
const MENU_OFFSET = 20;

export default function InlineAnnotationMenu(props: InlineAnnotationMenuProps) {
    const {
        selectedText,
        tooltipPosition,
        setSelectedText,
        setTooltipPosition,
        setIsAnnotating,
        isHighlightInteraction,
        activeHighlight,
        addHighlight,
        removeHighlight,
        setUserMessageReferences,
    } = props;

    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);

    // Calculate optimal position when tooltip position changes
    useEffect(() => {
        if (!tooltipPosition) {
            setMenuPosition(null);
            return;
        }

        // Calculate horizontal position (keep existing logic)
        const left = Math.min(tooltipPosition.x, window.innerWidth - MENU_WIDTH);

        // Calculate vertical position - check if menu fits below cursor
        const spaceBelow = window.innerHeight - tooltipPosition.y - MENU_OFFSET;
        const spaceAbove = tooltipPosition.y - MENU_OFFSET;

        let top: number;
        if (spaceBelow >= MENU_HEIGHT) {
            // Enough space below - render below cursor
            top = tooltipPosition.y + MENU_OFFSET;
        } else if (spaceAbove >= MENU_HEIGHT) {
            // Not enough space below, but enough above - render above cursor
            top = tooltipPosition.y - MENU_HEIGHT - MENU_OFFSET;
        } else {
            // Not enough space either way - render where there's more space
            if (spaceBelow >= spaceAbove) {
                top = tooltipPosition.y + MENU_OFFSET;
            } else {
                top = Math.max(10, tooltipPosition.y - MENU_HEIGHT - MENU_OFFSET);
            }
        }

        setMenuPosition({ left, top });
    }, [tooltipPosition]);

    useEffect(() => {
        const handleMouseDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedText("");
                setTooltipPosition(null);
                setIsAnnotating(false);
            } else if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
                navigator.clipboard.writeText(selectedText);
            } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                setUserMessageReferences((prev: string[]) => {
                    const newReferences = [...prev, selectedText];
                    return Array.from(new Set(newReferences)); // Remove duplicates
                });
            } else if (e.key === "h" && (e.ctrlKey || e.metaKey)) {
                addHighlight(selectedText);
                e.stopPropagation();
            } else if (e.key === "d" && (e.ctrlKey || e.metaKey) && isHighlightInteraction && activeHighlight) {
                removeHighlight(activeHighlight);
                setSelectedText("");
                setTooltipPosition(null);
                setIsAnnotating(false);
            } else if (e.key === "e" && (e.ctrlKey || e.metaKey)) {
                setIsAnnotating(true);
                setTooltipPosition(null);
                setSelectedText("");
            } else {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
        }

        window.addEventListener("keydown", handleMouseDown);
        return () => window.removeEventListener("keydown", handleMouseDown);
    }, [selectedText]);

    if (!tooltipPosition || !menuPosition) return null;

    return (
        <div
            ref={menuRef}
            className="fixed z-30 bg-background shadow-lg rounded-lg p-3 border border-border w-[200px]"
            style={{
                left: `${menuPosition.left}px`,
                top: `${menuPosition.top}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="flex flex-col gap-1.5">
                {/* Copy Button */}
                <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between text-sm font-normal h-9 px-2"
                    onClick={() => {
                        navigator.clipboard.writeText(selectedText);
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                    }}
                >
                    <div className="flex items-center gap-2">
                        <Copy size={14} />
                        Copy
                    </div>
                    <CommandShortcut className="text-muted-foreground">
                        {localizeCommandToOS('C')}
                    </CommandShortcut>
                </Button>

                {/* Highlight Button */}
                {
                    !isHighlightInteraction && (
                        <Button
                            variant="ghost"
                            className="w-full flex items-center justify-between text-sm font-normal h-9 px-2"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                                e.stopPropagation();
                                addHighlight(selectedText, undefined, undefined, undefined, false);
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <Bookmark size={14} />
                                Save
                            </div>
                            <CommandShortcut className="text-muted-foreground">
                                {localizeCommandToOS('H')}
                            </CommandShortcut>
                        </Button>
                    )
                }

                {/* Annotate Button */}
                {
                    <Button
                        variant="ghost"
                        className="w-full flex items-center justify-between text-sm font-normal h-9 px-2"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsAnnotating(true);
                            setTooltipPosition(null);
                            setSelectedText("");
                            if (!isHighlightInteraction) {
                                addHighlight(selectedText, undefined, undefined, undefined, true);
                            }
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <Highlighter size={14} />
                            Annotate
                        </div>
                        <CommandShortcut className="text-muted-foreground">
                            {localizeCommandToOS('E')}
                        </CommandShortcut>
                    </Button>
                }

                {/* Add to Chat Button */}
                <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between text-sm font-normal h-9 px-2"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        setUserMessageReferences(prev => Array.from(new Set([...prev, selectedText])));
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                        e.stopPropagation();
                    }}
                >
                    <div className="flex items-center gap-2">
                        <MessageCircle size={14} />
                        Ask
                    </div>
                    <CommandShortcut className="text-muted-foreground">
                        {localizeCommandToOS('A')}
                    </CommandShortcut>
                </Button>


                {/* Remove Highlight Button - Only show when interacting with highlight */}
                {isHighlightInteraction && activeHighlight && (
                    <Button
                        variant="ghost"
                        className="w-full flex items-center justify-between text-sm font-normal h-9 px-2 text-destructive"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (activeHighlight) {
                                removeHighlight(activeHighlight);
                                setSelectedText("");
                                setTooltipPosition(null);
                                setIsAnnotating(false);
                            }
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <Minus size={14} />
                            Delete
                        </div>
                        <CommandShortcut className="text-muted-foreground">
                            {localizeCommandToOS('D')}
                        </CommandShortcut>
                    </Button>
                )}

                {/* Close Button */}
                <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between text-sm font-normal h-9 px-2"
                    onClick={() => {
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                    }}
                >
                    <div className="flex items-center gap-2">
                        <X size={14} />
                        Close
                    </div>
                    <CommandShortcut className="text-muted-foreground">
                        Esc
                    </CommandShortcut>
                </Button>
            </div>
        </div>
    );
}
