"use client";

import { useState } from "react";
import removeMd from "remove-markdown";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Check, Copy } from "lucide-react";

import { PaperItem, Reference } from "@/lib/schema";
import { CITATION_MARKER, citationKeys } from "./utils/CustomCitationLink";

interface ChatMessageActionsProps {
	message: string;
	references?: Reference;
	// Title sources for "Copy with references": `papers` is matched on a
	// citation's paper_id, `paperTitle` names the paper of a single-paper view.
	papers?: PaperItem[];
	paperTitle?: string;
}

export function ChatMessageActions({ message, references, papers, paperTitle }: ChatMessageActionsProps) {
	const [hasCopied, setHasCopied] = useState(false);

	const onCopy = (text: string) => {
		navigator.clipboard.writeText(text).then(() => {
			setHasCopied(true);
			setTimeout(() => {
				setHasCopied(false);
			}, 2000);
		});
	};

	const copyAsPlainText = () => {
		onCopy(removeMd(message));
	};

	const copyAsMarkdown = () => {
		onCopy('```markdown\n' + message + '\n```');
	};

	// The answer and its references as Markdown footnotes.
	const copyWithReferences = () => {
		// Markdown has no grouped footnote marker, so [^6, ^7] becomes [^6][^7].
		let textToCopy = message.replace(new RegExp(CITATION_MARKER, "g"), (_, keys: string) =>
			citationKeys(keys).map(key => `[^${key}]`).join(""));
		if (references && references.citations && references.citations.length > 0) {
			const footnotes = references.citations
				.map(citation => {
					const title = papers?.find(paper => paper.id === citation.paper_id)?.title ?? paperTitle;
					// Kept to one line, as a blank line would end the footnote. Chat passages arrive quoted.
					const passage = citation.reference.replace(/\s+/g, " ").trim().replace(/^"(.*)"$/, "$1");
					return `[^${citation.key}]: ${title ? `${title}: ` : ""}"${passage}"`;
				})
				.join("\n");
			textToCopy += `\n\n${footnotes}`;
		}
		onCopy(textToCopy);
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 text-muted-foreground hover:text-foreground"
					title="Copy"
				>
					{hasCopied ? (
						<Check className="h-3 w-3 text-green-500" />
					) : (
						<Copy className="h-3 w-3" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={copyAsPlainText}>
					Copy as text
				</DropdownMenuItem>
				<DropdownMenuItem onClick={copyAsMarkdown}>
					Copy as markdown
				</DropdownMenuItem>
				<DropdownMenuItem onClick={copyWithReferences} disabled={!references || !references.citations || references.citations.length === 0}>
					Copy with references
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
