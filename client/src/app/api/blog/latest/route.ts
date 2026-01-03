import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
    const contentDirectory = path.join(process.cwd(), 'src/content')

    const posts = await Promise.all(
        fs.readdirSync(contentDirectory)
            .filter(file => file.endsWith('.mdx'))
            .map(async file => {
                const slug = file.replace('.mdx', '')
                const { metadata } = await import(`@/content/${slug}.mdx`)
                return {
                    slug,
                    title: metadata.title,
                    description: metadata.description,
                    date: metadata.date,
                }
            })
    )

    const sortedPosts = posts.sort(
        (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
    )

    const latestPost = sortedPosts[0] || null

    return NextResponse.json(latestPost)
}
