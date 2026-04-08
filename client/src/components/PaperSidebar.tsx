import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { CitePaperButton } from '@/components/CitePaperButton';
import { LucideIcon } from 'lucide-react';

interface PaperSidebarProps {
    rightSideFunction: string;
    setRightSideFunction: (value: string) => void;
    PaperToolset: {
        nav: {
            name: string;
            icon: LucideIcon;
        }[];
    };
}

export function PaperSidebar({ rightSideFunction, setRightSideFunction, PaperToolset }: PaperSidebarProps) {
    return (
        <TooltipProvider>
            <div className="absolute right-2 top-14 z-20 flex flex-col gap-1 p-1.5 bg-background/95 backdrop-blur-sm border border-border rounded-xl shadow-md">
                {PaperToolset.nav.map((item) => (
                    <Tooltip key={item.name}>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                className={`h-10 w-10 p-0 rounded-lg ${
                                    item.name === rightSideFunction
                                        ? 'bg-blue-500 dark:bg-blue-500 text-blue-100 dark:text-blue-100 hover:bg-blue-600 dark:hover:bg-blue-600'
                                        : 'text-secondary-foreground hover:bg-blue-100 dark:hover:bg-blue-800'
                                }`}
                                onClick={() => setRightSideFunction(item.name)}
                            >
                                <item.icon className="h-5 w-5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left" sideOffset={8}>
                            {item.name}
                        </TooltipContent>
                    </Tooltip>
                ))}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div>
                            <CitePaperButton iconOnly />
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" sideOffset={8}>
                        Cite
                    </TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
}
