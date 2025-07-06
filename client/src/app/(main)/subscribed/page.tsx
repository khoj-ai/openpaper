'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchFromApi } from '@/lib/api'
import { CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react'
import confetti from 'canvas-confetti'

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
    const [error, setError] = useState<string | null>(null)
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

    const getStatusIcon = () => {
        if (!sessionStatus) return null

        if (sessionStatus.status === 'complete' && sessionStatus.backend_subscription_found) {
            return <CheckCircle className="h-16 w-16 text-green-500" />
        } else if (sessionStatus.status === 'complete' && !sessionStatus.backend_subscription_found) {
            return <Clock className="h-16 w-16 text-yellow-500" />
        } else if (sessionStatus.status === 'open') {
            return <Clock className="h-16 w-16 text-blue-500" />
        } else {
            return <XCircle className="h-16 w-16 text-red-500" />
        }
    }

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
            <div className="container mx-auto max-w-2xl py-12 px-4">
                <Card>
                    <CardHeader className="text-center">
                        <Skeleton className="h-16 w-16 rounded-full mx-auto mb-4" />
                        <Skeleton className="h-8 w-64 mx-auto mb-2" />
                        <Skeleton className="h-4 w-96 mx-auto" />
                    </CardHeader>
                    <CardContent className="text-center">
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4 mx-auto" />
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (error || !sessionId) {
        return (
            <div className="container mx-auto max-w-2xl py-12 px-4">
                <Card>
                    <CardHeader className="text-center">
                        <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
                        <CardTitle className="text-2xl">Something went wrong</CardTitle>
                        <CardDescription>
                            {error || 'No session ID was provided in the URL'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                        <Button onClick={() => router.push('/pricing')} className="mt-4">
                            Return to Pricing
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const statusMessage = getStatusMessage()

    return (
        <div className="container mx-auto max-w-2xl py-12 px-4">
            <Card>
                <CardHeader className="text-center">
                    <div className="mb-4 items-center justify-center mx-auto">
                        {getStatusIcon()}
                    </div>
                    <CardTitle className="text-2xl">{statusMessage?.title}</CardTitle>
                    <CardDescription className="text-lg">
                        {statusMessage?.description}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {/* Status Details */}
                    <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">Payment Status</div>
                            <div className="text-sm capitalize">{sessionStatus?.status}</div>
                        </div>
                        {sessionStatus?.customer_email && (
                            <div>
                                <div className="text-sm font-medium text-muted-foreground">Email</div>
                                <div className="text-sm">{sessionStatus.customer_email}</div>
                            </div>
                        )}
                        <div>
                            <div className="text-sm font-medium text-muted-foreground">Backend Status</div>
                            <div className="text-sm">
                                {sessionStatus?.backend_subscription_found ? (
                                    <span className="text-green-600">✓ Found</span>
                                ) : (
                                    <span className="text-yellow-600">⏳ Processing</span>
                                )}
                            </div>
                        </div>
                        {sessionStatus?.backend_subscription_status && (
                            <div>
                                <div className="text-sm font-medium text-muted-foreground">Subscription Status</div>
                                <div className="text-sm capitalize">{sessionStatus.backend_subscription_status}</div>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-4 pt-4">
                        {statusMessage?.variant === 'success' ? (
                            <Button onClick={() => router.push('/')} className="flex-1 bg-blue-500">
                                Start Using Open Paper
                            </Button>
                        ) : statusMessage?.variant === 'processing' ? (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => window.location.reload()}
                                    className="flex-1"
                                >
                                    Refresh Status
                                </Button>
                                <Button onClick={() => router.push('/')} className="flex-1">
                                    Continue to App
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => router.push('/pricing')}
                                    className="flex-1"
                                >
                                    Return to Pricing
                                </Button>
                                <Button
                                    onClick={() => router.push('/contact')}
                                    className="flex-1"
                                >
                                    Contact Support
                                </Button>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function SubscribedPageSkeleton() {
    return (
        <div className="container mx-auto max-w-2xl py-12 px-4">
            <Card>
                <CardHeader className="text-center">
                    <Skeleton className="h-16 w-16 rounded-full mx-auto mb-4" />
                    <Skeleton className="h-8 w-64 mx-auto mb-2" />
                    <Skeleton className="h-4 w-96 mx-auto" />
                </CardHeader>
                <CardContent className="text-center">
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-4 w-3/4 mx-auto" />
                </CardContent>
            </Card>
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
