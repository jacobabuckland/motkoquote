import type { MetadataRoute } from "next";

const BASE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://motko.app"
).replace(/\/$/, "");

// Index the public marketing surface; keep the authed app and private token
// share links (/q, /c, /i) out of search results.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/support"],
      disallow: [
        "/dashboard",
        "/jobs",
        "/setup",
        "/signup",
        "/login",
        "/api/",
        "/q/",
        "/c/",
        "/i/",
      ],
    },
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
