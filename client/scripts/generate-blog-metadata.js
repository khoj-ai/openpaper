const fs = require('fs');
const path = require('path');

const contentDir = path.join(__dirname, '../src/content');
const outputPath = path.join(__dirname, '../public/blog-latest.json');

async function generateBlogMetadata() {
    const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.mdx'));

    const posts = [];

    for (const file of files) {
        const content = fs.readFileSync(path.join(contentDir, file), 'utf-8');

        // Extract metadata object from the MDX file
        const metadataMatch = content.match(/export\s+const\s+metadata\s*=\s*(\{[\s\S]*?\});?\s*\n/);
        if (!metadataMatch) continue;

        try {
            // Evaluate the metadata object (safe since we control these files)
            const metadata = eval('(' + metadataMatch[1] + ')');
            const slug = file.replace('.mdx', '');

            posts.push({
                slug,
                title: metadata.title,
                description: metadata.description,
                date: metadata.date,
            });
        } catch (e) {
            console.warn(`Failed to parse metadata from ${file}:`, e.message);
        }
    }

    // Sort by date descending
    posts.sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date(0);
        const dateB = b.date ? new Date(b.date) : new Date(0);
        return dateB.getTime() - dateA.getTime();
    });

    const latestPost = posts[0] || null;

    fs.writeFileSync(outputPath, JSON.stringify(latestPost, null, 2));
    console.log('Generated blog-latest.json:', latestPost?.title || 'No posts found');
}

generateBlogMetadata();
