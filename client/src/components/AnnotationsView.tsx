import React, { useEffect, useState, useRef } from 'react';

import {
	AIPaperHighlight,
	AIPaperHighlightAnnotation,
	PaperHighlight,
	PaperHighlightAnnotation
} from '@/lib/schema';

import { Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from './ui/card';
import { useAuth, User } from "@/lib/auth";
import { Avatar } from './ui/avatar';
import { Annotation } from './Annotation';

export interface AnnotationButtonProps {
	highlightId: string;
	// Make addAnnotation optional as it might not be needed in readonly
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
}

export function AnnotationButton({ highlightId, addAnnotation }: AnnotationButtonProps) {
	const [content, setContent] = useState("");
	const [isTyping, setIsTyping] = useState(false);

	const handleSave = async () => {
		if (content.trim() && addAnnotation) {
			await addAnnotation(highlightId, content);
			setContent("");
			setIsTyping(false);
		}
	};

	const handleCancel = () => {
		setContent("");
		setIsTyping(false);
	};

	if (!addAnnotation) return null;

	return (
		<div className="mt-1 pt-1 border-t border-gray-100">
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
					<Button variant="outline" size="sm" onClick={handleCancel}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave}>
						Save
					</Button>
				</div>
			)}
		</div>
	);
}

interface AnnotationCardProps {
	annotation: PaperHighlightAnnotation;
	removeAnnotation?: (annotationId: string) => void;
	updateAnnotation?: (annotationId: string, content: string) => void;
	user?: User;
	readonly?: boolean;
}

function AnnotationCard({ annotation, removeAnnotation, updateAnnotation, user, readonly = false }: AnnotationCardProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [editedContent, setEditedContent] = useState(annotation.content);

	const handleSave = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (editedContent.trim() !== annotation.content && updateAnnotation) {
			await updateAnnotation(annotation.id, editedContent);
		}
		setIsEditing(false);
	};

	if (isEditing && !readonly) {
		return (
			<div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2">
				<Textarea
					value={editedContent}
					onChange={(e) => setEditedContent(e.target.value)}
					className="mb-2"
					rows={3}
					onClick={(e) => e.stopPropagation()}
					autoFocus
				/>
				<div className="flex justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={(e) => {
							e.stopPropagation();
							setIsEditing(false);
							setEditedContent(annotation.content);
						}}
					>
						Cancel
					</Button>
					<Button size="sm" onClick={handleSave}>
						Save
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="group bg-gray-50 border border-gray-200 rounded-lg p-3 mb-2 hover:bg-gray-100 transition-colors">
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-start gap-2 flex-1">
					<div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
						<Avatar className="h-6 w-6">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							{user?.picture ? (<img src={user.picture} alt={user.name} />) : (<span className="text-xs text-gray-500">{user?.name?.charAt(0)}</span>)}
						</Avatar>
					</div>
					<div className="flex-1">
						<p className="text-sm text-gray-800 leading-relaxed">{annotation.content}</p>
						<p className="text-xs text-gray-500 mt-1">
							{new Date(annotation.created_at).toLocaleDateString()}
						</p>
					</div>
				</div>
				{!readonly && removeAnnotation && updateAnnotation && (
					<div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
						<button
							className="p-1 hover:bg-gray-200 rounded"
							onClick={(e) => {
								e.stopPropagation();
								setIsEditing(true);
							}}
						>
							<Pencil size={12} className="text-gray-500" />
						</button>
						<button
							className="p-1 hover:bg-red-100 rounded"
							onClick={(e) => {
								e.stopPropagation();
								removeAnnotation(annotation.id);
							}}
						>
							<Trash2 size={12} className="text-red-500" />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

interface HighlightThreadProps {
	highlight: PaperHighlight | AIPaperHighlight;
	type: 'user' | 'ai';
	annotations: (AIPaperHighlightAnnotation | PaperHighlightAnnotation)[];
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
	type,
	annotations,
	isActive,
	onClick,
	addAnnotation,
	removeAnnotation,
	updateAnnotation,
	user,
	readonly
}: HighlightThreadProps) {

	const highlightBorderColor = type === 'ai' ? 'border-blue-500' : 'border-gray-400';
	const activeBgColor = isActive ? 'bg-secondary' : 'hover:bg-secondary/50';

	const normalizedAnnotations: PaperHighlightAnnotation[] = annotations.map(annotation => {
		if ('ai_highlight_id' in annotation) {
			// Convert AI annotations to a common format
			return {
				...annotation,
				highlight_id: annotation.ai_highlight_id, // Use ai_highlight_id for consistency
				paper_id: highlight.id, // Assuming highlight.id is the paper ID
				content: annotation.content,
				created_at: annotation.created_at,
				type: 'ai',
			} as PaperHighlightAnnotation;
		}
		return {
			...annotation,
			type: 'user',
		}
	})

	return (
		<Card
			className={`transition-colors cursor-pointer rounded-lg p-2 ${activeBgColor}`}
			onClick={onClick}
		>
			<CardContent className="p-0">
				{/* The Blockquote */}
				<blockquote className={`border-l-4 ${highlightBorderColor} pl-4 py-2 mb-4 bg-background`}>
					<p className="italic text-gray-600">
						"{highlight.raw_text}"
					</p>
				</blockquote>

				{/* The Annotation Thread */}
				<div className="space-y-2">
					{normalizedAnnotations.map((annotation) => (
						<Annotation
							key={annotation.id}
							annotation={{ ...annotation, type: type === 'ai' ? 'ai' : 'user' }}
							removeAnnotation={removeAnnotation}
							updateAnnotation={updateAnnotation}
							user={user}
							readonly={readonly}
						/>
					))}
				</div>

				{/* Add Annotation Form */}
				{type === 'user' && isActive && !readonly && addAnnotation && highlight.id && (
					<div className="mt-4 pt-4 border-t border-gray-200">
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
	aiHighlights?: AIPaperHighlight[];
	annotations: PaperHighlightAnnotation[];
	aiAnnotations?: AIPaperHighlightAnnotation[];
	onHighlightClick: (highlight: PaperHighlight) => void;
	onAIHighlightClick?: (aiHighlight: AIPaperHighlight) => void;
	activeHighlight?: PaperHighlight | null;
	activeAIHighlight?: AIPaperHighlight | null;
	addAnnotation?: (highlightId: string, content: string) => Promise<PaperHighlightAnnotation>;
	removeAnnotation?: (annotationId: string) => void;
	updateAnnotation?: (annotationId: string, content: string) => void;
	readonly?: boolean;
}


interface HighlightWithType {
	highlight: PaperHighlight | AIPaperHighlight;
	type: 'user' | 'ai';
}


export function AnnotationsView(
	{
		highlights,
		aiHighlights,
		annotations,
		aiAnnotations,
		onHighlightClick,
		onAIHighlightClick,
		addAnnotation,
		activeHighlight,
		activeAIHighlight,
		removeAnnotation,
		updateAnnotation,
		readonly = false
	}: AnnotationsViewProps
) {
	// All your existing useEffect hooks for sorting and mapping data remain the same
	const [sortedHighlights, setSortedHighlights] = React.useState<HighlightWithType[]>([]);
	const [highlightAnnotationMap, setHighlightAnnotationMap] = React.useState<Map<string, PaperHighlightAnnotation[]>>(new Map());
	const [aiHighlightAnnotationMap, setAIHighlightAnnotationMap] = React.useState<Map<string, AIPaperHighlightAnnotation[]>>(new Map());
	const highlightRefs = useRef(new Map<string, React.RefObject<HTMLDivElement | null>>());
	const { user, loading: authLoading } = useAuth();

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
		if (activeAIHighlight?.id) {
			const ref = highlightRefs.current.get(activeAIHighlight.id);
			if (ref?.current) {
				ref.current.scrollIntoView({
					behavior: 'smooth',
					block: 'center'
				});
			}
		}
	}, [activeAIHighlight]);


	// Add these helper functions at the top of the component or outside it
	const getStartOffset = (item: HighlightWithType): number => {
		return item.type === 'user'
			? (item.highlight as PaperHighlight).start_offset
			: (item.highlight as AIPaperHighlight).start_offset_hint || 0;
	};

	const getEndOffset = (item: HighlightWithType): number => {
		return item.type === 'user'
			? (item.highlight as PaperHighlight).end_offset
			: (item.highlight as AIPaperHighlight).end_offset_hint || 0;
	};

	useEffect(() => {
		const mergedHighlights: HighlightWithType[] = [];

		// Add user highlights
		highlights.forEach(highlight => {
			mergedHighlights.push({
				highlight,
				type: 'user'
			});
		});

		// Add AI highlights if they exist
		if (aiHighlights && aiHighlights.length > 0) {
			aiHighlights.forEach(aiHighlight => {
				mergedHighlights.push({
					highlight: aiHighlight,
					type: 'ai'
				});
			});
		}

		// Sort by position in document
		const sorted = mergedHighlights.sort((a, b) => {
			const aStartOffset = getStartOffset(a);
			const bStartOffset = getStartOffset(b);
			const aEndOffset = getEndOffset(a);
			const bEndOffset = getEndOffset(b);

			if (aStartOffset === bStartOffset) {
				return aEndOffset - bEndOffset;
			}
			return aStartOffset - bStartOffset;
		});

		setSortedHighlights(sorted);

		// Handle user annotations
		const annotationMap = new Map<string, PaperHighlightAnnotation[]>();
		annotations.forEach((annotation) => {
			const highlightId = annotation.highlight_id;
			const existingAnnotations = annotationMap.get(highlightId) || [];
			existingAnnotations.push(annotation);
			annotationMap.set(highlightId, existingAnnotations);
		});
		setHighlightAnnotationMap(annotationMap);

		// Handle AI annotations
		const aiAnnotationMap = new Map<string, AIPaperHighlightAnnotation[]>();
		if (aiAnnotations) {
			aiAnnotations.forEach((annotation) => {
				const aiHighlightId = annotation.ai_highlight_id;
				const existingAnnotations = aiAnnotationMap.get(aiHighlightId) || [];
				existingAnnotations.push(annotation);
				aiAnnotationMap.set(aiHighlightId, existingAnnotations);
			});

			// Sort AI annotations by created_at for each highlight
			aiAnnotationMap.forEach((annotations, key) => {
				annotations.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
				aiAnnotationMap.set(key, annotations);
			});
		}
		setAIHighlightAnnotationMap(aiAnnotationMap);
	}, [highlights, aiHighlights, annotations, aiAnnotations]);


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
			{sortedHighlights.map((item) => {
				const { highlight, type } = item;
				const isActive = type === 'user'
					? activeHighlight?.id === highlight.id
					: activeAIHighlight?.id === highlight.id;

				const combinedAnnotations = [
					...(type === 'user' ? (highlightAnnotationMap.get(highlight.id!) || []) : []),
					...(type === 'ai' ? (aiHighlightAnnotationMap.get(highlight.id!) || []) : [])
				].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());


				const handleClick = () => {
					if (type === 'user') onHighlightClick(highlight as PaperHighlight);
					else if (type === 'ai' && onAIHighlightClick) onAIHighlightClick(highlight as AIPaperHighlight);
				};

				return (
					<div key={`${type}-${highlight.id}`} ref={highlight.id ? highlightRefs.current.get(highlight.id) : undefined}>
						<HighlightThread
							highlight={highlight}
							type={type}
							annotations={combinedAnnotations}
							isActive={isActive}
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
