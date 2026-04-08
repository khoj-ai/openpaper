"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BasicUser } from "@/lib/auth";
import { PaperHighlightAnnotation } from "@/lib/schema";
import { getAlphaHashToBackgroundColor, getInitials } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface InlineAnnotationCardProps {
    highlightId: string;
    topPosition: number;
    leftPosition: number;
    initialContent?: string;
    isActive?: boolean;
    user: BasicUser | null;
    addAnnotation: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
    onClose: () => void;
}

export function InlineAnnotationCard({
    highlightId,
    topPosition,
    leftPosition,
    initialContent,
    isActive = false,
    user,
    addAnnotation,
    onClose,
}: InlineAnnotationCardProps) {
    const [content, setContent] = useState(initialContent ?? "");
    const [isSaving, setIsSaving] = useState(false);
    const [isEditing, setIsEditing] = useState(!initialContent);
    const cardRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const timestamp = `${timeStr} Today`;

    const handleSave = async () => {
        if (!content.trim() || isSaving) return;
        setIsSaving(true);
        try {
            await addAnnotation(highlightId, content.trim());
            setIsEditing(false);
        } finally {
            setIsSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === "Escape") {
            onClose();
        }
    };

    // Focus textarea when entering edit mode
    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus();
            // Move cursor to end
            const len = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(len, len);
        }
    }, [isEditing]);

    // Outside click: close only if nothing has been typed; otherwise collapse to read mode
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
                if (!content.trim()) {
                    onClose();
                } else if (isEditing) {
                    setIsEditing(false);
                }
            }
        };
        const timerId = setTimeout(() => {
            document.addEventListener("mousedown", handleOutsideClick);
        }, 100);
        return () => {
            clearTimeout(timerId);
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [onClose, content, isEditing]);

    const displayName = user?.name || "Anonymous";
    const avatarBg = user?.name ? getAlphaHashToBackgroundColor(user.name) : "bg-muted";

    return (
        <div
            ref={cardRef}
            className={`absolute z-40 w-[280px] border border-border rounded-xl shadow-lg p-4 flex flex-col gap-3 transition-colors duration-200 ${isActive ? "bg-background" : "bg-[#ebebeb] dark:bg-zinc-800"} ${!isEditing && content ? "cursor-pointer" : ""}`}
            style={{ left: `${leftPosition}px`, top: `${topPosition}px` }}
            onClick={(e) => {
                e.stopPropagation();
                if (!isEditing && content) setIsEditing(true);
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* User info */}
            <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 flex-shrink-0">
                    {user?.picture && <AvatarImage src={user.picture} alt={displayName} />}
                    <AvatarFallback
                        className="text-xs text-white font-medium"
                        style={{ backgroundColor: avatarBg }}
                    >
                        {getInitials(displayName)}
                    </AvatarFallback>
                </Avatar>
                <div className="flex flex-col leading-tight flex-1">
                    <span className="text-sm font-medium">{displayName}</span>
                    <span className="text-xs text-muted-foreground">{timestamp}</span>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <X size={14} />
                </Button>
            </div>

            {/* Annotation — editable textarea in edit mode, plain text in read mode */}
            {isEditing ? (
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Write your notes here and press Enter to save"
                    className="text-sm text-foreground placeholder:text-muted-foreground resize-none bg-transparent border-none outline-none w-full min-h-[72px] p-0 focus:outline-none"
                    rows={3}
                    disabled={isSaving}
                />
            ) : (
                <p className="text-sm text-foreground whitespace-pre-wrap">{content}</p>
            )}
        </div>
    );
}
