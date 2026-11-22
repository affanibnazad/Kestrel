import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <div className="site">
      <PageHero eyebrow="404" title="This page could not be found" text="It may have moved, or the address may be wrong." />
      <main className="section">
        <div className="wrap" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <Link className="btn go" href="/">Go to the home page</Link>
          <Link className="btn" href="/help">Visit the Help centre</Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
