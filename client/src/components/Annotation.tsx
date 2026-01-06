import React, { useState } from 'react';
import { Check, File, Pencil, Trash2, User as UserIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PaperHighlightAnnotation } from '@/lib/schema';
import { BasicUser } from '@/lib/auth';
import { formatDate } from '@/lib/utils';

interface AnnotationProps {
    annotation: PaperHighlightAnnotation;
    user?: BasicUser;
    removeAnnotation?: (annotationId: string) => void;
    updateAnnotation?: (annotationId: string, content: string) => void;
    readonly?: boolean;
}

export default function Annotation({
    annotation,
    user,
    removeAnnotation,
    updateAnnotation,
    readonly = false
}: AnnotationProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(annotation.content);
    const [isHovered, setIsHovered] = useState(false);
    const isAI = annotation.role === 'assistant';

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

    if (isEditing && !readonly) {
        return (
            <div className="border-l border-muted pl-2 py-1">
                <div className="flex items-center gap-1.5 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isAI
                        ? 'bg-blue-100 dark:bg-blue-900'
                        : 'bg-muted'
                        }`}>
                        {isAI ? (
                            <File size={10} className="text-blue-500" />
                        ) : (
                            <UserIcon size={10} className="text-muted-foreground" />
                        )}
                    </div>
                    <span className="text-xs font-medium text-foreground">
                        {isAI ? 'Open Paper' : user?.name || 'User'}
                    </span>
                </div>

                <Textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="min-h-[60px] text-sm"
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
        );
    }

    return (
        <div
            className="group border-l border-muted pl-2 py-1"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="flex items-center gap-1.5">
                {/* Avatar */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${isAI
                    ? 'bg-blue-100 dark:bg-blue-900'
                    : 'bg-muted'
                    }`}>
                    {isAI ? (
                        <File size={10} className="text-blue-500" />
                    ) : user?.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                        <UserIcon size={10} className="text-muted-foreground" />
                    )}
                </div>

                <span className="text-xs font-medium text-foreground">
                    {isAI ? 'Open Paper' : user?.name || 'User'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                    {formatDate(annotation.created_at)}
                </span>

                {/* Action buttons */}
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

            <p className="text-sm text-foreground leading-snug mt-0.5 whitespace-pre-wrap">
                {annotation.content}
            </p>
        </div>
    );
}
