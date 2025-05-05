import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaperData } from "@/lib/schema";
import { isDateValid } from "@/lib/utils";

interface IPaperMetadata {
    paperData: PaperData;
    // Make onClickStarterQuestion optional as it's not used in readonly mode
    onClickStarterQuestion?: (question: string) => void;
    hasMessages: boolean;
    readonly?: boolean; // Add readonly prop
}

const googleScholarUrl = (searchTerm: string) => {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(searchTerm)}`;
}

// Set default for readonly to false
function PaperMetadata({ paperData, onClickStarterQuestion, hasMessages, readonly = false }: IPaperMetadata) {
    const [isOpen, setIsOpen] = useState(!hasMessages);
    const [showFullSummary, setShowFullSummary] = useState(false);

    const showAccordion = paperData.authors?.length > 0 || paperData.institutions?.length > 0;

    useEffect(() => {
        // Only collapse automatically if not in readonly mode and messages exist
        if (!readonly) {
            setIsOpen(!hasMessages);
        } else {
            // In readonly mode, default to open unless explicitly closed by user
            setIsOpen(true);
        }
    }, [hasMessages, readonly]);

    // Function to render metadata content (used in both modes)
    const renderMetadataContent = () => (
        showAccordion ? (
            <Accordion type="single" collapsible className='text-sm'>
                {paperData.authors && paperData.authors.length > 0 && (
                    <AccordionItem value="item-1">
                        <AccordionTrigger className="flex justify-between items-center">
                            Authors
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="flex gap-2 flex-wrap">
                                {paperData.authors.map((author, i) => (
                                    <a
                                        key={i}
                                        href={googleScholarUrl(author)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:underline mr-2"
                                    >
                                        {author}
                                    </a>
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )}
                {paperData.institutions && paperData.institutions.length > 0 && (
                    <AccordionItem value="item-2">
                        <AccordionTrigger className="flex justify-between items-center">
                            Institutions
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="flex gap-2 flex-wrap">
                                {paperData.institutions.map((institution, i) => (
                                    <a
                                        key={i}
                                        href={googleScholarUrl(institution)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-500 hover:underline mr-2"
                                    >
                                        {institution}
                                    </a>
                                ))}
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                )}
            </Accordion>
        ) : <p className="text-sm text-muted-foreground">No additional metadata available.</p>
    );

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={setIsOpen}
            className="mb-4 border-b-2 border-secondary"
        >
            <div className="p-2">
                <CollapsibleTrigger className="flex flex-row w-full items-center justify-between">
                    <h2 className="text-xl font-bold">{paperData.title}</h2>
                    <div className="text-secondary-foreground text-xs flex items-center gap-2 bg-secondary p-1 rounded-md">
                        {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                </CollapsibleTrigger>
            </div>

            <CollapsibleContent>
                <div className="px-4 pb-4 space-y-4">
                    {
                        paperData.publish_date && isDateValid(paperData.publish_date) && (
                            <div className='text-secondary-foreground text-xs w-fit p-1 rounded-lg bg-secondary'>
                                {new Date(paperData.publish_date).toLocaleDateString()}
                            </div>
                        )
                    }
                    {
                        paperData.summary && (
                            <div
                                className={`text-xs font-normal max-w-full whitespace-normal h-auto text-left justify-start break-words hover:bg-secondary/50 ${showFullSummary ? 'cursor-default' : 'cursor-pointer line-clamp-3'}`}
                                onClick={() => {
                                    setShowFullSummary(!showFullSummary);
                                }}
                            >
                                {paperData.summary}
                            </div>
                        )
                    }

                    {/* Conditional rendering for Tabs vs direct Metadata */}
                    {readonly ? (
                        // Readonly mode: Only show metadata section
                        <div className="pt-4">
                            {renderMetadataContent()}
                        </div>
                    ) : (
                        // Normal mode: Show Tabs
                        <Tabs defaultValue="questions" className="w-full">
                            <TabsList>
                                <TabsTrigger value="questions">Suggested Questions</TabsTrigger>
                                <TabsTrigger value="metadata">Metadata</TabsTrigger>
                            </TabsList>
                            <TabsContent value="questions">
                                {paperData.starter_questions && paperData.starter_questions.length > 0 ? (
                                    <div className="flex gap-2 flex-wrap">
                                        {paperData.starter_questions.slice(0, 5).map((question, i) => (
                                            <Button
                                                key={i}
                                                variant="outline"
                                                className="text-xs font-medium p-2 max-w-full whitespace-normal h-auto text-left justify-start break-words bg-secondary text-secondary-foreground hover:bg-secondary/50"
                                                onClick={() => {
                                                    // Check if onClickStarterQuestion exists before calling
                                                    onClickStarterQuestion?.(question);
                                                    setIsOpen(false);
                                                }}
                                            >
                                                {question}
                                            </Button>
                                        ))}
                                    </div>
                                ) : <p className="text-sm text-muted-foreground">No suggested questions available.</p>}
                            </TabsContent>
                            <TabsContent value="metadata">
                                {renderMetadataContent()}
                            </TabsContent>
                        </Tabs>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible >
    );
}

export default PaperMetadata;
