"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const DISMISSED_POST_KEY = "dismissed_blog_post_slug";
const TOAST_ID = "blog-post-notification";

interface BlogPost {
    slug: string;
    title: string;
    description: string;
    date: string;
}

export function BlogPostToast() {
    const hasFetchedRef = useRef(false);

    useEffect(() => {
        if (hasFetchedRef.current) return;
        hasFetchedRef.current = true;

        const fetchLatestPost = async () => {
            try {
                const dismissedSlug = localStorage.getItem(DISMISSED_POST_KEY);

                const response = await fetch("/blog-latest.json");
                if (!response.ok) return;

                const post: BlogPost = await response.json();
                if (!post) return;

                if (dismissedSlug === post.slug) return;

                toast(post.title, {
                    id: TOAST_ID,
                    description: post.description,
                    duration: 3500,
                    position: "bottom-right",
                    action: {
                        label: "Read",
                        onClick: () => {
                            window.location.href = `/blog/${post.slug}`;
                        },
                    },
                    onDismiss: () => {
                        localStorage.setItem(DISMISSED_POST_KEY, post.slug);
                    },
                    onAutoClose: () => {
                        localStorage.setItem(DISMISSED_POST_KEY, post.slug);
                    },
                });
            } catch {
                // Silently fail - not critical
            }
        };

        fetchLatestPost();
    }, []);

    return null;
}
