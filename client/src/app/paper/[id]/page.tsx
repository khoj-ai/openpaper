'use client';

import { PdfViewer } from '@/components/PdfViewer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchFromApi, fetchStreamFromApi } from '@/lib/api';
import { useParams } from 'next/navigation';
import { useState, useEffect, FormEvent } from 'react';

import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from 'lucide-react';

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
    references?: Record<string, Record<string, string | number>[]>;
}

const isDateValid = (dateString: string) => {
    const date = new Date(dateString);
    return !isNaN(date.getTime());
};

const googleScholarUrl = (searchTerm: string) => {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(searchTerm)}`;
}

interface IPaperMetadata {
    paperData: PaperData;
    onClickStarterQuestion: (question: string) => void;
    hasMessages: boolean;
}

function PaperMetadata(props: IPaperMetadata) {
    const { paperData } = props;
    const [isOpen, setIsOpen] = useState(!props.hasMessages);

    useEffect(() => {
        setIsOpen(!props.hasMessages);
    }, [props.hasMessages]);

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={setIsOpen}
            className="mb-4 bg-white rounded-lg shadow"
        >
            <div className="p-4">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                    <h2 className="text-xl font-bold">{paperData.title}</h2>
                    <div className="text-gray-500">
                        {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
                <div className="px-4 pb-4">
                    <table className="w-full text-sm">
                        <tbody>
                            {paperData.authors && paperData.authors.length > 0 && (
                                <tr>
                                    <td className="font-semibold pr-2 py-1 align-top">Authors:</td>
                                    <td>
                                        {
                                            paperData.authors.length > 0 && (
                                                paperData.authors.map((author, i) => (
                                                    <a
                                                        key={i}
                                                        href={googleScholarUrl(author)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-500 hover:underline mr-2"
                                                    >
                                                        {author}
                                                    </a>
                                                ))
                                            )
                                        }
                                    </td>
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
                            {paperData.summary && (
                                <tr>
                                    <td className="font-semibold pr-2 py-1 align-top">Summary:</td>
                                    <td>{paperData.summary}</td>
                                </tr>
                            )}
                            {paperData.starter_questions && paperData.starter_questions.length > 0 && (
                                <tr>
                                    <td className="font-semibold pr-2 py-1 align-top">Starter Questions:</td>
                                    <td>
                                        <div className="flex gap-2 mt-2 flex-wrap">
                                            {paperData.starter_questions.map((question, i) => (
                                                <Button
                                                    key={i}
                                                    variant="outline"
                                                    className="text-xs font-medium p-2 max-w-full whitespace-normal h-auto text-left justify-start break-words"
                                                    onClick={() => props.onClickStarterQuestion(question)}
                                                >
                                                    {question}
                                                </Button>
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
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
                const initialMessages = response.messages.map((msg: ChatMessage) => ({
                    role: msg.role,
                    content: msg.content,
                    id: msg.id,
                    references: msg.references || {}
                }));
                console.log('Initial messages:', initialMessages);
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
            const stream = await fetchStreamFromApi('/api/message/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_query: userMessage.content,
                    conversation_id: conversationId,
                    paper_id: id
                })
            });

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let accumulatedContent = '';
            let references: Record<string, Record<string, string | number>[]> = {};

            // Debug counters
            let chunkCount = 0;
            let contentChunks = 0;
            let referenceChunks = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                // Decode the chunk
                const chunk = decoder.decode(value);
                chunkCount++;
                console.log(`Processing chunk #${chunkCount}:`, chunk);

                try {
                    // Parse the JSON chunk
                    const parsedChunk = JSON.parse(chunk);
                    const chunkType = parsedChunk.type;
                    const chunkContent = parsedChunk.content;

                    if (chunkType === 'content') {
                        contentChunks++;
                        console.log(`Processing content chunk #${contentChunks}:`, chunkContent);

                        // Add this content to our accumulated content
                        accumulatedContent += chunkContent;

                        // Update the message with the new content
                        setMessages(prev => {
                            const updatedMessages = [...prev];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...updatedMessages[updatedMessages.length - 1],
                                content: accumulatedContent,
                                ...(Object.keys(references).length > 0 ? { references } : {})
                            };
                            return updatedMessages;
                        });
                    }
                    else if (chunkType === 'references') {
                        referenceChunks++;
                        console.log(`Processing references chunk #${referenceChunks}:`, chunkContent);

                        // Store the references
                        references = chunkContent;

                        // Update the message with the references
                        setMessages(prev => {
                            const updatedMessages = [...prev];
                            updatedMessages[updatedMessages.length - 1] = {
                                ...updatedMessages[updatedMessages.length - 1],
                                content: accumulatedContent,
                                references
                            };
                            return updatedMessages;
                        });
                    }
                    else {
                        console.warn(`Unknown chunk type: ${chunkType}`);
                    }
                } catch (error) {
                    console.error('Error processing chunk:', error, 'Raw chunk:', chunk);
                    // Handle the error gracefully
                    setMessages(prev => {
                        const updatedMessages = [...prev];
                        updatedMessages[updatedMessages.length - 1] = {
                            ...updatedMessages[updatedMessages.length - 1],
                            content: "An error occurred while processing the response. Can you try again?",
                        };
                        return updatedMessages;
                    });
                    break;
                }
            }

            console.log(`Stream completed. Processed ${chunkCount} chunks (${contentChunks} content, ${referenceChunks} references).`);
            console.log("Final accumulated content:", accumulatedContent);
            console.log("Final references:", references);

        } catch (error) {
            console.error('Error during streaming:', error);
            setMessages(prev => {
                const updatedMessages = [...prev];
                updatedMessages[updatedMessages.length - 1] = {
                    ...updatedMessages[updatedMessages.length - 1],
                    content: "An error occurred while processing your request.",
                };
                return updatedMessages;
            });
        } finally {
            setIsStreaming(false);
        }
    };

    if (loading) return <div>Loading paper data...</div>;

    if (!paperData) return <div>Paper not found</div>;

    return (
        <div className="w-full h-screen grid grid-cols-2 items-center justify-center gap-4">
            <div className="h-screen overflow-y-auto border-r-2 border-l-2 border-gray-200">
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
                    <PaperMetadata
                        paperData={paperData}
                        hasMessages={messages.length > 0}
                        onClickStarterQuestion={(question) => {
                            setCurrentMessage(question);
                        }}
                    />
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
                                    ? 'bg-blue-100 text-blue-800 ml-12'
                                    : 'w-full'
                                    }`}
                            >
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                                {
                                    msg.references && msg.references['citations']?.length > 0 && (
                                        <div className="mt-2">
                                            <strong>References:</strong>
                                            <ul className="list-disc pl-5">
                                                {Object.entries(msg.references['citations']).map(([key, value]) => (
                                                    <div key={key} className="flex flex-row gap-2">
                                                        <div className="text-xs text-gray-500">
                                                            {value.key}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {value.reference}
                                                        </div>
                                                    </div>
                                                ))}
                                            </ul>
                                        </div>
                                    )
                                }
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
