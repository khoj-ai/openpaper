"use client";

import { cn } from "@/lib/utils";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const defaultParagraphClass =
	"text-sm text-foreground whitespace-pre-wrap break-words";

export function CollapsibleNoteText({
	content,
	isActive = true,
	paragraphClassName,
	onExpandToggle,
}: {
	content: string;
	/** When false, collapses expanded text (e.g. inactive inline card or sidebar row). */
	isActive?: boolean;
	paragraphClassName?: string;
	/** Optional hook when user toggles show more/less (e.g. focus parent highlight). */
	onExpandToggle?: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [collapsedOverflow, setCollapsedOverflow] = useState(false);
	const pRef = useRef<HTMLParagraphElement>(null);

	useEffect(() => {
		if (isActive === false) setExpanded(false);
	}, [isActive]);

	useLayoutEffect(() => {
		const el = pRef.current;
		if (!el || expanded) return;

		const measure = () => {
			setCollapsedOverflow(el.scrollHeight > el.clientHeight);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [content, expanded]);

	const showToggle = expanded || collapsedOverflow;
	const pClass = paragraphClassName ?? defaultParagraphClass;

	return (
		<div className="min-w-0 w-full">
			<p
				ref={pRef}
				className={cn(pClass, !expanded && "line-clamp-4")}
			>
				{content}
			</p>
			{showToggle && (
				<button
					type="button"
					className="text-xs text-blue-600 hover:underline dark:text-blue-400 mt-1"
					onClick={(e) => {
						e.stopPropagation();
						onExpandToggle?.();
						setExpanded((v) => !v);
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}
