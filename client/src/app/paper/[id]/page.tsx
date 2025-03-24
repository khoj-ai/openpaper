'use client';

import { PdfViewer } from '@/components/PdfViewer';
import { fetchFromApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import { useState, useEffect, FormEvent } from 'react';

interface PaperData {
    filename: string;
    url: string;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export default function PaperView() {
    const params = useParams();
    const id = params.id as string;
    const [paperData, setPaperData] = useState<PaperData | null>(null);
    const [loading, setLoading] = useState(true);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [currentMessage, setCurrentMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);


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
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage.content,
                    paperId: id
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

    if (loading) return <div>Loading paper data...</div>;

    if (!paperData) return <div>Paper not found</div>;

    return (
        <div className="w-full h-screen grid grid-cols-2 items-center justify-center gap-4">
            <div className="h-screen overflow-y-auto">
                {paperData.url && (
                    <div className="w-full h-full">
                        <PdfViewer pdfUrl={paperData.url} />
                    </div>
                )}
            </div>
            <div className="flex flex-col h-screen p-4">
                <div className="flex-1 overflow-y-auto mb-4 space-y-4">
                    {messages.length === 0 ? (
                        <div className="text-center text-gray-500 my-4">
                            Ask questions about this paper
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
                    <input
                        type="text"
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        placeholder="Ask something about this paper..."
                        className="flex-1 p-2 border rounded-md"
                        disabled={isStreaming}
                    />
                    <button
                        type="submit"
                        className={`px-4 py-2 bg-blue-500 text-white rounded-md ${isStreaming ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
                            }`}
                        disabled={isStreaming}
                    >
                        {isStreaming ? 'Sending...' : 'Send'}
                    </button>
                </form>
            </div>
        </div>
    );
}