"use client";

import { FormEvent, useCallback, useRef, useState, useEffect } from "react";
import { useIsMobile } from "@/lib/useMobile";
import { AnimatedMarkdown } from "@/components/AnimatedMarkdown";
import { Button } from "@/components/ui/button";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { Loader, ArrowUp, Recycle, X, ChevronDown, ChevronUp } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import CustomCitationLink from "@/components/utils/CustomCitationLink";
import { ChatMessageActions } from "@/components/ChatMessageActions";
import { ChatMessage, Reference, PaperItem } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import Link from "next/link";
import { TopicBubbles } from "@/components/TopicBubbles";
import { AnimatedGradientText } from "@/components/magicui/animated-gradient-text";
import { ChatHistorySkeleton } from "@/components/ChatHistorySkeleton";
import { PdfViewer } from "@/components/PdfViewer";

interface ConversationViewProps {
	messages: ChatMessage[];
	isOwner: boolean;
	papers: PaperItem[];
	isStreaming: boolean;
	streamingChunks: string[];
	streamingReferences?: Reference;
	statusMessage: string;
	error: string | null;
	isSessionLoading: boolean;
	chatCreditLimitReached: boolean;
	currentMessage: string;
	onCurrentMessageChange: (message: string) => void;
	onSubmit: (e?: FormEvent) => Promise<void>;
	onRetry: () => void;
	isCentered: boolean;
	setIsCentered: (isCentered: boolean) => void;
	displayedText: string;
	isTyping: boolean;
	handleCitationClick: (key: string, messageIndex: number) => void;
	highlightedInfo: { paperId: string; messageIndex: number } | null;
	setHighlightedInfo: (info: { paperId: string; messageIndex: number } | null) => void;
	authLoading: boolean;
}

export const ConversationView = ({
	messages,
	isOwner,
	papers,
	isStreaming,
	streamingChunks,
	streamingReferences,
	statusMessage,
	error,
	isSessionLoading,
	chatCreditLimitReached,
	currentMessage,
	onCurrentMessageChange,
	onSubmit,
	onRetry,
	isCentered,
	setIsCentered,
	displayedText,
	isTyping,
	handleCitationClick: originalHandleCitationClick,
	highlightedInfo,
	setHighlightedInfo,
	authLoading,
}: ConversationViewProps) => {
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputMessageRef = useRef<HTMLTextAreaElement>(null);
	const chatInputFormRef = useRef<HTMLFormElement>(null);

	const [pdfUrl, setPdfUrl] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState<string | null>(null);
	const [isPdfVisible, setIsPdfVisible] = useState(false);
	const isMobile = useIsMobile();

	const [statusMessageHistory, setStatusMessageHistory] = useState<{ message: string; startTime: number }[]>([]);
	const [elapsedTime, setElapsedTime] = useState(0);
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);

	useEffect(() => {
		if (statusMessage && (statusMessageHistory.length === 0 || statusMessageHistory[statusMessageHistory.length - 1].message !== statusMessage)) {
			setStatusMessageHistory(prev => [...prev, { message: statusMessage, startTime: Date.now() }]);
		}
	}, [statusMessage, statusMessageHistory]);

	useEffect(() => {
		if (!isStreaming) {
			setStatusMessageHistory([]);
			setIsHistoryOpen(false);
		}
	}, [isStreaming]);

	useEffect(() => {
		let interval: NodeJS.Timeout | undefined;
		if (isStreaming && statusMessageHistory.length > 0) {
			const updateElapsedTime = () => {
				const lastStatus = statusMessageHistory[statusMessageHistory.length - 1];
				if (lastStatus) {
					setElapsedTime(Math.floor((Date.now() - lastStatus.startTime) / 1000));
				}
			};
			updateElapsedTime();
			interval = setInterval(updateElapsedTime, 1000);
		} else {
			setElapsedTime(0);
		}
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [isStreaming, statusMessageHistory]);

	const handleCitationClick = (key: string, messageIndex: number) => {
		originalHandleCitationClick(key, messageIndex);
		const message = messages[messageIndex];
		if (!message || !message.references) return;

		const citation = message.references.citations.find(c => String(c.key) === key);
		if (!citation) return;

		const paper = papers.find(p => p.id === citation.paper_id);

		if (paper && paper.file_url) {
			setPdfUrl(paper.file_url);
			setSearchTerm(citation.reference);
			setIsPdfVisible(true);
		}
	};

	const handleTextareaChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			onCurrentMessageChange(e.target.value);
		},
		[onCurrentMessageChange]
	);

	const handleNewSubmit = useCallback(
		async (e: FormEvent | null = null) => {
			if (e) {
				e.preventDefault();
			}
			if (isCentered) {
				setIsCentered(false);
			}

			if (!e) return;
			await onSubmit(e);
		},
		[isCentered, onSubmit, setIsCentered]
	);

	const memoizedMessages = messages.map((msg, index) => (
		<div
			key={`${msg.id || `msg-${index}`}-${msg.role}`} // Use a stable and unique key
			className="flex flex-row gap-2 items-end transition-all duration-300 ease-in-out"
		>
			<div
				data-message-index={index}
				className={`relative group prose dark:prose-invert !max-w-full transition-all duration-300 ease-in-out ${msg.role === "user"
					? "text-lg w-fit animate-fade-in line-clamp-3 mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-600 px-2 py-2 rounded-xl border border-blue-100 dark:border-gray-600"
					: "w-full text-primary"
					}`}
			>
				<Markdown
					remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
					rehypePlugins={[rehypeKatex]}
					components={{
						p: (props) => (
							<CustomCitationLink
								{...props}
								handleCitationClick={handleCitationClick}
								messageIndex={index}
								citations={msg.references?.citations || []}
								papers={papers}
							/>
						),
						li: (props) => (
							<CustomCitationLink
								{...props}
								handleCitationClick={handleCitationClick}
								messageIndex={index}
								citations={msg.references?.citations || []}
								papers={papers}
							/>
						),
						div: (props) => (
							<CustomCitationLink
								{...props}
								handleCitationClick={handleCitationClick}
								messageIndex={index}
								citations={msg.references?.citations || []}
								papers={papers}
							/>
						),
						td: (props) => (
							<CustomCitationLink
								{...props}
								handleCitationClick={handleCitationClick}
								messageIndex={index}
								citations={msg.references?.citations || []}
								papers={papers}
							/>
						),
						table: (props) => (
							<div className="overflow-x-auto">
								<table {...props} className="min-w-full border-collapse" />
							</div>
						),
					}}
				>
					{msg.content}
				</Markdown>
				{msg.role === "assistant" && (
					<ChatMessageActions message={msg.content} references={msg.references} />
				)}
				{msg.references && msg.references["citations"]?.length > 0 && (
					<div>
						<div
							className="mt-0 pt-0 border-t border-gray-300 dark:border-gray-700"
							id="references-section"
						>
							<h4 className="text-sm font-semibold mb-2">References</h4>
						</div>
						<ReferencePaperCards
							citations={msg.references.citations}
							papers={papers}
							messageId={msg.id}
							messageIndex={index}
							highlightedPaper={
								highlightedInfo && highlightedInfo.messageIndex === index
									? highlightedInfo.paperId
									: null
							}
							onHighlightClear={() => setHighlightedInfo(null)}
						/>
					</div>
				)}
			</div>
		</div>
	));

	return (
		<div className="flex flex-row w-full h-full">
			<div className={`flex flex-col h-full transition-all duration-500 ease-in-out ${isMobile ? (isPdfVisible ? 'hidden' : 'w-full') : (isPdfVisible ? 'w-1/3' : 'w-full md:w-1/2 mx-auto')}`}>
				<div
					className={`${isCentered ? "flex-0" : "flex-1"} w-full overflow-y-auto transition-all duration-300 ease-in-out`}
					ref={messagesContainerRef}
				>
					<div className={`space-y-4 w-full transition-all duration-300 ease-in-out ${isPdfVisible ? 'p-2' : 'p-4'}`}>
						{isSessionLoading ? (
							<ChatHistorySkeleton />
						) : (
							<>
								{papers.length === 0 && messages.length === 0 && !authLoading && (
									<div className="text-center p-8">
										<h2 className="text-xl font-semibold mb-2">No Papers Found</h2>
										<p className="text-gray-600 dark:text-gray-400 mb-4">
											You need to have at least one paper indexed to ask questions.
										</p>
										<Button onClick={() => (window.location.href = "/")}>
											Index a Paper
										</Button>
									</div>
								)}

								{messages.length > 0 && memoizedMessages}
							</>
						)}
						{isStreaming && streamingChunks.length > 0 && (
							<div className="relative group prose dark:prose-invert !max-w-full rounded-lg w-full text-primary dark:text-primary-foreground transition-all duration-300 ease-in-out">
								<AnimatedMarkdown
									className="!p-0"
									content={streamingChunks.join("")}
									remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkGfm]}
									rehypePlugins={[rehypeKatex]}
									components={{
										p: (props) => (
											<CustomCitationLink
												{...props}
												handleCitationClick={handleCitationClick}
												messageIndex={messages.length}
												citations={streamingReferences?.citations || []}
											/>
										),
										li: (props) => (
											<CustomCitationLink
												{...props}
												handleCitationClick={handleCitationClick}
												messageIndex={messages.length}
												citations={streamingReferences?.citations || []}
											/>
										),
										div: (props) => (
											<CustomCitationLink
												{...props}
												handleCitationClick={handleCitationClick}
												messageIndex={messages.length}
												citations={streamingReferences?.citations || []}
											/>
										),
										td: (props) => (
											<CustomCitationLink
												{...props}
												handleCitationClick={handleCitationClick}
												messageIndex={messages.length}
												citations={streamingReferences?.citations || []}
											/>
										),
										table: (props) => (
											<div className="w-full overflow-x-auto">
												<table {...props} className="min-w-full border-collapse" />
											</div>
										),
									}}
								/>
								<ChatMessageActions
									message={streamingChunks.join("")}
									references={streamingReferences}
								/>
							</div>
						)}
						{isStreaming && (
							<div className="flex items-center gap-3 p-2">
								<Loader className="animate-spin w-6 h-6 text-blue-500 flex-shrink-0" />
								<div className="text-sm text-secondary-foreground w-full">
									{displayedText}
									{isTyping && <span className="animate-pulse">|</span>}
									{statusMessageHistory.length > 0 && (
										<div className="text-xs text-gray-500 mt-1">
											<div className="flex justify-between items-center">
												<span>{statusMessageHistory[statusMessageHistory.length - 1].message}</span>
												<span className="ml-2 text-gray-400 tabular-nums">({elapsedTime}s)</span>
											</div>
											{statusMessageHistory.length > 1 && (
												<div className="mt-1">
													<button onClick={() => setIsHistoryOpen(!isHistoryOpen)} className="flex items-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
														{isHistoryOpen ? <ChevronUp className="w-4 h-4 mr-1" /> : <ChevronDown className="w-4 h-4 mr-1" />}
														<span>Progress</span>
													</button>
													{isHistoryOpen && (
														<ul className="mt-2 border-l border-gray-300 dark:border-gray-600">
															{statusMessageHistory.slice(0, -1).reverse().map((status, index) => (
																<li key={index} className="relative ml-4 mb-1 text-gray-400">
																	<div className="absolute w-2 h-2 bg-gray-400 rounded-full top-1.5 -left-5 dark:bg-gray-500"></div>
																	{status.message}
																</li>
															))}
														</ul>
													)}
												</div>
											)}
										</div>
									)}
								</div>
							</div>
						)}
						<div ref={messagesEndRef} />
						{error && (
							<div className="flex flex-col items-start gap-2 p-4 text-black dark:text-white">
								<p>{error}</p>
								<Button onClick={onRetry} variant="outline">
									<Recycle className="mr-2 h-4 w-4" />
									Retry
								</Button>
							</div>
						)}
					</div>
				</div>
				<div
					className={`transition-all duration-300 ${isCentered
						? "flex-1 flex flex-col justify-center items-center my-au"
						: ""
						} ${isPdfVisible ? 'p-2' : 'p-4'} ease-in-out`}
				>
					{isCentered && (
						<AnimatedGradientText
							className="text-2xl font-bold mb-4"
							colorFrom="#6366f1"
							colorTo="#3b82f6"
						>
							What would you like to discover in your papers?
						</AnimatedGradientText>
					)}
					<form onSubmit={handleNewSubmit} className="w-full transition-all duration-300 ease-in-out" ref={chatInputFormRef}>
						<div className="relative w-full transition-all duration-300 ease-in-out">
							<Textarea
								value={currentMessage}
								onChange={handleTextareaChange}
								ref={inputMessageRef}
								placeholder={
									isCentered
										? "Discover something in your papers..."
										: "Ask a follow-up"
								}
								className="pr-16 resize-none w-full bg-secondary"
								disabled={isStreaming || papers.length === 0 || chatCreditLimitReached || !isOwner}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										handleNewSubmit(e);
									}
								}}
							/>
							<Button
								type="submit"
								variant="ghost"
								className="absolute top-1/2 right-2 -translate-y-1/2"
								disabled={isStreaming || papers.length === 0 || chatCreditLimitReached || !isOwner}
							>
								<ArrowUp className="h-5 w-5" />
							</Button>
						</div>
						{chatCreditLimitReached && (
							<div className="text-center text-sm text-secondary-foreground mt-2">
								Nice! You have used your chat credits for the week.{" "}
								<Link href="/pricing" className="text-blue-500 hover:underline">
									Upgrade your plan to use more.
								</Link>
							</div>
						)}
					</form>
					{isCentered && (
						<div className="absolute bottom-0 left-0 w-full">
							<TopicBubbles isVisible={currentMessage.length === 0} />
						</div>
					)}
				</div>
			</div>
			{isPdfVisible && (
				<div className={`${isMobile ? 'w-full relative' : 'w-2/3 border-l-2'} flex flex-col animate-in slide-in-from-right-5 duration-500 ease-in-out`}>
					{isMobile && (
						<Button onClick={() => setIsPdfVisible(false)} variant="ghost" size="icon" className="absolute top-2 right-2 z-20 bg-background rounded-full">
							<X className="h-6 w-6" />
						</Button>
					)}
					<div className="flex-grow transition-all duration-300 ease-in-out overflow-y-auto">
						{pdfUrl && (
							<PdfViewer
								pdfUrl={pdfUrl}
								explicitSearchTerm={searchTerm || undefined}
								highlights={[]}
								activeHighlight={null}
								setUserMessageReferences={() => { }}
								setSelectedText={() => { }}
								setTooltipPosition={() => { }}
								setIsAnnotating={() => { }}
								setIsHighlightInteraction={() => { }}
								isHighlightInteraction={false}
								setHighlights={() => { }}
								selectedText={''}
								tooltipPosition={null}
								setActiveHighlight={() => { }}
								addHighlight={async () => { throw new Error("Read-only"); }}
								loadHighlights={async () => { }}
								removeHighlight={() => { }}
								handleTextSelection={() => { }}
								renderAnnotations={() => { }}
								annotations={[]}
								setAddedContentForPaperNote={() => { }}
							/>
						)}
					</div>
				</div>
			)}
		</div>
	);
};
