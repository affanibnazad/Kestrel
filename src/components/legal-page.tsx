import type { ReactNode } from "react";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import { SITE } from "@/lib/site";

export type LegalSection = { id: string; title: string; body: ReactNode };

// Legal pages: plain text rows. Each section title on the left, its text on the right.
export default function LegalPage({ title, intro, sections, updated }: { title: string; intro: string; sections: LegalSection[]; updated?: string }) {
  return (
    <div className="site">
      <PageHero eyebrow={`Last updated ${updated ?? SITE.legalUpdated}`} title={title} text={intro} />
      <main className="wrap legal">
        <nav className="legal-row legal-toc" aria-label="On this page">
          <b>On this page</b>
          <div>{sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}</div>
        </nav>
        {sections.map((s) => (
          <section key={s.id} className="legal-row">
            <h2 id={s.id}>{s.title}</h2>
            <div className="prose">{s.body}</div>
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
