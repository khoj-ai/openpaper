'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import Markdown, { Components } from 'react-markdown';
import { PluggableList } from 'unified';

interface AnimatedMarkdownProps {
    content: string;
    remarkPlugins?: PluggableList;
    rehypePlugins?: PluggableList;
    components?: Components;
    className?: string;
    animationDuration?: number;
    chunkDelay?: number;
    enableAnimation?: boolean;
    debugMode?: boolean;
}

export function AnimatedMarkdown({
    content,
    remarkPlugins = [[remarkMath, { singleDollarTextMath: false }], remarkGfm],
    rehypePlugins = [rehypeKatex],
    components,
    className = '',
    animationDuration = 50,
    chunkDelay = 150,
    enableAnimation = true,
}: AnimatedMarkdownProps) {
    const [displayedContent, setDisplayedContent] = useState('');
    const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingContentRef = useRef('');

    // Chunk-based animation effect with content accumulation
    useEffect(() => {
        if (!enableAnimation) {
            setDisplayedContent(content);
            return;
        }

        // Update pending content buffer
        pendingContentRef.current = content;

        // Start animation if not already running
        if (!animationTimeoutRef.current) {

            const animateChunk = () => {
                setDisplayedContent(currentDisplayed => {
                    const currentPending = pendingContentRef.current;

                    // If there's no new content to display, stop animating
                    if (currentPending === currentDisplayed) {
                        animationTimeoutRef.current = null;
                        return currentDisplayed;
                    }

                    // Calculate chunk size (aim for reasonable chunks, not too small or large)
                    const remainingLength = currentPending.length - currentDisplayed.length;
                    const chunkSize = Math.max(1, Math.min(20, Math.ceil(remainingLength / 3)));

                    // Add the next chunk to displayed content
                    const newDisplayedLength = Math.min(
                        currentDisplayed.length + chunkSize,
                        currentPending.length
                    );
                    const newDisplayedContent = currentPending.substring(0, newDisplayedLength);

                    // Continue animating if there's more content
                    if (newDisplayedContent.length < currentPending.length) {
                        animationTimeoutRef.current = setTimeout(animateChunk, chunkDelay);
                    } else {
                        animationTimeoutRef.current = null;
                    }

                    return newDisplayedContent;
                });
            };

            // Start with initial delay
            animationTimeoutRef.current = setTimeout(animateChunk, animationDuration);
        }

        return () => {
            if (animationTimeoutRef.current) {
                clearTimeout(animationTimeoutRef.current);
                animationTimeoutRef.current = null;
            }
        };
    }, [content, chunkDelay, animationDuration, enableAnimation]);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (animationTimeoutRef.current) {
                clearTimeout(animationTimeoutRef.current);
            }
        };
    }, []);

    // Memoize the markdown component to avoid unnecessary re-renders
    const markdownContent = useMemo(() => {
        return (
            <Markdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={components}
            >
                {displayedContent}
            </Markdown>
        );
    }, [displayedContent, remarkPlugins, rehypePlugins, components]);

    return (
        <div className={`${className} relative`}>
            {markdownContent}
        </div>
    );
}
