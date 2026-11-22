import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import { WorksWith } from "@/components/brand";
import { SOURCES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features: lead collection, AI lead scoring and email drafts",
  description: "Kestrel features: collect B2B leads from nine public sources, score them with AI against your offer, find contacts, draft personal first emails and work as a team.",
  alternates: { canonical: "/features" },
};

const GROUPS = [
  { icon: "globe", title: "Collect", items: ["Nine sources: maps, web search, YouTube, OpenStreetMap, job boards, Companies House, podcasts, any web page and your own website lists", "Built-in library of keywords and places in 245 countries", "Search progress for every keyword and place, so you continue where you stopped", "Careful pace with daily limits and automatic pauses"] },
  { icon: "sparkle", title: "Judge with AI", items: ["Describe your offer, ideal customer, good signs and deal breakers once", "Every lead marked Good, Maybe or No with a one-line reason", "Works with Claude, ChatGPT, Gemini, OpenRouter or your own model", "No API key? Use Claude Code or Codex with a job file instead"] },
  { icon: "mail", title: "Reach out", items: ["Personal first emails: one line about the business, one line about you, one question", "Review every draft in the lead panel before export", "Email-ready export for your inbox or outreach tool", "Your sender name, postal address and opt-out line added to every email"] },
  { icon: "briefcase", title: "Signals and contacts", items: ["Hiring Now: companies hiring for the skills you sell", "Find business emails and decision makers with Hunter.io", "Directors from the UK company register", "Website checks flag businesses that may have closed"] },
  { icon: "layers", title: "Clean, organised data", items: ["One lead per business across every source, with new details merged in", "Lists, saved views, filters and custom scoring rules", "Do-not-contact list, never exported", "Automatic backups and safe restore"] },
  { icon: "users", title: "Team ready", items: ["Lists for each client or market", "Shared progress so nobody repeats a search", "Activity log of every search, export and change", "Roles for owners, managers, researchers and viewers"] },
];

export default function FeaturesPage() {
  return (
    <div className="site">
      <PageHero eyebrow="Features" title="Everything you need to find, judge and reach the right businesses" text="Kestrel brings lead collection, AI lead scoring, contact finding and email drafting into one workspace for agencies and B2B teams." />
      <main>
        <section className="section">
          <div className="wrap grid c3">
            {GROUPS.map((g) => (
              <article key={g.title} className="card">
                <h3>{g.title}</h3>
                <ul className="checks" style={{ marginTop: 14 }}>{g.items.map((i) => <li key={i} style={{ fontSize: 14.5, color: "var(--label2)" }}>{i}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>
        <section className="section alt">
          <div className="wrap">
            <p className="eyebrow">Sources</p>
            <h2>Nine places to find your next client</h2>
            <div className="grid c3" style={{ marginTop: 28 }}>
              {SOURCES.map((s) => <div key={s.name} className="card"><h3>{s.name}</h3><p>{s.text}</p></div>)}
            </div>
          </div>
        </section>
        <section className="section">
          <div className="wrap" style={{ textAlign: "center" }}>
            <h2>See it with your own offer</h2>
            <p className="intro" style={{ margin: "0 auto 28px" }}>Install the extension and score your first leads in minutes.</p>
            <Link className="btn go" href="/help#install">Get the extension</Link>
          </div>
        </section>
        <section className="section">
          <div className="wrap">
            <p className="eyebrow">Works with</p>
            <h2>Connected to the tools you trust</h2>
            <p className="intro">Use your own AI model and keys. Each service gets only what a feature needs, only when you use it.</p>
            <WorksWith />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
