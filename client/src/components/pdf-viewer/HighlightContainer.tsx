"use client";

import {
	TextHighlight,
	AreaHighlight,
	useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import type { ViewportHighlight } from "react-pdf-highlighter-extended";
import { ExtendedHighlight } from "./types";

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

	const highlightColor =
		highlight.role === "assistant"
			? "rgba(168, 85, 247, 0.3)" // purple for AI highlights
			: "rgba(59, 130, 246, 0.3)"; // blue for user highlights

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
