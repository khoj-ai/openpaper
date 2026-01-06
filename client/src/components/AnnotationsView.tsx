import React, { useEffect, useState, useRef } from 'react';

import {
	PaperHighlight,
	PaperHighlightAnnotation,
	HighlightColor,
} from '@/lib/schema';
import { RenderedHighlightPosition } from './PdfHighlighterViewer';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from './ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { BasicUser } from "@/lib/auth";
import { User as UserIcon } from 'lucide-react';
import { smoothScrollTo } from '@/lib/animation';
import Annotation from './Annotation';

// Map highlight color names to Tailwind border classes
const HIGHLIGHT_BORDER_COLOR_MAP: Record<HighlightColor, string> = {
	yellow: "border-yellow-400",
	green: "border-green-500",
	blue: "border-blue-400",
	pink: "border-pink-400",
	purple: "border-purple-400",
};

// Function to get badge styling based on highlight type
function getHighlightTypeStyling(type: string) {
	switch (type) {
		case 'topic':
			return { variant: 'default' as const, className: 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200' };
		case 'motivation':
			return { variant: 'default' as const, className: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200' };
		case 'method':
			return { variant: 'default' as const, className: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200' };
		case 'evidence':
			return { variant: 'default' as const, className: 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200' };
		case 'result':
			return { variant: 'default' as const, className: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200' };
		case 'impact':
			return { variant: 'default' as const, className: 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200' };
		case 'general':
			return { variant: 'secondary' as const, className: 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200' };
		default:
			return { variant: 'secondary' as const, className: 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200' };
	}
}

export interface AnnotationButtonProps {
	highlightId: string;
	// Make addAnnotation optional as it might not be needed in readonly
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
}

export function AnnotationButton({ highlightId, addAnnotation }: AnnotationButtonProps) {
	const [content, setContent] = useState("");
	const [isTyping, setIsTyping] = useState(false);
	const [isAdding, setIsAdding] = useState(false);

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
				className="text-sm"
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


// New HighlightThread Component
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

	const highlightBorderColor = highlight.role === 'assistant'
		? 'border-purple-500'
		: HIGHLIGHT_BORDER_COLOR_MAP[highlight.color || 'blue'];
	const activeBgColor = isActive ? 'bg-secondary' : 'hover:bg-secondary/50';

	return (
		<Card
			className={`transition-colors cursor-pointer rounded-md border-0 shadow-none py-2 ${activeBgColor}`}
			onClick={onClick}
		>
			<CardContent className="p-2">
				{/* The Blockquote */}
				<blockquote className={`border-l-2 ${highlightBorderColor} pl-3 py-1 mb-2`}>
					<div className="flex items-start flex-col gap-1">
						{highlight.type && (
							(() => {
								const styling = getHighlightTypeStyling(highlight.type);
								return (
									<Badge
										variant={styling.variant}
										className={`text-[10px] px-1.5 py-0 shrink-0 ${styling.className}`}
									>
										{highlight.type.replace('_', ' ').toLowerCase()}
									</Badge>
								);
							})()
						)}
						<p className="text-foreground text-sm flex-1">
							{highlight.raw_text}
						</p>
					</div>
				</blockquote>


				{/* The Annotation Thread */}
				{annotations.length > 0 && (
					<div className="space-y-1 ml-3">
						{annotations.map((annotation) => (
							<Annotation
								key={annotation.id}
								annotation={{ ...annotation }}
								removeAnnotation={removeAnnotation}
								updateAnnotation={updateAnnotation}
								user={user}
								readonly={readonly}
							/>
						))}
					</div>
				)}

				{/* Add Annotation Form */}
				{isActive && !readonly && addAnnotation && highlight.id && (
					<div className="pt-1 ml-3">
						<AnnotationButton
							highlightId={highlight.id}
							addAnnotation={addAnnotation}
						/>
					</div>
				)}
			</CardContent>
		</Card>
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
				<div className="space-y-2 p-2">
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
