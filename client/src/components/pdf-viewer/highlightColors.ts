import type { HighlightColor } from "@/lib/schema";

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
	return isActive ? "rgba(168, 85, 247, 0.3)" : "rgba(168, 85, 247, 0.15)";
}
