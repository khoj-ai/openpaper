"use client";

import { MutableRefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	ArrowLeft,
	ArrowRight,
	Minus,
	Plus,
	ChevronUp,
	ChevronDown,
	Search,
	X,
	Highlighter,
} from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getStatusIcon, PaperStatus } from "@/components/utils/PdfStatus";
import { HighlightColor } from "@/lib/schema";

// Color configuration for highlights
const HIGHLIGHT_COLORS: { color: HighlightColor; bg: string; label: string }[] = [
	{ color: "yellow", bg: "bg-yellow-300", label: "Yellow" },
	{ color: "green", bg: "bg-green-400", label: "Green" },
	{ color: "blue", bg: "bg-blue-400", label: "Blue" },
	{ color: "pink", bg: "bg-pink-400", label: "Pink" },
	{ color: "purple", bg: "bg-purple-400", label: "Purple" },
];

interface PdfToolbarProps {
	// Page navigation
	currentPage: number;
	numPages: number | null;
	goToPreviousPage: () => void;
	goToNextPage: () => void;

	// Search
	searchText: string;
	showSearchInput: boolean;
	setShowSearchInput: (show: boolean) => void;
	searchInputRef: MutableRefObject<HTMLInputElement | null>;
	handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	handleSearchSubmit: (e: React.FormEvent) => void;
	handleClearSearch: () => void;
	isSearching: boolean;
	matchPages: number[];
	currentMatchIndex: number;
	goToPreviousMatch: () => void;
	goToNextMatch: () => void;
	lastSearchTermRef: MutableRefObject<string | undefined>;

	// Zoom
	scale: number;
	zoomIn: () => void;
	zoomOut: () => void;

	// Status
	paperStatus?: PaperStatus;
	handleStatusChange?: (status: PaperStatus) => void;

	// Highlight color
	highlightColor: HighlightColor;
	setHighlightColor: (color: HighlightColor) => void;
}

export function PdfToolbar({
	currentPage,
	numPages,
	goToPreviousPage,
	goToNextPage,
	searchText,
	showSearchInput,
	setShowSearchInput,
	searchInputRef,
	handleSearchChange,
	handleSearchSubmit,
	handleClearSearch,
	isSearching,
	matchPages,
	currentMatchIndex,
	goToPreviousMatch,
	goToNextMatch,
	lastSearchTermRef,
	scale,
	zoomIn,
	zoomOut,
	paperStatus,
	handleStatusChange = () => { },
	highlightColor,
	setHighlightColor,
}: PdfToolbarProps) {
	const currentColorConfig = HIGHLIGHT_COLORS.find((c) => c.color === highlightColor) || HIGHLIGHT_COLORS[2];
	return (
		<div className="sticky top-0 z-10 flex items-center bg-white/80 dark:bg-black/80 backdrop-blur-sm px-3 py-2 w-full border-b border-gray-300">
			{/* Left section: Page navigation */}
			<div className="flex items-center gap-1">
				<Button
					onClick={goToPreviousPage}
					size="sm"
					variant="ghost"
					className="h-8 w-8 p-0"
					disabled={currentPage <= 1}
				>
					<ArrowLeft size={16} />
				</Button>
				<span className="text-xs text-secondary-foreground min-w-[4rem] text-center">
					{currentPage} / {numPages || "?"}
				</span>
				<Button
					onClick={goToNextPage}
					size="sm"
					variant="ghost"
					className="h-8 w-8 p-0"
					disabled={!numPages || currentPage >= numPages}
				>
					<ArrowRight size={16} />
				</Button>
			</div>

			{/* Separator */}
			<div className="h-5 w-px bg-gray-300 mx-3" />

			{/* Center section: Search */}
			<div className="flex items-center gap-1">
				{showSearchInput ? (
					<form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
						<div className="relative">
							<Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
							<Input
								ref={searchInputRef}
								type="text"
								placeholder="Search..."
								value={searchText}
								onChange={handleSearchChange}
								className="h-8 w-40 pl-7 pr-7 text-xs"
								autoFocus
							/>
							{searchText && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
									onClick={handleClearSearch}
								>
									<X size={12} />
								</Button>
							)}
						</div>
						{isSearching ? (
							<span className="text-xs text-muted-foreground">
								Searching...
							</span>
						) : matchPages.length > 0 ? (
							<div className="flex items-center gap-1">
								<span className="text-xs text-muted-foreground">
									{currentMatchIndex + 1}/{matchPages.length}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 w-7 p-0"
									onClick={goToPreviousMatch}
									title="Previous match"
								>
									<ChevronUp size={14} />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 w-7 p-0"
									onClick={goToNextMatch}
									title="Next match"
								>
									<ChevronDown size={14} />
								</Button>
							</div>
						) : searchText && lastSearchTermRef.current === searchText ? (
							<span className="text-xs text-muted-foreground">
								No results
							</span>
						) : null}
					</form>
				) : (
					<Button
						onClick={() => {
							setShowSearchInput(true);
							setTimeout(() => searchInputRef.current?.focus(), 0);
						}}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0"
						title="Search (Cmd+F)"
					>
						<Search size={16} />
					</Button>
				)}
			</div>

			{/* Separator */}
			<div className="h-5 w-px bg-gray-300 mx-3" />

			{/* Highlight color picker */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						size="sm"
						variant="ghost"
						className="h-8 px-2 gap-1.5"
						title="Highlight color"
					>
						<Highlighter size={16} />
						<div
							className={`w-3 h-3 rounded-sm ${currentColorConfig.bg}`}
						/>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="min-w-0">
					<div className="flex gap-1 p-1">
						{HIGHLIGHT_COLORS.map(({ color, bg }) => (
							<button
								key={color}
								onClick={() => setHighlightColor(color)}
								className={`w-6 h-6 rounded-sm ${bg} hover:scale-110 transition-transform ${
									highlightColor === color ? "ring-2 ring-offset-1 ring-gray-400" : ""
								}`}
								title={color}
							/>
						))}
					</div>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Spacer */}
			<div className="flex-1" />

			{/* Right section: Zoom + Status */}
			<div className="flex items-center gap-3">
				{/* Zoom controls */}
				<div className="flex items-center gap-1">
					<Button
						onClick={zoomOut}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0"
					>
						<Minus size={16} />
					</Button>
					<span className="text-xs w-10 text-center tabular-nums">
						{Math.round(scale * 100)}%
					</span>
					<Button
						onClick={zoomIn}
						size="sm"
						variant="ghost"
						className="h-8 w-8 p-0"
					>
						<Plus size={16} />
					</Button>
				</div>

				{/* Status dropdown */}
				{paperStatus && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" variant="outline" className="h-8 px-2 gap-1">
								{getStatusIcon(paperStatus)}
								<span className="text-xs capitalize">{paperStatus}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => handleStatusChange("todo")}>
								{getStatusIcon("todo")}
								Todo
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleStatusChange("reading")}>
								{getStatusIcon("reading")}
								Reading
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => handleStatusChange("completed")}>
								{getStatusIcon("completed")}
								Completed
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</div>
	);
}
