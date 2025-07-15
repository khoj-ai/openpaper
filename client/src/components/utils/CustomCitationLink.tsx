import { Citation, ReferenceCitation } from "@/lib/schema";
import { HTMLAttributes, ReactNode, createElement, Children } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

// Interface for the CustomCitationLink component props
interface CustomCitationLinkProps extends HTMLAttributes<HTMLElement> {
    children?: ReactNode;
    handleCitationClick: (key: string, messageIndex: number) => void;
    messageIndex: number;
    node?: {
        tagName?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        properties?: Record<string, any>;
    };
    className?: string;
    citations?: (Citation | ReferenceCitation)[];
}

interface CitationLinkProps {
    citationKey: string;
    messageIndex: number;
    handleCitationClick: (key: string, messageIndex: number) => void;
    citations?: (Citation | ReferenceCitation)[];
}

function CitationLink({
    citationKey,
    messageIndex,
    handleCitationClick,
    citations,
}: CitationLinkProps) {
    const matchingCitation = citations?.find(citation => 'key' in citation ? String(citation.key) === citationKey : String(citation.index) === citationKey) || null;

    const onClickCitation = (e: React.MouseEvent) => {
        e.preventDefault();
        if (handleCitationClick) {
            handleCitationClick(citationKey, messageIndex);
        }
    };

    // If no matching citation, render without hovercard but keep click functionality
    if (!matchingCitation) {
        return (
            <span
                className="bg-secondary text-secondary-foreground rounded px-1 cursor-pointer"
                onClick={onClickCitation}
            >
                {citationKey}
            </span>
        );
    }

    return (
        <HoverCard
            openDelay={100}
            closeDelay={100}
        >
            <HoverCardTrigger asChild>
                <span
                    className="bg-secondary text-secondary-foreground rounded px-1 cursor-pointer"
                    onClick={onClickCitation}
                >
                    {citationKey}
                </span>
            </HoverCardTrigger>
            <HoverCardContent className="w-80 p-2 shadow-md bg-accent">
                <p className="text-sm text-accent-foreground">{'reference' in matchingCitation ? matchingCitation.reference : matchingCitation.text}</p>
            </HoverCardContent>
        </HoverCard>
    );
};
export default function CustomCitationLink({ children, handleCitationClick, messageIndex, className, ...props }: CustomCitationLinkProps) {
    // Create a clone of props to avoid mutating the original
    const elementProps = {
        ...props,
        className: `${className || ''}`
    };

    return createElement(
        // Use the original component type from props
        props.node?.tagName || 'span',
        elementProps,
        Children.map(children, (child) => {
            // If the child is a string, process it for citations
            if (typeof child === 'string') {
                // Updated regex to match both single citations [^1] and multiple citations [^10, ^14]
                const citationRegex = /\[\^(\d+(?:[a-zA-Z]*)?(?:,\s*\^?\d+(?:[a-zA-Z]*)?)*)\]/g;

                if (citationRegex.test(child)) {
                    // Reset regex state
                    citationRegex.lastIndex = 0;
                    // Create a React element array from the string with replaced citations
                    const parts: React.ReactNode[] = [];
                    let lastIndex = 0;
                    let match: RegExpExecArray | null = null;

                    while ((match = citationRegex.exec(child)) !== null) {

                        if (!match || match.index === undefined) {
                            console.warn('Invalid match found in citation regex:', match);
                            continue; // Skip invalid matches
                        }

                        // Add text before the citation
                        if (match.index > lastIndex) {
                            parts.push(child.substring(lastIndex, match.index));
                        }

                        // Parse multiple citations from the match
                        const citationsStr = match[1];
                        const individualCitations = citationsStr.split(',').map(c => c.trim().replace(/^\^?/, ''));

                        // Create a container for multiple citations
                        parts.push(
                            <span key={`citations-${match.index}`} className="inline-flex gap-1">
                                {individualCitations.map((citationKey, index) => (
                                    <CitationLink
                                        key={`citation-${citationKey}-${index}`}
                                        citationKey={citationKey}
                                        messageIndex={messageIndex}
                                        handleCitationClick={handleCitationClick}
                                        citations={props.citations}
                                    />
                                ))}
                            </span>
                        );

                        // Update lastIndex to continue after current match
                        lastIndex = match.index + match[0].length;
                    }

                    // Add remaining text
                    if (lastIndex < child.length) {
                        parts.push(child.substring(lastIndex));
                    }

                    return <>{parts}</>;
                }
                return child;
            }
            return child;
        })
    );
};
