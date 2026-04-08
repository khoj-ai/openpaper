"use client";

import { HighlightColor } from "@/lib/schema";
import { useEffect, useState } from "react";
import type { ViewportHighlight } from "react-pdf-highlighter-extended";
import {
	AreaHighlight,
	TextHighlight,
	useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import { activeHighlightStore } from "./activeHighlightStore";
import { ExtendedHighlight } from "./types";

// Map highlight color names to rgba values: [inactive, active]
// Inactive uses low opacity; active uses the original "normal" color
const HIGHLIGHT_COLOR_MAP: Record<HighlightColor, [string, string]> = {
	yellow: ["rgba(255, 235, 59, 0.1)",  "rgba(255, 235, 59, 0.4)"],
	green:  ["rgba(76, 175, 80, 0.1)",   "rgba(76, 175, 80, 0.4)"],
	blue:   ["rgba(66, 165, 245, 0.1)",  "rgba(66, 165, 245, 0.4)"],
	pink:   ["rgba(236, 64, 122, 0.1)",  "rgba(236, 64, 122, 0.4)"],
	purple: ["rgba(171, 71, 188, 0.1)",  "rgba(171, 71, 188, 0.4)"],
};

interface HighlightContainerProps {
	onHighlightClick: (highlight: ViewportHighlight<ExtendedHighlight>, event: MouseEvent) => void;
}

export function HighlightContainer({ onHighlightClick }: HighlightContainerProps) {
	const { highlight, isScrolledTo } =
		useHighlightContainerContext<ExtendedHighlight>();

	// Subscribe to the module-level store so this component re-renders when
	// activeHighlight changes — even though it lives in a separate React root.
	const [activeHighlightId, setActiveHighlightId] = useState(activeHighlightStore.get());
	useEffect(() => activeHighlightStore.subscribe(setActiveHighlightId), []);

	const isTextHighlight = highlight.type === "text";
	const isActive = highlight.id === activeHighlightId;

	const handleClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		onHighlightClick(highlight, event.nativeEvent);
	};

	// Inactive highlights are dimmed; active highlight uses the original normal color
	const highlightColor =
		highlight.role === "assistant"
			? isActive ? "rgba(168, 85, 247, 0.3)" : "rgba(168, 85, 247, 0.15)"
			: HIGHLIGHT_COLOR_MAP[highlight.color || "blue"][isActive ? 1 : 0];

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
