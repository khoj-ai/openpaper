import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const REFERRAL_COOKIE = "op_ref";
const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days
const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

export function middleware(request: NextRequest) {
    const ref = request.nextUrl.searchParams.get("r");
    if (!ref) {
        return NextResponse.next();
    }

    const normalized = ref.trim().toUpperCase();
    if (!REFERRAL_CODE_PATTERN.test(normalized)) {
        return NextResponse.next();
    }

    const response = NextResponse.next();
    response.cookies.set({
        name: REFERRAL_COOKIE,
        value: normalized,
        maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "lax",
        // Readable from client JS so the post-auth attribution call can find it.
        httpOnly: false,
    });
    return response;
}

export const config = {
    matcher: [
        // Skip Next internals, API routes, and static assets.
        "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
    ],
};
