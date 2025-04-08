import { PaperHighlight } from "@/app/paper/[id]/page";
import { getSelectionOffsets } from "./utils/PdfTextUtils";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { CommandShortcut } from "./ui/command";
import { Highlighter, Minus, Plus, X } from "lucide-react";

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
    addHighlight: (selectedText: string, startOffset?: number, endOffset?: number) => void;
    removeHighlight: (highlight: PaperHighlight) => void;
    setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
    setAddedContentForPaperNote: (content: string) => void;
}

export default function InlineAnnotationMenu(props: InlineAnnotationMenuProps) {
    const { selectedText, tooltipPosition, setSelectedText, setTooltipPosition, setIsAnnotating, isHighlightInteraction, activeHighlight, addHighlight, removeHighlight, setUserMessageReferences, setAddedContentForPaperNote } = props;

    const localizeCommandToOS = (key: string) => {
        // Check if the user is on macOS using userAgent
        const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
        if (isMac) {
            return `⌘ ${key}`;
        } else {
            return `Ctrl ${key}`;
        }
    }

    const [offsets, setOffsets] = useState<{ start: number; end: number } | null>(null);


    useEffect(() => {
        if (selectedText) {
            const offsets = getSelectionOffsets();
            if (offsets) {
                setOffsets(offsets);
            }
        }

        const handleMouseDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedText("");
                setTooltipPosition(null);
                setIsAnnotating(false);
            }

            if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
                navigator.clipboard.writeText(selectedText);
            }
            if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                setUserMessageReferences((prev: string[]) => {
                    const newReferences = [...prev, selectedText];
                    return Array.from(new Set(newReferences)); // Remove duplicates
                });
            }

            if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
                setAddedContentForPaperNote(selectedText);
                setSelectedText("");
                setTooltipPosition(null);
                setIsAnnotating(false);
            }
        }

        window.addEventListener("keydown", handleMouseDown);
        return () => window.removeEventListener("keydown", handleMouseDown);
    }, [selectedText]);

    if (!tooltipPosition) return null;

    return (
        <div
            className="fixed z-30 bg-background shadow-lg rounded-lg p-3 border border-border w-[200px]"
            style={{
                left: `${Math.min(tooltipPosition.x, window.innerWidth - 220)}px`,
                top: `${tooltipPosition.y + 20}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="flex flex-col gap-1.5">
                {/* Copy Button */}
                <Button
                    variant="ghost"
                    className="w-full justify-between text-sm font-normal h-9"
                    onClick={() => {
                        navigator.clipboard.writeText(selectedText);
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                    }}
                >
                    Copy
                    <CommandShortcut className="text-muted-foreground">
                        {localizeCommandToOS('C')}
                    </CommandShortcut>
                </Button>

                {/* Highlight Button */}
                <Button
                    variant="default"
                    className="w-full justify-start gap-2 text-sm h-9"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        e.stopPropagation();
                        addHighlight(selectedText, offsets?.start, offsets?.end);
                    }}
                >
                    <Highlighter size={14} />
                    Highlight
                </Button>

                {/* Add Note Button */}
                <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 text-sm h-9"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                        e.stopPropagation();
                        setAddedContentForPaperNote(selectedText);
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                    }}
                >
                    <Plus size={14} />
                    Add to Note
                    <CommandShortcut className="text-muted-foreground">
                        {localizeCommandToOS('N')}
                    </CommandShortcut>
                </Button>

                {/* Remove Highlight Button - Only show when interacting with highlight */}
                {isHighlightInteraction && (
                    <Button
                        variant="destructive"
                        className="w-full justify-start gap-2 text-sm h-9"
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
                        <Minus size={14} />
                        Remove Highlight
                    </Button>
                )}

                {/* Add to Chat Button */}
                <Button
                    variant="ghost"
                    className="w-full justify-between text-sm font-normal h-9"
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
                        <Plus size={14} />
                        Add to Chat
                    </div>
                    <CommandShortcut className="text-muted-foreground">
                        {localizeCommandToOS('A')}
                    </CommandShortcut>
                </Button>

                {/* Close Button */}
                <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 text-sm h-9"
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
