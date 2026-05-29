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

interface CitationArtifactCardProps {
    artifact: CitationArtifact;
}

export function CitationArtifactCard({ artifact }: CitationArtifactCardProps) {
    const defaultName =
        STYLE_KEY_TO_NAME[artifact.preferred_style] ?? 'APA 7th Edition';
    const [selectedStyle, setSelectedStyle] = useState<string>(defaultName);
    const [copied, setCopied] = useState(false);

    const d = artifact.data;
    // The client generators key the year off `created_at`; feed publish_date there.
    const paperBase: PaperBase = {
        id: d.paper_id,
        title: d.title || '',
        authors: d.authors || [],
        created_at: d.publish_date,
        journal: d.journal,
        publisher: d.publisher,
        doi: d.doi,
    };

    const styleObj =
        citationStyles.find((s) => s.name === selectedStyle) ?? citationStyles[0];
    const citation = styleObj.generator(paperBase);

    return (
        <div className="not-prose my-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                    Citation
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
                            copyToClipboard(citation, selectedStyle);
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
                                Copy
                            </>
                        )}
                    </Button>
                </div>
            </div>

            <div className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap">
                {citation}
            </div>

            {artifact.missing_fields?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                    Some details couldn&apos;t be found ({artifact.missing_fields.join(', ')});
                    this citation may be incomplete.
                </p>
            )}
        </div>
    );
}
