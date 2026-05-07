// Auth.js middleware — runs the `authorized` callback in src/auth.ts on
// every matched request and redirects unauthenticated users to /signin.

export { auth as middleware } from "@/auth";

export const config = {
  // Skip Next internals, static files, and the auth route itself.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
