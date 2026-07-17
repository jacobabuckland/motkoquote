import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export const proxy = (request: NextRequest) => updateSession(request);

export const config = {
  matcher: [
    // Exclude Next internals and public metadata endpoints (robots, sitemap,
    // web manifest, OG image) so they are never redirected to /login — crawlers
    // and social scrapers reach them unauthenticated.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
