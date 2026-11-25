/**
 * Server start-up hook (Next.js instrumentation).
 *
 * Error monitoring: every unhandled server error is written to the structured
 * log. If SENTRY_DSN is set, it is also sent to Sentry, with personal data
 * removed first (no cookies, no request bodies, no user emails or IP
 * addresses; only the route, the error and an anonymous user id).
 */
import type { Instrumentation } from "next";

const enabled = () => !!process.env.SENTRY_DSN;

export async function register() {
  if (!enabled() || process.env.NEXT_RUNTIME !== "nodejs") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV,
    // Collect no personal data (Sentry 11 collects all of these by default).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: 0,
    // Second layer: strip anything personal that might still be attached.
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.headers) event.request.headers = { "user-agent": event.request.headers["user-agent"] ?? "" };
      }
      if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
      return event;
    },
  });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  const { log } = await import("./server/log");
  log.error("request.unhandled_error", { message: e?.message?.slice(0, 300), digest: e?.digest, path: request.path.split("?")[0], method: request.method, routeType: context.routeType, route: context.routePath });
  if (!enabled()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, { ...request, path: request.path.split("?")[0], headers: {} }, context);
};
