'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import Markdown, { Components } from 'react-markdown';
import { PluggableList } from 'unified';


// Define a simple CSS-in-JS for the blinking cursor animation
const cursorStyle = `
  @keyframes blink {
    50% { opacity: 0; }
  }
  .blinking-cursor {
    animation: blink 1s step-end infinite;
  }
`;

interface AnimatedMarkdownProps {
    content: string;
    remarkPlugins?: PluggableList;
    rehypePlugins?: PluggableList;
    components?: Components;
    className?: string;
    typewriterSpeed?: number;
    enableAnimation?: boolean;
}


export function AnimatedMarkdown({
    content,
    remarkPlugins = [[remarkMath, { singleDollarTextMath: false }], remarkGfm],
    rehypePlugins = [rehypeKatex],
    components,
    className = '',
    typewriterSpeed = 30,
    enableAnimation = true,
}: AnimatedMarkdownProps) {
    const [stableContent, setStableContent] = useState('');
    const [liveContent, setLiveContent] = useState('');
    const liveContentTargetRef = useRef('');

    // Effect 1: Split incoming content into "stable" and "live" parts.
    useEffect(() => {
        if (!enableAnimation) {
            setStableContent(content);
            setLiveContent('');
            return;
        }

        // Heuristic: A "stable" block is a chunk of markdown ending in a double newline.
        const lastStableIndex = content.lastIndexOf('\n\n');

        let newStableContent = '';
        let newLiveContentTarget = content;

        if (lastStableIndex !== -1) {
            // Split content at the last stable point
            newStableContent = content.substring(0, lastStableIndex + 2);
            newLiveContentTarget = content.substring(lastStableIndex + 2);
        }

        // Update the stable content if it has grown. This "locks in" the previous blocks.
        if (newStableContent.length > stableContent.length) {
            setStableContent(newStableContent);
            // The new live part starts fresh
            setLiveContent('');
        }

        liveContentTargetRef.current = newLiveContentTarget;

    }, [content, stableContent, enableAnimation]);

    // Effect 2: Animate the "live" part using a typewriter effect.
    useEffect(() => {
        if (!enableAnimation) return;

        // If the live content has caught up to the target, we stop.
        if (liveContent.length >= liveContentTargetRef.current.length) {
            return;
        }

        const animationTimeout = setTimeout(() => {
            setLiveContent(prevLiveContent => {
                const target = liveContentTargetRef.current;
                const nextChunkSize = Math.min(3, target.length - prevLiveContent.length);
                return target.substring(0, prevLiveContent.length + nextChunkSize);
            });
        }, typewriterSpeed);

        return () => clearTimeout(animationTimeout);
    }, [liveContent, enableAnimation, typewriterSpeed]);

    // Memoize the final rendered components for performance.
    const StableMarkdown = useMemo(() => (
        <Markdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={components}
        >
            {stableContent}
        </Markdown>
    ), [stableContent, remarkPlugins, rehypePlugins, components]);

    const LiveMarkdown = useMemo(() => (
        <Markdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={components}
        >
            {/* Add a blinking cursor for a classic typewriter feel */}
            {liveContent ? `${liveContent}` : ''}
        </Markdown>
    ), [liveContent, remarkPlugins, rehypePlugins, components]);

    // The cursor is handled separately to prevent re-rendering the entire LiveMarkdown component on each blink
    const Cursor = useMemo(() => <span className="blinking-cursor">▋</span>, []);

    return (
        <div className={`${className} prose dark:prose-invert !max-w-full w-full text-primary`}>
            {/* Inject the keyframes for the cursor animation */}
            <style>{cursorStyle}</style>
            {StableMarkdown}
            {/* We render the live part and the cursor as siblings */}
            {liveContent && <div style={{ display: 'inline' }}>{LiveMarkdown}{Cursor}</div>}
        </div>
    );
}
