'use client';

import { fetchFromApi } from '@/lib/api';
import { OpenAlexMatchResponse, OpenAlexPaper, OpenAlexResponse } from '@/lib/schema';
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import CitationGraph from './CitationGraph';
import { Check, X, Search, BookOpen, Users, Building, Calendar, ExternalLink } from 'lucide-react';
import LoadingIndicator from './utils/Loading';
import { toast } from "sonner";

interface GraphOverviewProps {
    paper_title?: string;
}

export default function GraphOverview({ paper_title }: GraphOverviewProps) {
    const [perPage, setPerPage] = useState(25);
    const [results, setResults] = useState<OpenAlexResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [matchedPaper, setMatchedPaper] = useState<OpenAlexPaper | null>(null);
    const [matchResponse, setMatchResponse] = useState<OpenAlexMatchResponse | null>(null);
    const [dismissedPapers, setDismissedPapers] = useState<Set<string>>(new Set());
    const [noMatchSelected, setNoMatchSelected] = useState(false);

    const handleSearch = async () => {
        if (!paper_title) return;

        setResults(null);
        setLoading(true);
        setError(null);
        setMatchedPaper(null);
        setDismissedPapers(new Set());
        setNoMatchSelected(false);

        try {
            const response: OpenAlexResponse = await fetchFromApi(
                `/api/paper_search/search?query=${encodeURIComponent(paper_title)}&page=${1}&per_page=${perPage}`,
                {
                    method: "POST",
                }
            );

            setResults(response);
            setPerPage(response.meta.per_page);
        } catch (error) {
            console.error("Search failed:", error);
            setError("Failed to fetch results. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    // Auto-trigger search when component mounts or paper_title changes
    useEffect(() => {
        if (paper_title) {
            handleSearch();
        }
    }, [paper_title]);

    const handleMatch = async (matchedPaper: OpenAlexPaper) => {
        if (!matchedPaper) return;
        setMatchedPaper(matchedPaper);
        setResults(null);
        setError(null);
        setLoading(true);
        try {
            const response: OpenAlexMatchResponse = await fetchFromApi(
                `/api/paper_search/match?open_alex_id=${matchedPaper.id}`,
                {
                    method: "POST",
                }
            );

            setMatchResponse(response);
            console.log("Match response:", response);
        } catch (error) {
            console.error("Match failed:", error);
            setError("Failed to match paper. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const handleMarkAsMatch = async (paper: OpenAlexPaper) => {
        setMatchedPaper(paper);
        toast.success("Paper matched successfully!", {
            description: "You can now explore the citation graph. Drag nodes to explore • Click to select • Scroll to zoom • Hover to highlight connections",
            duration: 5000,
            icon: <Check className="w-4 h-4" />,
        });
        await handleMatch(paper);
    };

    const handleDismissPaper = (paperId: string) => {
        setDismissedPapers(prev => new Set([...prev, paperId]));
    };

    const handleNoMatch = () => {
        setNoMatchSelected(true);
        setResults(null);
        setMatchedPaper(null);
    };

    const getViewPaperLink = (paper: OpenAlexPaper) => {
        if (paper.doi) {
            return `https://doi.org/${paper.doi}`;
        }
        return paper.id;
    };

    const filteredResults = results?.results?.slice(0, 5).filter(paper => !dismissedPapers.has(paper.id)) || [];

    return (
        <div className="flex flex-col items-center justify-center p-0 mx-auto">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold mb-2 text-gray-900 dark:text-gray-100">Graph Overview</h2>

                {!matchedPaper && !noMatchSelected && !loading && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-center mb-2">
                            <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-2" />
                            <h3 className="font-semibold text-blue-800 dark:text-blue-200">Find Your Paper Match</h3>
                        </div>
                        <ol className="text-sm text-blue-700 dark:text-blue-300 items-start list-inside text-start">
                            <li className='list-decimal ml-5'>Review the potential matches below and select the correct match.</li>
                            <li className='list-decimal ml-5'>Use the ✓ button to confirm a match or ✗ to dismiss papers that don&apos;t match.</li>
                            <li className='list-decimal ml-5'>Get a graph view of citations once you select a paper.</li>
                        </ol>
                    </div>
                )}

                {loading && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-center">
                            <LoadingIndicator />
                            <span className="text-blue-800 dark:text-blue-200">Searching for papers...</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Error Display */}
            {error && (
                <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg w-full">
                    <div className="flex items-center">
                        <X className="w-5 h-5 mr-2" />
                        {error}
                    </div>
                </div>
            )}

            {noMatchSelected && (
                <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-300 rounded-lg w-full">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <X className="w-5 h-5 mr-2" />
                            <span className="font-semibold">No matching paper found.</span>
                        </div>
                        <Button
                            variant="link"
                            size="sm"
                            className="border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30"
                        >
                            <a href="https://github.com/sabaimran/openpaper/issues" target="_blank" rel="noopener noreferrer" className="flex items-center">
                                <ExternalLink className="w-4 h-4 mr-2" />
                                Report Issue
                            </a>
                        </Button>
                    </div>
                </div>
            )}

            {/* Citation Graph */}
            {matchedPaper && matchResponse && (
                <div className="mt-6 w-full">
                    <CitationGraph
                        center={matchedPaper}
                        data={matchResponse}
                    />
                </div>
            )}

            {/* Results Display */}
            {results && results.results && results.results.length > 0 && (
                <div className="mt-6 w-full">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Which paper matches?
                        </h3>
                        {filteredResults.length > 0 && (
                            <Button
                                variant="outline"
                                onClick={handleNoMatch}
                                className="border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                            >
                                <X className="w-4 h-4 mr-2" />
                                None
                            </Button>
                        )}
                    </div>

                    <div className="grid gap-4">
                        {filteredResults.map((paper: OpenAlexPaper) => (
                            <div key={paper.id} className="group border border-gray-200 dark:border-gray-700 rounded-xl p-6 bg-white dark:bg-gray-800 shadow-sm hover:shadow-lg transition-all duration-300 transform hover:scale-[1.02]">
                                <div className="flex items-start">
                                    <div className="flex-1 pr-4">
                                        <h4 className="font-semibold text-lg text-blue-600 dark:text-blue-400 mb-3 group-hover:text-blue-700 dark:group-hover:text-blue-300 transition-colors">
                                            <a
                                                href={getViewPaperLink(paper)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="hover:underline flex items-center"
                                            >
                                                {paper.title}
                                                <ExternalLink className="w-4 h-4 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                                            </a>
                                        </h4>

                                        <div className="space-y-2 text-sm">
                                            <div className="flex items-start text-gray-700 dark:text-gray-300">
                                                <Users className="w-4 h-4 mr-2 mt-0.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                                                <span>
                                                    <strong>Authors:</strong>
                                                    <p className='line-clamp-2'>
                                                        {
                                                            paper.authorships
                                                                ?.map(authorship => authorship?.author?.display_name)
                                                                .join(', ') || 'N/A'
                                                        }
                                                    </p>
                                                </span>
                                            </div>

                                            <div className="flex items-start text-gray-700 dark:text-gray-300">
                                                <Building className="w-4 h-4 mr-2 mt-0.5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                                                <span>
                                                    <strong>Institutions:</strong>
                                                    <p className='line-clamp-2'>
                                                        {
                                                            paper.authorships
                                                                ?.flatMap(authorship =>
                                                                    authorship.institutions?.map(inst => inst.display_name) || []
                                                                )
                                                                .filter((inst, index, arr) => arr.indexOf(inst) === index)
                                                                .join(', ') || 'N/A'
                                                        }
                                                    </p>
                                                </span>
                                            </div>

                                            {paper.publication_year && (
                                                <div className="flex items-center text-gray-600 dark:text-gray-400">
                                                    <Calendar className="w-4 h-4 mr-2 text-gray-500 dark:text-gray-400" />
                                                    <span><strong>Year:</strong> {paper.publication_year}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-4 flex flex-row items-center justify-between">
                                            {paper.doi && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                                >
                                                    <a
                                                        href={`https://doi.org/${paper.doi}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center"
                                                    >
                                                        <ExternalLink className="w-4 h-4 mr-2" />
                                                        View Paper
                                                    </a>
                                                </Button>
                                            )}
                                            <div className="flex flex-col gap-2 mt-2 items-end">
                                                <Button
                                                    onClick={() => handleMarkAsMatch(paper)}
                                                    className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold px-4 py-2 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 w-fit"
                                                >
                                                    <Check className="w-4 h-4 mr-2" />
                                                    This is it!
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => handleDismissPaper(paper.id)}
                                                    className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-4 py-2 rounded-lg transition-all duration-200 w-fit"
                                                >
                                                    <X className="w-4 h-4 mr-2" />
                                                    Not this one
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {filteredResults.length === 0 && results.results.length > 0 && (
                        <div className="text-center p-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
                            <p className="text-gray-600 dark:text-gray-400 mb-4">
                                You&apos;ve dismissed all search results.
                            </p>
                            <Button
                                variant="outline"
                                onClick={() => setDismissedPapers(new Set())}
                                className="mr-4"
                            >
                                Show dismissed papers
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleNoMatch}
                                className="border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                            >
                                None of these match
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* No Results */}
            {results && results.results && results.results.length === 0 && (
                <div className="mt-6 p-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300 rounded-lg w-full">
                    <div className="text-center">
                        <Search className="w-8 h-8 mx-auto mb-2 text-yellow-600 dark:text-yellow-400" />
                        <h3 className="font-semibold mb-2">No papers found</h3>
                        <p className="text-sm">
                            No papers found for the given title. Try adjusting your search terms or check the spelling.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
