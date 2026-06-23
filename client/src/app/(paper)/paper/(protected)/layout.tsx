import { RequireAuth } from "@/components/auth/RequireAuth";

export default function ProtectedPaperLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return <RequireAuth>{children}</RequireAuth>;
}
