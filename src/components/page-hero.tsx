import Backdrop from "@/components/backdrop";
import SiteHeader from "@/components/site-header";

// Inner pages: the page title on the colour panel. The top bar sits outside the panel so page content never covers it.
export default function PageHero({ eyebrow, title, text }: { eyebrow?: string; title: string; text?: string }) {
  return (
    <>
    <SiteHeader onColor />
    <div className="page-hero">
      <Backdrop fade={540} />
      <div className="wrap page-hero-text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {text ? <p className="lead">{text}</p> : null}
      </div>
    </div>
    </>
  );
}
