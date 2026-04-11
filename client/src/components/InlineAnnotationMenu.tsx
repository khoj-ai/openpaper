import {
    PaperHighlight,
} from '@/lib/schema';

import { useEffect, useState, useRef } from "react";
import { Button } from "./ui/button";
import { Bookmark, Copy, Highlighter, MessageCircle, Minus } from "lucide-react";

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
    addHighlight: (selectedText: string, doAnnotate?: boolean) => void;
    removeHighlight: (highlight: PaperHighlight) => void;
    setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
    onAnnotate: (y: number) => void;
}

// Compact horizontal card — always rendered below the anchor
const MENU_HEIGHT = 40;
const MENU_WIDTH = 300;
const MENU_OFFSET = 6;

interface ActionButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: (e: React.MouseEvent) => void;
    className?: string;
}

function ActionButton({ icon, label, onClick, className = "" }: ActionButtonProps) {
    return (
        <Button
            variant="ghost"
            className={`flex items-center gap-1 h-6 px-1.5 text-[11px] font-normal ${className}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClick}
        >
            {icon}
            {label}
        </Button>
    );
}

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
        onAnnotate,
    } = props;

    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);

    // Always place below the anchor, clamped to viewport edges
    useEffect(() => {
        if (!tooltipPosition) {
            setMenuPosition(null);
            return;
        }
        const left = Math.min(
            Math.max(0, tooltipPosition.x),
            window.innerWidth - MENU_WIDTH
        );
        const spaceBelow = window.innerHeight - tooltipPosition.y - MENU_OFFSET;
        const top = spaceBelow >= MENU_HEIGHT
            ? tooltipPosition.y + MENU_OFFSET
            : tooltipPosition.y - MENU_HEIGHT - MENU_OFFSET;
        setMenuPosition({ left, top });
    }, [tooltipPosition]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            } else if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
                navigator.clipboard.writeText(selectedText);
            } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
                setUserMessageReferences((prev: string[]) =>
                    Array.from(new Set([...prev, selectedText]))
                );
            } else if (e.key === "h" && (e.ctrlKey || e.metaKey)) {
                addHighlight(selectedText);
                e.stopPropagation();
            } else if (e.key === "d" && (e.ctrlKey || e.metaKey) && isHighlightInteraction && activeHighlight) {
                removeHighlight(activeHighlight);
                close();
            } else if (e.key === "e" && (e.ctrlKey || e.metaKey)) {
                if (tooltipPosition) onAnnotate(tooltipPosition.y);
                setIsAnnotating(true);
                setTooltipPosition(null);
                setSelectedText("");
            } else {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedText]);

    const close = () => {
        setSelectedText("");
        setTooltipPosition(null);
        setIsAnnotating(false);
    };

    // Dismiss on outside click
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            // Let handleHighlightClick handle highlight clicks — don't close here
            if (target.closest?.('.TextHighlight__parts, .TextHighlight__part')) return;
            if (menuRef.current && !menuRef.current.contains(target)) {
                close();
            }
        };
        const timerId = setTimeout(() => {
            document.addEventListener("mousedown", handleOutsideClick);
        }, 100);
        return () => {
            clearTimeout(timerId);
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [tooltipPosition]);

    if (!tooltipPosition || !menuPosition) return null;

    return (
        <div
            ref={menuRef}
            data-inline-annotation-menu=""
            className="fixed z-30 bg-background shadow-md rounded-lg border border-border"
            style={{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="flex items-center gap-0.5 p-1">
                {/* Save — hidden when interacting with an existing highlight */}
                {!isHighlightInteraction && (
                    <ActionButton
                        icon={<Bookmark size={11} />}
                        label="Save"
                        onClick={(e) => {
                            e.stopPropagation();
                            addHighlight(selectedText, false);
                        }}
                    />
                )}

                {/* Annotate */}
                <ActionButton
                    icon={<Highlighter size={11} />}
                    label="Annotate"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (tooltipPosition) onAnnotate(tooltipPosition.y);
                        setIsAnnotating(true);
                        setTooltipPosition(null);
                        setSelectedText("");
                        if (!isHighlightInteraction) {
                            addHighlight(selectedText, true);
                        }
                    }}
                />

                {/* Ask */}
                <ActionButton
                    icon={<MessageCircle size={11} />}
                    label="Ask"
                    onClick={(e) => {
                        e.stopPropagation();
                        setUserMessageReferences(prev =>
                            Array.from(new Set([...prev, selectedText]))
                        );
                        close();
                    }}
                />

                {/* Copy */}
                <ActionButton
                    icon={<Copy size={11} />}
                    label="Copy"
                    onClick={() => {
                        navigator.clipboard.writeText(selectedText);
                        close();
                    }}
                />

                {/* Delete — only when interacting with an existing highlight */}
                {isHighlightInteraction && activeHighlight && (
                    <ActionButton
                        icon={<Minus size={11} />}
                        label="Delete"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => {
                            e.stopPropagation();
                            removeHighlight(activeHighlight);
                            close();
                        }}
                    />
                )}

            </div>
        </div>
    );
}
