"use client"

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import Link from "next/link";

function LoginContent() {
	const { user, loading, error: authError, login } = useAuth();
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();
	const searchParams = useSearchParams();
	const returnTo = searchParams.get('returnTo') || '/';
	const errorParam = searchParams.get('error');

	// Handle error query param
	useEffect(() => {
		if (errorParam) {
			switch (errorParam) {
				case 'callback_failed':
					setError('Login failed. Please try again.');
					break;
				case 'authentication_error':
					setError('Authentication error occurred. Please try again.');
					break;
				case 'missing_code':
					setError('Authentication code missing. Please try again.');
					break;
				default:
					setError('An error occurred during login. Please try again.');
			}
		}
	}, [errorParam]);

	// If user is already logged in, redirect to return path
	useEffect(() => {
		if (user && !loading) {
			router.push(returnTo);
		}
	}, [user, loading, router, returnTo]);

	const handleLogin = async () => {
		setError(null);
		await login();
	};

	if (loading) {
		return (
			<div className="h-full flex flex-col items-center justify-center py-8 space-y-6">
				<Loader2 className="h-12 w-12 animate-spin text-primary" />
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center h-full p-4">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle className="text-2xl">Sign in to Open Paper</CardTitle>
					<CardDescription>
						Connect with your Google account to access your papers and annotations.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{(error || authError) && (
							<Alert variant="destructive">
								<AlertCircle className="h-4 w-4" />
								<AlertDescription>
									{error || authError}
								</AlertDescription>
							</Alert>
						)}
						<Button
							onClick={handleLogin}
							className="w-full"
							size="lg"
						>
							Continue with Google
						</Button>
					</div>
				</CardContent>
				<CardFooter className="text-sm text-muted-foreground text-start">
					<div className="flex flex-wrap gap-1 justify-start">
						<span>By signing in, you agree to our</span>
						<Link href="/tos" className="text-primary hover:underline">Terms of Service</Link>
						<span>and</span>
						<Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
					</div>
				</CardFooter>
			</Card>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense fallback={
			<div className="h-full flex items-center justify-center">
				<Loader2 className="h-12 w-12 animate-spin text-primary" />
			</div>
		}>
			<LoginContent />
		</Suspense>
	)
}
