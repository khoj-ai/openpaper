"use client";

import { createPortal } from "react-dom";
import { useMemo } from "react";
import { File, User as UserIcon } from "lucide-react";
import { BasicUser } from "@/lib/auth";
import { PaperHighlightAnnotation } from "@/lib/schema";
import { formatAnnotationDate } from "@/lib/utils";

const CARD_WIDTH = 280;
const CARD_MAX_HEIGHT = 320;
const VIEWPORT_PADDING = 8;

interface AnnotationHoverCardProps {
    annotations: PaperHighlightAnnotation[];
    position: { x: number; y: number };
    user: BasicUser | null;
}

export function AnnotationHoverCard({
    annotations,
    position,
    user,
}: AnnotationHoverCardProps) {
    if (annotations.length === 0) return null;

    const sorted = useMemo(
        () =>
            [...annotations].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            ),
        [annotations]
    );

    // Clamp so the card stays within the viewport
    const left = Math.min(position.x, window.innerWidth - CARD_WIDTH - VIEWPORT_PADDING);
    const top = Math.min(position.y, window.innerHeight - CARD_MAX_HEIGHT - VIEWPORT_PADDING);

    return createPortal(
        <div
            data-annotation-hover-card=""
            className="fixed z-50 w-[280px] max-h-[320px] overflow-y-auto rounded-xl shadow-lg border border-border bg-background p-3 flex flex-col gap-3 pointer-events-none"
            style={{ left, top }}
        >
            {sorted.map((ann) => {
                const isAI = ann.role === "assistant";
                return (
                    <div key={ann.id} className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <div
                                className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden ${
                                    isAI ? "bg-blue-100 dark:bg-blue-900" : "bg-muted"
                                }`}
                            >
                                {isAI ? (
                                    <File size={12} className="text-blue-500" />
                                ) : user?.picture ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={user.picture}
                                        alt={user.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <UserIcon size={12} className="text-muted-foreground" />
                                )}
                            </div>
                            <span className="text-xs font-medium text-foreground">
                                {isAI ? "Open Paper" : user?.name || "User"}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                                {formatAnnotationDate(ann.created_at)}
                            </span>
                        </div>
                        <p className="text-sm text-foreground leading-snug whitespace-pre-wrap break-words line-clamp-4 pl-8">
                            {ann.content}
                        </p>
                    </div>
                );
            })}
        </div>,
        document.body
    );
}
