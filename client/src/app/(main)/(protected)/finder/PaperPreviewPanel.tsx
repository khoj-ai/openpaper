import { OpenAlexPaper } from "@/lib/schema";
import { ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface PaperPreviewPanelProps {
    paper: OpenAlexPaper;
    onClose?: () => void;
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
                <button className={className}>
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

export default function PaperPreviewPanel({ paper, onClose }: PaperPreviewPanelProps) {
    const numAuthors = paper.authorships?.length || 0;
    const authorLine = paper.authorships?.slice(0, 5).map(a => a.author?.display_name).filter(Boolean).join(", ") || "";
    const hasMoreAuthors = numAuthors > 5;
    const sourceName = paper.primary_location?.source?.display_name;

    return (
        <div className="h-full overflow-y-auto p-5 bg-secondary text-slate-900 dark:text-slate-100">
            {/* Title */}
            <div className="flex items-start gap-2 mb-2">
                <h2 className="text-lg leading-snug font-semibold text-slate-900 dark:text-slate-100 flex-1">
                    {paper.title}
                </h2>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Author/Source/Year line */}
            <div className="text-sm text-blue-600 dark:text-blue-400 mb-2">
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

            {/* Action links row */}
            <div className="flex items-center gap-3 text-sm flex-wrap mb-4">
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
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        [PDF]
                    </a>
                ) : (
                    <SciHubLink doiLink={paper.doi} className="font-medium text-blue-600 dark:text-blue-400 hover:underline" />
                )}
                {paper.doi && (
                    <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        View
                    </a>
                )}
            </div>

            {/* Abstract */}
            {paper.abstract && (
                <div className="mb-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        {paper.abstract}
                    </p>
                </div>
            )}

            {/* Keywords */}
            {paper.keywords && paper.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {paper.keywords.slice(0, 8).map((keyword, i) => (
                        <Badge key={i} variant="secondary" className="text-xs bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            {keyword.display_name}
                        </Badge>
                    ))}
                    {paper.keywords.length > 8 && (
                        <span className="text-xs text-slate-400">+{paper.keywords.length - 8} more</span>
                    )}
                </div>
            )}

            {/* Topics */}
            {paper.topics && paper.topics.length > 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                    {paper.topics.slice(0, 3).map((topic, i) => (
                        <span key={i}>
                            {i > 0 && " · "}
                            {topic.display_name}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
