import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Github, Lightbulb, Search, Sparkles } from "lucide-react";
import Link from "next/link";

interface ExampleBadgeProps {
    children: React.ReactNode
    onClick?: () => void
}

function ExampleBadge({ children, onClick }: ExampleBadgeProps) {
    return (
        <Badge
            variant="secondary"
            className="font-normal text-xs py-1.5 px-3 hover:bg-secondary/80 cursor-pointer transition-colors"
            onClick={onClick}
        >
            {children}
        </Badge>
    )
}

interface HelperCardProps {
    onExampleClick: (example: string) => void
}

export default function HelperCard({ onExampleClick }: HelperCardProps) {
    return (
        <Card className="bg-gradient-to-br from-card to-card/50 border-border/50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-4">
                <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-primary/20 to-primary/10 p-4 rounded-2xl">
                        <Search className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
                            Paper Finder
                            <Sparkles className="h-5 w-5 text-primary" />
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">Discover academic research with ease</p>
                </div>
            </div>
        </CardHeader>

        <CardContent className="space-y-6">
            {/* Main Description */}
            <div className="space-y-3">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Discover academic papers by title or research topic. We tap into a vast public database to bring you
                    relevant research in your field of interest.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Many papers are available via open access. For others, a DOI is provided to link you directly to the source,
                    which may require institutional credentials.
                </p>
            </div>

            <Separator />

            {/* Examples Section */}
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Try these examples</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                    <ExampleBadge onClick={() => onExampleClick("Attention is All You Need")}>
                        Attention is All You Need
                    </ExampleBadge>
                    <ExampleBadge onClick={() => onExampleClick("large language models")}>
                        large language models
                    </ExampleBadge>
                    <ExampleBadge onClick={() => onExampleClick("climate change impact")}>
                        climate change impact
                    </ExampleBadge>
                    <ExampleBadge onClick={() => onExampleClick("University of Illinois")}>
                        University of Illinois
                    </ExampleBadge>
                </div>
            </div>

            <Separator />

            {/* Tips Section */}
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-primary">
                        <Lightbulb className="h-4 w-4 text-amber-500" />
                    </span>
                    Pro Tips
                </h3>
                <ul className="text-xs text-muted-foreground space-y-1">
                    <li>Filter results by specific authors or institutions using autocomplete</li>
                    <li>Combine multiple keywords for more precise results</li>
                    <li>Click on results to see more details</li>
                </ul>
            </div>

            {/* Footer Section */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">Powered by</span>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                        <Link href="https://openalex.org" className="flex items-center gap-1">
                            OpenAlex
                            <ExternalLink className="h-3 w-3" />
                        </Link>
                    </Button>
                </div>

                <Button variant="outline" size="sm" className="text-xs" asChild>
                    <Link href="https://github.com/sabaimran/openpaper/issues" className="flex items-center gap-2">
                        <Github className="h-3 w-3" />
                        Feedback & Issues
                    </Link>
                </Button>
            </div>
        </CardContent>
    </Card>
    );
}
