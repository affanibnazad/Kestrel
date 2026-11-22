import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";

export const metadata: Metadata = {
  title: "About Kestrel",
  description: "Kestrel is built by people who do B2B outreach themselves, to make prospecting calmer, more careful and more personal.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="site">
      <PageHero eyebrow="About" title="Prospecting should feel calm, careful and personal" />
      <main>
        <section className="section">
          <div className="wrap split" style={{ alignItems: "start" }}>
            <div>
              <h2>Why we built Kestrel</h2>
              <p className="intro">Kestrel started as a tool for our own outreach. We wanted to find businesses we could genuinely help, understand them before writing, and never waste anyone&rsquo;s time with messages that could go to anyone.</p>
            </div>
            <div className="tlist">
              <div><h3>Quality over volume</h3><p>A short list of the right businesses beats a long list of strangers.</p></div>
              <div><h3>People stay in control</h3><p>AI suggests and drafts. You decide and send.</p></div>
              <div><h3>Good conduct by default</h3><p>Careful limits, honest identification and opt-outs are built in, not optional.</p></div>
            </div>
          </div>
        </section>
        <section className="section alt">
          <div className="wrap" style={{ textAlign: "center" }}>
            <h2>Say hello</h2>
            <p className="intro" style={{ margin: "0 auto 28px" }}>Questions, ideas or feedback are always welcome.</p>
            <Link className="btn go" href="/contact">Contact us</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
