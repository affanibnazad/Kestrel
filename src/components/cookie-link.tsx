"use client";

// "Cookie settings" in the footer: reopens the cookie choices.
export default function CookieSettingsLink() {
  return (
    <button type="button" className="footer-link-btn" onClick={() => window.dispatchEvent(new Event("kestrel-cookie-settings"))}>
      Cookie settings
    </button>
  );
}
