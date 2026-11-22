import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import { INTRO, PLANS, introPrice, money } from "@/lib/plans";
import ApplyForm from "./form";

export const metadata: Metadata = {
  title: "Creator program",
  description: "Recommend Kestrel to your audience. They get 50% off for 3 months; you earn 30% of every payment for 12 months.",
  alternates: { canonical: "/creators" },
};

// The creator program (database 040): numbers decided by Affan on 12 Nov 2026 (Outreach Engine/08).
const pro = PLANS.find((p) => p.id === "pro");
const STEPS = [
  ["Apply", "Tell us about your channel, newsletter or community. We reply within a few days."],
  ["Share your link and code", "You get your own link (kestrelleads.com/?ref=YOU) and a code. Your audience gets " + `${INTRO.percent}% off their first ${INTRO.months} months.`],
  ["Earn every month", "30% of every payment from each team you bring, for 12 months. You see every sign-up and every dollar in your own page in the Kestrel App."],
];
const FOR = ["Cold-email and lead-generation teachers", "Agency growth coaches", "Freelancer and creator-business channels", "Honest SaaS and tool reviewers"];

export default function CreatorsPage() {
  return (
    <div className="site">
      <PageHero eyebrow="Creator program" title="Recommend Kestrel. Earn every month."
        text={`Your audience gets ${INTRO.percent}% off their first ${INTRO.months} months. You earn 30% of every payment they make, for 12 months.`} />
      <main>
        <section className="section">
          <div className="wrap">
            <div className="tlist creator-steps">
              {STEPS.map(([t, d], i) => <div key={t}><h3>{i + 1}. {t}</h3><p>{d}</p></div>)}
            </div>
          </div>
        </section>
        <section className="section alt">
          <div className="wrap split">
            <div>
              <h2>What you get</h2>
              <div className="tlist">
                <div><h3>30% for 12 months</h3><p>On every payment from each team you bring. Founding creators (the first 10) get 40%.{pro ? ` One Pro team pays ${money(introPrice(pro.price))} a month for ${INTRO.months} months, then ${money(pro.price)}.` : ""}</p></div>
                <div><h3>Paid on time</h3><p>Each payment is held 30 days (refunds take it back), then paid to you twice a month.</p></div>
                <div><h3>Free Agency access</h3><p>Use Kestrel yourself while you are an active creator, so you can show it honestly.</p></div>
                <div><h3>Ready-made content</h3><p>Video scripts, posts, emails and screenshots. Use them or make your own.</p></div>
              </div>
            </div>
            <div>
              <h2>Who it is for</h2>
              <ul className="creator-list">{FOR.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="intro">Kestrel is for finding and contacting businesses within email and privacy law. Please only recommend it that way: real business emails, your postal address, an easy way to say no. No spam promises, no paid ads on the Kestrel name. Full rules in the <Link href="/creators/terms">creator terms</Link>.</p>
            </div>
          </div>
        </section>
        <section className="section" id="apply">
          <div className="wrap contact-grid">
            <div className="contact-side">
              <h2>Apply</h2>
              <p className="intro">We read every application and approve creators by hand. If it is a fit, you get your link, your code and your page in the App.</p>
            </div>
            <ApplyForm />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
