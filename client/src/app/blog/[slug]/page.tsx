const convertDate = (date: string) => {
    const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }
    return new Date(date).toLocaleDateString('en-US', options)
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
