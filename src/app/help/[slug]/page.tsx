import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageHero from "@/components/page-hero";
import SiteFooter from "@/components/site-footer";
import { ARTICLES, HELP_GROUPS, articleBySlug } from "@/lib/help";

export function generateStaticParams() { return ARTICLES.map((a) => ({ slug: a.slug })); }

export async function generateMetadata({ params }: PageProps<"/help/[slug]">): Promise<Metadata> {
  const a = articleBySlug((await params).slug);
  return a ? { title: `${a.title} · Help`, description: a.desc, alternates: { canonical: `/help/${a.slug}` } } : {};
}

// One help article: plain text, steps and tips (text only, no boxes), with the other articles in the same group.
export default async function HelpArticle({ params }: PageProps<"/help/[slug]">) {
  const a = articleBySlug((await params).slug);
  if (!a) notFound();
  const group = HELP_GROUPS.find(([id]) => id === a.group)?.[1] ?? "Help";
  const more = ARTICLES.filter((x) => x.group === a.group && x.slug !== a.slug);
  return (
    <div className="site">
      <PageHero eyebrow={group} title={a.title} text={a.desc} />
      <main className="wrap help-article">
        <article className="prose">
          {a.steps ? <ol>{a.steps.map((s) => <li key={s}>{s}</li>)}</ol> : null}
          {(a.text ?? []).map((p) => <p key={p}>{p}</p>)}
          {a.tips?.length ? (<><h2>Good to know</h2><ul>{a.tips.map((t) => <li key={t}>{t}</li>)}</ul></>) : null}
        </article>
        <aside className="help-more">
          <b>More in {group}</b>
          {more.map((x) => <Link key={x.slug} href={`/help/${x.slug}`}>{x.title}</Link>)}
          <Link href="/help" className="back">All help articles</Link>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
