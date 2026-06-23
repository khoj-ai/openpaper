'use client';

import { useEffect, useState } from 'react';
import { fetchFromApi } from '@/lib/api';
import { Conversation } from '@/lib/schema';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import ConversationHistory from '@/components/ConversationHistory';
import { useParams } from 'next/navigation';

export default function ProjectPastConversationsPage() {
    const params = useParams();
    const projectId = params.projectId as string;
    const [conversations, setConversations] = useState<Conversation[]>([]);

    useEffect(() => {
        const fetchConversations = async () => {
            try {
                const response = await fetchFromApi(`/api/projects/conversations/${projectId}`);
                setConversations(response);
            } catch (error) {
                console.error(`Error fetching conversations for project ${projectId}`, error);
                setConversations([]);
            }
        };

        if (projectId) {
            fetchConversations();
        }
    }, [projectId]);

    const handleDeleteConversation = async (conversationId: string) => {
        try {
            await fetchFromApi(`/api/conversation/${conversationId}`, {
                method: 'DELETE',
            });
            setConversations(conversations.filter((c) => c.id !== conversationId));
        } catch (error) {
            console.error('Error deleting conversation', error);
        }
    };

    return (
        <div className="p-4 md:p-6 lg:w-2/3 mx-auto">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Past Conversations</h1>
                    <p className="text-muted-foreground mt-1">
                        Browse and manage your previous conversations for this project.
                    </p>
                </div>
                <Link href={`/projects/${projectId}`}>
                    <Button variant="outline">
                        <Plus className="mr-2 h-4 w-4" /> New Chat
                    </Button>
                </Link>
            </div>
            <ConversationHistory
                conversations={conversations}
                onDelete={handleDeleteConversation}
                hrefGenerator={(conversation) => `/projects/${projectId}/conversations/${conversation.id}`}
            />
        </div>
    );
}
