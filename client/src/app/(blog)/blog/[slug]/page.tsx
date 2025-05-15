import { Metadata } from "next";

const convertDate = (date: string) => {
    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }
    return new Date(date).toLocaleDateString('en-US', options)
}

type Props = {
    params: Promise<{ slug: string }>
}

// Generate metadata for the page dynamically
export async function generateMetadata(
    { params }: Props,
): Promise<Metadata> {
    const { slug } = await params;
    const { metadata } = await import(`@/content/${slug}.mdx`);

    return {
        title: metadata.title,
        description: metadata.description,
        openGraph: {
            title: metadata.title,
            description: metadata.description,
            type: 'article',
            publishedTime: metadata.date,
            authors: metadata.author ? [metadata.author] : undefined,
            images: metadata.image ? [
                {
                    url: metadata.image,
                    width: 1200,
                    height: 630,
                    alt: metadata.title,
                }
            ] : undefined,
        },
        twitter: {
            card: 'summary_large_image',
            title: metadata.title,
            description: metadata.description,
            images: metadata.image ? [metadata.image] : undefined,
        }
    };
}

export default async function Page({
    params,
}: {
    params: Promise<{ slug: string }>
}) {
    const { slug } = await params
    const { default: Post, metadata } = await import(`@/content/${slug}.mdx`)
    return <>
        <h1>{metadata.title}</h1>
        <p className="bg-secondary rounded-lg p-2">{metadata.description}</p>
        <div className="bg-primary w-fit rounded-full text-primary-foreground p-1 text-xs">{metadata.date && convertDate(metadata.date)}</div>
        <Post />
    </>
}

export function generateStaticParams() {
    return [{ slug: 'manifesto' }]
}

export const dynamicParams = false
