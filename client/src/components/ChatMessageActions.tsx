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
import { Check, Copy, ChevronDown } from "lucide-react";

import { Reference } from "@/lib/schema";

interface ChatMessageActionsProps {
	message: string;
	references?: Reference;
}

export function ChatMessageActions({ message, references }: ChatMessageActionsProps) {
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

	const copyWithReferences = () => {
		let textToCopy = message;
		if (references && references.citations && references.citations.length > 0) {
			const referenceText = references.citations
				.map(citation => `[${citation.key}] ${citation.reference}`)
				.join("\n");
			textToCopy += `\n\nReferences:\n${referenceText}`;
		}
		onCopy(textToCopy);
	};

	return (
		<div className="">
			<div className="flex items-center space-x-1 p-1 rounded-lg">
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6"
					onClick={copyAsPlainText}
					title="Copy"
				>
					{hasCopied ? (
						<Check className="h-3 w-3 text-green-500" />
					) : (
						<Copy className="h-3 w-3" />
					)}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-6 w-6">
							<ChevronDown className="h-3 w-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem onClick={copyAsMarkdown}>
							As Markdown
						</DropdownMenuItem>
						<DropdownMenuItem onClick={copyWithReferences} disabled={!references || !references.citations || references.citations.length === 0}>
							With References
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
