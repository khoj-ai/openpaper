import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AuthProvider } from "@/lib/auth";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { Toaster } from "@/components/ui/sonner";
import { PostHogProvider } from "@/lib/providers";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Annotated Paper",
	description: "Quickly and efficiently read, highlight, and understand all your papers.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<AuthProvider>
					<PostHogProvider>
						<SidebarProvider>
							<AppSidebar />
							<SidebarInset>
								<header className="flex h-8 shrink-0 items-center gap-2 border-b px-4">
									<SidebarTrigger className="-ml-1" />
									<Separator orientation="vertical" className="mr-2 h-4" />
									<header className="flex flex-1 items-center justify-between">
										<h1 className="text-lg font-bold">
											The Annotated Paper
										</h1>
										<OnboardingChecklist />
									</header>
								</header>
								{children}
							</SidebarInset>
						</SidebarProvider>
					</PostHogProvider>
				</AuthProvider>
				<Toaster />
			</body>
		</html>
	);
}
