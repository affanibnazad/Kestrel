import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Security and data protection",
  description: "How Kestrel protects your data and respects websites: local-first storage, private keys, careful collection limits, robots.txt, do-not-contact lists and GDPR-minded design.",
  alternates: { canonical: "/security" },
};

const BLOCKS = [
  { icon: "layers", title: "Your data, your control", text: "Leads collected with the extension are stored in your own browser. You choose when to sync them with your team workspace, and you can export or delete them at any time." },
  { icon: "eye", title: "Private keys", text: "Keys for AI and data services stay private. They are never included in exports, backups or support requests, and each key is sent only to its own service." },
  { icon: "gauge", title: "Careful collection", text: "Kestrel collects slowly with daily limits, pauses after any check from a website, and never solves CAPTCHAs, rotates identities or gets around logins and blocks." },
  { icon: "globe", title: "Respect for websites", text: "Kestrel follows each website's robots.txt, identifies itself honestly to open data services, and reads only public pages you choose." },
  { icon: "person", title: "Respect for people", text: "A do-not-contact list keeps people who said no out of every export. Kestrel never sends email for you: every message is reviewed and sent by you." },
  { icon: "book", title: "Clear records", text: "An activity log records searches, imports, exports, backups and changes, so your team always knows what happened and when." },
];

export default function SecurityPage() {
  return (
    <div className="site">
      <PageHero eyebrow="Security" title="Built to protect your data and respect everyone else's" text="Security and good conduct are part of the product, not an add-on." />
      <main>
        <section className="section">
          <div className="wrap grid c3">
            {BLOCKS.map((b) => (
              <article key={b.title} className="card">
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="section alt">
          <div className="wrap split">
            <div>
              <p className="eyebrow">Data protection</p>
              <h2>Designed with UK and EU data law in mind</h2>
              <p className="intro">Kestrel helps you keep only what you need, honour opt-outs quickly and delete data on request. You remain responsible for how you contact people, and our Terms explain what that means.</p>
            </div>
            <div className="grid" style={{ gap: 12 }}>
              <Link className="card" href="/privacy"><h3>Privacy Policy</h3><p>What we collect and why.</p></Link>
              <Link className="card" href="/dpa"><h3>Data Processing</h3><p>Our role and commitments when we process data for you.</p></Link>
              <Link className="card" href="/subprocessors"><h3>Sub-processors</h3><p>The services we rely on.</p></Link>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="wrap" style={{ textAlign: "center" }}>
            <h2>Found a security issue?</h2>
            <p className="intro" style={{ margin: "0 auto 28px" }}>Please tell us privately so we can fix it quickly.</p>
            <Link className="btn go" href="/contact">Contact us</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
