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
