import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function MdxLayout({ children }: { children: React.ReactNode }) {
    return (
        <div
        className="mx-2 md:ml-auto md:mr-auto pb-10 prose prose-headings:mt-8 prose-headings:font-semibold prose-h1:text-5xl prose-h2:text-4xl prose-h3:text-3xl prose-h4:text-2xl prose-h5:text-xl prose-h6:text-lg dark:prose-invert">
            <Link href="/blog" className="flex items-start justify-start mb-8">
                <ArrowLeft className="h-4 w-4 mr-2" />
                <span className="text-sm">All Posts</span>
            </Link>
            {children}
        </div>
    )
}
