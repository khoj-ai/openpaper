'use client';

import { fetchFromApi } from '@/lib/api';
import { OpenAlexMatchResponse, OpenAlexPaper, OpenAlexResponse } from '@/lib/schema';
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

interface GraphOverviewProps {
    paper_id: string;
    paper_title?: string;
}

export default function GraphOverview({ paper_id, paper_title }: GraphOverviewProps) {
    const [perPage, setPerPage] = useState(25);
    const [results, setResults] = useState<OpenAlexResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [matchedPaper, setMatchedPaper] = useState<OpenAlexPaper | null>(null);
    const [cites, setCites] = useState<OpenAlexResponse | null>(null);
    const [citedBy, setCitedBy] = useState<OpenAlexResponse | null>(null);

    const handleSearch = async () => {
        if (!paper_title) return;

        setResults(null);
        setLoading(true);
        setError(null);
        setMatchedPaper(null); // Clear any previous match

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

    const handleMatch = async (matchedPaper: OpenAlexPaper) => {
        if (!matchedPaper) return;
        setMatchedPaper(matchedPaper);
        setResults(null); // Clear results after matching
        setError(null); // Clear any previous error
        setLoading(true);
        try {
            const response: OpenAlexMatchResponse = await fetchFromApi(
                `/api/paper_search/match?open_alex_id=${matchedPaper.id}`,
                {
                    method: "POST",
                }
            );

            setCites(response.cites);
            setCitedBy(response.cited_by);

            // Handle the response if needed
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
        await handleMatch(paper);
    };

    const getViewPaperLink = (paper: OpenAlexPaper) => {
        if (paper.doi) {
            return `https://doi.org/${paper.doi}`;
        }
        return paper.id; // Fallback to OpenAlex ID
    };

    const handlePaperClick = (paper: OpenAlexPaper) => {
        const link = getViewPaperLink(paper);
        window.open(link, '_blank', 'noopener,noreferrer');
    };
    const PaperNode = ({ paper, type, isCenter = false }: {
        paper: OpenAlexPaper;
        type: 'cites' | 'cited_by' | 'center';
        isCenter?: boolean;
    }) => (
        <div
            className={`
            relative border rounded-lg p-3 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md
            h-40 overflow-hidden
            ${isCenter
                    ? 'bg-blue-50 border-blue-300 shadow-md hover:bg-blue-100'
                    : type === 'cites'
                        ? 'bg-red-50 border-red-200 hover:border-red-400 hover:bg-red-100'
                        : 'bg-green-50 border-green-200 hover:border-green-400 hover:bg-green-100'
                }
        `}
            onClick={() => handlePaperClick(paper)}
        >
            <div className="flex items-start justify-between h-full">
                <div className="flex-1 min-w-0 flex flex-col h-full">
                    <h4 className={`font-medium text-sm mb-2 line-clamp-2 ${isCenter ? 'text-blue-800' :
                        type === 'cites' ? 'text-red-700' : 'text-green-700'
                        }`}>
                        {paper.title}
                    </h4>

                    <div className="space-y-1 flex-1 overflow-hidden">
                        <p className="text-xs text-gray-600 line-clamp-2">
                            <strong>Authors:</strong> {paper.authorships
                                ?.map(authorship => authorship?.author?.display_name)
                                .join(', ') || 'N/A'}
                        </p>

                        <p className="text-xs text-gray-600 line-clamp-2">
                            <strong>Institutions:</strong> {paper.authorships
                                ?.flatMap(authorship =>
                                    authorship.institutions?.map(inst => inst.display_name) || []
                                )
                                .filter((inst, index, arr) => arr.indexOf(inst) === index)
                                .join(', ') || 'N/A'}
                        </p>

                        {paper.publication_year && (
                            <p className="text-xs text-gray-500">
                                <strong>Year:</strong> {paper.publication_year}
                            </p>
                        )}
                    </div>
                </div>

                <div className="ml-2 flex flex-col items-center justify-start">
                    {!isCenter && (
                        <div className={`text-xs px-2 py-1 rounded-full ${type === 'cites'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                            }`}>
                            {type === 'cites' ? 'Cites' : 'Cited by'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex flex-col items-center justify-center p-4 max-w-6xl mx-auto">
            <h2 className="text-lg font-semibold mb-2">Graph Overview</h2>
            {/* Search Section */}
            {
                !matchedPaper && (
                    <div className="mt-6 w-full">
                        <Button
                            onClick={handleSearch}
                            disabled={!paper_title || loading}
                            className="bg-blue-500 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded"
                        >
                            {loading ? 'Searching...' : 'Search for Paper'}
                        </Button>
                    </div>
                )
            }

            {/* Error Display */}
            {error && (
                <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded w-full">
                    {error}
                </div>
            )}

            {/* Citation Graph */}
            {matchedPaper && (cites || citedBy) && (
                <div className="mt-8 w-full">
                    {/* Graph Layout */}
                    <div className="flex flex-col items-center space-y-8">

                        {/* Papers that cite this work */}
                        {citedBy && citedBy.results && citedBy.results.length > 0 && (
                            <div className="w-full">
                                <h4 className="text-lg font-medium mb-4 text-center text-green-700">
                                    Papers citing this work ({citedBy.meta.count})
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {citedBy.results.map((paper: OpenAlexPaper) => (
                                        <PaperNode key={paper.id} paper={paper} type="cited_by" />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Center Paper */}
                        <div className="flex justify-center">
                            <div className="max-w-md">
                                <h4 className="text-lg font-medium mb-2 text-center text-blue-700">
                                    Matched Paper
                                </h4>
                                <PaperNode paper={matchedPaper} type="center" isCenter={true} />
                            </div>
                        </div>

                        {/* Papers this work cites */}
                        {cites && cites.results && cites.results.length > 0 && (
                            <div className="w-full">
                                <h4 className="text-lg font-medium mb-4 text-center text-red-700">
                                    Papers cited by this work ({cites.meta.count})
                                </h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {cites.results.map((paper: OpenAlexPaper) => (
                                        <PaperNode key={paper.id} paper={paper} type="cites" />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Legend */}
                    <div className="mt-8 flex justify-center">
                        <div className="flex space-x-6 text-sm">
                            <div className="flex items-center">
                                <div className="w-3 h-3 bg-green-200 border border-green-300 rounded mr-2"></div>
                                Papers citing this work
                            </div>
                            <div className="flex items-center">
                                <div className="w-3 h-3 bg-blue-200 border border-blue-300 rounded mr-2"></div>
                                Matched paper
                            </div>
                            <div className="flex items-center">
                                <div className="w-3 h-3 bg-red-200 border border-red-300 rounded mr-2"></div>
                                Papers cited by this work
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Results Display */}
            {results && results.results && results.results.length > 0 && (
                <div className="mt-6 w-full">
                    <h3 className="text-lg font-semibold mb-4">Search Results ({results.meta.count} found)</h3>
                    <div className="space-y-4">
                        {results.results.map((paper: OpenAlexPaper, index: number) => (
                            <div key={paper.id} className="border border-gray-300 rounded-lg p-4 bg-white shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div className="flex-1">
                                        <h4 className="font-semibold text-blue-600 mb-2">
                                            <a
                                                href={getViewPaperLink(paper)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="hover:underline"
                                            >
                                                {paper.title}
                                            </a>
                                        </h4>

                                        <p className="text-sm text-gray-700 mb-1">
                                            <strong>Authors:</strong> {
                                                paper.authorships
                                                    ?.map(authorship => authorship?.author?.display_name)
                                                    .join(', ') || 'N/A'
                                            }
                                        </p>

                                        <p className="text-sm text-gray-700 mb-1">
                                            <strong>Institutions:</strong> {
                                                paper.authorships
                                                    ?.flatMap(authorship =>
                                                        authorship.institutions?.map(inst => inst.display_name) || []
                                                    )
                                                    .filter((inst, index, arr) => arr.indexOf(inst) === index)
                                                    .join(', ') || 'N/A'
                                            }
                                        </p>

                                        <div className="flex gap-4 text-sm text-gray-600">
                                            {paper.publication_year && (
                                                <span><strong>Year:</strong> {paper.publication_year}</span>
                                            )}
                                        </div>

                                        {paper.doi && (
                                            <div className="mt-2">
                                                <Button variant={'outline'}>
                                                    <a
                                                        href={`https://doi.org/${paper.doi}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-500 hover:underline"
                                                    >
                                                        View Paper
                                                    </a>
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    <Button
                                        onClick={() => handleMarkAsMatch(paper)}
                                        className={`ml-4 px-3 py-1 rounded text-sm font-medium ${matchedPaper?.id === paper.id
                                            ? 'bg-green-500 text-white'
                                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                            }`}
                                    >
                                        {matchedPaper?.id === paper.id ? 'Matched ✓' : 'Mark as Match'}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* No Results */}
            {results && results.results && results.results.length === 0 && (
                <div className="mt-6 p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded w-full">
                    No papers found for the given title.
                </div>
            )}
        </div>
    );
}
