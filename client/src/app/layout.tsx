import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AuthProvider } from "@/lib/auth";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import { Toaster } from "@/components/ui/sonner";
import { PostHogProvider, ThemeProvider } from "@/lib/providers";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Open Paper",
	description: "The fastest way to annotate, understand, and share your papers.",
	openGraph: {
		title: "Open Paper",
		description: "The fastest way to annotate, understand, and share your papers.",
		images: [
			{
				url: "https://assets.khoj.dev/openpaper_meta.png",
				width: 1280,
				height: 640,
				alt: "Open Paper",
			}
		],
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Open Paper",
		description: "The fastest way to annotate, understand, and share your papers.",
		images: ["https://assets.khoj.dev/openpaper_meta.png"],
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					id="theme-script"
					dangerouslySetInnerHTML={{
						__html: `
      try {
        if (localStorage.getItem('darkMode') === 'dark' ||
            (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } catch (e) {}
    `,
					}}
				/>
			</head>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<ThemeProvider>
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
												Open Paper
											</h1>
											<OnboardingChecklist />
										</header>
									</header>
									{children}
								</SidebarInset>
							</SidebarProvider>
						</PostHogProvider>
					</AuthProvider>
				</ThemeProvider>
				<Toaster />
			</body>
		</html>
	);
}
