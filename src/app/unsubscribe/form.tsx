"use client";

import { useEffect, useState } from "react";

export default function UnsubscribeForm() {
  const [token, setToken] = useState("");
  useEffect(() => { Promise.resolve().then(() => setToken(new URLSearchParams(location.search).get("t") || "")); }, []);
  return (
    <form className="redeem-card" method="post" action={`/api/mail/unsubscribe?t=${encodeURIComponent(token)}`}>
      <h1>Unsubscribe</h1>
      <p className="redeem-text">Click the button and this sender will not email you again through Kestrel.</p>
      <div className="redeem-acts"><button className="btn go" type="submit" disabled={!token}>Unsubscribe me</button></div>
    </form>
  );
}
