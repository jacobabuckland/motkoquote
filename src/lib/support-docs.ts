// The public help centre: a Notion database published to the web, holding the
// step-by-step guides /support sends a contractor to.
//
// Hard-coded rather than read from the environment, unlike the App Store
// listing (lib/app-store-link.ts). That one is env-driven because an unset
// value must render nothing rather than a plausible dead link; this URL is
// already published and public, so there is no state in which it resolves to
// nothing and nothing to guard against.
//
// The `?v=` parameter selects the published view and is kept exactly as Notion
// emitted it; only the `source=copy_link` tracking parameter was dropped. If
// the docs are ever republished under a different workspace domain, this is the
// single line to change.
export const SUPPORT_DOCS_URL =
  "https://thread-song-fe0.notion.site/3c51e4f908b480e0bbc5f2b22726cd50?v=3c51e4f908b480269884000c6bffa4b8";
