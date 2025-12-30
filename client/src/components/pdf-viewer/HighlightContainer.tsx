"use client";

import {
	TextHighlight,
	AreaHighlight,
	useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import type { ViewportHighlight } from "react-pdf-highlighter-extended";
import { ExtendedHighlight } from "./types";
import { HighlightColor } from "@/lib/schema";

// Map highlight color names to rgba values
const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, string> = {
	yellow: "rgba(255, 235, 59, 0.4)",
	green: "rgba(76, 175, 80, 0.4)",
	blue: "rgba(66, 165, 245, 0.4)",
	pink: "rgba(236, 64, 122, 0.4)",
	purple: "rgba(171, 71, 188, 0.4)",
};

interface HighlightContainerProps {
	onHighlightClick: (highlight: ViewportHighlight<ExtendedHighlight>, event: MouseEvent) => void;
}

export function HighlightContainer({ onHighlightClick }: HighlightContainerProps) {
	const { highlight, isScrolledTo } =
		useHighlightContainerContext<ExtendedHighlight>();

	const isTextHighlight = highlight.type === "text";

	const handleClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		onHighlightClick(highlight, event.nativeEvent);
	};

	// Determine highlight color: assistant highlights use purple, user highlights use their selected color
	const highlightColor =
		highlight.role === "assistant"
			? "rgba(168, 85, 247, 0.3)" // purple for AI highlights
			: HIGHLIGHT_COLOR_MAP[highlight.color || "blue"]; // user's selected color, default to blue

	if (isTextHighlight) {
		return (
			<div onClick={handleClick} style={{ cursor: "pointer" }}>
				<TextHighlight
					isScrolledTo={isScrolledTo}
					highlight={highlight}
					style={{
						background: highlightColor,
					}}
				/>
			</div>
		);
	}

	return (
		<div onClick={handleClick} style={{ cursor: "pointer" }}>
			<AreaHighlight
				isScrolledTo={isScrolledTo}
				highlight={highlight}
				style={{
					background: highlightColor,
					border: isScrolledTo ? "2px solid #3b82f6" : "none",
				}}
			/>
		</div>
	);
}
