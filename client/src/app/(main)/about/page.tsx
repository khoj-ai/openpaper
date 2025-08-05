const { default: Post } = await import(`@/content/about/about.mdx`);

export default function About() {
    return (
        <div className="mx-2 md:ml-auto md:mr-auto pb-10 prose prose-headings:mt-8 prose-headings:font-semibold prose-h1:text-5xl prose-h2:text-4xl prose-h3:text-3xl prose-h4:text-2xl prose-h5:text-xl prose-h6:text-lg dark:prose-invert">
            <Post />
        </div>
    )
}
