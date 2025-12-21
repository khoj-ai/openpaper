import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@/components/ui/collapsible";


import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PaperData } from "@/lib/schema";
import { isDateValid } from "@/lib/utils";

interface IPaperMetadata {
    paperData: PaperData;
}

const googleScholarUrl = (searchTerm: string) => {
    return `https://scholar.google.com/scholar?q=${encodeURIComponent(searchTerm)}`;
}

// Set default for readonly to false
function PaperMetadata({ paperData }: IPaperMetadata) {
    const [isOpen, setIsOpen] = useState(false);

    const showAccordion = paperData.authors?.length > 0 || paperData.institutions?.length > 0;

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
            className="border-b-2 border-secondary"
        >
            <div className="p-2">
                <CollapsibleTrigger className="flex flex-row w-full items-center justify-between">
                    <h2 className={`text-xl font-bold text-left ${isOpen ? '' : 'line-clamp-1'}`}>{paperData.title}</h2>
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
                    {/* Conditional rendering for Tabs vs direct Metadata */}
                    <div className="pt-4">
                        {renderMetadataContent()}
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible >
    );
}

export default PaperMetadata;
