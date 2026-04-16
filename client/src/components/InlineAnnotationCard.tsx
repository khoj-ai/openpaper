"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BasicUser } from "@/lib/auth";
import { PaperHighlightAnnotation } from "@/lib/schema";
import { cn, formatAnnotationDate, getAlphaHashToBackgroundColor, getInitials } from "@/lib/utils";
import { Pencil, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** Read-only note body: clamps long text and offers Show more / Show less (overflow measured). */
function CollapsibleNoteText({
	content,
	isActive,
	onCardFocus,
}: {
	content: string;
	isActive: boolean;
	onCardFocus?: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [collapsedOverflow, setCollapsedOverflow] = useState(false);
	const pRef = useRef<HTMLParagraphElement>(null);

	useEffect(() => {
		if (!isActive) setExpanded(false);
	}, [isActive]);

	useLayoutEffect(() => {
		const el = pRef.current;
		if (!el || expanded) return;

		const measure = () => {
			setCollapsedOverflow(el.scrollHeight > el.clientHeight);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [content, expanded]);

	const showToggle = expanded || collapsedOverflow;

	return (
		<div className="min-w-0 w-full">
			<p
				ref={pRef}
				className={cn(
					"text-sm text-foreground whitespace-pre-wrap break-words",
					!expanded && "line-clamp-4"
				)}
			>
				{content}
			</p>
			{showToggle && (
				<button
					type="button"
					className="text-xs text-blue-600 hover:underline dark:text-blue-400 mt-1"
					onClick={(e) => {
						e.stopPropagation();
						onCardFocus?.();
						setExpanded((v) => !v);
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}

interface InlineAnnotationCardProps {
    highlightId: string;
    topPosition: number;
    leftPosition: number;
    annotations: PaperHighlightAnnotation[];
    isActive?: boolean;
    user: BasicUser | null;
    /** When omitted, card is display-only (e.g. share / preview); no create or save. */
    addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
    updateAnnotation?: (annotationId: string, content: string) => Promise<unknown> | void;
    removeAnnotation?: (annotationId: string) => void;
    onAnnotationSaved?: (annotationId: string) => void;
    onClose: () => void;
    onHeightChange?: (height: number) => void;
    /** Called when the user interacts with the card so the parent can mark this highlight active (e.g. show reply UI). */
    onCardFocus?: () => void;
}

export function InlineAnnotationCard({
    highlightId,
    topPosition,
    leftPosition,
    annotations,
    isActive = false,
    user,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    onAnnotationSaved,
    onClose,
    onHeightChange,
    onCardFocus,
}: InlineAnnotationCardProps) {
    const isNewThread = annotations.length === 0;
    const canWrite = Boolean(addAnnotation);

    // State for the new-thread textarea (when no annotations exist yet)
    const [newContent, setNewContent] = useState("");
    // State for the reply textarea (when thread already has comments)
    const [replyContent, setReplyContent] = useState("");
    // Whether the reply composer is expanded (false = collapsed pill)
    const [isReplyOpen, setIsReplyOpen] = useState(false);
    // Which annotation is currently being edited in-place
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    /** When there are multiple comments, show only the first until the user expands the thread */
    const [threadExpanded, setThreadExpanded] = useState(false);

    const cardRef = useRef<HTMLDivElement>(null);
    const newTextareaRef = useRef<HTMLTextAreaElement>(null);
    const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
    const editTextareaRef = useRef<HTMLTextAreaElement>(null);
    /** Wrapper around the in-place edit textarea; used to detect “click outside” to cancel edit */
    const editBlockRef = useRef<HTMLDivElement>(null);
    /** Reply row (pill or expanded); used to collapse reply when clicking elsewhere on the card */
    const replySectionRef = useRef<HTMLDivElement>(null);

    const displayName = user?.name || "Anonymous";
    const avatarBg = user?.name ? getAlphaHashToBackgroundColor(user.name) : "bg-muted";

    const sortedThread = useMemo(
        () =>
            [...annotations].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            ),
        [annotations]
    );
    const hasMultiComment = sortedThread.length > 1;
    const visibleThread =
        !hasMultiComment || threadExpanded ? sortedThread : sortedThread.slice(0, 1);
    const moreCount = hasMultiComment && !threadExpanded ? sortedThread.length - 1 : 0;

    // Auto-focus the new-thread textarea on mount when there are no annotations
    useEffect(() => {
        if (isNewThread && canWrite && newTextareaRef.current) {
            newTextareaRef.current.focus();
        }
    }, [isNewThread, canWrite]);

    // Report actual card height to parent whenever it changes
    useEffect(() => {
        const el = cardRef.current;
        if (!el || !onHeightChange) return;
        const ro = new ResizeObserver(() => {
            onHeightChange(el.offsetHeight);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [onHeightChange]);

    // Outside click: for cards with saved annotations, only collapse editing/reply state.
    // For new unsaved cards, close if nothing has been typed; otherwise collapse.
    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
                if (!isNewThread) {
                    // Thread exists — never auto-close via outside click
                    setEditingId(null);
                    // Collapse reply to pill (draft kept in replyContent for next open)
                    setIsReplyOpen(false);
                } else if (!newContent.trim()) {
                    onClose();
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
    }, [onClose, newContent, isNewThread]);

    // Editing an existing comment: hide the expanded reply composer (bordered textarea) so only
    // one bordered field is visible at a time.
    useEffect(() => {
        if (editingId) setIsReplyOpen(false);
    }, [editingId]);

    // Cancel in-place edit on mousedown outside the edit textarea. Use capture so we still run
    // when the card stops propagation on bubble (clicks inside the card never reach document).
    useEffect(() => {
        if (!editingId) return;
        const handleMouseDown = (e: MouseEvent) => {
            const el = editBlockRef.current;
            if (el && !el.contains(e.target as Node)) {
                setEditingId(null);
            }
        };
        document.addEventListener("mousedown", handleMouseDown, true);
        return () => document.removeEventListener("mousedown", handleMouseDown, true);
    }, [editingId]);

    // Collapse expanded reply when mousedown happens outside the reply section (capture phase).
    useEffect(() => {
        if (!isReplyOpen) return;
        const handleMouseDown = (e: MouseEvent) => {
            const el = replySectionRef.current;
            if (el && !el.contains(e.target as Node)) {
                setIsReplyOpen(false);
            }
        };
        document.addEventListener("mousedown", handleMouseDown, true);
        return () => document.removeEventListener("mousedown", handleMouseDown, true);
    }, [isReplyOpen]);

    // When inactive: hide reply UI and collapse thread preview. When active (e.g. user clicked
    // the highlight in the PDF), expand multi-comment threads so the full conversation shows.
    useEffect(() => {
        if (!isActive) {
            setIsReplyOpen(false);
            setReplyContent("");
            setEditingId(null);
            setThreadExpanded(false);
        } else if (hasMultiComment) {
            setThreadExpanded(true);
        }
    }, [isActive, hasMultiComment]);

    // ── Save handlers ──────────────────────────────────────────────────────────

    const handleSaveNew = async () => {
        if (!newContent.trim() || isSaving || !addAnnotation) return;
        setIsSaving(true);
        try {
            const result = await addAnnotation(highlightId, newContent.trim());
            onAnnotationSaved?.(result.id);
            setNewContent("");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveReply = async () => {
        if (!replyContent.trim() || isSaving || !addAnnotation) return;
        setIsSaving(true);
        try {
            await addAnnotation(highlightId, replyContent.trim());
            setReplyContent("");
            setIsReplyOpen(false);
            setThreadExpanded(true);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveEdit = async (annotationId: string) => {
        if (!editContent.trim() || isSaving || !updateAnnotation) return;
        setIsSaving(true);
        try {
            await updateAnnotation(annotationId, editContent.trim());
            setEditingId(null);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteComment = (annotationId: string) => {
        removeAnnotation?.(annotationId);
    };

    // ── Keyboard handlers ──────────────────────────────────────────────────────

    const handleNewKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSaveNew();
        } else if (e.key === "Escape") {
            onClose();
        }
    };

    const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSaveReply();
        } else if (e.key === "Escape") {
            setReplyContent("");
            setIsReplyOpen(false);
        }
    };

    const handleEditKeyDown = (annotationId: string) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSaveEdit(annotationId);
        } else if (e.key === "Escape") {
            setEditingId(null);
        }
    };

    // ── Auto-resize helper ─────────────────────────────────────────────────────

    /** Bordered comment fields: grow with content up to max height, then scroll inside */
    const CONTAINED_TEXTAREA_MAX_PX = 192; // matches max-h-48
    const autoResizeContained = (el: HTMLTextAreaElement) => {
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, CONTAINED_TEXTAREA_MAX_PX)}px`;
    };

    useLayoutEffect(() => {
        if (editingId && editTextareaRef.current) {
            autoResizeContained(editTextareaRef.current);
        }
    }, [editingId]);

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div
            ref={cardRef}
            data-inline-annotation-card=""
            className={cn(
                "absolute z-40 w-[280px] rounded-xl shadow-lg flex flex-col transition-[top,left,background-color,border-color] duration-200 ease-out motion-reduce:transition-none overflow-hidden",
                isActive
                    ? "border border-border bg-background"
                    : "border-0 bg-[#F9FAFD] dark:bg-zinc-800"
            )}
            style={{ left: `${leftPosition}px`, top: `${topPosition}px` }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
                e.stopPropagation();
                onCardFocus?.();
                if (hasMultiComment && !threadExpanded) setThreadExpanded(true);
            }}
        >
            {isNewThread ? (
                /* ── New thread: single composer ─────────────────────────── */
                <div className="p-4 flex flex-col gap-3">
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
                        <div className="flex flex-col leading-tight flex-1 min-w-0">
                            <span className="text-sm font-medium">{displayName}</span>
                            <span className="text-xs text-muted-foreground">Just now</span>
                        </div>
                        {canWrite && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
                                onClick={(e) => { e.stopPropagation(); onClose(); }}
                                onMouseDown={(e) => e.stopPropagation()}
                                title="Close"
                            >
                                <X size={14} />
                            </Button>
                        )}
                    </div>
                    {canWrite ? (
                        <div className="flex flex-col gap-2">
                            <textarea
                                ref={newTextareaRef}
                                value={newContent}
                                onChange={(e) => {
                                    setNewContent(e.target.value);
                                    autoResizeContained(e.target);
                                }}
                                onKeyDown={handleNewKeyDown}
                                placeholder="Write your notes here…"
                                aria-label="New annotation"
                                className="text-sm text-foreground placeholder:text-muted-foreground resize-none w-full min-h-[4rem] max-h-48 px-3 py-2 overflow-y-auto overflow-x-hidden box-border rounded-md border border-black bg-background focus:outline-none focus:ring-0 focus:border-black dark:border-white dark:focus:border-white"
                                disabled={isSaving}
                                rows={3}
                            />
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-muted-foreground"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onClose();
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    disabled={isSaving}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-7 px-3 text-xs"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveNew();
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    disabled={!newContent.trim() || isSaving}
                                >
                                    Save
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground italic">No annotation yet.</p>
                    )}
                </div>
            ) : (
                /* ── Existing thread (one card; optional collapse to first comment) ─ */
                <>
                    <div
                        className={cn(
                            "px-4 pt-4 flex flex-col gap-3",
                            canWrite && isActive ? "pb-2" : "pb-4"
                        )}
                    >
                        {visibleThread.map((ann) => (
                            <div key={ann.id} className="flex flex-col gap-2">
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-7 w-7 flex-shrink-0">
                                        {user?.picture && <AvatarImage src={user.picture} alt={displayName} />}
                                        <AvatarFallback
                                            className="text-[10px] text-white font-medium"
                                            style={{ backgroundColor: avatarBg }}
                                        >
                                            {getInitials(displayName)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-col leading-tight flex-1 min-w-0">
                                        <span className="text-xs font-medium">{displayName}</span>
                                        <span className="text-[11px] text-muted-foreground">{formatAnnotationDate(ann.created_at)}</span>
                                    </div>
                                    {ann.role === "user" && isActive && (
                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                            {updateAnnotation && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onCardFocus?.();
                                                        setThreadExpanded(true);
                                                        setEditingId(ann.id);
                                                        setEditContent(ann.content);
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    title="Edit"
                                                >
                                                    <Pencil size={12} />
                                                </Button>
                                            )}
                                            {removeAnnotation && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onCardFocus?.();
                                                        handleDeleteComment(ann.id);
                                                    }}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {editingId === ann.id ? (
                                    <div ref={editBlockRef} className="w-full min-w-0 flex flex-col gap-2">
                                        <textarea
                                            ref={editTextareaRef}
                                            autoFocus
                                            value={editContent}
                                            onChange={(e) => {
                                                setEditContent(e.target.value);
                                                autoResizeContained(e.target);
                                            }}
                                            onKeyDown={handleEditKeyDown(ann.id)}
                                            aria-label="Edit comment"
                                            className="text-sm text-foreground resize-none w-full min-h-[4rem] max-h-48 px-3 py-2 overflow-y-auto overflow-x-hidden box-border rounded-md border border-black bg-background focus:outline-none focus:ring-0 focus:border-black dark:border-white dark:focus:border-white"
                                            disabled={isSaving}
                                            rows={3}
                                        />
                                        <div className="flex items-center justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 px-2 text-xs text-muted-foreground"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingId(null);
                                                }}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                disabled={isSaving}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="h-7 px-3 text-xs"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSaveEdit(ann.id);
                                                }}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                disabled={!editContent.trim() || isSaving}
                                            >
                                                Save
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <CollapsibleNoteText
                                        content={ann.content}
                                        isActive={isActive}
                                        onCardFocus={onCardFocus}
                                    />
                                )}
                            </div>
                        ))}
                        {moreCount > 0 && (
                            <p className="text-xs text-muted-foreground">
                                +{moreCount} more {moreCount === 1 ? "reply" : "replies"} — click to show
                            </p>
                        )}
                    </div>

                    {/* Reply composer — only after user clicked this highlight or the card */}
                    {canWrite && isActive && (
                        <div ref={replySectionRef} className="px-4 pb-4 pt-0">
                            {isReplyOpen ? (
                                /* Expanded: full textarea, no avatar */
                                <div className="flex flex-col gap-2">
                                    <textarea
                                        ref={replyTextareaRef}
                                        autoFocus
                                        value={replyContent}
                                        onChange={(e) => {
                                            setReplyContent(e.target.value);
                                            autoResizeContained(e.target);
                                        }}
                                        onKeyDown={handleReplyKeyDown}
                                        placeholder="Write a reply…"
                                        className="text-sm text-foreground placeholder:text-muted-foreground resize-none w-full min-h-[4rem] max-h-48 px-3 py-2 overflow-y-auto overflow-x-hidden box-border rounded-md border border-black bg-background focus:outline-none focus:ring-0 focus:border-black dark:border-white dark:focus:border-white"
                                        disabled={isSaving}
                                        rows={3}
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-xs text-muted-foreground"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setReplyContent("");
                                                setIsReplyOpen(false);
                                            }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            disabled={isSaving}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-7 px-3 text-xs"
                                            onClick={(e) => { e.stopPropagation(); handleSaveReply(); }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                            disabled={!replyContent.trim() || isSaving}
                                        >
                                            Reply
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                /* Collapsed pill */
                                <button
                                    type="button"
                                    className="w-full text-left text-sm text-muted-foreground rounded-full border border-border px-3 py-1.5 hover:bg-muted/50 transition-colors cursor-text"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onCardFocus?.();
                                        setIsReplyOpen(true);
                                    }}
                                >
                                    Reply…
                                </button>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
