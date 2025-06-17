import React, { useEffect, useState, useRef } from 'react';

import {
	PaperHighlight,
	PaperHighlightAnnotation
} from '@/lib/schema';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from './ui/card';
import { useAuth, User } from "@/lib/auth";
import Annotation from './Annotation';

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
	user?: User;
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
	readonly
}: HighlightThreadProps) {

	const highlightBorderColor = highlight.role === 'assistant' ? 'border-blue-500' : 'border-gray-400';
	const activeBgColor = isActive ? 'bg-secondary' : 'hover:bg-secondary/50';

	return (
		<Card
			className={`transition-colors cursor-pointer rounded-lg p-2 ${activeBgColor}`}
			onClick={onClick}
		>
			<CardContent className="p-0">
				{/* The Blockquote */}
				<blockquote className={`border-l-4 ${highlightBorderColor} pl-4 py-2 mb-4 bg-background`}>
					<p className="text-foreground">
						{highlight.raw_text}
					</p>
				</blockquote>

				{/* The Annotation Thread */}
				<div className="space-y-2">
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

				{/* Add Annotation Form */}
				{isActive && !readonly && addAnnotation && highlight.id && (
					<div className="pt-2 pl-2">
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
	readonly?: boolean;
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
		readonly = false
	}: AnnotationsViewProps
) {
	// All your existing useEffect hooks for sorting and mapping data remain the same
	const [sortedHighlights, setSortedHighlights] = React.useState<PaperHighlight[]>([]);
	const [highlightAnnotationMap, setHighlightAnnotationMap] = React.useState<Map<string, PaperHighlightAnnotation[]>>(new Map());
	const highlightRefs = useRef(new Map<string, React.RefObject<HTMLDivElement | null>>());
	const { user } = useAuth();

	useEffect(() => {
		if (activeHighlight?.id) {
			const ref = highlightRefs.current.get(activeHighlight.id);
			if (ref?.current) {
				ref.current.scrollIntoView({
					behavior: 'smooth',
					block: 'center'
				});
			}
		}
	}, [activeHighlight]);


	useEffect(() => {

		const sortedHighlights = highlights.sort((a, b) => {
			const aStart = a.start_offset || 0;
			const bStart = b.start_offset || 0;
			return aStart - bStart;
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

	}, [highlights, annotations]);


	if (sortedHighlights.length === 0) {
		return (
			<div className="flex flex-col gap-4 p-4 text-center">
				<p className="text-secondary-foreground text-sm">
					{readonly ? "There are no annotations for this paper." : "Highlight text in the document to begin annotating."}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{sortedHighlights.map((highlight) => {

				const annotations = (highlight.id && highlightAnnotationMap.get(highlight.id) || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

				const handleClick = () => {
					onHighlightClick(highlight);
				};

				return (
					<div key={`${highlight.role}-${highlight.id}`} ref={highlight.id ? highlightRefs.current.get(highlight.id) : undefined}>
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
			})}
		</div>
	);
}
