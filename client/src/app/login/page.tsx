"use client"

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LoginPage() {
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
					<CardTitle className="text-2xl">Sign in to The Annotated Paper</CardTitle>
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
				<CardFooter className="flex justify-center text-sm text-muted-foreground">
					By signing in, you agree to our Terms of Service and Privacy Policy.
				</CardFooter>
			</Card>
		</div>
	);
}
