"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { ArrowDownNarrowWide, Calendar, Check, ChevronDown, Search } from "lucide-react"
import { useRef } from "react"

export interface DiscoverSource {
    key: string
    label: string
    description: string
}

export type SearchMode = "scholarly" | "discover"
export type DiscoverSort = "cited_by_count:desc" | "publication_date:desc" | null
export type YearFilter = "last_year" | "last_5_years" | null

const SORT_OPTIONS: { value: DiscoverSort; label: string }[] = [
    { value: null, label: "Relevance" },
    { value: "cited_by_count:desc", label: "Most cited" },
    { value: "publication_date:desc", label: "Newest" },
]

const YEAR_FILTER_OPTIONS: { value: YearFilter; label: string }[] = [
    { value: null, label: "All time" },
    { value: "last_year", label: "Last year" },
    { value: "last_5_years", label: "Last 5 years" },
]

interface DiscoverInputProps {
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    loading: boolean
    sources: DiscoverSource[]
    selectedSources: string[]
    onSourceToggle: (sourceKey: string) => void
    sort: DiscoverSort
    onSortChange: (sort: DiscoverSort) => void
    mode: SearchMode
    onModeChange: (mode: SearchMode) => void
    onlyOpenAccess: boolean
    onOpenAccessChange: (value: boolean) => void
    yearFilter: YearFilter
    onYearFilterChange: (filter: YearFilter) => void
}

export default function DiscoverInput({
    value,
    onChange,
    onSubmit,
    loading,
    sources,
    selectedSources,
    onSourceToggle,
    sort,
    onSortChange,
    mode,
    onModeChange,
    onlyOpenAccess,
    onOpenAccessChange,
    yearFilter,
    onYearFilterChange,
}: DiscoverInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (value.trim() && !loading) {
                onSubmit()
            }
        }
    }

    // Filter out openalex from sources (it's now handled by mode)
    const webSources = sources.filter(s => s.key !== "openalex")
    const selectedWebSources = selectedSources.filter(s => s !== "openalex")
    const selectedCount = selectedWebSources.length

    const sourcesLabel = selectedCount === 0
        ? "All sources"
        : selectedCount === 1
            ? webSources.find(s => s.key === selectedWebSources[0])?.label || "1 source"
            : `${selectedCount} sources`

    const currentSortLabel = SORT_OPTIONS.find(o => o.value === sort)?.label || "Relevance"
    const currentYearFilterLabel = YEAR_FILTER_OPTIONS.find(o => o.value === yearFilter)?.label || "All time"

    return (
        <div className="w-full max-w-2xl mx-auto space-y-4">
            <h1 className="text-2xl font-semibold text-center">Discover Research</h1>
            <p className="text-sm text-muted-foreground text-center">
                Enter a research question and we&apos;ll find relevant papers across the web.
            </p>
            <div className="relative">
                <Textarea
                    ref={textareaRef}
                    placeholder="What research questions are you exploring?"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="min-h-[100px] resize-none pb-12"
                    rows={3}
                />

                {/* Controls inside textarea */}
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {/* Mode toggle */}
                        <div className="flex items-center bg-muted rounded-md p-0.5">
                            <button
                                type="button"
                                onClick={() => onModeChange("scholarly")}
                                className={cn(
                                    "px-2.5 py-1 text-sm rounded transition-colors",
                                    mode === "scholarly"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                Scholarly
                            </button>
                            <button
                                type="button"
                                onClick={() => onModeChange("discover")}
                                className={cn(
                                    "px-2.5 py-1 text-sm rounded transition-colors",
                                    mode === "discover"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                Discover
                            </button>
                        </div>

                        {/* Academic mode: sort dropdown and open access filter */}
                        {mode === "scholarly" && (
                            <>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            type="button"
                                            className={cn(
                                                "flex items-center gap-1.5 text-sm rounded-md px-2 py-1 transition-colors",
                                                "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                sort ? "text-foreground" : "text-muted-foreground"
                                            )}
                                        >
                                            <ArrowDownNarrowWide className="h-3.5 w-3.5" />
                                            {currentSortLabel}
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-40 p-1" align="start">
                                        <div className="space-y-0.5">
                                            {SORT_OPTIONS.map((option) => (
                                                <button
                                                    key={option.label}
                                                    type="button"
                                                    onClick={() => onSortChange(option.value)}
                                                    className={cn(
                                                        "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                                                        "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                        sort === option.value && "bg-accent"
                                                    )}
                                                >
                                                    <Check className={cn(
                                                        "h-3.5 w-3.5",
                                                        sort === option.value ? "opacity-100" : "opacity-0"
                                                    )} />
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>

                                <label className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1 cursor-pointer hover:bg-accent transition-colors">
                                    <Checkbox
                                        checked={onlyOpenAccess}
                                        onCheckedChange={(checked) => onOpenAccessChange(checked === true)}
                                        className="h-3.5 w-3.5"
                                    />
                                    <span className={onlyOpenAccess ? "text-foreground" : "text-muted-foreground"}>
                                        Open Access
                                    </span>
                                </label>

                            </>
                        )}

                        {/* Discover mode: domain filter dropdown */}
                        {mode === "discover" && webSources.length > 0 && (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            "flex items-center gap-1.5 text-sm rounded-md px-2 py-1 transition-colors",
                                            "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            selectedCount > 0 ? "text-foreground" : "text-muted-foreground"
                                        )}
                                    >
                                        {sourcesLabel}
                                        <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 p-2" align="start">
                                    <div className="space-y-1">
                                        {webSources.map((source) => {
                                            const isSelected = selectedSources.includes(source.key)
                                            return (
                                                <label
                                                    key={source.key}
                                                    className="flex items-start gap-3 rounded-md px-2 py-2 cursor-pointer hover:bg-accent transition-colors"
                                                >
                                                    <Checkbox
                                                        checked={isSelected}
                                                        onCheckedChange={() => onSourceToggle(source.key)}
                                                        className="mt-0.5"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium">{source.label}</div>
                                                        <div className="text-xs text-muted-foreground">{source.description}</div>
                                                    </div>
                                                </label>
                                            )
                                        })}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        )}

                        {/* Time filter (shown for both modes) */}
                        <Popover>
                            <PopoverTrigger asChild>
                                <button
                                    type="button"
                                    className={cn(
                                        "flex items-center gap-1.5 text-sm rounded-md px-2 py-1 transition-colors",
                                        "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        yearFilter ? "text-foreground" : "text-muted-foreground"
                                    )}
                                >
                                    <Calendar className="h-3.5 w-3.5" />
                                    {currentYearFilterLabel}
                                    <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-40 p-1" align="start">
                                <div className="space-y-0.5">
                                    {YEAR_FILTER_OPTIONS.map((option) => (
                                        <button
                                            key={option.label}
                                            type="button"
                                            onClick={() => onYearFilterChange(option.value)}
                                            className={cn(
                                                "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                                                "hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                yearFilter === option.value && "bg-accent"
                                            )}
                                        >
                                            <Check className={cn(
                                                "h-3.5 w-3.5",
                                                yearFilter === option.value ? "opacity-100" : "opacity-0"
                                            )} />
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Search button */}
                    <Button
                        onClick={onSubmit}
                        disabled={!value.trim() || loading}
                        size="sm"
                        className="gap-2"
                    >
                        <Search className="h-4 w-4" />
                        Search
                    </Button>
                </div>
            </div>
        </div>
    )
}
