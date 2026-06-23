import { RequireAuth } from "@/components/auth/RequireAuth";

export default function ProtectedLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return <RequireAuth>{children}</RequireAuth>;
}
