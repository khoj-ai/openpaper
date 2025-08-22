"use client";

import { FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { AnimatedMarkdown } from "@/components/AnimatedMarkdown";
import { Button } from "@/components/ui/button";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { Loader, ArrowUp, Recycle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import CustomCitationLink from "@/components/utils/CustomCitationLink";
import { ChatMessageActions } from "@/components/ChatMessageActions";
import { ChatMessage, Reference, PaperItem } from "@/lib/schema";
import ReferencePaperCards from "@/components/ReferencePaperCards";
import Link from "next/link";
import { TopicBubbles } from "@/components/TopicBubbles";
import { AnimatedGradientText } from "@/components/magicui/animated-gradient-text";
import { ChatHistorySkeleton } from "@/components/ChatHistorySkeleton";

interface ConversationViewProps {
	messages: ChatMessage[];
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
	handleCitationClick,
	highlightedInfo,
	setHighlightedInfo,
	authLoading,
}: ConversationViewProps) => {
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputMessageRef = useRef<HTMLTextAreaElement>(null);
	const chatInputFormRef = useRef<HTMLFormElement>(null);

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

	const memoizedMessages = useMemo(() => {
		return messages.map((msg, index) => (
			<div
				key={`${msg.id || `msg-${index}`}-${index}-${msg.role}-${msg.content.slice(0, 20).replace(/\s+/g, '')}`} // Use a stable and unique key
				className="flex flex-row gap-2 items-end"
			>
				<div
					data-message-index={index}
					className={`relative group prose dark:prose-invert !max-w-full ${msg.role === "user"
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
	}, [messages, handleCitationClick, papers, highlightedInfo, setHighlightedInfo]);

	return (
		<div className="flex flex-col w-full h-[calc(100vh-64px)]">
			<div
				className={`${isCentered ? "flex-0" : "flex-1"} w-full overflow-y-auto`}
				ref={messagesContainerRef}
			>
				<div className="mx-auto max-w-3xl space-y-4 p-4 w-full">
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
						<div className="relative group prose dark:prose-invert !max-w-full rounded-lg w-full text-primary dark:text-primary-foreground">
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
							<div className="text-sm text-secondary-foreground">
								{displayedText}
								{isTyping && <span className="animate-pulse">|</span>}
								{statusMessage && (
									<div className="text-xs text-gray-500">{statusMessage}</div>
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
				className={`p-4 transition-all duration-500 ${isCentered
					? "flex-1 flex flex-col justify-center items-center my-au"
					: ""
					}`}
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
				<form onSubmit={handleNewSubmit} className="w-full" ref={chatInputFormRef}>
					<div className="relative w-full md:max-w-3xl mx-auto">
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
							disabled={isStreaming || papers.length === 0 || chatCreditLimitReached}
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
							disabled={isStreaming || papers.length === 0 || chatCreditLimitReached}
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
	);
};
