import React, { useState } from 'react';
import { Check, File, Pencil, Trash2, User as UserIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar } from '@/components/ui/avatar';
import { PaperHighlightAnnotation } from '@/lib/schema';
import { User } from '@/lib/auth';

interface AnnotationProps {
    annotation: PaperHighlightAnnotation;
    user?: User;
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

    // Format date more elegantly
    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

        if (diffInHours < 24) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffInHours < 168) { // 7 days
            return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    };

    if (isEditing && !readonly) {
        return (
            <div className="group relative">
                <div className="flex items-start gap-4 p-4 bg-background dark:bg-card border border-border rounded-xl shadow-sm">
                    {/* Avatar */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isAI
                        ? 'bg-blue-200 dark:bg-blue-800'
                        : 'bg-muted dark:bg-muted/70'
                        }`}>
                        {isAI ? (
                            <File size={16} className="text-blue-500" />
                        ) : (
                            <UserIcon size={16} className="text-muted-foreground" />
                        )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-foreground">
                                {isAI ? 'Open Paper' : user?.name || 'User'}
                            </h4>
                        </div>

                        <Textarea
                            value={editedContent}
                            onChange={(e) => setEditedContent(e.target.value)}
                            className="min-h-[80px] bg-muted/50 dark:bg-muted/30 border-border focus:bg-background dark:focus:bg-card"
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                            placeholder="Write your annotation..."
                        />

                        <div className="flex items-center justify-end gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancel}
                                className="text-muted-foreground hover:text-foreground"
                            >
                                <X size={14} className="mr-1" />
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleSave}
                                className="bg-primary hover:bg-primary/90"
                            >
                                <Check size={14} className="mr-1" />
                                Save
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className="group relative"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="relative flex items-start gap-4 p-4 rounded-xl border bg-background dark:bg-card border-border hover:border-border/80 dark:hover:border-border hover:shadow-sm dark:hover:shadow-lg transition-all duration-300">

                {/* Avatar */}
                <div className="relative">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-transform duration-200 ${isAI
                        ? 'bg-blue-200 dark:bg-blue-800'
                        : 'bg-muted dark:bg-muted/70'
                        } ${isHovered ? 'scale-105' : ''}`}>
                        {isAI ? (
                            <File size={16} className="text-blue-500" />
                        ) : user?.picture ? (
                            <Avatar className="h-8 w-8">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={user.picture} alt={user.name} className="w-full h-full object-cover" />
                            </Avatar>
                        ) : (
                            <UserIcon size={16} className="text-muted-foreground" />
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-foreground">
                                {isAI ? 'Open Paper' : user?.name || 'User'}
                            </h4>
                            <span className="text-xs text-muted-foreground bg-muted dark:bg-muted/50 px-2 py-0.5 rounded-full">
                                {formatDate(annotation.created_at)}
                            </span>
                        </div>

                        {/* Action buttons */}
                        {!readonly && removeAnnotation && updateAnnotation && (
                            <div className={`flex items-center gap-1 transition-all duration-200 ${isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
                                }`}>
                                {!isAI && (
                                    <button
                                        className="p-1.5 hover:bg-muted dark:hover:bg-muted/70 rounded-lg transition-colors duration-200 group/btn"
                                        onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                                        title="Edit annotation"
                                    >
                                        <Pencil size={14} className="text-muted-foreground group-hover/btn:text-primary transition-colors" />
                                    </button>
                                )}
                                {!isAI && (
                                    <button
                                        className="p-1.5 hover:bg-destructive/10 dark:hover:bg-destructive/20 rounded-lg transition-colors duration-200 group/btn"
                                        onClick={(e) => { e.stopPropagation(); removeAnnotation(annotation.id); }}
                                        title="Delete annotation"
                                    >
                                        <Trash2 size={14} className="text-muted-foreground group-hover/btn:text-destructive transition-colors" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="prose prose-sm max-w-none dark:prose-invert">
                        <p className="text-foreground leading-relaxed m-0 whitespace-pre-wrap">
                            {annotation.content}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
