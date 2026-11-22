"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Tip } from "@/components/ui";
import AssistantPersonal from "./assistant-personal";
import AssistantChat, { type ChatQuestion } from "./assistant-chat";
import AiActivityView from "./ai-activity-view";

type Acct = { team_id: string; role: string } | null;

export default function AssistantView({
  account,
  demo,
  toast,
  tools,
  question,
  onAsked,
  onChatFrame,
}: {
  account: Acct;
  demo: boolean;
  toast: (t: string) => void;
  tools: ReactNode;
  question?: ChatQuestion | null;
  onAsked?: () => void;
  onChatFrame?: (on: boolean) => void;
  editable?: boolean;
  go?: (view: string) => void;
  addDnc?: unknown;
  onChanged?: () => void;
  dnc?: unknown;
}) {
  const [tab, setTab] = useState<"chat" | "tools" | "activity" | "personal">("chat");

  // A question sent from the search box at the top of the App opens the chat.
  useEffect(() => {
    if (!question) return;
    const t = setTimeout(() => setTab("chat"), 0);
    return () => clearTimeout(t);
  }, [question]);

  // The chat is the one tab that fills the page: the App tells the shell so the
  // pane can become exactly one screen tall and the composer stays at the bottom.
  useEffect(() => {
    if (tab !== "chat") {
      onChatFrame?.(false);
      return;
    }
    onChatFrame?.(true);
    return () => onChatFrame?.(false);
  }, [tab, onChatFrame]);

  return (
    <div className={`app-page as-page${tab === "chat" ? " as-chat-page" : ""}`}>
      <header className="head">
        <div>
          <h1>
            Kestrel AI{" "}
            <Tip text="Ask Kestrel anything about your leads, campaigns, replies and sending. Score many leads at once, write their emails, customize tone and persona, and inspect the activity log of everything AI changed for your team." />
          </h1>
          <span className="sub">
            {tab === "chat"
              ? "Ask about your leads, campaigns, replies and sending"
              : tab === "tools"
              ? "Score many leads and write their emails at once"
              : tab === "activity"
              ? "Everything Kestrel AI changed for your team"
              : "Your AI, about you, and what it remembers"}
          </span>
        </div>
        <div className="head-actions">
          <div className="seg" role="tablist" aria-label="Kestrel AI sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "chat"}
              className={tab === "chat" ? "on" : ""}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "tools"}
              className={tab === "tools" ? "on" : ""}
              onClick={() => setTab("tools")}
            >
              Score and write
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "activity"}
              className={tab === "activity" ? "on" : ""}
              onClick={() => setTab("activity")}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "personal"}
              className={tab === "personal" ? "on" : ""}
              onClick={() => setTab("personal")}
            >
              Personalize
            </button>
          </div>
        </div>
      </header>
      {tab === "personal" ? (
        <AssistantPersonal account={account} demo={demo} toast={toast} />
      ) : tab === "activity" ? (
        <AiActivityView account={account} demo={demo} />
      ) : tab === "chat" ? (
        <div className="as-chat-wrap">
          <AssistantChat question={question} onAsked={onAsked} />
        </div>
      ) : (
        <div className="as-tools">{tools}</div>
      )}
    </div>
  );
}
