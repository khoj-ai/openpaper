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
import { ExternalLink, Users, CalendarDays, Building2, BookOpen, Quote, Tag, Globe } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PaperResultCardProps {
    paper: OpenAlexResponse["results"][number]
}

export default function PaperResultCard({ paper }: PaperResultCardProps) {
    const [isSheetOpen, setIsSheetOpen] = useState(false); // Renamed from isDialogOpen

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
                className="group flex flex-col transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-blue-500/10 hover:border-blue-200 cursor-pointer bg-secondary/10 dark:bg-secondary/80"
                onClick={() => setIsSheetOpen(true)} // Changed to setIsSheetOpen
            >
                <CardHeader className="relative">
                    <CardTitle className="text-lg leading-tight group-hover:text-blue-700 group-hover:dark:text-blue-300 transition-colors duration-200 pr-8">
                        {paper.title}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 text-accent-foreground">
                        <CalendarDays className="h-4 w-4 text-blue-500" />
                        {paper.publication_date}
                        {paper.publication_year && (
                            <Badge variant="outline" className="ml-2 text-xs">
                                {paper.publication_year}
                            </Badge>
                        )}
                    </CardDescription>
                </CardHeader>

                <CardContent className="flex-grow space-y-4">
                    {hasAuthors && (
                        <div className="flex items-start gap-2">
                            <Users className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                            <div className="text-sm text-accent-foreground leading-relaxed">
                                {paper.authorships?.slice(0, 3).map((a, index) => (
                                    <span key={a.author?.id || index}>
                                        {index > 0 && ", "}
                                        {a.author?.orcid ? (
                                            <a
                                                href={`${a.author.orcid}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-emerald-600 dark:text-green-200 hover:text-emerald-700 hover:underline transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {a.author.display_name}
                                            </a>
                                        ) : (
                                            <span className="text-accent-foreground">
                                                {a.author?.display_name || "Unknown Author"}
                                            </span>
                                        )}
                                    </span>
                                ))}
                                {numAuthors > 3 && (
                                    <span className="italic">
                                        {" "}and {numAuthors - 3} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {hasInstitutions && (
                        <div className="flex items-start gap-2">
                            <Building2 className="h-4 w-4 mt-0.5 text-purple-500 flex-shrink-0" />
                            <div className="text-sm leading-relaxed">
                                {institutions.slice(0, 2).map((institution, index) => (
                                    <span key={institution.id}>
                                        {index > 0 && ", "}
                                        <a
                                            href={`${institution.ror}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-purple-600 dark:text-purple-200 hover:underline transition-colors"
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
                            {paper.keywords?.slice(0, 2).map((keyword, i) => (
                                <Badge key={`keyword-${i}`} variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 transition-colors">
                                    <Tag className="h-3 w-3 mr-1" />
                                    {keyword.display_name}
                                </Badge>
                            ))}
                            {paper.topics?.slice(0, 1).map((topic, i) => (
                                <Badge key={`topic-${i}`} variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100 transition-colors">
                                    <Globe className="h-3 w-3 mr-1" />
                                    {topic.display_name}
                                </Badge>
                            ))}
                        </div>
                    )}

                    {paper.abstract && (
                        <div className="bg-secondary p-3 border-l-4 border-slate-300">
                            <p className="text-sm text-secondary-foreground leading-relaxed">
                                {paper.abstract.length > 150
                                    ? paper.abstract.slice(0, 150) + "..."
                                    : paper.abstract}
                            </p>
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex flex-col md:flex-row md:justify-between items-start md:items-center pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                        {paper.cited_by_count !== undefined && (
                            <Badge variant="default" className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors">
                                <Quote className="h-3 w-3 mr-1" />
                                {paper.cited_by_count} citations
                            </Badge>
                        )}
                        {paper.open_access?.is_oa && (
                            <Badge className="bg-green-100 text-green-700">
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
                                className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
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
                        {paper.open_access?.oa_url && (
                            <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                className="hover:bg-green-50 hover:text-green-700 transition-colors"
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
                        )}
                    </div>
                </CardFooter>
            </Card>

            {/* ==== Sheet Implementation ==== */}
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetContent
                    side="right" // Or "left", "top", "bottom"
                    className="w-full md:w-3/4 lg:w-1/2 xl:max-w-2xl p-6 h-full overflow-y-auto"
                >
                    <SheetHeader className="mb-6">
                        <SheetTitle className="text-xl leading-tight pr-8">
                            {paper.title}
                        </SheetTitle>
                        <SheetDescription className="flex items-start flex-col gap-4 text-base pt-2">
                            <div className="flex items-center gap-2">
                                <span className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4" />
                                    {paper.publication_date}
                                </span>
                                {paper.publication_year && (
                                    <Badge variant="outline">
                                        {paper.publication_year}
                                    </Badge>
                                )}
                            </div>
                            {/* Links */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                {paper.doi && (
                                    <Button
                                        variant={"outline"}
                                        asChild>
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
                                    <Button variant="default" asChild>
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
                                )}
                            </div>
                        </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6">
                        {/* Abstract */}
                        {paper.abstract && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3">Abstract</h3>
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 border-l-4 border-slate-300">
                                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                                        {paper.abstract}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Authors Section */}
                        {hasAuthors && (
                            <div>
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                                    <Users className="h-5 w-5 text-emerald-500" />
                                    Authors ({numAuthors})
                                </h3>
                                <div className="grid gap-2">
                                    {paper.authorships?.map((authorship, index) => (
                                        <div key={index} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <div>
                                                {authorship.author?.orcid ? (
                                                    <a
                                                        href={authorship.author.orcid}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
                                                    >
                                                        {authorship.author.display_name}
                                                    </a>
                                                ) : (
                                                    <span className="font-medium">
                                                        {authorship.author?.display_name || "Unknown Author"}
                                                    </span>
                                                )}
                                                {authorship.institutions && authorship.institutions.length > 0 && (
                                                    <div className="text-sm text-slate-600 mt-1">
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
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                                    <Building2 className="h-5 w-5 text-purple-500" />
                                    Institutions ({institutions.length})
                                </h3>
                                <div className="grid gap-2">
                                    {institutions.map(institution => (
                                        <div key={institution.id} className="p-2 bg-slate-50 dark:bg-slate-900 rounded-lg">
                                            <a
                                                href={institution.ror}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium text-purple-600 dark:text-purple-400 hover:underline"
                                            >
                                                {institution.display_name}
                                            </a>
                                            <div className="text-sm text-slate-600 mt-1">
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
                                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                                    <Tag className="h-5 w-5 text-blue-500" />
                                    Keywords & Topics
                                </h3>
                                <div className="space-y-3">
                                    {paper.keywords && paper.keywords.length > 0 && (
                                        <div>
                                            <h4 className="font-medium text-sm text-slate-600 dark:text-slate-400 mb-2">Keywords:</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {paper.keywords.map((keyword, i) => (
                                                    <Badge key={i} variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
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
                                                    <div key={i} className="p-2 bg-slate-50 rounded-lg dark:bg-slate-900">
                                                        <div className="font-medium text-amber-600 dark:text-amber-400">
                                                            {topic.display_name}
                                                            {topic.score && (
                                                                <span className="ml-2 text-xs opacity-70">
                                                                    Score: {topic.score.toFixed(2)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-amber-700 mt-1 dark:text-amber-300">
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
                            <h3 className="font-semibold text-lg mb-3">Publication Details</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {paper.cited_by_count !== undefined && (
                                    <div className="bg-slate-50 p-3 rounded-lg dark:bg-slate-900">
                                        <div className="font-medium text-slate-600 dark:text-slate-300">Citations</div>
                                        <div className="text-lg font-semibold text-indigo-600 dark:text-indigo-400">
                                            {paper.cited_by_count}
                                        </div>
                                    </div>
                                )}
                                {paper.open_access && (
                                    <div className="bg-slate-50 p-3 rounded-lg dark:bg-slate-900">
                                        <div className="font-medium text-slate-600 dark:text-slate-300">Open Access Status</div>
                                        <Badge className={`mt-1 ${paper.open_access.is_oa ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                                            {paper.open_access.oa_status}
                                        </Badge>
                                    </div>
                                )}
                            </div>
                        </div>
                        <SheetFooter className="mt-6">
                            {/* Links again */}
                            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t mt-4">
                                {paper.doi && (
                                    <Button
                                        variant={"outline"}
                                        asChild>
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
                                    <Button variant="default" asChild>
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
                                )}
                            </div>
                            <SheetClose asChild>
                                <Button variant="outline" className="w-fit">Close</Button>
                            </SheetClose>
                        </SheetFooter>
                    </div>
                </SheetContent>
            </Sheet >
        </>
    );
}
