"use client"

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

/**
 * Gates its children behind authentication. Rendered once at the layout level for
 * protected route groups (see design.md, "Routing & auth") so individual pages don't reimplement
 * the auth check. While auth is resolving it shows a spinner; if the user is
 * unauthenticated it redirects to /login, preserving the current path as returnTo.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
	const { user, loading } = useAuth();
	const router = useRouter();
	const pathname = usePathname();

	useEffect(() => {
		if (!loading && !user) {
			router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
		}
	}, [loading, user, pathname, router]);

	if (loading) {
		return (
			<div className="flex h-[calc(100vh-3rem)] w-full items-center justify-center">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return user ? <>{children}</> : null;
}
