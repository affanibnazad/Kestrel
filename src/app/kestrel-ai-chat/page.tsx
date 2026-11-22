import type { Metadata } from "next";
import AiChat from "./ai-chat";

// The Kestrel AI chat stands on its own: no sign-in, no App shell, no other Kestrel screen.
// Only the chat is on this page.
export const metadata: Metadata = {
  title: "Kestrel AI chat",
  description: "Ask Kestrel AI about your leads, campaigns, replies and sending.",
  robots: { index: false, follow: false },
};

// The look this person already chose in the App is kept (the same key the App
// uses): Light, Dark or Gradient. It is set before the first paint so the page
// never flashes the wrong colours. "Automatic" follows the system.
const THEME = `(function(){try{
var l=JSON.parse(localStorage.getItem("kestrel-look")||"{}");
var t=l&&l.theme;
if(t!=="light"&&t!=="dark"&&t!=="gradient"){
t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";
}
var d=document.documentElement;
d.setAttribute("data-chat-theme",t);
d.setAttribute("data-theme",t==="dark"?"dark":"light");
}catch(e){}})();`;

export default function KestrelAiChatPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME }} />
      <AiChat />
    </>
  );
}
