import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User as UserIcon } from 'lucide-react';

import {
	HighlightColor,
	PaperHighlight,
	PaperHighlightAnnotation,
} from '@/lib/schema';
import { RenderedHighlightPosition } from './PdfHighlighterViewer';
import { smoothScrollTo } from '@/lib/animation';
import { BasicUser } from "@/lib/auth";
import { formatDate } from '@/lib/utils';

const ITEM_BG_MAP: Record<HighlightColor, string> = {
	yellow: "bg-yellow-50 dark:bg-yellow-950/20",
	green:  "bg-green-50 dark:bg-green-950/20",
	blue:   "bg-blue-50 dark:bg-blue-950/20",
	pink:   "bg-pink-50 dark:bg-pink-950/20",
	purple: "bg-purple-50 dark:bg-purple-950/20",
};

const ITEM_BG_ACTIVE_MAP: Record<HighlightColor, string> = {
	yellow: "bg-yellow-100 dark:bg-yellow-900/30",
	green:  "bg-green-100 dark:bg-green-900/30",
	blue:   "bg-blue-100 dark:bg-blue-900/30",
	pink:   "bg-pink-100 dark:bg-pink-900/30",
	purple: "bg-purple-100 dark:bg-purple-900/30",
};

interface AnnotationsViewProps {
	highlights: PaperHighlight[];
	annotations: PaperHighlightAnnotation[];
	onHighlightClick: (highlight: PaperHighlight) => void;
	activeHighlight?: PaperHighlight | null;
	user: BasicUser;
	renderedHighlightPositions?: Map<string, RenderedHighlightPosition>;
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
}: AnnotationsViewProps) {
	const firstAnnotationRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const prevActiveIdRef = useRef<string | null>(null);
	/** highlight id → expanded full thread (same behavior as inline annotation card) */
	const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>({});

	const threads = useMemo<AnnotationThread[]>(() => {
		const annotationMap = new Map<string, PaperHighlightAnnotation[]>();
		for (const ann of annotations) {
			const existing = annotationMap.get(ann.highlight_id) ?? [];
			existing.push(ann);
			annotationMap.set(ann.highlight_id, existing);
		}

		const annotatedHighlights = highlights.filter((h) => {
			if (!h.id || !annotationMap.has(h.id)) return false;
			if (h.role === 'user') return true;
			if (h.position) return true;
			if (h.id && renderedHighlightPositions?.has(h.id)) return true;
			return false;
		});

		const sorted = [...annotatedHighlights].sort((a, b) => {
			let aPage = a.page_number || 0;
			let aTop = 0;
			if (a.position) {
				aPage = a.position.boundingRect.pageNumber || aPage;
				aTop = a.position.boundingRect.y1;
			} else if (a.id && renderedHighlightPositions?.has(a.id)) {
				const pos = renderedHighlightPositions.get(a.id)!;
				aPage = pos.page;
				aTop = pos.top;
			}

			let bPage = b.page_number || 0;
			let bTop = 0;
			if (b.position) {
				bPage = b.position.boundingRect.pageNumber || bPage;
				bTop = b.position.boundingRect.y1;
			} else if (b.id && renderedHighlightPositions?.has(b.id)) {
				const pos = renderedHighlightPositions.get(b.id)!;
				bPage = pos.page;
				bTop = pos.top;
			}

			if (aPage !== bPage) return aPage - bPage;
			return aTop - bTop;
		});

		return sorted.map((highlight) => ({
			highlight,
			annotations: (annotationMap.get(highlight.id!) ?? []).sort(
				(a, b) =>
					new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
			),
		}));
	}, [highlights, annotations, renderedHighlightPositions]);

	useEffect(() => {
		if (activeHighlight?.id) {
			const element = firstAnnotationRefs.current[activeHighlight.id];
			if (element && scrollContainerRef.current) {
				smoothScrollTo(element, scrollContainerRef.current);
			}
		}
	}, [activeHighlight]);

	// When the active highlight changes, collapse only the *previous* highlight's thread — not the
	// newly selected one. Clearing the whole map was wiping expansion set in the same click as
	// switching highlights (e.g. B → A required two clicks to expand A).
	useEffect(() => {
		const id = activeHighlight?.id ?? null;
		const prev = prevActiveIdRef.current;
		if (prev !== null && id !== null && prev !== id) {
			setExpandedThreads((prevMap) => {
				const next = { ...prevMap };
				delete next[prev];
				return next;
			});
		}
		prevActiveIdRef.current = id;
	}, [activeHighlight?.id]);

	if (threads.length === 0) {
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
				<div className="divide-y divide-border">
					{threads.map(({ highlight, annotations: threadAnns }) => {
						const hid = highlight.id!;
						const isActive = activeHighlight?.id === hid;
						const color: HighlightColor = highlight.role === 'assistant'
							? 'purple'
							: (highlight.color || 'blue');
						const bg = isActive ? ITEM_BG_ACTIVE_MAP[color] : ITEM_BG_MAP[color];

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
									{visible.map((annotation) => (
										<div key={annotation.id} className="flex flex-col gap-2">
											<div className="flex items-center gap-2">
												<div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center">
													{user?.picture ? (
														// eslint-disable-next-line @next/next/no-img-element
														<img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
													) : (
														<UserIcon size={14} className="text-muted-foreground" />
													)}
												</div>
												<span className="text-sm font-medium text-foreground">
													{user?.name || 'User'}
												</span>
												<span className="text-xs text-muted-foreground">
													{formatDate(annotation.created_at)}
												</span>
											</div>
											<p className="text-sm text-foreground leading-snug whitespace-pre-wrap pl-10">
												{annotation.content}
											</p>
										</div>
									))}
									{moreCount > 0 && (
										<p className="text-xs text-muted-foreground pl-10">
											+{moreCount} more {moreCount === 1 ? 'reply' : 'replies'} — click to show
										</p>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
