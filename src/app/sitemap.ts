import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Public pages only. The App and Log in are kept out of search results (see robots.ts).
const PAGES: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
  ["", 1, "weekly"], ["/features", 0.9, "monthly"], ["/how-it-works", 0.8, "monthly"], ["/use-cases", 0.8, "monthly"],
  ["/pricing", 0.9, "monthly"], ["/signup", 0.6, "monthly"], ["/security", 0.7, "monthly"], ["/help", 0.7, "weekly"], ["/about", 0.5, "yearly"], ["/contact", 0.5, "yearly"], ["/creators", 0.5, "monthly"], ["/creators/terms", 0.3, "yearly"],
  ["/privacy", 0.3, "yearly"], ["/terms", 0.3, "yearly"], ["/cookies", 0.3, "yearly"], ["/acceptable-use", 0.3, "yearly"],
  ["/dpa", 0.3, "yearly"], ["/subprocessors", 0.3, "yearly"],
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(([path, priority, changeFrequency]) => ({ url: `${SITE.url}${path}`, priority, changeFrequency }));
}
