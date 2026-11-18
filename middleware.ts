import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/token";

const PUBLIC = ["/login", "/signup", "/q/", "/i/", "/api/v1/", "/api/public/", "/api/webhooks/", "/api/cron/", "/api/health", "/_next", "/favicon"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  if (pathname === "/" || PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next({ request: { headers } });

  const ok = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ok) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
