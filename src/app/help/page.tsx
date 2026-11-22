import type { Metadata } from "next";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import HelpSearch from "./search";

export const metadata: Metadata = {
  title: "Help centre",
  description: "Kestrel help centre: install the extension, collect leads from each source, score leads with AI, draft emails and collect safely.",
  alternates: { canonical: "/help" },
};

export default function HelpPage() {
  return (
    <div className="site">
      <PageHero eyebrow="Help centre" title="How can we help?" />
      <main className="wrap">
        <HelpSearch />
      </main>
      <SiteFooter />
    </div>
  );
}
