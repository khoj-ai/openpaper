import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { BasicUser } from '@/lib/auth';
import { HighlightColor, PaperHighlightAnnotation } from '@/lib/schema';
import { formatDate } from '@/lib/utils';
import { Check, File, Pencil, Trash2, User as UserIcon, X } from 'lucide-react';
import React, { useState } from 'react';

// Map highlight color names to bubble background + border classes for annotation notes in the side panel
const BUBBLE_BG_MAP: Record<HighlightColor, string> = {
    yellow: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800",
    green:  "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800",
    blue:   "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    pink:   "bg-pink-50 border-pink-200 dark:bg-pink-950/30 dark:border-pink-800",
    purple: "bg-purple-50 border-purple-200 dark:bg-purple-950/30 dark:border-purple-800",
};

interface AnnotationProps {
    annotation: PaperHighlightAnnotation;
    highlightColor?: HighlightColor;
    user?: BasicUser;
    removeAnnotation?: (annotationId: string) => void;
    updateAnnotation?: (annotationId: string, content: string) => void;
    readonly?: boolean;
}

export default function Annotation({
    annotation,
    highlightColor = 'blue',
    user,
    removeAnnotation,
    updateAnnotation,
    readonly = false
}: AnnotationProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(annotation.content);
    const [isHovered, setIsHovered] = useState(false);
    const isAI = annotation.role === 'assistant';

    const bubbleClass = BUBBLE_BG_MAP[highlightColor] ?? BUBBLE_BG_MAP['blue'];

    const handleSave = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (editedContent.trim() !== annotation.content && updateAnnotation) {
            await updateAnnotation(annotation.id, editedContent);
        }
        setIsEditing(false);
    };

    const handleCancel = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditedContent(annotation.content);
        setIsEditing(false);
    };

    const avatarEl = (
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${isAI ? 'bg-blue-100 dark:bg-blue-900' : 'bg-muted'}`}>
            {isAI ? (
                <File size={14} className="text-blue-500" />
            ) : user?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
            ) : (
                <UserIcon size={14} className="text-muted-foreground" />
            )}
        </div>
    );

    if (isEditing && !readonly) {
        return (
            <div className="w-full min-w-0">
                {/* Avatar row */}
                <div className="flex items-center gap-2">
                    {avatarEl}
                    <span className="text-sm font-medium text-foreground">
                        {isAI ? 'Open Paper' : user?.name || 'User'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {formatDate(annotation.created_at)}
                    </span>
                </div>

                {/* Indent to align with name, but use padding so width stays within container */}
                <div className="pl-10 mt-2">
                    <Textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full min-h-[60px] text-sm focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-foreground focus-visible:border-foreground"
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        placeholder="Write your annotation..."
                    />

                    <div className="flex items-center justify-end gap-1 mt-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCancel}
                            className="h-7 text-xs text-muted-foreground hover:text-foreground"
                        >
                            <X size={12} className="mr-1" />
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSave}
                            className="h-7 text-xs"
                        >
                            <Check size={12} className="mr-1" />
                            Save
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Avatar row: avatar + name + timestamp + action buttons */}
            <div className="flex items-center gap-2">
                {avatarEl}
                <span className="text-sm font-medium text-foreground">
                    {isAI ? 'Open Paper' : user?.name || 'User'}
                </span>
                <span className="text-xs text-muted-foreground">
                    {formatDate(annotation.created_at)}
                </span>

                {!readonly && removeAnnotation && updateAnnotation && !isAI && (
                    <div className={`flex items-center gap-0.5 ml-auto transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                        <button
                            className="p-1 hover:bg-muted rounded transition-colors"
                            onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                            title="Edit"
                        >
                            <Pencil size={12} className="text-muted-foreground hover:text-primary" />
                        </button>
                        <button
                            className="p-1 hover:bg-destructive/10 rounded transition-colors"
                            onClick={(e) => { e.stopPropagation(); removeAnnotation(annotation.id); }}
                            title="Delete"
                        >
                            <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
                        </button>
                    </div>
                )}
            </div>

            {/* Annotation note bubble — indented to align with the name */}
            <div className={`ml-10 border rounded-tr-lg rounded-bl-lg rounded-br-lg p-3 mt-2 text-sm text-foreground leading-snug whitespace-pre-wrap ${bubbleClass}`}>
                {annotation.content}
            </div>
        </div>
    );
}
