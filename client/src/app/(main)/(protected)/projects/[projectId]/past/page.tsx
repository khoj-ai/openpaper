'use client';

import { useEffect } from 'react';
import { fetchFromApi } from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import ConversationHistory from '@/components/ConversationHistory';
import { useProjectWorkspace } from '@/components/project/ProjectWorkspaceProvider';

export default function ProjectPastConversationsPage() {
    const { projectId, conversations, refetchConversations, setCrumb } = useProjectWorkspace();

    useEffect(() => {
        setCrumb('Past chats');
        return () => setCrumb(null);
    }, [setCrumb]);

    const handleDeleteConversation = async (conversationId: string) => {
        try {
            await fetchFromApi(`/api/conversation/${conversationId}`, {
                method: 'DELETE',
            });
            refetchConversations();
        } catch (error) {
            console.error('Error deleting conversation', error);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl p-4 md:p-6">
                <div className="mb-6 flex items-start justify-between">
                    <div>
                        <h1 className="text-lg font-semibold">Past Conversations</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Browse and manage your previous conversations for this project.
                        </p>
                    </div>
                    <Link href={`/projects/${projectId}`}>
                        <Button variant="outline" size="sm">
                            <Plus className="mr-2 h-4 w-4" /> New Chat
                        </Button>
                    </Link>
                </div>
                <ConversationHistory
                    conversations={conversations}
                    onDelete={handleDeleteConversation}
                    hrefGenerator={(conversation) => `/projects/${projectId}/conversations/${conversation.id}`}
                    compact
                />
            </div>
        </div>
    );
}
