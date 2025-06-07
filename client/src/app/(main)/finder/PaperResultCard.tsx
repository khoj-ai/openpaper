import { OpenAlexResponse } from "@/lib/schema";
import { useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
    SheetFooter,
    SheetClose,
} from '@/components/ui/sheet';
import { ExternalLink, Users, CalendarDays, Building2, BookOpen, Quote, Tag, PlusCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import Link from "next/link";

interface PaperResultCardProps {
    paper: OpenAlexResponse["results"][number]
}

const makeSciHubUrl = (doi: string) => {
    const baseUrl = "https://sci-hub.se/";
    return `${baseUrl}${doi}`;
}

function SciHubCard({ doiLink }: { doiLink: string | undefined }) {
    if (!doiLink) return null;
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="hover:bg-slate-100 dark:hover:bg-slate-100 hover:text-slate-900 text-primary transition-colors"
                    onClick={(e) => e.stopPropagation()}
                >
                    <BookOpen className="h-4 w-4" />
                    PDF
                </Button>
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

export default function PaperResultCard({ paper }: PaperResultCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false);

    // Get unique institutions from authorships
    const institutions = paper.authorships?.flatMap(a => a.institutions || []).filter(Boolean).filter((inst, index, self) =>
        index === self.findIndex(i => i.id === inst.id)
    ) || [];

    const hasInstitutions = institutions.length > 0;
    const hasAuthors = paper.authorships?.some(a => a.author?.display_name) || false;
    const numAuthors = paper.authorships?.length || 0;

    return (
        <>
            <Card
                className="group flex flex-col transition-all duration-200 ease-in-out hover:shadow-md hover:border-blue-500/30 cursor-pointer border-slate-200 dark:border-slate-800 bg-secondary/10 hover:bg-secondary/20 dark:bg-primary/10 dark:hover:bg-primary/20"
                onClick={() => setIsSheetOpen(true)}
            >
                <CardHeader className="relative">
                    <CardTitle className="text-lg leading-tight group-hover:text-blue-600 transition-colors duration-200 pr-8 font-medium">
                        {paper.title}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                        <CalendarDays className="h-4 w-4 text-secondary-foreground" />
                        {paper.publication_date}
                        {paper.publication_year && (
                            <Badge variant="outline" className="ml-2 text-xs text-secondary-foreground bg-secondary">
                                {paper.publication_year}
                            </Badge>
                        )}
                    </CardDescription>
                </CardHeader>

                <CardContent className="flex-grow space-y-4">
                    {hasAuthors && (
                        <div className="flex items-start gap-2">
                            <Users className="h-4 w-4 mt-0.5 text-secondary-foreground flex-shrink-0" />
                            <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                {paper.authorships?.slice(0, 3).map((a, index) => (
                                    <span key={a.author?.id || index}>
                                        {index > 0 && ", "}
                                        {a.author?.orcid ? (
                                            <a
                                                href={`${a.author.orcid}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:underline transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {a.author.display_name}
                                            </a>
                                        ) : (
                                            <span className="text-slate-700 dark:text-slate-300">
                                                {a.author?.display_name || "Unknown Author"}
                                            </span>
                                        )}
                                    </span>
                                ))}
                                {numAuthors > 3 && (
                                    <span className="italic text-slate-500">
                                        {" "}and {numAuthors - 3} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {hasInstitutions && (
                        <div className="flex items-start gap-2">
                            <Building2 className="h-4 w-4 mt-0.5 text-secondary-foreground flex-shrink-0" />
                            <div className="text-sm leading-relaxed">
                                {institutions.slice(0, 2).map((institution, index) => (
                                    <span key={institution.id}>
                                        {index > 0 && ", "}
                                        <a
                                            href={`${institution.ror}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-slate-700 dark:text-slate-300 hover:text-blue-600 hover:underline transition-colors"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {institution.display_name}
                                        </a>
                                    </span>
                                ))}
                                {institutions.length > 2 && (
                                    <span className="text-slate-500 italic">
                                        {" "}and {institutions.length - 2} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {(paper.keywords || paper.topics) && (
                        <div className="flex flex-wrap gap-2">
                            {paper.keywords?.slice(0, 3).map((keyword, i) => (
                                <Badge key={`keyword-${i}`} variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200 text-xs">
                                    {keyword.display_name}
                                </Badge>
                            ))}
                            {paper.topics?.slice(0, 1).map((topic, i) => (
                                <Badge key={`topic-${i}`} variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200 text-xs">
                                    {topic.display_name}
                                </Badge>
                            ))}
                        </div>
                    )}

                    {paper.abstract && (
                        <div className="bg-slate-50 dark:bg-slate-900 p-3 border-l-2 border-slate-300 dark:border-slate-700">
                            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                                {paper.abstract.length > 150
                                    ? paper.abstract.slice(0, 150) + "..."
                                    : paper.abstract}
                            </p>
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex flex-col md:flex-row md:justify-between items-start md:items-center pt-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                        {paper.cited_by_count !== undefined && (
                            <Badge variant="outline" className="text-secondary-foreground bg-secondary text-xs">
                                <Quote className="h-3 w-3 mr-1" />
                                {paper.cited_by_count} citations
                            </Badge>
                        )}
                        {paper.open_access?.is_oa && (
                            <Badge className="bg-blue-500 text-white text-xs">
                                Open Access
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {paper.doi && (
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="hover:bg-slate-100 dark:hover:bg-slate-100 hover:text-slate-900 text-primary transition-colors"
                            >
                                <a
                                    href={`https://doi.org/${paper.doi}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <ExternalLink className="h-4 w-4" />
                                    View
                                </a>
                            </Button>
                        )}
                        {paper.open_access?.oa_url ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="hover:bg-blue-50 dark:hover:bg-blue-800 hover:text-blue-700 transition-colors text-blue-600 dark:text-blue-100"
                            >
                                <a
                                    href={paper.open_access.oa_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <BookOpen className="h-4 w-4" />
                                    PDF
                                </a>
                            </Button>
                        ) : (
                            <SciHubCard doiLink={paper.doi} />
                        )}
                    </div>
                </CardFooter>
            </Card>

            {/* Sheet Implementation */}
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent
                    side="right"
                    className="w-full md:w-3/4 lg:w-1/2 xl:max-w-2xl p-6 h-full overflow-y-auto bg-secondary text-slate-900 dark:text-slate-100"
                >
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-xl leading-tight pr-8 font-medium">
                            {paper.title}
                        </SheetTitle>
                        <SheetDescription className="flex items-start flex-col gap-4 text-base pt-2">
                            <div className="flex items-center gap-2">
                                <span className="flex items-center gap-2 text-secondary-foreground">
                                    <CalendarDays className="h-4 w-4" />
                                    {paper.publication_date}
                                </span>
                                {paper.publication_year && (
                                    <Badge variant="outline" className="border-slate-300 text-secondary-foreground bg-secondary text-xs">
                                        {paper.publication_year}
                                    </Badge>
                                )}
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3">
                                {paper.doi && (
                                    <Button variant="outline" asChild className="border-slate-300">
                                        <a
                                            href={`https://doi.org/${paper.doi}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            View Publication
                                        </a>
                                    </Button>
                                )}
                                {paper.open_access?.oa_url && (
                                    <>
                                        <Button variant="default" asChild className="bg-blue-500 hover:bg-blue-600">
                                            <a
                                                href={paper.open_access.oa_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                            >
                                                <BookOpen className="h-4 w-4" />
                                                Open Access PDF
                                            </a>
                                        </Button>
                                        {/* Dialog for importing into library. When clicked, shows user instructions for navigating to the Open Access PDF link, retrieving the paper, and then uploading to Open Paper via the home page `/` */}
                                        <Dialog>
                                            <DialogTrigger asChild>
                                                <Button variant="outline" className="border-slate-300">
                                                    <PlusCircle className="h-4 w-4 mr-2" />
                                                    Add to Queue
                                                </Button>
                                            </DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader>
                                                    <DialogTitle>Import Paper</DialogTitle>
                                                    <DialogDescription>
                                                        To import this paper into your library, follow these steps:
                                                        <ol className="list-decimal list-inside">
                                                            <li>Visit this <a href={paper.open_access.oa_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Open Access</a> link.</li>
                                                            <li>Download the paper to your device.</li>
                                                            <li>Open the <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline">Open Paper home page</Link>.</li>
                                                            <li>Upload the PDF.</li>
                                                        </ol>
                                                        <Collapsible className="mt-4">
                                                            <CollapsibleTrigger className="text-blue-600 dark:text-blue-400 hover:underline">
                                                                Why do I need to do this?
                                                            </CollapsibleTrigger>
                                                            <CollapsibleContent className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                                                                Open Access URLs can vary widely in how they are structured and hosted. By downloading the paper directly, you ensure that you have the correct file to upload to your library.
                                                            </CollapsibleContent>
                                                        </Collapsible>
                                                    </DialogDescription>
                                                </DialogHeader>
                                            </DialogContent>
                                        </Dialog>
                                    </>
                                )}
                            </div>
                        </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6">
                        {/* Abstract */}
                        {paper.abstract && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 text-slate-900 dark:text-slate-100">Abstract</h3>
                                <div className="bg-slate-50 dark:bg-slate-900 p-4 border-l-2 border-slate-300 dark:border-slate-700">
                                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {paper.abstract}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Authors Section */}
                        {hasAuthors && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                    <Users className="h-5 w-5 text-slate-500" />
                                    Authors ({numAuthors})
                                </h3>
                                <div className="grid gap-2">
                                    {paper.authorships?.map((authorship, index) => (
                                        <div key={index} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                                            <div>
                                                {authorship.author?.orcid ? (
                                                    <a
                                                        href={authorship.author.orcid}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                                    >
                                                        {authorship.author.display_name}
                                                    </a>
                                                ) : (
                                                    <span className="font-medium text-slate-900 dark:text-slate-100">
                                                        {authorship.author?.display_name || "Unknown Author"}
                                                    </span>
                                                )}
                                                {authorship.institutions && authorship.institutions.length > 0 && (
                                                    <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                                        {authorship.institutions.map((inst, i) => (
                                                            <span key={inst.id}>
                                                                {i > 0 && ", "}
                                                                {inst.display_name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Institutions Section */}
                        {hasInstitutions && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                    <Building2 className="h-5 w-5 text-slate-500" />
                                    Institutions ({institutions.length})
                                </h3>
                                <div className="grid gap-2">
                                    {institutions.map(institution => (
                                        <div key={institution.id} className="p-3 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-800">
                                            <a
                                                href={institution.ror}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                            >
                                                {institution.display_name}
                                            </a>
                                            <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                                Type: {institution.type}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Keywords and Topics */}
                        {(paper.keywords || paper.topics) && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2 text-slate-900 dark:text-slate-100">
                                    <Tag className="h-5 w-5 text-slate-500" />
                                    Keywords & Topics
                                </h3>
                                <div className="space-y-4">
                                    {paper.keywords && paper.keywords.length > 0 && (
                                        <div>
                                            <h4 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2">Keywords:</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {paper.keywords.map((keyword, i) => (
                                                    <Badge key={i} variant="secondary" className="bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                                        {keyword.display_name}
                                                        {keyword.score && (
                                                            <span className="ml-1 text-xs opacity-70">
                                                                ({keyword.score.toFixed(2)})
                                                            </span>
                                                        )}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {paper.topics && paper.topics.length > 0 && (
                                        <div>
                                            <h4 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2 mt-3">Topics:</h4>
                                            <div className="space-y-2">
                                                {paper.topics.map((topic, i) => (
                                                    <div key={i} className="p-3 bg-slate-50 rounded border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                                                        <div className="font-medium text-slate-900 dark:text-slate-100">
                                                            {topic.display_name}
                                                            {topic.score && (
                                                                <span className="ml-2 text-xs opacity-70 text-accent-foreground">
                                                                    Score: {topic.score.toFixed(2)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-slate-600 mt-1 dark:text-slate-400">
                                                            {topic.domain.display_name} → {topic.field.display_name} → {topic.subfield.display_name}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Metadata */}
                        <div>
                            <h3 className="font-semibold text-lg mb-3 text-slate-900 dark:text-slate-100">Publication Details</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {paper.cited_by_count !== undefined && (
                                    <div className="bg-slate-50 p-4 rounded border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                                        <div className="font-medium text-slate-600 dark:text-slate-400">Citations</div>
                                        <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                            {paper.cited_by_count}
                                        </div>
                                    </div>
                                )}
                                {paper.open_access && (
                                    <div className="bg-slate-50 p-4 rounded border border-slate-200 dark:bg-slate-900 dark:border-slate-800">
                                        <div className="font-medium text-slate-600 dark:text-slate-400">Open Access Status</div>
                                        <Badge className={`mt-2 ${paper.open_access.is_oa ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-700'}`}>
                                            {paper.open_access.oa_status}
                                        </Badge>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <SheetFooter className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800">
                        <div className="flex flex-col sm:flex-row gap-3 w-full">
                            {paper.doi && (
                                <Button variant="outline" asChild className="border-slate-300">
                                    <a
                                        href={`https://doi.org/${paper.doi}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 w-full sm:w-auto justify-center"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                        View Publication
                                    </a>
                                </Button>
                            )}
                            {paper.open_access?.oa_url ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    asChild
                                    className="hover:bg-blue-50 dark:hover:bg-blue-800 hover:text-blue-700 transition-colors text-blue-600 dark:text-blue-100"
                                >
                                    <a
                                        href={paper.open_access.oa_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <BookOpen className="h-4 w-4" />
                                        PDF
                                    </a>
                                </Button>
                            ) : (
                                <SciHubCard doiLink={paper.doi} />
                            )}
                            <SheetClose asChild>
                                <Button variant="outline" className="border-slate-300">Close</Button>
                            </SheetClose>
                        </div>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </>
    );
}
