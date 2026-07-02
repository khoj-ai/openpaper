"use client";

import {
	RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import Link from "next/link";
import {
	AtSign,
	ChevronDown,
	FileText,
	FolderOpen,
	Highlighter,
	MessageSquareText,
	X,
} from "lucide-react";
import {
	HighlightResult,
	MessageScopeItem,
	PaperItem,
	Project,
	SearchResults,
} from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

// Highlight search needs at least this many chars (the /search/local minimum).
const HIGHLIGHT_SEARCH_MIN_CHARS = 2;
const HIGHLIGHT_SEARCH_DEBOUNCE_MS = 250;

// Max suggestions shown per section in the @-mention dropdown.
const MAX_PER_SECTION = 5;

// Beyond this many context pills we collapse into a single summary badge so the
// input never grows past one row of context.
const PILL_COLLAPSE_THRESHOLD = 3;

export type MentionKind = "paper" | "project" | "highlight";

export interface MentionEntity {
	kind: MentionKind;
	id: string;
	label: string;
	sublabel?: string;
	// For highlight mentions: the parent paper (for scoping + linking).
	paperId?: string;
	// For highlight mentions: the annotations written on the highlight.
	annotations?: string[];
	// Why this suggestion matched, when it's not obvious from the label — e.g. a
	// highlight surfaced because one of its annotations matched the query.
	matchContext?: string;
}

export interface MentionSelection {
	paperIds: string[];
	projectIds: string[];
	// Highlights aren't a client-side list, so we keep the resolved entities
	// (label + parent paper) rather than just ids.
	highlights: MentionEntity[];
}

export const EMPTY_MENTION_SELECTION: MentionSelection = {
	paperIds: [],
	projectIds: [],
	highlights: [],
};

export function mentionSelectionIsEmpty(selection: MentionSelection): boolean {
	return (
		selection.paperIds.length === 0 &&
		selection.projectIds.length === 0 &&
		selection.highlights.length === 0
	);
}

export function entityIcon(kind: MentionKind) {
	if (kind === "project") return FolderOpen;
	if (kind === "highlight") return Highlighter;
	return FileText;
}

/**
 * Build the denormalized scope snapshot ([{kind, id, title}]) from a live
 * selection, mirroring what the backend persists — used to show context on the
 * just-sent message immediately, before the server round-trip.
 */
export function selectionToScopeItems(
	selection: MentionSelection,
	papers: PaperItem[],
	projects: Project[],
): MessageScopeItem[] {
	const paperById = new Map(papers.map((p) => [p.id, p]));
	const projectById = new Map(projects.map((p) => [p.id, p]));
	return [
		...selection.paperIds.map((id) => ({
			kind: "paper" as const,
			id,
			title: paperById.get(id)?.title || "Untitled paper",
		})),
		...selection.projectIds.map((id) => ({
			kind: "project" as const,
			id,
			title: projectById.get(id)?.title || "Untitled project",
		})),
		...selection.highlights.map((h) => ({
			kind: "highlight" as const,
			id: h.id,
			title: h.label,
			paper_id: h.paperId,
			paper_title: h.sublabel,
			annotations: h.annotations,
		})),
	];
}

/** Map a persisted scope snapshot to displayable mention entities. */
export function scopeItemsToEntities(
	scope: MessageScopeItem[],
): MentionEntity[] {
	return scope.map((item) => ({
		kind: item.kind,
		id: item.id,
		label: item.title,
		paperId: item.paper_id,
		// Surfaced in the hover card (e.g. a highlight's source paper title).
		sublabel: item.paper_title,
		annotations: item.annotations,
	}));
}

// Mention queries may contain spaces (papers/projects/highlights have
// multi-word names), so whitespace no longer ends the token. A newline ends it,
// and this cap stops an abandoned "@" + sentence from tracking forever / firing
// the highlight search. The menu still hides itself once nothing matches.
const MAX_MENTION_QUERY_LEN = 64;

/**
 * Find an in-progress "@mention" token ending at the caret. A token starts at
 * an "@" that is at the start of the text or preceded by whitespace, and runs
 * up to the caret (spaces included). Returns null when the caret is not inside
 * such a token (so an email like "a@b" never triggers it), when a newline
 * intervenes, or when the query runs longer than MAX_MENTION_QUERY_LEN.
 */
function findMentionToken(
	value: string,
	caret: number,
): { start: number; query: string } | null {
	for (let i = caret - 1; i >= 0; i--) {
		const ch = value[i];
		if (ch === "\n") return null;
		if (ch === "@") {
			const before = i === 0 ? " " : value[i - 1];
			if (!/\s/.test(before)) return null;
			const query = value.slice(i + 1, caret);
			return query.length > MAX_MENTION_QUERY_LEN ? null : { start: i, query };
		}
	}
	return null;
}

function paperToEntity(paper: PaperItem): MentionEntity {
	return {
		kind: "paper",
		id: paper.id,
		label: paper.title || "Untitled paper",
		sublabel: paper.authors?.length ? paper.authors.join(", ") : undefined,
	};
}

function projectToEntity(project: Project): MentionEntity {
	const count = project.num_papers ?? 0;
	return {
		kind: "project",
		id: project.id,
		label: project.title || "Untitled project",
		sublabel: `${count} paper${count === 1 ? "" : "s"}`,
	};
}

interface UseMentionAutocompleteArgs {
	papers: PaperItem[];
	projects: Project[];
	value: string;
	onValueChange: (value: string) => void;
	selection: MentionSelection;
	onSelectionChange: (selection: MentionSelection) => void;
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	// Project chat scopes mentions to papers only, so highlight search is off.
	enableHighlights?: boolean;
}

export function useMentionAutocomplete({
	papers,
	projects,
	value,
	onValueChange,
	selection,
	onSelectionChange,
	textareaRef,
	enableHighlights = true,
}: UseMentionAutocompleteArgs) {
	const [token, setToken] = useState<{ start: number; query: string } | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const query = token?.query ?? "";

	const selectedPaperIds = useMemo(
		() => new Set(selection.paperIds),
		[selection.paperIds],
	);
	const selectedProjectIds = useMemo(
		() => new Set(selection.projectIds),
		[selection.projectIds],
	);
	const selectedHighlightIds = useMemo(
		() => new Set(selection.highlights.map((h) => h.id)),
		[selection.highlights],
	);

	// Highlights aren't a client-side list, so we search /search/local for them
	// (debounced + abortable), flattening each paper's matching highlights.
	const [highlightItems, setHighlightItems] = useState<MentionEntity[]>([]);
	useEffect(() => {
		const q = query.trim();
		if (!enableHighlights || q.length < HIGHLIGHT_SEARCH_MIN_CHARS) {
			setHighlightItems([]);
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const res: SearchResults = await fetchFromApi(
					`/api/search/local?q=${encodeURIComponent(q)}&limit=5`,
					{ signal: controller.signal },
				);
				if (controller.signal.aborted) return;
				// A highlight can match on its own text or on one of its
				// annotations; surface it either way, deduped by highlight id.
				const flattened: MentionEntity[] = [];
				const seen = new Set<string>();
				for (const paper of res?.papers || []) {
					// Group the paper's matching annotations by their highlight so
					// each surfaced highlight can carry its notes.
					const notesByHighlight = new Map<string, string[]>();
					for (const a of paper.annotations || []) {
						if (!a.highlight || !a.content) continue;
						const arr = notesByHighlight.get(a.highlight.id) || [];
						arr.push(a.content);
						notesByHighlight.set(a.highlight.id, arr);
					}
					const pushHighlight = (h: HighlightResult, matchContext?: string) => {
						if (!h || seen.has(h.id)) return;
						seen.add(h.id);
						flattened.push({
							kind: "highlight",
							id: h.id,
							label: h.raw_text,
							sublabel: paper.title || undefined,
							paperId: paper.id,
							annotations: notesByHighlight.get(h.id),
							matchContext,
						});
					};
					// Highlights whose own text matched have no extra context; a
					// highlight surfaced via an annotation shows that annotation.
					for (const h of paper.highlights || []) pushHighlight(h);
					for (const a of paper.annotations || []) {
						pushHighlight(a.highlight, a.content);
					}
				}
				setHighlightItems(flattened.slice(0, MAX_PER_SECTION));
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") return;
				setHighlightItems([]);
			}
		}, HIGHLIGHT_SEARCH_DEBOUNCE_MS);
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [query, enableHighlights]);

	// Flat, ordered suggestion list (papers, then projects, then highlights),
	// filtered by the current query and excluding already-selected entities.
	const items = useMemo<MentionEntity[]>(() => {
		if (!token) return [];
		const q = token.query.trim().toLowerCase();
		const matches = (text: string) => !q || text.toLowerCase().includes(q);

		const paperItems = papers
			.filter((p) => !selectedPaperIds.has(p.id) && matches(p.title || ""))
			.slice(0, MAX_PER_SECTION)
			.map(paperToEntity);

		const projectItems = projects
			.filter((p) => !selectedProjectIds.has(p.id) && matches(p.title || ""))
			.slice(0, MAX_PER_SECTION)
			.map(projectToEntity);

		const highlightSuggestions = highlightItems.filter(
			(h) => !selectedHighlightIds.has(h.id),
		);

		return [...paperItems, ...projectItems, ...highlightSuggestions];
	}, [
		token,
		papers,
		projects,
		highlightItems,
		selectedPaperIds,
		selectedProjectIds,
		selectedHighlightIds,
	]);

	const isOpen = token !== null && items.length > 0;

	// Keep the active highlight in range as the suggestion list changes.
	useEffect(() => {
		setActiveIndex(0);
	}, [token?.query, items.length]);

	const close = useCallback(() => setToken(null), []);

	const syncToken = useCallback((nextValue: string, caret: number) => {
		setToken(findMentionToken(nextValue, caret));
	}, []);

	const handleTextChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			const nextValue = e.target.value;
			onValueChange(nextValue);
			syncToken(nextValue, e.target.selectionStart ?? nextValue.length);
		},
		[onValueChange, syncToken],
	);

	// Programmatically open the menu (e.g. from a toolbar button): insert an "@"
	// at the caret and seed an empty-query token so it behaves like a typed "@".
	const openMentionMenu = useCallback(() => {
		const el = textareaRef.current;
		const caret = el?.selectionStart ?? value.length;
		const before = value.slice(0, caret);
		// findMentionToken requires the "@" to start the text or follow whitespace.
		const prefix = before.length === 0 || /\s$/.test(before) ? "@" : " @";
		const atIndex = before.length + prefix.length - 1;
		onValueChange(before + prefix + value.slice(caret));
		setToken({ start: atIndex, query: "" });
		requestAnimationFrame(() => {
			const node = textareaRef.current;
			if (node) {
				node.focus();
				node.setSelectionRange(atIndex + 1, atIndex + 1);
			}
		});
	}, [value, onValueChange, textareaRef]);

	const selectEntity = useCallback(
		(entity: MentionEntity) => {
			if (token) {
				// Strip the "@query" fragment that triggered the dropdown.
				const removeEnd = token.start + 1 + token.query.length;
				const nextValue = value.slice(0, token.start) + value.slice(removeEnd);
				onValueChange(nextValue);
				// Restore the caret to where the mention used to be.
				requestAnimationFrame(() => {
					const el = textareaRef.current;
					if (el) {
						el.focus();
						el.setSelectionRange(token.start, token.start);
					}
				});
			}

			if (entity.kind === "paper" && !selectedPaperIds.has(entity.id)) {
				onSelectionChange({
					...selection,
					paperIds: [...selection.paperIds, entity.id],
				});
			} else if (entity.kind === "project" && !selectedProjectIds.has(entity.id)) {
				onSelectionChange({
					...selection,
					projectIds: [...selection.projectIds, entity.id],
				});
			} else if (entity.kind === "highlight" && !selectedHighlightIds.has(entity.id)) {
				onSelectionChange({
					...selection,
					highlights: [...selection.highlights, entity],
				});
			}

			close();
		},
		[
			token,
			value,
			onValueChange,
			selection,
			onSelectionChange,
			selectedPaperIds,
			selectedProjectIds,
			selectedHighlightIds,
			textareaRef,
			close,
		],
	);

	// Intercept keys while the dropdown is open. Returns true when the event was
	// consumed, so the caller skips its own handling (e.g. Enter-to-submit).
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			if (!isOpen) return false;
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setActiveIndex((i) => (i + 1) % items.length);
					return true;
				case "ArrowUp":
					e.preventDefault();
					setActiveIndex((i) => (i - 1 + items.length) % items.length);
					return true;
				case "Enter":
				case "Tab":
					e.preventDefault();
					selectEntity(items[activeIndex]);
					return true;
				case "Escape":
					e.preventDefault();
					close();
					return true;
				default:
					return false;
			}
		},
		[isOpen, items, activeIndex, selectEntity, close],
	);

	const removeMention = useCallback(
		(kind: MentionKind, id: string) => {
			if (kind === "paper") {
				onSelectionChange({
					...selection,
					paperIds: selection.paperIds.filter((p) => p !== id),
				});
			} else if (kind === "project") {
				onSelectionChange({
					...selection,
					projectIds: selection.projectIds.filter((p) => p !== id),
				});
			} else {
				onSelectionChange({
					...selection,
					highlights: selection.highlights.filter((h) => h.id !== id),
				});
			}
		},
		[selection, onSelectionChange],
	);

	// Resolve selected ids back to entities for the chips row. Papers/projects
	// resolve from the in-memory lists; highlights are already stored as entities.
	const selectedEntities = useMemo<MentionEntity[]>(() => {
		const paperById = new Map(papers.map((p) => [p.id, p]));
		const projectById = new Map(projects.map((p) => [p.id, p]));
		return [
			...selection.paperIds.map((id) => {
				const p = paperById.get(id);
				return p
					? paperToEntity(p)
					: { kind: "paper" as const, id, label: "Paper" };
			}),
			...selection.projectIds.map((id) => {
				const p = projectById.get(id);
				return p
					? projectToEntity(p)
					: { kind: "project" as const, id, label: "Project" };
			}),
			...selection.highlights,
		];
	}, [selection, papers, projects]);

	return {
		isOpen,
		items,
		activeIndex,
		setActiveIndex,
		query: token?.query ?? "",
		handleTextChange,
		handleKeyDown,
		selectEntity,
		selectedEntities,
		removeMention,
		openMentionMenu,
	};
}

function MentionRow({
	entity,
	active,
	onSelect,
	onHover,
}: {
	entity: MentionEntity;
	active: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	const Icon = entityIcon(entity.kind);
	// Keep the keyboard-active row visible within the scrollable dropdown.
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (active) ref.current?.scrollIntoView({ block: "nearest" });
	}, [active]);
	return (
		<button
			ref={ref}
			type="button"
			// Use onMouseDown so selection fires before the textarea blurs.
			onMouseDown={(e) => {
				e.preventDefault();
				onSelect();
			}}
			onMouseMove={onHover}
			className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
				active ? "bg-accent text-accent-foreground" : "text-foreground"
			}`}
		>
			<Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="min-w-0 flex-1 truncate">{entity.label}</span>
					{entity.sublabel && (
						<span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
							{entity.sublabel}
						</span>
					)}
				</div>
				{entity.matchContext && (
					<div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
						<MessageSquareText className="h-3 w-3 shrink-0" />
						<span className="truncate">{entity.matchContext}</span>
					</div>
				)}
			</div>
		</button>
	);
}

export function MentionDropdown({
	open,
	items,
	activeIndex,
	onSelect,
	onHover,
}: {
	open: boolean;
	items: MentionEntity[];
	activeIndex: number;
	onSelect: (entity: MentionEntity) => void;
	onHover: (index: number) => void;
}) {
	if (!open) return null;

	const papers = items.filter((i) => i.kind === "paper");
	const projects = items.filter((i) => i.kind === "project");
	const highlights = items.filter((i) => i.kind === "highlight");

	const renderSection = (heading: string, sectionItems: MentionEntity[]) => {
		if (sectionItems.length === 0) return null;
		return (
			<div className="py-1">
				<div className="px-2 py-1 text-xs font-medium text-muted-foreground">
					{heading}
				</div>
				{sectionItems.map((entity) => {
					const index = items.indexOf(entity);
					return (
						<MentionRow
							key={`${entity.kind}-${entity.id}`}
							entity={entity}
							active={index === activeIndex}
							onSelect={() => onSelect(entity)}
							onHover={() => onHover(index)}
						/>
					);
				})}
			</div>
		);
	};

	return (
		<div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
			{renderSection("Papers", papers)}
			{renderSection("Projects", projects)}
			{renderSection("Highlights", highlights)}
		</div>
	);
}

/** The route a mention links to, or null if it isn't directly navigable. */
function entityHref(entity: MentionEntity): string | null {
	if (entity.kind === "highlight") {
		return entity.paperId ? `/paper/${entity.paperId}?rsf=annotations` : null;
	}
	if (entity.kind === "paper") return `/paper/${entity.id}`;
	if (entity.kind === "project") return `/projects/${entity.id}`;
	return null;
}

function MentionPill({
	entity,
	onRemove,
	href,
}: {
	entity: MentionEntity;
	onRemove?: () => void;
	href?: string | null;
}) {
	const Icon = entityIcon(entity.kind);
	// Only surface a hover tooltip when the label is actually clipped.
	const labelRef = useRef<HTMLSpanElement>(null);
	const [truncated, setTruncated] = useState(false);
	useEffect(() => {
		const el = labelRef.current;
		if (el) setTruncated(el.scrollWidth > el.clientWidth);
	}, [entity.label]);

	const inner = (
		<>
			<Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
			<span ref={labelRef} className="truncate">
				{entity.label}
			</span>
		</>
	);
	const pill = (
		<span className="inline-flex max-w-[200px] items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-foreground">
			{href ? (
				<Link
					href={href}
					className="inline-flex min-w-0 items-center gap-1 hover:underline"
				>
					{inner}
				</Link>
			) : (
				inner
			)}
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					className="ml-0.5 shrink-0 rounded-full p-0.5 hover:bg-muted"
					aria-label={`Remove ${entity.label}`}
				>
					<X className="h-3 w-3" />
				</button>
			)}
		</span>
	);

	// The highlight's annotations (fall back to the matched annotation when the
	// full set isn't available, e.g. a not-yet-reloaded live selection).
	const isHighlight = entity.kind === "highlight";
	const notes =
		entity.annotations && entity.annotations.length > 0
			? entity.annotations
			: entity.matchContext
				? [entity.matchContext]
				: [];
	// Show the hover card when the label is clipped, always for highlights (to
	// reveal the source paper), or whenever there are notes to surface.
	const showTooltip =
		truncated || (isHighlight && !!entity.sublabel) || notes.length > 0;
	if (!showTooltip) return pill;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{pill}</TooltipTrigger>
			<TooltipContent className="max-w-xs break-words">
				<p className="whitespace-pre-wrap">{entity.label}</p>
				{notes.map((note, i) => (
					<p
						key={`${i}-${note.slice(0, 12)}`}
						className="mt-1 flex items-start gap-1 text-xs opacity-75"
					>
						<MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" />
						<span className="whitespace-pre-wrap">{note}</span>
					</p>
				))}
				{isHighlight && entity.sublabel && (
					<p className="mt-1 text-xs opacity-75">{entity.sublabel}</p>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The attached-context row that lives inside the input box. Up to
 * PILL_COLLAPSE_THRESHOLD entities render as individual removable pills; beyond
 * that they collapse into one summary badge that opens the full, removable list
 * in a popover — so the input height stays bounded.
 */
export function MentionContextBar({
	entities,
	onRemove,
	linkable = false,
}: {
	entities: MentionEntity[];
	// Omit to render the bar read-only (e.g. on a persisted message).
	onRemove?: (kind: MentionKind, id: string) => void;
	// When true, each pill links through to its paper/project page.
	linkable?: boolean;
}) {
	const [open, setOpen] = useState(false);

	if (entities.length === 0) return null;

	if (entities.length <= PILL_COLLAPSE_THRESHOLD) {
		return (
			<TooltipProvider delayDuration={300}>
				<div className="flex flex-wrap items-center gap-1.5">
					{entities.map((entity) => (
						<MentionPill
							key={`${entity.kind}-${entity.id}`}
							entity={entity}
							href={linkable ? entityHref(entity) : undefined}
							onRemove={
								onRemove ? () => onRemove(entity.kind, entity.id) : undefined
							}
						/>
					))}
				</div>
			</TooltipProvider>
		);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-muted"
				>
					<AtSign className="h-3 w-3 text-muted-foreground" />
					{entities.length} in context
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 p-2">
				<div className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
					In context
				</div>
				<div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
					{entities.map((entity) => {
						const Icon = entityIcon(entity.kind);
						const href = linkable ? entityHref(entity) : null;
						const rowInner = (
							<>
								<Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span className="truncate text-sm">{entity.label}</span>
							</>
						);
						return (
							<div
								key={`${entity.kind}-${entity.id}`}
								className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
							>
								{href ? (
									<Link
										href={href}
										className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
									>
										{rowInner}
									</Link>
								) : (
									rowInner
								)}
								{onRemove && (
									<button
										type="button"
										onClick={() => onRemove(entity.kind, entity.id)}
										className="ml-auto shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
										aria-label={`Remove ${entity.label}`}
									>
										<X className="h-3.5 w-3.5" />
									</button>
								)}
							</div>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
