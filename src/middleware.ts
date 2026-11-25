import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight gate: sends visitors without a session cookie to sign-in.
 * Real session validation and every permission check happen on the server
 * (src/server/context.ts) because middleware can't reach the database.
 */
const PUBLIC = [/^\/api\/health$/, /^\/login/, /^\/invite\//, /^\/forbidden/, /^\/api\/cron\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/offline/];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (req.cookies.get("gshq_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
