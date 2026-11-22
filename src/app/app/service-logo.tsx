"use client";

import { useState } from "react";
import { SERVICES, type ServiceId } from "@/lib/connections";

// The company's own logo (files in public/logos, the same ones the extension uses) on a white rounded tile; the old
// coloured letter if the picture cannot load. Logos are fine inside the App (the no-logo rule is for the website only).
export default function ServiceLogo({ id, size = 36 }: { id: ServiceId; size?: number }) {
  const s = SERVICES[id];
  const [failed, setFailed] = useState(false);
  if (!failed && s.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="cn-mark logo" style={{ width: size, height: size }} aria-hidden="true"><img src={s.logo} alt="" onError={() => setFailed(true)} /></span>;
  }
  return <span className="cn-mark" style={{ background: s.tone, width: size, height: size }} aria-hidden="true">{s.mark}</span>;
}
