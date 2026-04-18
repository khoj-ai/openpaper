import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { File, User as UserIcon } from 'lucide-react';

import {
	HighlightColor,
	PaperHighlight,
	PaperHighlightAnnotation,
} from '@/lib/schema';
import { RenderedHighlightPosition } from './PdfHighlighterViewer';
import { smoothScrollTo } from '@/lib/animation';
import { BasicUser } from "@/lib/auth";
import { cn, formatAnnotationDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CollapsibleNoteText } from '@/components/CollapsibleNoteText';

const ITEM_BG_MAP: Record<HighlightColor, string> = {
	yellow: "bg-yellow-50 dark:bg-yellow-950/20",
	green:  "bg-green-50 dark:bg-green-950/20",
	blue:   "bg-blue-50 dark:bg-blue-950/20",
	pink:   "bg-pink-50 dark:bg-pink-950/20",
	purple: "bg-purple-50 dark:bg-purple-950/20",
};

/** Left accent for quoted PDF snippet (matches thread highlight color). */
const QUOTE_ACCENT_BORDER: Record<HighlightColor, string> = {
	yellow: "border-yellow-500 dark:border-yellow-400",
	green: "border-green-600 dark:border-green-500",
	blue: "border-blue-500 dark:border-blue-400",
	pink: "border-pink-500 dark:border-pink-400",
	purple: "border-purple-500 dark:border-purple-400",
};

function highlightSwatchColor(h: PaperHighlight | undefined): HighlightColor {
	if (!h) return "blue";
	return h.role === "assistant" ? "purple" : (h.color || "blue");
}

/** Matches `InlineAnnotationCard` reply field — max-h-48 */
const REPLY_TEXTAREA_MAX_PX = 192;
function autoResizeReplyTextarea(el: HTMLTextAreaElement) {
	el.style.height = "auto";
	el.style.height = `${Math.min(el.scrollHeight, REPLY_TEXTAREA_MAX_PX)}px`;
}

const inlineReplyTextareaClassName =
	"text-sm text-foreground placeholder:text-muted-foreground resize-none w-full min-h-[4rem] max-h-48 px-3 py-2 overflow-y-auto overflow-x-hidden box-border rounded-md border border-black bg-background focus:outline-none focus:ring-0 focus:border-black dark:border-white dark:focus:border-white";

function annotationCreatedMs(iso: string | undefined): number {
	if (!iso) return NaN;
	const t = Date.parse(iso);
	return Number.isFinite(t) ? t : NaN;
}

/** Newest annotation in the thread (ms since epoch); used for ordering threads latest → oldest */
function threadLastActivityMs(
	annotationMap: Map<string, PaperHighlightAnnotation[]>,
	highlightId: string,
	composeHighlightId: string | null
): number {
	const anns = annotationMap.get(highlightId);
	if (!anns?.length) {
		return composeHighlightId === highlightId ? Number.MAX_SAFE_INTEGER : 0;
	}
	let max = 0;
	for (const ann of anns) {
		const t = annotationCreatedMs(ann.created_at);
		if (Number.isFinite(t)) max = Math.max(max, t);
	}
	return max;
}

interface AnnotationsViewProps {
	highlights: PaperHighlight[];
	annotations: PaperHighlightAnnotation[];
	onHighlightClick: (highlight: PaperHighlight) => void;
	activeHighlight?: PaperHighlight | null;
	user: BasicUser;
	renderedHighlightPositions?: Map<string, RenderedHighlightPosition>;
	composeHighlightId?: string | null;
	onComposeHighlightDismiss?: (cancelledHighlightId?: string | null) => void;
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
	readonly?: boolean;
}

interface AnnotationThread {
	highlight: PaperHighlight;
	annotations: PaperHighlightAnnotation[];
}

export function AnnotationsView({
	highlights,
	annotations,
	onHighlightClick,
	activeHighlight,
	user,
	renderedHighlightPositions,
	composeHighlightId = null,
	onComposeHighlightDismiss,
	addAnnotation,
	readonly = false,
}: AnnotationsViewProps) {
	const firstAnnotationRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const composeBlockRef = useRef<HTMLDivElement | null>(null);
	const composeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
	const prevActiveIdRef = useRef<string | null>(null);
	/** highlight id → expanded full thread (same behavior as inline annotation card) */
	const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});
	const [composeDraft, setComposeDraft] = useState('');
	const [isComposeSaving, setIsComposeSaving] = useState(false);
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyDraft, setReplyDraft] = useState('');
	const [isReplySaving, setIsReplySaving] = useState(false);
	const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

	const threads = useMemo<AnnotationThread[]>(() => {
		const annotationMap = new Map<string, PaperHighlightAnnotation[]>();
		for (const ann of annotations) {
			const existing = annotationMap.get(ann.highlight_id) ?? [];
			existing.push(ann);
			annotationMap.set(ann.highlight_id, existing);
		}

		const annotatedHighlights = highlights.filter((h) => {
			if (!h.id) return false;
			if (composeHighlightId && h.id === composeHighlightId) return true;
			if (!annotationMap.has(h.id)) return false;
			if (h.role === 'user') return true;
			if (h.position) return true;
			if (h.id && renderedHighlightPositions?.has(h.id)) return true;
			return false;
		});

		const seenIds = new Set<string>();
		const dedupedHighlights = annotatedHighlights.filter((h) => {
			if (!h.id || seenIds.has(h.id)) return false;
			seenIds.add(h.id);
			return true;
		});

		const sorted = [...dedupedHighlights].sort((a, b) => {
			const idA = a.id!;
			const idB = b.id!;
			const tA = threadLastActivityMs(annotationMap, idA, composeHighlightId);
			const tB = threadLastActivityMs(annotationMap, idB, composeHighlightId);
			if (tB !== tA) return tB - tA;
			return idB.localeCompare(idA);
		});

		return sorted.map((highlight) => ({
			highlight,
			annotations: (annotationMap.get(highlight.id!) ?? []).sort((a, b) => {
				const ta = annotationCreatedMs(a.created_at);
				const tb = annotationCreatedMs(b.created_at);
				return (
					(Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0)
				);
			}),
		}));
	}, [highlights, annotations, renderedHighlightPositions, composeHighlightId]);

	const listThreads = useMemo(() => {
		if (!composeHighlightId) return threads;
		return threads.filter(
			(t) =>
				!(
					t.highlight.id === composeHighlightId &&
					t.annotations.length === 0
				)
		);
	}, [threads, composeHighlightId]);

	useEffect(() => {
		if (activeHighlight?.id) {
			const element = firstAnnotationRefs.current[activeHighlight.id];
			if (element && scrollContainerRef.current) {
				smoothScrollTo(element, scrollContainerRef.current);
			}
		}
	}, [activeHighlight]);

	// When the active highlight changes (e.g. user clicked highlighted PDF text): expand that
	// thread fully so "+N more replies" is not needed. When switching A→B, collapse A's expansion
	// state and expand B.
	useEffect(() => {
		const id = activeHighlight?.id ?? null;
		const prev = prevActiveIdRef.current;

		setExpandedThreads((prevMap) => {
			const next = { ...prevMap };
			if (prev !== null && id !== null && prev !== id) {
				delete next[prev];
			}
			if (id !== null) {
				next[id] = true;
			}
			return next;
		});

		prevActiveIdRef.current = id;
	}, [activeHighlight?.id]);

	useEffect(() => {
		setComposeDraft('');
	}, [composeHighlightId]);

	useEffect(() => {
		setReplyOpen(false);
		setReplyDraft('');
	}, [activeHighlight?.id]);

	useLayoutEffect(() => {
		if (!replyOpen) return;
		const el = replyTextareaRef.current;
		if (!el) return;
		el.focus();
		autoResizeReplyTextarea(el);
	}, [replyOpen]);

	useLayoutEffect(() => {
		if (!composeHighlightId) return;
		const el = composeTextareaRef.current;
		if (!el) return;
		el.focus();
		autoResizeReplyTextarea(el);
	}, [composeHighlightId]);

	useEffect(() => {
		if (!composeHighlightId || !composeBlockRef.current || !scrollContainerRef.current) return;
		smoothScrollTo(composeBlockRef.current, scrollContainerRef.current);
	}, [composeHighlightId]);

	const composeTargetHighlight = composeHighlightId
		? highlights.find((h) => h.id === composeHighlightId)
		: undefined;

	const handleComposeSave = async () => {
		if (
			!composeHighlightId ||
			!addAnnotation ||
			!composeDraft.trim() ||
			isComposeSaving
		)
			return;
		setIsComposeSaving(true);
		try {
			await addAnnotation(composeHighlightId, composeDraft.trim());
			setComposeDraft('');
			onComposeHighlightDismiss?.();
		} finally {
			setIsComposeSaving(false);
		}
	};

	const handleComposeCancel = () => {
		setComposeDraft('');
		onComposeHighlightDismiss?.(composeHighlightId);
	};

	const handleReplySave = async (highlightId: string) => {
		if (!addAnnotation || !replyDraft.trim() || isReplySaving) return;
		setIsReplySaving(true);
		try {
			await addAnnotation(highlightId, replyDraft.trim());
			setReplyDraft('');
			setReplyOpen(false);
			setExpandedThreads((prev) => ({ ...prev, [highlightId]: true }));
		} finally {
			setIsReplySaving(false);
		}
	};

	if (threads.length === 0 && !composeHighlightId) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-secondary-foreground text-sm">
					There are no annotations for this paper.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 overflow-auto" ref={scrollContainerRef}>
				{composeHighlightId && addAnnotation && !readonly && (
					<div
						ref={composeBlockRef}
						className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3 shadow-sm"
					>
						<p className="text-xs font-medium text-muted-foreground mb-2">
							New note
						</p>
						{composeTargetHighlight?.raw_text ? (
							<div
								className={cn(
									"min-w-0 border-l-2 pl-3 mb-2",
									QUOTE_ACCENT_BORDER[highlightSwatchColor(composeTargetHighlight)]
								)}
							>
								<CollapsibleNoteText
									content={composeTargetHighlight.raw_text}
									isActive={Boolean(composeHighlightId)}
									paragraphClassName="text-xs text-muted-foreground whitespace-pre-wrap break-words"
								/>
							</div>
						) : null}
						<textarea
							ref={composeTextareaRef}
							value={composeDraft}
							onChange={(e) => {
								setComposeDraft(e.target.value);
								autoResizeReplyTextarea(e.target);
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault();
									void handleComposeSave();
								} else if (e.key === 'Escape') {
									handleComposeCancel();
								}
							}}
							placeholder="Write a note…"
							aria-label="New note"
							className={inlineReplyTextareaClassName}
							disabled={isComposeSaving}
							rows={3}
						/>
						<div className="flex items-center justify-end gap-2 mt-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs text-muted-foreground"
								onClick={handleComposeCancel}
								disabled={isComposeSaving}
							>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								className="h-7 px-3 text-xs"
								onClick={() => void handleComposeSave()}
								disabled={isComposeSaving || !composeDraft.trim()}
							>
								Save
							</Button>
						</div>
					</div>
				)}
				<div className="divide-y divide-border">
					{listThreads.map(({ highlight, annotations: threadAnns }) => {
						const hid = highlight.id!;
						const isActive = activeHighlight?.id === hid;
						const color: HighlightColor = highlight.role === 'assistant'
							? 'purple'
							: (highlight.color || 'blue');
						const bg = isActive
							? "bg-white dark:bg-zinc-950"
							: ITEM_BG_MAP[color];

						const hasMulti = threadAnns.length > 1;
						const expanded = expandedThreads[hid] ?? false;
						const visible =
							!hasMulti || expanded ? threadAnns : threadAnns.slice(0, 1);
						const moreCount = hasMulti && !expanded ? threadAnns.length - 1 : 0;

						return (
							<div
								key={hid}
								data-annotation-sidebar-row=""
								ref={(el) => {
									firstAnnotationRefs.current[hid] = el;
								}}
								className={`px-4 py-3 cursor-pointer transition-colors ${bg}`}
								onClick={() => {
									onHighlightClick(highlight);
									if (hasMulti && !expanded) {
										setExpandedThreads((prev) => ({ ...prev, [hid]: true }));
									}
								}}
							>
								<div className="flex flex-col gap-3">
									{highlight.raw_text?.trim() ? (
										<div
											className={cn(
												"min-w-0 border-l-2 pl-3 mb-0",
												QUOTE_ACCENT_BORDER[color]
											)}
										>
											<CollapsibleNoteText
												content={highlight.raw_text}
												isActive={isActive}
												paragraphClassName="text-xs text-muted-foreground whitespace-pre-wrap break-words"
											/>
										</div>
									) : null}
									{visible.map((annotation) => {
										const isAI = annotation.role === 'assistant';
										return (
										<div key={annotation.id} className="flex flex-col gap-2">
											<div className="flex items-center gap-2">
												<div className={`w-8 h-8 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center ${isAI ? 'bg-blue-100 dark:bg-blue-900' : 'bg-muted'}`}>
													{isAI ? (
														<File size={14} className="text-blue-500" />
													) : user?.picture ? (
														// eslint-disable-next-line @next/next/no-img-element
														<img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
													) : (
														<UserIcon size={14} className="text-muted-foreground" />
													)}
												</div>
												<span className="text-sm font-medium text-foreground">
													{isAI ? 'Open Paper' : user?.name || 'User'}
												</span>
												<span className="text-xs text-muted-foreground">
													{formatAnnotationDate(annotation.created_at)}
												</span>
											</div>
											<div className="pl-10">
												<CollapsibleNoteText
													content={annotation.content}
													isActive={isActive}
													paragraphClassName="text-sm text-foreground leading-snug whitespace-pre-wrap break-words"
												/>
											</div>
										</div>
									)})}
									{moreCount > 0 && (
										<p className="text-xs text-muted-foreground pl-10">
											+{moreCount} more {moreCount === 1 ? 'reply' : 'replies'} — click to show
										</p>
									)}
								</div>
								{isActive && addAnnotation && !readonly && (
									<div
										className="mt-2 pt-0"
										onMouseDown={(e) => e.stopPropagation()}
										onClick={(e) => e.stopPropagation()}
									>
										{replyOpen ? (
											<div className="flex flex-col gap-2">
												<textarea
													ref={replyTextareaRef}
													value={replyDraft}
													onChange={(e) => {
														setReplyDraft(e.target.value);
														autoResizeReplyTextarea(e.target);
													}}
													onKeyDown={(e) => {
														if (e.key === 'Enter' && !e.shiftKey) {
															e.preventDefault();
															void handleReplySave(hid);
														} else if (e.key === 'Escape') {
															setReplyOpen(false);
															setReplyDraft('');
														}
													}}
													onMouseDown={(e) => e.stopPropagation()}
													placeholder="Write a reply…"
													aria-label="Reply"
													className={inlineReplyTextareaClassName}
													disabled={isReplySaving}
													rows={3}
												/>
												<div className="flex items-center justify-end gap-2">
													<Button
														type="button"
														variant="ghost"
														size="sm"
														className="h-7 px-2 text-xs text-muted-foreground"
														disabled={isReplySaving}
														onClick={(e) => {
															e.stopPropagation();
															setReplyOpen(false);
															setReplyDraft('');
														}}
														onMouseDown={(e) => e.stopPropagation()}
													>
														Cancel
													</Button>
													<Button
														type="button"
														size="sm"
														className="h-7 px-3 text-xs"
														disabled={isReplySaving || !replyDraft.trim()}
														onClick={(e) => {
															e.stopPropagation();
															void handleReplySave(hid);
														}}
														onMouseDown={(e) => e.stopPropagation()}
													>
														Reply
													</Button>
												</div>
											</div>
										) : (
											<button
												type="button"
												className="w-full text-left text-sm text-muted-foreground rounded-full border border-border px-3 py-1.5 hover:bg-muted/50 transition-colors cursor-text"
												onMouseDown={(e) => e.stopPropagation()}
												onClick={(e) => {
													e.stopPropagation();
													setReplyOpen(true);
												}}
											>
												Reply…
											</button>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
