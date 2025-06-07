import Link from 'next/link'
import fs from 'fs'
import path from 'path'

export default async function BlogIndexPage() {
    const contentDirectory = path.join(process.cwd(), 'src/content')
    const posts = await Promise.all(
        fs.readdirSync(contentDirectory)
            .filter(file => file.endsWith('.mdx'))
            .map(async file => {
                const slug = file.replace('.mdx', '')
                const { metadata } = await import(`@/content/${slug}.mdx`)
                return {
                    slug,
                    metadata
                }
            })
    )

    // Sort after resolving all promises
    const sortedPosts = posts.sort(
        (a, b) => new Date(b.metadata.date || 0).getTime() - new Date(a.metadata.date || 0).getTime()
    )

    return (
        <div>
            <h1>Posts</h1>
            <ul>
                {sortedPosts.map(post => (
                    <li key={post.slug}>
                        <Link href={`/blog/${post.slug}`}>
                            {post.metadata.title || post.slug}
                        </Link>
                        {post.metadata.date && (
                            <span> - {post.metadata.date}</span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}
