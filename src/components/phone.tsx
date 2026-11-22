import type { ReactNode } from "react";

// An accurate phone (iPhone 15 Pro proportions: 393 × 852 point screen, thin bezel, black titanium rim),
// drawn in SVG and CSS, no image. Screen content scales with the phone's width.
export default function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="phone" aria-hidden="true">
      <span className="pbtn act" /><span className="pbtn up" /><span className="pbtn down" /><span className="pbtn pwr" />
      <svg className="phone-frame" viewBox="0 0 431 884" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5b5c60" /><stop offset="0.25" stopColor="#2c2d30" /><stop offset="0.5" stopColor="#47484c" /><stop offset="0.75" stopColor="#242527" /><stop offset="1" stopColor="#55565a" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="431" height="884" rx="70" fill="url(#rim)" />
        <rect x="1.2" y="1.2" width="428.6" height="881.6" rx="69" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" />
        <rect x="4" y="4" width="423" height="876" rx="66" fill="#0a0a0b" />
      </svg>
      <div className="phone-screen">
        <span className="island" />
        <div className="phone-status">
          <b>9:41</b>
          <span className="phone-icons">
            <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
            <svg viewBox="0 0 16 12"><path d="M8 2.6c2.4 0 4.6.9 6.3 2.5l1.2-1.3A10.6 10.6 0 0 0 8 .8 10.6 10.6 0 0 0 .5 3.8l1.2 1.3A8.8 8.8 0 0 1 8 2.6zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.2-1.3A7.2 7.2 0 0 0 8 4.4c-1.9 0-3.6.7-4.9 1.9l1.2 1.3c1-.9 2.3-1.4 3.7-1.4zm0 3.5c-.6 0-1.1.2-1.5.6L8 11.8l1.5-1.5c-.4-.4-.9-.6-1.5-.6z" /></svg>
            <svg viewBox="0 0 27 12"><rect x="0.5" y="0.5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="19" height="8" rx="2" /><path d="M24 4v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2z" opacity="0.45" /></svg>
          </span>
        </div>
        <div className="phone-content">{children}</div>
      </div>
    </div>
  );
}
