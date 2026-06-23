import { OpenAlexPaper } from "@/lib/schema";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import Link from "next/link";

interface PaperResultCardProps {
    paper: OpenAlexPaper;
    isSelected?: boolean;
    onSelect?: (paper: OpenAlexPaper) => void;
}

const makeSciHubUrl = (doi: string) => {
    const baseUrl = "https://sci-hub.se/";
    return `${baseUrl}${doi}`;
}

function SciHubLink({ doiLink, className }: { doiLink: string | undefined; className?: string }) {
    if (!doiLink) return null;
    return (
        <Dialog>
            <DialogTrigger asChild>
                <button
                    className={className}
                    onClick={(e) => e.stopPropagation()}
                >
                    [PDF]
                </button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Alternative PDF Access</DialogTitle>
                    <DialogDescription asChild>
                        <div className="space-y-3">
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                You will be redirected to Sci-Hub, a third-party platform that provides access to academic papers. Please note that availability of the requested article is not guaranteed.
                            </p>
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <p className="text-xs text-amber-800 dark:text-amber-200">
                                    <strong>Disclaimer:</strong> Sci-Hub operates independently and may not comply with all copyright laws. Users should verify the legal status of accessing content through third-party platforms in their jurisdiction. We recommend prioritizing official publisher channels and institutional access when available.
                                </p>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <Button
                                    variant="outline"
                                    asChild
                                    className="flex-1"
                                >
                                    <a
                                        href={makeSciHubUrl(doiLink)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-2"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        Continue to Sci-Hub
                                    </a>
                                </Button>
                                <DialogClose asChild>
                                    <Button variant="secondary">Cancel</Button>
                                </DialogClose>
                            </div>
                        </div>
                    </DialogDescription>
                </DialogHeader>
            </DialogContent>
        </Dialog>
    );
}

export default function PaperResultCard({ paper, isSelected, onSelect }: PaperResultCardProps) {
    const numAuthors = paper.authorships?.length || 0;

    // Format authors for the metadata line
    const authorLine = paper.authorships?.slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", ") || "";
    const hasMoreAuthors = numAuthors > 3;

    // Get source/journal name if available
    const sourceName = paper.primary_location?.source?.display_name;

    return (
        <div
            className={`group py-4 cursor-pointer border-b border-slate-200 dark:border-slate-800 last:border-b-0 transition-colors overflow-hidden ${
                isSelected
                    ? "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500 pl-3"
                    : "hover:bg-slate-50 dark:hover:bg-slate-900/50"
            }`}
            onClick={() => onSelect?.(paper)}
        >
            {/* Title */}
            <h3 className={`text-lg leading-snug mb-1 break-words ${
                isSelected
                    ? "text-blue-800 dark:text-blue-300"
                    : "text-blue-700 dark:text-blue-400 group-hover:underline"
            }`}>
                {paper.title}
            </h3>

            {/* Author/Source/Year line */}
            <div className="text-sm text-blue-600 dark:text-blue-400 mb-1 break-words">
                {authorLine}
                {hasMoreAuthors && <span>...</span>}
                {sourceName && (
                    <>
                        {authorLine && " - "}
                        <span>{sourceName}</span>
                    </>
                )}
                {paper.publication_year && (
                    <>
                        {(authorLine || sourceName) && ", "}
                        {paper.publication_year}
                    </>
                )}
            </div>

            {/* Abstract snippet */}
            {paper.abstract && (
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-2 line-clamp-2 break-words">
                    {paper.abstract}
                </p>
            )}

            {/* Action links row */}
            <div className="flex items-center gap-3 text-sm flex-wrap">
                {paper.cited_by_count !== undefined && paper.cited_by_count > 0 && (
                    <span className="text-slate-500 dark:text-slate-400">
                        Cited by {paper.cited_by_count}
                    </span>
                )}
                {paper.open_access?.is_oa && (
                    <span className="text-green-600 dark:text-green-400 text-xs font-medium">
                        Open Access
                    </span>
                )}
                {paper.open_access?.oa_url ? (
                    <a
                        href={paper.open_access.oa_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        [PDF]
                    </a>
                ) : (
                    <SciHubLink doiLink={paper.doi} className="text-blue-600 dark:text-blue-400 hover:underline" />
                )}
                {paper.doi && (
                    <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        View
                    </a>
                )}
                {paper.doi && (
                    <Link
                        href={`/graph?doi=${encodeURIComponent(paper.doi)}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        Graph
                    </Link>
                )}
            </div>
        </div>
    );
}
