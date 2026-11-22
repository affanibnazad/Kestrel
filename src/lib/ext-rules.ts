// Live page rules for the Kestrel extension, served at https://kestrelleads.com/ext/rules (route: app/ext/rules).
// When Google changes a page, fix the selector here and publish the site: every extension picks it up within about
// 30 minutes, with no new extension version and no store review.
//
// Rules (keep them, the extension enforces them too, see core/rules.js):
// - Data only: CSS selectors and plain text patterns. Never code, never URLs to load, never limits or timings.
// - Each entry is tried FIRST; the extension's own built-in value stays as the fallback, so a wrong entry here can
//   never make collecting worse than the built-in rules.
// - The safety checks ("blocked", "signedIn") can only be ADDED to: the extension always checks its built-in ones too.
// - Strings up to 300 characters; patterns are case-insensitive JavaScript regular expressions without nested repeats.
// - An empty object means "use the built-in rules". Bump `updated` with every change (shown in the extension).

export const EXT_RULES = {
  schema: 1,
  updated: "2026-11-18",
  maps: {
    // e.g. feed: 'div[role="feed"]',
  },
  search: {},
  google: {},
} as const;
