import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import { SITE } from "@/lib/site";
import ContactForm from "./form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact the Kestrel team about the product, your account, privacy or security.",
  alternates: { canonical: "/contact" },
};

const TOPICS = [
  ["Product questions", "How Kestrel works, what it can do for your team.", SITE.contactEmail],
  ["Privacy and data requests", "Access, correction or deletion of personal data.", SITE.privacyEmail],
  ["Security", "Report a security issue privately. Choose the Security topic.", SITE.contactEmail],
];

export default function ContactPage() {
  return (
    <div className="site">
      <PageHero eyebrow="Contact" title="We would like to hear from you" text="Tell us what you need and we will reply as soon as we can." />
      <main>
        <section className="section">
          <div className="wrap contact-grid">
            <div className="contact-side">
              <h2>Send us a message</h2>
              <p className="intro">Questions about Kestrel, plans for your team, billing, privacy or security: write to us here and a person replies, usually within one working day.</p>
              <div className="tlist">
                {TOPICS.map(([t, d, mail]) => (
                  <div key={t}>
                    <h3>{t}</h3>
                    <p>{d}{mail && !mail.startsWith("[") ? <><br /><b>{mail}</b></> : null}</p>
                  </div>
                ))}
              </div>
            </div>
            <ContactForm />
          </div>
        </section>
        <section className="section alt">
          <div className="wrap split">
            <div>
              <h2>Looking for answers right now?</h2>
              <p className="intro">The Help centre covers installing, every source, AI scoring, email drafts and safe collecting.</p>
              <Link className="btn go" href="/help">Visit the Help centre</Link>
            </div>
            <div className="tlist">
              <div>
              <h3>Company details</h3>
              <p>{SITE.legalName.startsWith("[") ? "Kestrel" : SITE.legalName}{SITE.address.startsWith("[") ? null : <><br />{SITE.address}</>}{SITE.country.startsWith("[") ? null : <><br />{SITE.country}</>}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
