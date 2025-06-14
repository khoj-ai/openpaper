import React, { useState } from 'react';
import { Bot, Pencil, Trash2, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar } from '@/components/ui/avatar';
import { PaperHighlightAnnotation } from '@/lib/schema';
import { User } from '@/lib/auth';

interface AnnotationProps {
    annotation: PaperHighlightAnnotation & { type: 'user' | 'ai' };
    user?: User;
    removeAnnotation?: (annotationId: string) => void;
    updateAnnotation?: (annotationId: string, content: string) => void;
    readonly?: boolean;
}

export function Annotation({ annotation, user, removeAnnotation, updateAnnotation, readonly = false }: AnnotationProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(annotation.content);
    const isAI = annotation.type === 'ai';

    const handleSave = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (editedContent.trim() !== annotation.content && updateAnnotation) {
            await updateAnnotation(annotation.id, editedContent);
        }
        setIsEditing(false);
    };

    // Common styles
    const avatarBaseClasses = "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0";
    const contentBaseClasses = "w-full rounded-lg";

    // Type-specific styles
    const avatarClasses = isAI
        ? `${avatarBaseClasses} bg-blue-500`
        : `${avatarBaseClasses} bg-gray-200`;

    const contentClasses = isAI
        ? `${contentBaseClasses} bg-blue-50/50`
        : `${contentBaseClasses} bg-gray-50/50`;

    const authorName = isAI ? 'AI Analysis' : user?.name || 'User';

    if (isEditing && !readonly) {
        return (
            <div className="flex items-start gap-3 w-full">
                <div className={avatarClasses}>
                    {isAI ? <Bot size={14} className="text-white" /> : <UserIcon size={14} className="text-gray-600" />}
                </div>
                <div className="w-full">
                    <Textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="mb-2"
                        rows={3}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleSave}>
                            Save
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="group flex items-start gap-3 w-full">
            <div className={avatarClasses}>
                {isAI ? (
                    <Bot size={14} className="text-white" />
                ) : (
                    <Avatar className="h-7 w-7">
                        {user?.picture ? <img src={user.picture} alt={user.name} /> : <span className="text-xs">{user?.name?.charAt(0)}</span>}
                    </Avatar>
                )}
            </div>
            <div className={contentClasses}>
                <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium text-gray-900">{authorName}</p>
                    {!readonly && !isAI && removeAnnotation && updateAnnotation && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                            <button className="p-1 hover:bg-gray-200 rounded" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>
                                <Pencil size={14} className="text-gray-600" />
                            </button>
                            <button className="p-1 hover:bg-red-100 rounded" onClick={(e) => { e.stopPropagation(); removeAnnotation(annotation.id); }}>
                                <Trash2 size={14} className="text-red-500" />
                            </button>
                        </div>
                    )}
                </div>
                <p className="text-sm text-gray-700 leading-relaxed">{annotation.content}</p>
                <p className="text-xs text-gray-500 mt-2">
                    {new Date(annotation.created_at).toLocaleDateString()}
                </p>
            </div>
        </div>
    );
}
