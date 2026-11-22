import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";

export const metadata: Metadata = {
  title: "How it works: from search to first email",
  description: "How Kestrel works: install the extension, choose keywords and places, collect leads safely, score them with AI, review email drafts and export.",
  alternates: { canonical: "/how-it-works" },
};

const STEPS = [
  ["Install the extension", "Add Kestrel to Brave, Chrome or Edge and open the side panel. No account is needed to start."],
  ["Describe your offer", "Write what you sell, who buys it, good signs and deal breakers. This is what the AI scores against."],
  ["Choose keywords and places", "Pick from the built-in library or add your own. Kestrel tracks every keyword and place pair."],
  ["Collect", "Press Start. Kestrel gathers public business details at a careful pace, visits each website for contact details, and skips businesses you already have."],
  ["Score with AI", "Every lead is marked Good, Maybe or No with a short reason. Review the Maybes yourself with one key press."],
  ["Find contacts and signals", "See who is hiring for your skills, and find business emails and decision makers for your best leads."],
  ["Draft and export", "Review personal first-email drafts, then export an email-ready list. You send from your own inbox."],
];

export default function HowItWorksPage() {
  return (
    <div className="site">
      <PageHero eyebrow="How it works" title="From first search to first reply" text="Seven simple steps. You stay in control at every one." />
      <main>
        <section className="section">
          <div className="wrap grid c3 steps-row">
            {STEPS.map(([t, d]) => <article key={t} className="card"><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </section>
        <section className="section alt">
          <div className="wrap" style={{ textAlign: "center" }}>
            <h2>Start with the extension</h2>
            <p className="intro" style={{ margin: "0 auto 28px" }}>It works on its own, and connects to your team when you are ready.</p>
            <Link className="btn go" href="/help#install">Get the extension</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
