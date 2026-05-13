// app/providers.tsx
'use client'

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, Suspense } from "react"
import { usePostHog } from 'posthog-js/react'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider } from 'posthog-js/react'
import { useIsDarkMode } from "@/hooks/useDarkMode"

// Note: This provider does not work wherever adblock is enabled.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
            api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
            person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
            capture_pageview: false // Disable automatic pageview capture, as we capture manually
        })
    }, [])

    return (
        <PHProvider client={posthog}>
            <SuspendedPostHogPageView />
            <SuspendedReferralCapture />
            {children}
        </PHProvider>
    )
}

function PostHogPageView() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const posthog = usePostHog()

    // Track pageviews
    useEffect(() => {
        if (pathname && posthog) {
            let url = window.origin + pathname
            if (searchParams.toString()) {
                url = url + "?" + searchParams.toString();
            }

            posthog.capture('$pageview', { '$current_url': url })
        }
    }, [pathname, searchParams, posthog])

    return null
}

// Wrap PostHogPageView in Suspense to avoid the useSearchParams usage above
// from de-opting the whole app into client-side rendering
// See: https://nextjs.org/docs/messages/deopted-into-client-rendering
function SuspendedPostHogPageView() {
    return (
        <Suspense fallback={null}>
            <PostHogPageView />
        </Suspense>
    )
}


const REFERRAL_STORAGE_KEY = "op_ref"
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,16}$/

// Captures `?r=<code>` into localStorage on every navigation so the post-auth
// attribution flow can pick it up after a user signs up. localStorage is
// preferable to a cookie here because we don't need server-side access — the
// attribution POST is fired from the client at /auth/callback.
function ReferralCapture() {
    const searchParams = useSearchParams()

    useEffect(() => {
        const ref = searchParams.get("r")
        if (!ref) return
        const normalized = ref.trim().toUpperCase()
        if (!REFERRAL_CODE_PATTERN.test(normalized)) return
        try {
            localStorage.setItem(REFERRAL_STORAGE_KEY, normalized)
        } catch {
            // Some browsers (private mode, quotas) refuse writes. Silent skip
            // is fine — the worst case is a missed attribution.
        }
    }, [searchParams])

    return null
}

function SuspendedReferralCapture() {
    return (
        <Suspense fallback={null}>
            <ReferralCapture />
        </Suspense>
    )
}


export function ThemeProvider({ children }: { children: React.ReactNode }) {
    // Actually use the hook - this ensures React is aware of the dark mode state
    const {  } = useIsDarkMode();

    return <>{children}</>;
}
