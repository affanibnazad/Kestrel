import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Use cases: lead generation for agencies, freelancers and B2B sales",
  description: "How agencies, freelancers, production studios and B2B sales teams use Kestrel to find well-matched businesses and start better conversations.",
  alternates: { canonical: "/use-cases" },
};

const CASES = [
  { icon: "users", title: "Creative and marketing agencies", text: "Find brands and businesses in your target cities, see which already invest in content, and contact the best fits with a personal first email.", points: ["Search by niche and city", "Score against your services", "Spot companies hiring for your skills"] },
  { icon: "briefcase", title: "White-label and production studios", text: "Partner with agencies that need extra hands. Kestrel finds agencies that make video, design or content for clients and shows which are busy right now.", points: ["Agency lists by city", "Hiring signals for editors and designers", "Decision makers and business emails"] },
  { icon: "person", title: "Freelancers and consultants", text: "Build a small, focused list of businesses you can really help, instead of sending the same message to hundreds of strangers.", points: ["Small, high-quality lists", "AI reasons you can read in seconds", "Drafts that sound like you"] },
  { icon: "gauge", title: "B2B sales teams", text: "Give every researcher the same keywords, places and scoring rules, and see progress across the team without duplicate work.", points: ["Shared progress", "One lead per business", "Activity log and roles"] },
];

export default function UseCasesPage() {
  return (
    <div className="site">
      <PageHero eyebrow="Use cases" title="Built for teams that sell to other businesses" text="Whether you run an agency, a studio or a sales team, Kestrel helps you find the businesses most likely to need what you offer." />
      <main>
        <section className="section">
          <div className="wrap grid c2">
            {CASES.map((c) => (
              <article key={c.title} className="card">
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <ul className="checks" style={{ marginTop: 16 }}>{c.points.map((p) => <li key={p} style={{ fontSize: 14.5 }}>{p}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>
        <section className="section alt">
          <div className="wrap" style={{ textAlign: "center" }}>
            <h2>Not sure if Kestrel fits?</h2>
            <p className="intro" style={{ margin: "0 auto 28px" }}>Tell us what you sell and who you want to reach. We will tell you honestly whether Kestrel can help.</p>
            <Link className="btn go" href="/contact">Contact us</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
