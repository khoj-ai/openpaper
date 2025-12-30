import type { Highlight, Content } from "react-pdf-highlighter-extended";
import { PaperHighlight, ScaledPosition, HighlightColor } from "@/lib/schema";

// Extended highlight type that includes our custom properties
export interface ExtendedHighlight extends Highlight {
	content: Content;
	comment?: string;
	role?: "user" | "assistant";
	raw_text?: string;
	color?: HighlightColor;
}

// Convert PaperHighlight to ExtendedHighlight
export function paperHighlightToExtended(
	highlight: PaperHighlight
): ExtendedHighlight | null {
	if (!highlight.position) return null;

	return {
		id: highlight.id || crypto.randomUUID(),
		type: "text",
		position: highlight.position,
		content: { text: highlight.raw_text },
		role: highlight.role,
		raw_text: highlight.raw_text,
		color: highlight.color,
	};
}

// Convert ExtendedHighlight to PaperHighlight
export function extendedToPaperHighlight(
	highlight: ExtendedHighlight
): PaperHighlight {
	return {
		id: highlight.id,
		raw_text: highlight.content.text || highlight.raw_text || "",
		role: highlight.role || "user",
		page_number: highlight.position.boundingRect.pageNumber,
		position: highlight.position as ScaledPosition,
		color: highlight.color,
	};
}
