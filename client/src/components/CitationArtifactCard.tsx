"use client";

import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { citationStyles, copyToClipboard, PaperBase } from '@/components/utils/paperUtils';
import { CitationArtifact } from '@/lib/schema';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

// Map the server's canonical style keys to the client's citationStyles names.
const STYLE_KEY_TO_NAME: Record<string, string> = {
    MLA: 'MLA 9th Edition',
    HARVARD: 'Harvard',
    AAA: 'AAA',
    IEEE: 'IEEE',
    AMA: 'AMA 11th Edition',
    CHICAGO: 'Chicago 17th (Author-Date)',
    APA: 'APA 7th Edition',
    BIBTEX: 'BibTeX',
};

// What bibliographic fields the agent couldn't find for this artifact. Derived
// from the data (null = the agent attempted and came up empty), so DOI/venue/
// date gaps are surfaced even when they don't affect the style-required render.
function computeMissingFields(a: CitationArtifact): string[] {
    const d = a.data;
    const missing: string[] = [];
    if (!d.publish_date) missing.push('publication date');
    if (!d.journal && !d.publisher) missing.push('publication venue');
    if (!d.doi) missing.push('DOI');
    return missing;
}

function artifactToPaperBase(a: CitationArtifact): PaperBase {
    const d = a.data;
    // The client generators key the year off `created_at`; feed publish_date there.
    return {
        id: d.paper_id,
        title: d.title || '',
        authors: d.authors || [],
        created_at: d.publish_date,
        journal: d.journal,
        publisher: d.publisher,
        doi: d.doi,
    };
}

// Pick the most common preferred_style across the bundled artifacts as the
// initial selection (falls back to APA when unknown).
function consensusStyleName(artifacts: CitationArtifact[]): string {
    const counts: Record<string, number> = {};
    for (const a of artifacts) {
        counts[a.preferred_style] = (counts[a.preferred_style] ?? 0) + 1;
    }
    const sorted = Object.entries(counts).sort((x, y) => y[1] - x[1]);
    const winner = sorted[0]?.[0];
    return STYLE_KEY_TO_NAME[winner ?? ''] ?? 'APA 7th Edition';
}

interface CitationArtifactCardProps {
    artifacts: CitationArtifact[];
}

export function CitationArtifactCard({ artifacts }: CitationArtifactCardProps) {
    const [selectedStyle, setSelectedStyle] = useState<string>(() =>
        consensusStyleName(artifacts),
    );
    const [copied, setCopied] = useState(false);

    if (!artifacts || artifacts.length === 0) return null;

    const styleObj =
        citationStyles.find((s) => s.name === selectedStyle) ?? citationStyles[0];

    const entries = artifacts.map((a, i) => {
        const text = styleObj.generator(artifactToPaperBase(a));
        // Mirror CitePaperButton's IEEE bibliography convention.
        const display =
            selectedStyle === 'IEEE' && artifacts.length > 1
                ? `[${i + 1}] ${text}`
                : text;
        return { artifact: a, display, missing: computeMissingFields(a) };
    });

    const isBibliography = artifacts.length > 1;
    const headerLabel = isBibliography ? `Citations (${artifacts.length})` : 'Citation';
    const copyAllText = entries.map((e) => e.display).join('\n\n');
    const copyButtonLabel = isBibliography ? 'Copy all' : 'Copy';

    return (
        <div className="not-prose my-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                    {headerLabel}
                </span>
                <div className="flex items-center gap-1">
                    <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                        <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                            <SelectValue placeholder="Citation style" />
                        </SelectTrigger>
                        <SelectContent>
                            {citationStyles.map((style) => (
                                <SelectItem key={style.name} value={style.name}>
                                    {style.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => {
                            copyToClipboard(copyAllText, selectedStyle);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        }}
                    >
                        {copied ? (
                            <>
                                <Check className="h-3.5 w-3.5 mr-1.5" />
                                Copied
                            </>
                        ) : (
                            <>
                                <Copy className="h-3.5 w-3.5 mr-1.5" />
                                {copyButtonLabel}
                            </>
                        )}
                    </Button>
                </div>
            </div>

            <div className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap space-y-3">
                {entries.map((e, i) => (
                    <div key={i}>
                        <div>{e.display}</div>
                        {e.missing.length > 0 && (
                            <p className="mt-1 italic text-muted-foreground">
                                Couldn&apos;t find: {e.missing.join(', ')}
                            </p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
