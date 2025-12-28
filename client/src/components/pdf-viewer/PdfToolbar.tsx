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
} from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getStatusIcon, PaperStatus } from "@/components/utils/PdfStatus";

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
}: PdfToolbarProps) {
	return (
		<div className="sticky top-0 z-10 flex items-center justify-between bg-white/80 dark:bg-black/80 backdrop-blur-sm p-2 rounded-none w-full border-b border-gray-300">
			{/* Page navigation */}
			<div className="flex items-center gap-1 mx-2">
				<Button
					onClick={goToPreviousPage}
					size="sm"
					variant="ghost"
					className="h-8 w-8 p-0"
					disabled={currentPage <= 1}
				>
					<ArrowLeft size={16} />
				</Button>
				<span className="text-xs text-secondary-foreground">
					{currentPage} of {numPages || "?"}
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

			{/* Search */}
			<div className="flex items-center gap-1">
				{showSearchInput ? (
					<form onSubmit={handleSearchSubmit} className="flex items-center gap-1">
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
						{/* Match count and navigation */}
						{isSearching ? (
							<span className="text-xs text-muted-foreground whitespace-nowrap">
								Searching...
							</span>
						) : matchPages.length > 0 ? (
							<>
								<span className="text-xs text-muted-foreground whitespace-nowrap">
									{currentMatchIndex + 1} of {matchPages.length}
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
							</>
						) : searchText && lastSearchTermRef.current === searchText ? (
							<span className="text-xs text-muted-foreground whitespace-nowrap">
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
				<span className="text-xs w-12 text-center">
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
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" variant="outline" className="h-8 px-2">
								<span className="ml-1 text-xs text-muted-foreground flex items-center gap-1">
									{getStatusIcon(paperStatus)}
									{paperStatus}
								</span>
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
				</div>
			)}
		</div>
	);
}
