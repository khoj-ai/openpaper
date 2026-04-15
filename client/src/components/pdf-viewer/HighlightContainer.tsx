"use client";

import { useEffect, useState } from "react";
import type { ViewportHighlight } from "react-pdf-highlighter-extended";
import {
	AreaHighlight,
	TextHighlight,
	useHighlightContainerContext,
} from "react-pdf-highlighter-extended";
import { activeHighlightStore } from "./activeHighlightStore";
import {
	getAssistantHighlightBackgroundRgba,
	getUserHighlightBackgroundRgba,
} from "./highlightColors";
import { ExtendedHighlight } from "./types";

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

	// Solid hex fills from highlightColors.ts (inactive vs active).
	const highlightColor =
		highlight.role === "assistant"
			? getAssistantHighlightBackgroundRgba(isActive)
			: getUserHighlightBackgroundRgba(highlight.color, isActive);

	if (isTextHighlight) {
		return (
			<div
				data-pdf-text-highlight=""
				onClick={handleClick}
				style={{ cursor: "pointer" }}
			>
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
		<div
			data-pdf-text-highlight=""
			onClick={handleClick}
			style={{ cursor: "pointer" }}
		>
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
