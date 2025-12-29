import remarkGfm from 'remark-gfm'
import createMDX from '@next/mdx'

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Configure `pageExtensions` to include markdown and MDX files
    pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
    // Transpile packages that import CSS from node_modules
    transpilePackages: ['react-pdf-highlighter-extended', 'pdfjs-dist'],
    // Add image remote patterns configuration
    images: {
        remotePatterns: [
            {
                protocol: 'https' as const,
                hostname: 'assets.khoj.dev',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https' as const,
                hostname: 'openpaper.ai',
                port: '',
                pathname: '/**',
            },
            {
                protocol: 'https' as const,
                hostname: 'lh3.googleusercontent.com',
                port: '',
                pathname: '/**',
            }
        ],
    },
}

const withMDX = createMDX({
    // Add markdown plugins here, as desired
    options: {
        remarkPlugins: [remarkGfm],
    }
})

// Merge MDX config with Next.js config
export default withMDX(nextConfig)
