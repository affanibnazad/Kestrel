import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import OfferBanner from "@/components/offer-banner";
import { LAUNCH as INTRO, PLANS, TRIAL_DAYS, introPrice, money } from "@/lib/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Kestrel plans for freelancers, agencies and B2B teams. Try every feature free for ${TRIAL_DAYS} days, no card needed.`,
  alternates: { canonical: "/pricing" },
};

const QA: [string, string][] = [
  ["What happens after the free trial?", `Your trial lasts ${TRIAL_DAYS} days and includes every Pro feature. At the end you choose a plan to keep collecting leads and using AI. Nothing is charged until you choose one. Without a plan your leads stay safe and you can still export them.`],
  ["Do I need a card to start?", "No. You only need your work email."],
  ["Is AI included in the price?", "Kestrel uses your own AI key (Claude, ChatGPT, Gemini or OpenRouter), or your coding assistant with no key at all. You pay your AI provider directly for what you use."],
  ["Can I change plans later?", "Yes. The team owner can move up or down at any time from the App."],
  ["How do I pay?", "By card through Lemon Squeezy, our payment partner. It handles VAT and sends your receipts. Plans renew monthly and you can cancel any time from Plan and billing in the App."],
];

export default function PricingPage() {
  return (
    <div className="site">
      <PageHero eyebrow={INTRO.percent ? `Launch offer: ${INTRO.percent}% off for ${INTRO.months} months` : "Pricing"} title="Simple plans that grow with your team" text={`Start with a ${TRIAL_DAYS}-day free trial. No card needed.`} />
      <main>
        <section className="section">
          <div className="wrap">
            <OfferBanner />
            <h2 className="sr-only">Plans</h2>
            <div className="price-grid" id="plans">
              {PLANS.map((p) => (
                <article key={p.id} className={`price${p.id === "pro" ? " pop" : ""}`}>
                  {p.id === "pro" ? <span className="price-tag">Most popular</span> : null}
                  <h3>{p.name}</h3>
                  <p className="price-line">{p.tagline}</p>
                  {INTRO.percent ? (
                    <>
                      <p className="price-amount"><b>{money(introPrice(p.price, INTRO))}</b><s>{money(p.price)}</s><span>per month</span></p>
                      <p className="price-offer">{INTRO.percent}% off for your first {INTRO.months} months, then {money(p.price)} a month</p>
                    </>
                  ) : <p className="price-amount"><b>{money(p.price)}</b><span>per month</span></p>}
                  <p className="price-seats">{p.seats}</p>
                  <ul className="checks">{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
                  <Link className={`btn ${p.id === "pro" ? "go" : "glass"}`} href={`/signup?plan=${p.id}`}>Start free trial</Link>
                </article>
              ))}
            </div>
            <p className="price-note">Prices in US dollars. Safety limits are the same on every plan: a higher plan never searches Google faster.</p>
          </div>
        </section>
        <section className="section">
          <div className="wrap faq-layout">
            <div className="faq-head"><p className="eyebrow">Questions</p><h2>Pricing questions</h2></div>
            <div className="faq">{QA.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
