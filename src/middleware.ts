import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/terms",
  "/privacy",
  "/api(.*)",
]);

const isDashboardRoute = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  // Redirect to org-selection if user is signed in but has no active org
  // on dashboard routes (server-side auth needs orgId for data fetching)
  const { userId, orgId } = await auth();
  if (userId && !orgId && isDashboardRoute(request)) {
    const orgSelectionUrl = new URL("/org-selection", request.url);
    return NextResponse.redirect(orgSelectionUrl);
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
