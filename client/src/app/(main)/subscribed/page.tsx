'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { fetchFromApi } from '@/lib/api'
import { CheckCircle, XCircle, Upload, MessageSquare, Sparkles, ArrowLeft } from 'lucide-react'
import confetti from 'canvas-confetti'
import LoadingIndicator from '@/components/utils/Loading'
import Link from 'next/link'

interface SessionStatusResponse {
    status: string
    customer_email: string | null
    backend_subscription_found: boolean
    backend_subscription_status: string | null
}

function SubscribedPageContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const sessionId = searchParams.get('session_id')

    const [sessionStatus, setSessionStatus] = useState<SessionStatusResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>('')
    const [confettiTriggered, setConfettiTriggered] = useState(false)

    const triggerConfetti = () => {
        const duration = 5 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

        const randomInRange = (min: number, max: number) =>
            Math.random() * (max - min) + min;

        const interval = window.setInterval(() => {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({
                ...defaults,
                particleCount,
                origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
            });
            confetti({
                ...defaults,
                particleCount,
                origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
            });
        }, 250);
    }

    useEffect(() => {
        if (!sessionId) {
            setError('No session ID provided')
            setLoading(false)
            return
        }

        const fetchSessionStatus = async () => {
            try {
                const response = await fetchFromApi(`/api/subscription/session-status?session_id=${sessionId}`)
                setSessionStatus(response)
            } catch (err) {
                setError('Failed to fetch subscription status')
                console.error('Error fetching session status:', err)
            } finally {
                setLoading(false)
            }
        }

        fetchSessionStatus()
    }, [sessionId])

    // Trigger confetti when subscription is successfully activated
    useEffect(() => {
        if (sessionStatus &&
            sessionStatus.status === 'complete' &&
            sessionStatus.backend_subscription_found &&
            !confettiTriggered) {
            triggerConfetti()
            setConfettiTriggered(true)
        }
    }, [sessionStatus, confettiTriggered])

    const getStatusMessage = () => {
        if (!sessionStatus) return null

        if (sessionStatus.status === 'complete' && sessionStatus.backend_subscription_found) {
            return {
                title: 'Subscription Activated!',
                description: `Welcome! Your subscription is now active${sessionStatus.customer_email ? ` for ${sessionStatus.customer_email}` : ''}.`,
                variant: 'success' as const
            }
        } else if (sessionStatus.status === 'complete' && !sessionStatus.backend_subscription_found) {
            return {
                title: 'Payment Processed',
                description: 'Your payment was successful! We\'re setting up your subscription - this may take a few moments.',
                variant: 'processing' as const
            }
        } else if (sessionStatus.status === 'open') {
            return {
                title: 'Payment Pending',
                description: 'Your payment session is still open. Please complete the payment process.',
                variant: 'pending' as const
            }
        } else {
            return {
                title: 'Subscription Issue',
                description: 'There was an issue with your subscription. Please contact support.',
                variant: 'error' as const
            }
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
                <LoadingIndicator />
                <p className="mt-4 text-muted-foreground">Verifying your subscription...</p>
            </div>
        )
    }

    if (error || !sessionId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center max-w-2xl mx-auto">
                <div className="relative mb-8">
                    <div className="relative w-32 h-32 mx-auto">
                        <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent rounded-full blur-2xl" />
                        <div className="relative w-full h-full bg-gradient-to-br from-red-500/5 to-red-500/10 dark:from-red-500/10 dark:to-red-500/20 rounded-2xl flex items-center justify-center border border-red-500/10 shadow-sm">
                            <XCircle className="w-14 h-14 text-red-500" strokeWidth={1.5} />
                        </div>
                    </div>
                </div>

                <h2 className="text-2xl font-bold text-foreground mb-3">
                    Subscription Error
                </h2>
                <p className="text-muted-foreground mb-8 max-w-md">
                    {error || 'No session ID was provided. Your subscription may not have been processed correctly.'}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                    <Button
                        size="lg"
                        className="flex-1 bg-primary hover:bg-primary/90"
                        onClick={() => router.push('/pricing')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Pricing
                    </Button>
                    <Button
                        size="lg"
                        variant="outline"
                        className="flex-1"
                        asChild
                    >
                        <Link href="/">
                            Continue to App
                        </Link>
                    </Button>
                </div>

                <p className="text-sm text-muted-foreground mt-8">
                    If you believe this is an error, please{' '}
                    <a href="mailto:saba@openpaper.ai" className="text-primary hover:underline">
                        contact support
                    </a>{' '}
                    with your payment confirmation.
                </p>
            </div>
        )
    }

    const statusMessage = getStatusMessage()
    const isSuccess = sessionStatus?.status === 'complete' && sessionStatus?.backend_subscription_found
    const isError = sessionStatus?.status !== 'complete' && sessionStatus?.status !== 'open'

    // Error state (payment failed or expired)
    if (isError) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center max-w-2xl mx-auto">
                <div className="relative mb-8">
                    <div className="relative w-32 h-32 mx-auto">
                        <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent rounded-full blur-2xl" />
                        <div className="relative w-full h-full bg-gradient-to-br from-red-500/5 to-red-500/10 dark:from-red-500/10 dark:to-red-500/20 rounded-2xl flex items-center justify-center border border-red-500/10 shadow-sm">
                            <XCircle className="w-14 h-14 text-red-500" strokeWidth={1.5} />
                        </div>
                    </div>
                </div>

                <h2 className="text-2xl font-bold text-foreground mb-3">
                    {statusMessage?.title}
                </h2>
                <p className="text-muted-foreground mb-8 max-w-md">
                    {statusMessage?.description} Please return to the pricing page and try again.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                    <Button
                        size="lg"
                        className="flex-1 bg-primary hover:bg-primary/90"
                        onClick={() => router.push('/pricing')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Pricing
                    </Button>
                    <Button
                        size="lg"
                        variant="outline"
                        className="flex-1"
                        asChild
                    >
                        <Link href="/">
                            Continue to App
                        </Link>
                    </Button>
                </div>

                <p className="text-sm text-muted-foreground mt-8">
                    Having trouble?{' '}
                    <a href="mailto:saba@openpaper.ai" className="text-primary hover:underline">
                        Contact support
                    </a>{' '}
                    for assistance.
                </p>
            </div>
        )
    }

    // Success state
    if (isSuccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center max-w-2xl mx-auto">
                {/* Success Icon */}
                <div className="relative mb-8">
                    <div className="relative w-32 h-32 mx-auto">
                        <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-primary/5 to-transparent rounded-full blur-2xl" />
                        <div className="relative w-full h-full bg-gradient-to-br from-green-500/5 to-primary/10 dark:from-green-500/10 dark:to-primary/20 rounded-2xl flex items-center justify-center border border-green-500/10 shadow-sm">
                            <CheckCircle className="w-14 h-14 text-green-500" strokeWidth={1.5} />
                        </div>
                        <div className="absolute -top-2 -right-2 w-12 h-12 bg-background dark:bg-card rounded-xl flex items-center justify-center border border-green-500/20 shadow-md">
                            <Sparkles className="w-6 h-6 text-green-500" strokeWidth={2} />
                        </div>
                    </div>
                </div>

                <h2 className="text-2xl font-bold text-foreground mb-3">
                    Welcome to Open Paper - Researcher!
                </h2>
                <p className="text-muted-foreground mb-2 max-w-md">
                    Your subscription is now active{sessionStatus?.customer_email ? ` for ${sessionStatus.customer_email}` : ''}.
                </p>
                <p className="text-sm text-muted-foreground mb-8 max-w-md">
                    You now have access to upgraded features. Here&apos;s what you can do:
                </p>

                {/* Feature highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8 w-full max-w-lg">
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-500/10 text-blue-500 mb-3">
                            <Upload className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium">More Papers</p>
                        <p className="text-xs text-muted-foreground">Enjoy higher upload limits</p>
                    </div>
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 text-primary mb-3">
                            <MessageSquare className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium">Upgraded Chat</p>
                        <p className="text-xs text-muted-foreground">Ask anything, anytime</p>
                    </div>
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-green-500/10 text-green-500 mb-3">
                            <Sparkles className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-medium">Intelligent Artifacts</p>
                        <p className="text-xs text-muted-foreground">Collect insights & audio summaries</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                    <Button
                        size="lg"
                        className="flex-1 bg-primary hover:bg-primary/90"
                        onClick={() => router.push('/')}
                    >
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Papers
                    </Button>
                    <Button
                        size="lg"
                        variant="outline"
                        className="flex-1"
                        asChild
                    >
                        <Link href="/projects">
                            Create Projects
                        </Link>
                    </Button>
                </div>

                <div className="mt-8">
                    <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                        or go to your library →
                    </Link>
                </div>
            </div>
        )
    }

    // Processing/pending state (payment complete but subscription not yet ready, or payment still open)
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center max-w-2xl mx-auto">
            <div className="relative mb-8">
                <div className="relative w-32 h-32 mx-auto">
                    <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 via-yellow-500/5 to-transparent rounded-full blur-2xl" />
                    <div className="relative w-full h-full bg-gradient-to-br from-yellow-500/5 to-yellow-500/10 dark:from-yellow-500/10 dark:to-yellow-500/20 rounded-2xl flex items-center justify-center border border-yellow-500/10 shadow-sm">
                        <LoadingIndicator />
                    </div>
                </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground mb-3">
                {statusMessage?.title}
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md">
                {statusMessage?.description}
            </p>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
                <Button
                    size="lg"
                    variant="outline"
                    className="flex-1"
                    onClick={() => window.location.reload()}
                >
                    Refresh Status
                </Button>
                <Button
                    size="lg"
                    className="flex-1 bg-primary hover:bg-primary/90"
                    onClick={() => router.push('/')}
                >
                    Continue to App
                </Button>
            </div>

            <p className="text-sm text-muted-foreground mt-8">
                This usually takes just a few moments. Feel free to continue using the app while we set things up.
            </p>
        </div>
    )
}

function SubscribedPageSkeleton() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
            <LoadingIndicator />
            <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
    )
}

export default function SubscribedPage() {
    return (
        <Suspense fallback={<SubscribedPageSkeleton />}>
            <SubscribedPageContent />
        </Suspense>
    )
}
