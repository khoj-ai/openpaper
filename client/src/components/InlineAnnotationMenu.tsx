import { PaperHighlight } from "@/app/paper/[id]/page";
import { getSelectionOffsets } from "./utils/PdfTextUtils";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { CommandShortcut } from "./ui/command";
import { Highlighter, Minus, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@radix-ui/react-popover";
import { Textarea } from "./ui/textarea";

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
    addHighlight: (selectedText: string, annotation?: string, startOffset?: number, endOffset?: number) => void;
    removeHighlight: (highlight: PaperHighlight) => void;
    setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function InlineAnnotationMenu(props: InlineAnnotationMenuProps) {
    const { selectedText, tooltipPosition, setSelectedText, setTooltipPosition, setIsAnnotating, highlights, setHighlights, isHighlightInteraction, activeHighlight, addHighlight, removeHighlight, setUserMessageReferences } = props;

    const localizeCommandToOS = (key: string) => {
        // Check if the user is on macOS using userAgent
        const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
        if (isMac) {
            return `⌘ ${key}`;
        } else {
            return `Ctrl ${key}`;
        }
    }

    const [annotationText, setAnnotationText] = useState<string>("");
    const [offsets, setOffsets] = useState<{ start: number; end: number } | null>(null);

    if (!tooltipPosition) return null;

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
        }

        window.addEventListener("keydown", handleMouseDown);
        return () => window.removeEventListener("keydown", handleMouseDown);
    }, [selectedText]);

    return (
        <div
            className="fixed z-30 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-2 border border-gray-200 dark:border-gray-700"
            style={{
                left: `${Math.min(tooltipPosition.x, window.innerWidth - 200)}px`,
                top: `${tooltipPosition.y + 20}px`, // Position slightly below the cursor
            }}
            onClick={(e) => e.stopPropagation()} // Stop click events from bubbling
            onMouseDown={(e) => e.stopPropagation()} // Also prevent mousedown from bubbling
        >
            <div className="flex flex-col gap-2 text-sm">
                <Button
                    variant={'ghost'}
                    onClick={() => {
                        navigator.clipboard.writeText(selectedText);
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                    }}
                >
                    <CommandShortcut>
                        <span className="text-secondary-foreground">
                            {localizeCommandToOS('C')}
                        </span>
                    </CommandShortcut>
                </Button>
                <Button
                    className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                    onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
                    onClick={(e) => {
                        e.stopPropagation();
                        console.log("Adding highlight:", selectedText);

                        // Use the new addHighlight function that uses offsets
                        addHighlight(selectedText, "");
                    }}
                >
                    <Highlighter size={16} />
                    <span className="text-white">Highlight</span>
                </Button>
                {
                    isHighlightInteraction && (
                        <Button
                            variant={'ghost'}
                            onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
                            onClick={(e) => {
                                e.stopPropagation();

                                // Remove the highlight based on offsets
                                if (activeHighlight) {
                                    removeHighlight(activeHighlight);
                                    setSelectedText("");
                                    setTooltipPosition(null);
                                    setIsAnnotating(false);
                                }
                            }}
                        >
                            <Minus size={16} />
                        </Button>
                    )
                }
                <Button
                    variant={'ghost'}
                    onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
                    onClick={(e) => {
                        setUserMessageReferences((prev: string[]) => {
                            const newReferences = [...prev, selectedText];
                            return Array.from(new Set(newReferences)); // Remove duplicates
                        });
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                        e.stopPropagation();
                    }}
                >
                    <span>Add to Chat</span>
                    <Plus size={16} />
                    <CommandShortcut>
                        <span className="text-secondary-foreground">
                            {localizeCommandToOS('A')}
                        </span>
                    </CommandShortcut>
                </Button>
                <Popover>
                    <PopoverTrigger
                        asChild>
                        <Button
                            variant={'ghost'}
                            onMouseDown={(e) => e.preventDefault()} // Prevent text deselection
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            Annotate
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className="p-2 bg-background"
                    >
                        <div className="flex flex-col gap-2">
                            <Textarea
                                placeholder="Add a note..."
                                value={annotationText}
                                onChange={(e) => setAnnotationText(e.target.value)}
                            />
                            <Button
                                className="w-fit"
                                onClick={() => {
                                    // If using an activeHighlight, first get the matching one in the current set of highlights, then update it
                                    if (activeHighlight) {
                                        const updatedHighlights = highlights.map(highlight => {
                                            if (highlight.start_offset === activeHighlight.start_offset &&
                                                highlight.end_offset === activeHighlight.end_offset) {
                                                return { ...highlight, annotation: annotationText };
                                            }
                                            return highlight;
                                        });
                                        setHighlights(updatedHighlights);
                                    } else {
                                        // Use the new addHighlight function with annotation
                                        addHighlight(selectedText, annotationText, offsets?.start, offsets?.end);
                                    }
                                    setAnnotationText("");
                                    setSelectedText("");
                                    setTooltipPosition(null);
                                    setIsAnnotating(false);
                                }}
                            >
                                Add Annotation
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>

                <Button
                    variant={'ghost'}
                    onClick={() => {
                        setSelectedText("");
                        setTooltipPosition(null);
                        setIsAnnotating(false);
                    }}
                >
                    <X size={16} />
                </Button>
            </div>
        </div>
    )
}
