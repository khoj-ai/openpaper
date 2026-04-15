import type { HighlightColor } from "@/lib/schema";

/** Tailwind classes for highlight color picker swatches (PDF toolbar / floating sidebar). */
export const HIGHLIGHT_COLOR_SWATCHES: {
	color: HighlightColor;
	bg: string;
	label: string;
}[] = [
	{ color: "yellow", bg: "bg-yellow-300", label: "Yellow" },
	{ color: "green", bg: "bg-green-400", label: "Green" },
	{ color: "blue", bg: "bg-blue-400", label: "Blue" },
	{ color: "pink", bg: "bg-pink-400", label: "Pink" },
	{ color: "purple", bg: "bg-purple-400", label: "Purple" },
];

/**
 * Soft solid fills for PDF text (opaque hex). Using translucent RGBA on saturated base
 * colors still looks loud on white, and overlapping line rects stack alpha and create dark bands.
 * [inactive, active] — inactive stays a light wash; active uses a clearly darker/saturated hex
 * so the focused highlight is easy to spot (not “two pastels”).
 */
export const USER_HIGHLIGHT_FILL: Record<HighlightColor, [string, string]> = {
	yellow: ["#FFFBEB", "#FDE68A"],
	green: ["#F0FDF4", "#86EFAC"],
	blue: ["#EFF6FF", "#93C5FD"],
	pink: ["#FDF2F8", "#F9A8D4"],
	purple: ["#FAF5FF", "#C4B5FD"],
};

/** @deprecated Use USER_HIGHLIGHT_FILL — kept for re-exports */
export const USER_HIGHLIGHT_RGBA = USER_HIGHLIGHT_FILL;

const ASSISTANT_HIGHLIGHT_FILL = ["#F5F3FF", "#A78BFA"] as const;

export function getUserHighlightBackgroundRgba(
	color: HighlightColor | undefined,
	isActive: boolean
): string {
	return USER_HIGHLIGHT_FILL[color || "blue"][isActive ? 1 : 0];
}

export function getAssistantHighlightBackgroundRgba(isActive: boolean): string {
	return ASSISTANT_HIGHLIGHT_FILL[isActive ? 1 : 0];
}

/** Ephemeral text selection while dragging (matches blue idle fill). */
export const PDF_TEXT_SELECTION_FILL = "#EFF6FF";
