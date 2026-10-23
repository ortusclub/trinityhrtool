import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Vercel kills edge middleware that hasn't responded within 25s. Without a
// shorter cap of our own, a flaky Supabase Auth API takes the whole site down
// for every request until that hard limit fires. Timing out early lets us
// fail closed (redirect to /login) fast instead of a wall of 504s.
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Allow auth callback, login, cron, the calendar feed, and the biometric
  // ingest paths without session auth. The calendar feed is polled by external
  // clients (Google Calendar) with no cookies — it authenticates itself via
  // its ?token= query param, so a session redirect here would break every
  // subscription.
  //
  // /iclock/* is the fingerprint scanner's ADMS feed. The device has no
  // cookies and does not follow redirects — bouncing it to /login would look
  // to the firmware like the server is broken, and it would silently stop
  // posting attendance. It authenticates on its serial number instead; see
  // lib/biometric/device.ts. /api/biometric/ingest, /api/directory and
  // /api/payslips/import use bearer secrets.
  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/api/auth") ||
    request.nextUrl.pathname.startsWith("/api/cron") ||
    request.nextUrl.pathname.startsWith("/api/calendar/feed") ||
    request.nextUrl.pathname.startsWith("/api/biometric/ingest") ||
    request.nextUrl.pathname.startsWith("/api/directory") ||
    request.nextUrl.pathname.startsWith("/api/payslips/import") ||
    request.nextUrl.pathname.startsWith("/iclock");

  // Skip getUser() for auth routes — calling it during the PKCE callback
  // can interfere with the code verifier cookie before exchangeCodeForSession runs
  if (isAuthRoute) {
    return supabaseResponse;
  }

  // If there's an auth code in the URL, redirect to the callback handler
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  let user = null;
  try {
    const result = await withTimeout(supabase.auth.getUser(), 8_000);
    user = result.data.user;
  } catch (error) {
    console.error("Middleware auth check failed:", error);
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Bump last_active_at at most once per minute per session. The cookie is the
  // hot-path throttle (no DB round-trip when fresh); the SQL function carries
  // its own 1-minute WHERE guard so a missing/forged cookie can't cause write
  // amplification. Best-effort: a slow or failed bump shouldn't block the
  // request, so it gets its own short timeout and swallows its own errors.
  const lastBump = Number(request.cookies.get("last_active_bump")?.value);
  if (!lastBump || Date.now() - lastBump > 60_000) {
    try {
      await withTimeout(supabase.rpc("touch_last_active"), 5_000);
      supabaseResponse.cookies.set("last_active_bump", String(Date.now()), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24,
      });
    } catch (error) {
      console.error("Middleware last_active bump failed:", error);
    }
  }

  return supabaseResponse;
}
