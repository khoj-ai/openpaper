import { ZoteroImportStatusItem, ZoteroLibraryItem } from "./types";

export function formatZoteroLastSynced(dateString: string): string {
	const d = new Date(dateString);
	const time = d.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit" });
	const date = d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	return `${time}, ${date}`;
}

export function computeImportProgress(
	items: ZoteroImportStatusItem[],
	importingKeys: Set<string>,
	total: number,
): { done: number; progress: number } {
	if (total <= 0) return { done: 0, progress: 0 };
	const done = items.filter(
		(i) =>
			importingKeys.has(i.zotero_item_key) &&
			(i.status === "completed" || i.status === "failed"),
	).length;
	return { done, progress: Math.min(100, Math.round((done / total) * 100)) };
}

export function defaultZoteroSelection(
	items: ZoteroLibraryItem[],
	remainingSlots: number,
	selectAllByDefault: boolean,
): Set<string> {
	if (!selectAllByDefault || remainingSlots <= 0) return new Set();
	const keys = items
		.filter((i) => !i.already_imported && i.has_pdf_attachment && i.has_metadata)
		.slice(0, remainingSlots)
		.map((i) => i.zotero_item_key);
	return new Set(keys);
}

export type ImportFailureGroup = {
	message: string;
	/** Titles we could resolve; may be shorter than `count`. */
	titles: string[];
	count: number;
};

/**
 * Group import failures by their message.
 *
 * A single account-level cause (Zotero File Storage not holding the files, say)
 * fails every selected paper with the same explanation, so listing them per item
 * repeats one sentence N times. Grouping states the cause once and names the
 * papers it applies to.
 *
 * A failure that happens before the paper row exists has no title to look up, so
 * `count` is tracked separately and callers can fall back to it rather than
 * printing an opaque Zotero item key.
 */
export function groupImportFailures(
	failures: { zotero_item_key: string; message: string }[],
	titleFor: (key: string) => string | undefined,
): ImportFailureGroup[] {
	const groups = new Map<string, ImportFailureGroup>();
	for (const failure of failures) {
		const group = groups.get(failure.message) ?? {
			message: failure.message,
			titles: [],
			count: 0,
		};
		const title = titleFor(failure.zotero_item_key);
		if (title) group.titles.push(title);
		group.count += 1;
		groups.set(failure.message, group);
	}
	return Array.from(groups.values());
}

/**
 * Name the papers in a failure group: their titles when we have them, and a
 * plain count when the failure predates the paper row.
 */
export function describeFailureGroup(group: ImportFailureGroup): string {
	if (group.titles.length === group.count) return group.titles.join(", ");
	if (group.titles.length > 0) {
		return `${group.titles.join(", ")} and ${group.count - group.titles.length} more`;
	}
	return `${group.count} paper${group.count === 1 ? "" : "s"}`;
}
