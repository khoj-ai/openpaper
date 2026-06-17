export type ZoteroStatus = {
	connected: boolean;
	connected_at?: string;
	last_synced_at?: string;
};

export type ZoteroImportStatusItem = {
	zotero_item_key: string;
	paper_id?: string;
	status: string;
	import_source: string;
	title?: string;
	created_at?: string;
};

export type ZoteroImportResponse = {
	imported_count: number;
	imported_via_url: number;
	skipped_already_imported: number;
	errors: { zotero_item_key: string; error: string }[];
};

export type ZoteroLibraryItem = {
	zotero_item_key: string;
	title: string;
	authors: string[];
	date?: string;
	item_type: "journalArticle" | "conferencePaper" | "preprint";
	venue?: string;
	date_added?: string;
	tags: string[];
	collections: string[];
	already_imported: boolean;
	has_pdf_attachment: boolean;
	has_metadata: boolean;
};

export type ZoteroLibraryResponse = {
	items: ZoteroLibraryItem[];
	remaining_slots: number;
};

export type SortBy =
	| "dateModified"
	| "datePublished"
	| "dateAdded"
	| "title"
	| "author";
