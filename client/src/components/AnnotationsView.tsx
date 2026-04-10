import React, { useEffect, useRef, useState } from 'react';

import {
	HighlightColor,
	PaperHighlight,
	PaperHighlightAnnotation,
} from '@/lib/schema';
import { RenderedHighlightPosition } from './PdfHighlighterViewer';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { smoothScrollTo } from '@/lib/animation';
import { BasicUser } from "@/lib/auth";
import { User as UserIcon } from 'lucide-react';
import Annotation from './Annotation';

// Map highlight color names to bg color classes for the left bar
const HIGHLIGHT_BAR_COLOR_MAP: Record<HighlightColor, string> = {
	yellow: "bg-yellow-400",
	green: "bg-green-500",
	blue: "bg-blue-400",
	pink: "bg-pink-400",
	purple: "bg-purple-400",
};

export interface AnnotationButtonProps {
	highlightId: string;
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
	user?: BasicUser;
}

export function AnnotationButton({ highlightId, addAnnotation, user }: AnnotationButtonProps) {
	const [content, setContent] = useState("");
	const [isTyping, setIsTyping] = useState(false);
	const [isAdding, setIsAdding] = useState(false);

	const now = new Date();
	const timeStr = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

	const handleSave = async () => {
		if (content.trim() && addAnnotation) {
			setIsAdding(true);
			await addAnnotation(highlightId, content);
			setContent("");
			setIsTyping(false);
			setIsAdding(false);
		}
	};

	const handleCancel = () => {
		setContent("");
		setIsTyping(false);
	};

	if (!addAnnotation) return null;

	return (
		<div className="mt-1">
			{/* Avatar row */}
			<div className="flex items-center gap-2 mb-2">
				<div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden bg-muted">
					{user?.picture ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
					) : (
						<UserIcon size={14} className="text-muted-foreground" />
					)}
				</div>
				<span className="text-sm font-medium text-foreground">{user?.name || 'User'}</span>
				<span className="text-xs text-muted-foreground">{timeStr}</span>
			</div>

			<Textarea
				value={content}
				onChange={(e) => {
					setContent(e.target.value);
					if (!isTyping) setIsTyping(true);
				}}
				onKeyDown={(e => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						handleSave();
					}
				})}
				placeholder="Store your thoughts here."
				className="ml-10 w-[calc(100%-2.5rem)] text-sm focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-foreground focus-visible:border-foreground"
				rows={3}
				autoFocus
			/>
			{isTyping && (
				<div className="flex justify-end gap-2 mt-2">
					<Button variant="outline" size="sm" onClick={handleCancel} disabled={isAdding}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave} disabled={isAdding || !content.trim()}>
						Save
					</Button>
				</div>
			)}
		</div>
	);
}

interface HighlightThreadProps {
	highlight: PaperHighlight;
	annotations: PaperHighlightAnnotation[];
	isActive: boolean;
	onClick: () => void;
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
	removeAnnotation?: (annotationId: string) => void;
	updateAnnotation?: (annotationId: string, content: string) => void;
	user?: BasicUser
	readonly?: boolean;
}


// HighlightThread Component
function HighlightThread({
	highlight,
	annotations,
	isActive,
	onClick,
	addAnnotation,
	removeAnnotation,
	updateAnnotation,
	user,
	readonly,
}: HighlightThreadProps) {

	const barColor = highlight.role === 'assistant'
		? 'bg-purple-400'
		: HIGHLIGHT_BAR_COLOR_MAP[highlight.color || 'blue'];

	return (
		<div
			className={`cursor-pointer rounded-lg px-3 py-3 transition-colors ${isActive ? 'bg-secondary' : 'hover:bg-secondary/50'}`}
			onClick={onClick}
		>
			{/* Quoted highlight text with colored left bar */}
			<div className="flex gap-2.5">
				<div className={`w-0.5 rounded-full shrink-0 self-stretch ${barColor}`} />
				<div className="min-w-0">
					{highlight.type && (
						<span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium block mb-0.5">
							{highlight.type.replace('_', ' ').toLowerCase()}
						</span>
					)}
					<p className="text-foreground text-sm leading-snug">
						{highlight.raw_text}
					</p>
				</div>
			</div>

			{/* Annotation notes */}
			{annotations.length > 0 && (
				<div className="space-y-3 mt-3">
					{annotations.map((annotation) => (
						<Annotation
							key={annotation.id}
							annotation={{ ...annotation }}
							highlightColor={highlight.role === 'assistant' ? 'purple' : (highlight.color || 'blue')}
							removeAnnotation={removeAnnotation}
							updateAnnotation={updateAnnotation}
							user={user}
							readonly={readonly}
						/>
					))}
				</div>
			)}

			{isActive && !readonly && addAnnotation && highlight.id && (
				<div className="mt-3">
					<AnnotationButton
						highlightId={highlight.id}
						addAnnotation={addAnnotation}
						user={user}
					/>
				</div>
			)}
		</div>
	);
}

interface AnnotationsViewProps {
	highlights: PaperHighlight[];
	annotations: PaperHighlightAnnotation[];
	onHighlightClick: (highlight: PaperHighlight) => void;
	activeHighlight?: PaperHighlight | null;
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
	removeAnnotation?: (annotationId: string) => void;
	updateAnnotation?: (annotationId: string, content: string) => void;
	user: BasicUser;
	readonly?: boolean;
	renderedHighlightPositions?: Map<string, RenderedHighlightPosition>;
}

interface AnnotationsToolbarProps {
	onShowJustMine: (show: boolean) => void;
	showJustMine: boolean;
	readonly: boolean;
}

function AnnotationsToolbar({
	onShowJustMine,
	showJustMine,
	readonly,
}: AnnotationsToolbarProps) {
	return (
		<div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-muted/20">
			{
				!readonly && (
					<div className="flex items-center gap-2">
						<Switch
							checked={showJustMine}
							onCheckedChange={onShowJustMine}
							id="just-mine"
						/>
						<label htmlFor="just-mine" className="text-sm font-medium text-foreground cursor-pointer flex items-center gap-1">
							<UserIcon size={14} />
							Just mine
						</label>
					</div>
				)
			}
		</div>
	);
}

export function AnnotationsView(
	{
		highlights,
		annotations,
		onHighlightClick,
		addAnnotation,
		activeHighlight,
		removeAnnotation,
		updateAnnotation,
		user,
		readonly = false,
		renderedHighlightPositions,
	}: AnnotationsViewProps
) {
	// All your existing useEffect hooks for sorting and mapping data remain the same
	const [sortedHighlights, setSortedHighlights] = React.useState<PaperHighlight[]>([]);
	const [filteredHighlights, setFilteredHighlights] = React.useState<PaperHighlight[]>([]);
	const [highlightAnnotationMap, setHighlightAnnotationMap] = React.useState<Map<string, PaperHighlightAnnotation[]>>(new Map());
	const [showJustMine, setShowJustMine] = React.useState<boolean>(false);
	const highlightRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (activeHighlight?.id) {
			const element = highlightRefs.current[activeHighlight.id];
			if (element && scrollContainerRef.current) {
				smoothScrollTo(element, scrollContainerRef.current);
			}
		}
	}, [activeHighlight]);

	useEffect(() => {
		// Filter out assistant highlights that don't have a rendered position
		// (they couldn't be found in the PDF text)
		const visibleHighlights = highlights.filter((h) => {
			// User highlights are always shown
			if (h.role === 'user') return true;
			// Highlights with stored position data are shown
			if (h.position) return true;
			// Assistant highlights need a rendered position to be shown
			if (h.id && renderedHighlightPositions?.has(h.id)) return true;
			return false;
		});

		// Sort highlights by position
		// For highlights with position data (user highlights), use boundingRect
		// For assistant highlights without position, use renderedHighlightPositions from DOM
		const sortedHighlights = [...visibleHighlights].sort((a, b) => {
			// Get position for highlight a
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

			// Get position for highlight b
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

			// Sort by page first, then by vertical position
			if (aPage !== bPage) {
				return aPage - bPage;
			}
			return aTop - bTop;
		});

		setSortedHighlights(sortedHighlights);

		// Handle user annotations
		const annotationMap = new Map<string, PaperHighlightAnnotation[]>();
		annotations.forEach((annotation) => {
			const highlightId = annotation.highlight_id;
			const existingAnnotations = annotationMap.get(highlightId) || [];
			existingAnnotations.push(annotation);
			annotationMap.set(highlightId, existingAnnotations);
		});
		setHighlightAnnotationMap(annotationMap);
	}, [highlights, annotations, renderedHighlightPositions]);

	// Filter highlights based on selected filters
	useEffect(() => {
		let filtered = sortedHighlights;

		// Filter to show only user's annotations if enabled
		if (showJustMine) {
			filtered = filtered.filter(h => {
				const highlightAnnotations = h.id ? highlightAnnotationMap.get(h.id) || [] : [];
				const hasUserAnnotations = highlightAnnotations.some(a => a.role === 'user');
				const isUserHighlight = h.role === 'user';
				return isUserHighlight || hasUserAnnotations;
			});
		}

		setFilteredHighlights(filtered);
	}, [sortedHighlights, showJustMine, highlightAnnotationMap]);

	const handleShowJustMine = (show: boolean) => {
		setShowJustMine(show);
	};


	if (sortedHighlights.length === 0) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<p className="text-secondary-foreground text-sm">
					{readonly ? "There are no annotations for this paper." : "Highlight text in the document to begin annotating."}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full">
			<AnnotationsToolbar
				onShowJustMine={handleShowJustMine}
				showJustMine={showJustMine}
				readonly={readonly}
			/>

			<div className="flex-1 overflow-auto" ref={scrollContainerRef}>
				<div className="space-y-1 p-2">
					{filteredHighlights.length === 0 ? (
						<div className="text-center text-muted-foreground text-sm py-8">
							No highlights match the current filters.
						</div>
					) : (
						filteredHighlights.map((highlight) => {
							const annotations = (highlight.id && highlightAnnotationMap.get(highlight.id) || [])
								.filter(annotation => !showJustMine || annotation.role === 'user')
								.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

							const handleClick = () => {
								onHighlightClick(highlight);
							};

							return (
								<div
									key={`${highlight.role}-${highlight.id}`}
									ref={(el) => {
										if (highlight.id) {
											highlightRefs.current[highlight.id] = el;
										}
									}}
								>
									<HighlightThread
										highlight={highlight}
										annotations={annotations}
										isActive={activeHighlight?.id === highlight.id}
										onClick={handleClick}
										addAnnotation={addAnnotation}
										removeAnnotation={removeAnnotation}
										updateAnnotation={updateAnnotation}
										user={user ?? undefined}
										readonly={readonly}
									/>
								</div>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
