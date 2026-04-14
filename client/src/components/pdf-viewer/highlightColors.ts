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

/** [inactive, active] rgba — inactive is lower opacity than active */
export const USER_HIGHLIGHT_RGBA: Record<HighlightColor, [string, string]> = {
	yellow: ["rgba(255, 235, 59, 0.1)", "rgba(255, 235, 59, 0.4)"],
	green: ["rgba(76, 175, 80, 0.1)", "rgba(76, 175, 80, 0.4)"],
	blue: ["rgba(66, 165, 245, 0.1)", "rgba(66, 165, 245, 0.4)"],
	pink: ["rgba(236, 64, 122, 0.1)", "rgba(236, 64, 122, 0.4)"],
	purple: ["rgba(171, 71, 188, 0.1)", "rgba(171, 71, 188, 0.4)"],
};

export function getUserHighlightBackgroundRgba(
	color: HighlightColor | undefined,
	isActive: boolean
): string {
	return USER_HIGHLIGHT_RGBA[color || "blue"][isActive ? 1 : 0];
}

export function getAssistantHighlightBackgroundRgba(isActive: boolean): string {
	// Inactive opacity matches user highlights (0.1) so all non-selected highlights look consistent.
	return isActive ? "rgba(168, 85, 247, 0.3)" : "rgba(168, 85, 247, 0.1)";
}
