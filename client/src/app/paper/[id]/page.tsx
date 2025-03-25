'use client';

import { PdfViewer } from '@/components/PdfViewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchFromApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import { useState, useEffect, FormEvent } from 'react';

interface PaperData {
    filename: string;
    file_url: string;
    authors: string[];
    title: string;
    abstract: string;
    publish_date: string;
    summary: string;
    institutions: string[];
    keywords: string[];
    starter_questions: string[];
}

interface ChatMessage {
    id?: string;
    role: 'user' | 'assistant';
    content: string;
    references?: Record<string, any>;
}

export default function PaperView() {
    const params = useParams();
    const id = params.id as string;
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [loading, setLoading] = useState(true);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);

    useEffect(() => {
        // Only fetch data when id is available
        if (!id) return;

        async function fetchPaper() {
            try {
                console.log(`Fetching paper with ID: ${id}`);

                const response: PaperData = await fetchFromApi(`/api/paper?id=${id}`);
                console.log('Paper data:', response);
                setPaperData(response);
            } catch (error) {
                console.error('Error fetching paper:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchPaper();
    }, [id]);

    useEffect(() => {
        if (!paperData) return;

        // Initialize conversation once paper data is available
        async function fetchConversation() {
            let retrievedConversationId = null;
            try {
                const response = await fetchFromApi(`/api/paper/conversation?document_id=${id}`, {
                    method: 'GET',
                });

                if (response && response.id) {
                    retrievedConversationId = response.id;
                }
                setConversationId(retrievedConversationId);
            } catch (error) {
                console.error('Error fetching conversation ID:', error);

                try {

                    if (!retrievedConversationId) {
                        // If no conversation ID is returned, create a new one
                        const newConversationResponse = await fetchFromApi(`/api/conversation/${id}`, {
                            method: 'POST',
                        });
                        retrievedConversationId = newConversationResponse.id;
                    }

                    setConversationId(retrievedConversationId);
                } catch (error) {
                    console.error('Error fetching conversation:', error);
                }
            }

            console.log("Conversation ID:", retrievedConversationId);
        }

        fetchConversation();
    }, [paperData]);

    useEffect(() => {
        if (!conversationId) return;

        // Fetch initial messages for the conversation
        async function fetchMessages() {
            try {
                const response = await fetchFromApi(`/api/conversation/${conversationId}`, {
                    method: 'GET',
                });

                // Map the response messages to the expected format
                const initialMessages = response.messages.map((msg: any) => ({
                    role: msg.role,
                    content: msg.content,
                    id: msg.id,
                    references: msg.references,
                }));
                setMessages(initialMessages);
            } catch (error) {
                console.error('Error fetching messages:', error);
            }
        }
        fetchMessages();
    }, [conversationId]);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!currentMessage.trim() || isStreaming) return;

        // Add user message to chat
        const userMessage: ChatMessage = { role: 'user', content: currentMessage };
        setMessages(prev => [...prev, userMessage]);

        // Clear input field
        setCurrentMessage('');

        // Create placeholder for assistant response
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
        setIsStreaming(true);

        try {
            // For streaming implementation, you would typically:
            // 1. Make a fetch request with appropriate headers for streaming
            // 2. Process the chunks as they arrive and update the last message
            const response = await fetchFromApi('/api/message/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_query: userMessage.content,
                    conversation_id: conversationId,
                    paper_id: id
                })
            });

            if (!response.ok) throw new Error('Failed to send message');

            if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let done = false;

                while (!done) {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;

                    if (value) {
                        const chunk = decoder.decode(value);

                        // Update the last message with new content
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastMessage = newMessages[newMessages.length - 1];
                            newMessages[newMessages.length - 1] = {
                                ...lastMessage,
                                content: lastMessage.content + chunk
                            };
                            return newMessages;
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error sending message:', error);
            // Update the assistant message to show error
            setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                    role: 'assistant',
                    content: 'Sorry, there was an error processing your request.'
                };
                return newMessages;
            });
        } finally {
            setIsStreaming(false);
        }
    };

    const isDateValid = (dateString: string) => {
        const date = new Date(dateString);
        return !isNaN(date.getTime());
    };

    if (loading) return <div>Loading paper data...</div>;

    if (!paperData) return <div>Paper not found</div>;

    return (
        <div className="w-full h-screen grid grid-cols-2 items-center justify-center gap-4">
            <div className="h-screen overflow-y-auto border-r-2 border-gray-200">
                {/* PDF Viewer Section */}
                {paperData.file_url && (
                    <div className="w-full h-full">
                        <PdfViewer pdfUrl={paperData.file_url} />
                    </div>
                )}
            </div>
            <div className="flex flex-col h-screen p-4">
                {/* Paper Metadata Section */}
                {paperData && (
                    <div className="mb-4 bg-white rounded-lg shadow p-4">
                        <h2 className="text-xl font-bold mb-3">{paperData.title}</h2>
                        <table className="w-full text-sm">
                            <tbody>
                                {paperData.authors && paperData.authors.length > 0 && (
                                    <tr>
                                        <td className="font-semibold pr-2 py-1 align-top">Authors:</td>
                                        <td>{paperData.authors.join(', ')}</td>
                                    </tr>
                                )}
                                {paperData.institutions && paperData.institutions.length > 0 && (
                                    <tr>
                                        <td className="font-semibold pr-2 py-1 align-top">Institutions:</td>
                                        <td>{paperData.institutions.join(', ')}</td>
                                    </tr>
                                )}
                                {paperData.publish_date && isDateValid(paperData.publish_date) && (
                                    <tr>
                                        <td className="font-semibold pr-2 py-1">Published:</td>
                                        <td>{new Date(paperData.publish_date).toLocaleDateString()}</td>
                                    </tr>
                                )}
                                {paperData.keywords && paperData.keywords.length > 0 && (
                                    <tr>
                                        <td className="font-semibold pr-2 py-1 align-top">Keywords:</td>
                                        <td>
                                            <div className="flex flex-wrap gap-1">
                                                {paperData.keywords.map((keyword, i) => (
                                                    <span key={i} className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                                                        {keyword}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                                {
                                    paperData.starter_questions && paperData.starter_questions.length > 0 && (
                                        <tr>
                                            <td className="font-semibold pr-2 py-1 align-top">Starter Questions:</td>
                                            <td>
                                                <ul className="list-disc pl-5">
                                                    {paperData.starter_questions.map((question, i) => (
                                                        <li key={i}>{question}</li>
                                                    ))}
                                                </ul>
                                            </td>
                                        </tr>
                                    )}
                                {paperData.abstract && (
                                    <tr>
                                        <td className="font-semibold pr-2 py-1 align-top">Abstract:</td>
                                        <td>{paperData.abstract}</td>
                                    </tr>
                                )}
                                {
                                    paperData.summary && (
                                        <tr>
                                            <td className="font-semibold pr-2 py-1 align-top">Summary:</td>
                                            <td>{paperData.summary}</td>
                                        </tr>
                                    )
                                }

                            </tbody>
                        </table>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto mb-4 space-y-4">
                    {messages.length === 0 ? (
                        <div className="text-center text-gray-500 my-4">
                            What do you want to know?
                        </div>
                    ) : (
                        messages.map((msg, index) => (
                            <div
                                key={index}
                                className={`p-3 rounded-lg ${msg.role === 'user'
                                    ? 'bg-blue-100 ml-12'
                                    : 'bg-gray-100 mr-12'
                                    }`}
                            >
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                        ))
                    )}
                </div>
                <form onSubmit={handleSubmit} className="flex gap-2">
                    <Input
                        type="text"
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        placeholder="Ask something about this paper..."
                        className="flex-1 p-2 border rounded-md"
                        disabled={isStreaming}
                    />
                    <Button
                        type="submit"
                        className={`px-4 py-2 bg-blue-500 text-white rounded-md ${isStreaming ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
                            }`}
                        disabled={isStreaming}
                    >
                        {isStreaming ? 'Sending...' : 'Send'}
                    </Button>
                </form>
            </div>
        </div>
    );
}
