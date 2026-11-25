import { NextResponse, type NextRequest } from "next/server";

/**
 * Protects admin pages and integration APIs with a username/password.
 * Placeholder until the platform's real login system exists.
 */
function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USERNAME ?? "admin";
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("ADMIN_PASSWORD is not set. Set it in the hosting environment variables.", { status: 503 });
    }
    return NextResponse.next(); // local development only; dashboard shows a warning
  }
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (safeEqual(u, user) && safeEqual(rest.join(":"), pass)) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="GoldwaterShiftHQ admin"' } });
}

export const config = { matcher: ["/admin/:path*", "/api/integrations/:path*"] };
