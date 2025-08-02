
import { useEffect, useState } from 'react';
import { fetchFromApi } from '@/lib/api';
import { Marquee } from "@/components/magicui/marquee";
import { cn } from '@/lib/utils';

const TopicCard = ({ topic }: { topic: string }) => {
    return (
        <figure
            className={cn(
                "relative h-full w-fit sm:w-36 cursor-pointer overflow-hidden rounded-xl border p-4",
                // light styles
                "border-gray-950/[.1] bg-gray-950/[.01] hover:bg-gray-950/[.05]",
                // dark styles
                "dark:border-gray-50/[.1] dark:bg-gray-50/[.10] dark:hover:bg-gray-50/[.15]",
            )}
        >
            <blockquote className="text-sm">{topic}</blockquote>
        </figure>
    );
};

export function TopicBubbles() {
    const [topics, setTopics] = useState<string[]>([]);

    useEffect(() => {
        const fetchTopics = async () => {
            try {
                const response = await fetchFromApi('/api/auth/topics');
                setTopics(response);
            } catch (error) {
                console.error("Error fetching topics:", error);
            }
        };

        fetchTopics();
    }, []);

    const firstRow = topics.slice(0, topics.length / 2);
    const secondRow = topics.slice(topics.length / 2);

    return (
        <div className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-lg bg-background py-2">
            <Marquee pauseOnHover className="[--duration:20s]">
                {firstRow.map((topic) => (
                    <TopicCard topic={topic} key={topic} />
                ))}
            </Marquee>
            <Marquee reverse pauseOnHover className="[--duration:20s]">
                {secondRow.map((topic) => (
                    <TopicCard topic={topic} key={topic} />
                ))}
            </Marquee>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background"></div>
            <div className="pointer-events-none absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-background"></div>
        </div>
    );
}
