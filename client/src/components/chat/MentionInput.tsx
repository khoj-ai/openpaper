"use client";

import { RefObject, useRef } from "react";
import { AtSign, Loader, Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PaperItem, Project } from "@/lib/schema";
import {
	useMentionAutocomplete,
	MentionDropdown,
	MentionContextBar,
	MentionSelection,
	EMPTY_MENTION_SELECTION,
} from "@/components/chat/MentionAutocomplete";

interface MentionInputProps {
	value: string;
	onValueChange: (value: string) => void;
	onSubmit: () => void;
	papers: PaperItem[];
	projects?: Project[];
	// Papers-only mode (project chat): no projects/highlights in the menu.
	papersOnly?: boolean;
	selection?: MentionSelection;
	// Providing this enables @-mentions; omit it for a plain input.
	onSelectionChange?: (selection: MentionSelection) => void;
	placeholder?: string;
	disabled?: boolean;
	// Extra condition to disable just the send button (e.g. empty input).
	sendDisabled?: boolean;
	busy?: boolean;
	autoFocus?: boolean;
	// Optional external ref (e.g. for focus effects); an internal one is used otherwise.
	textareaRef?: RefObject<HTMLTextAreaElement | null>;
	minHeightClass?: string;
}

/**
 * The shared chat input box: a unified field with attached-context pills, the
 * "@" mention menu, and an @/send toolbar. Used by both the conversation view
 * and the project page's "start a conversation" input.
 */
export function MentionInput({
	value,
	onValueChange,
	onSubmit,
	papers,
	projects = [],
	papersOnly = false,
	selection = EMPTY_MENTION_SELECTION,
	onSelectionChange,
	placeholder,
	disabled = false,
	sendDisabled = false,
	busy = false,
	autoFocus = false,
	textareaRef,
	minHeightClass = "min-h-20",
}: MentionInputProps) {
	const internalRef = useRef<HTMLTextAreaElement>(null);
	const taRef = textareaRef ?? internalRef;

	const mentionsEnabled = !!onSelectionChange;
	const mention = useMentionAutocomplete({
		papers,
		projects: papersOnly ? [] : projects,
		value,
		onValueChange,
		selection,
		onSelectionChange: onSelectionChange ?? (() => { }),
		textareaRef: taRef,
		enableHighlights: !papersOnly,
	});
	const hasSelectedMentions =
		mentionsEnabled && mention.selectedEntities.length > 0;

	return (
		<div className="relative w-full rounded-md bg-secondary dark:bg-accent focus-within:ring-1 focus-within:ring-blue-400/30 transition-all duration-300 ease-in-out">
			{mentionsEnabled && (
				<MentionDropdown
					open={mention.isOpen}
					items={mention.items}
					activeIndex={mention.activeIndex}
					onSelect={mention.selectEntity}
					onHover={mention.setActiveIndex}
				/>
			)}
			{/* Attached context lives inside the input box, since it's part of the
			    prompt we send. Collapses past 3 to bound the height. */}
			{mentionsEnabled && hasSelectedMentions && (
				<div className="px-3 pt-2.5">
					<MentionContextBar
						entities={mention.selectedEntities}
						onRemove={mention.removeMention}
					/>
				</div>
			)}
			<Textarea
				value={value}
				onChange={
					mentionsEnabled
						? mention.handleTextChange
						: (e) => onValueChange(e.target.value)
				}
				ref={taRef}
				autoFocus={autoFocus}
				placeholder={placeholder}
				className={`${minHeightClass} resize-none w-full border-none dark:border-none bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 text-primary`}
				disabled={disabled}
				onKeyDown={(e) => {
					if (mentionsEnabled && mention.handleKeyDown(e)) {
						return;
					}
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						onSubmit();
					}
				}}
			/>
			{/* Bottom toolbar: context actions on the left, send on the right. */}
			<div className="flex items-center justify-between px-2 pb-2">
				<div className="flex items-center gap-1">
					{mentionsEnabled && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => mention.openMentionMenu()}
							title="Add context (@)"
							aria-label="Add context"
							className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
							disabled={disabled}
						>
							<AtSign className="w-4 h-4" />
						</Button>
					)}
				</div>
				<Button
					type="button"
					size="sm"
					onClick={onSubmit}
					className="h-8 w-8 p-0 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
					disabled={disabled || sendDisabled}
				>
					{busy ? (
						<Loader className="w-4 h-4 animate-spin" />
					) : (
						<Send className="w-4 h-4" />
					)}
				</Button>
			</div>
		</div>
	);
}
