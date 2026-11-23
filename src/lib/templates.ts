// TODO: Texts are video/agency-specific. Generalize per service in Task 1.2.
// Cold Outreach Template Library (Phase 4E, 19 Nov 2026).
// Curated, spam-checked templates for small agencies, motion designers, video editors, and freelancers.
// Pure definitions: used by SequencesView, Kestrel AI, and campaign builders.

import type { Step } from "./sequence";

export type Template = {
  id: string;
  name: string;
  tagline: string;
  category: "Agency" | "Creator & Podcast" | "Short & Casual" | "Follow-up Framework";
  bestFor: string;
  steps: Step[];
};

export const TEMPLATES: Template[] = [
  {
    id: "agency-whitelabel",
    name: "White-Label Agency Partner",
    tagline: "Short pitch for busy marketing and creative agencies needing extra production hands.",
    category: "Agency",
    bestFor: "Post-production, video editing, motion graphics, and creative studios",
    steps: [
      {
        day: 0,
        subject: "{{SUBJECT}}",
        variants: [
          "video editing overflow for {{FIRST_NAME}}",
          "quick question on your client video work"
        ],
        body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}"
      },
      {
        day: 5,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      },
      {
        day: 10,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      },
      {
        day: 15,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      }
    ]
  },
  {
    id: "short-problem-first",
    name: "Problem-First (<80 words)",
    tagline: "Ultra-concise, conversational inquiry with no fluff and no sales pitch.",
    category: "Short & Casual",
    bestFor: "Cold outreach to founders and heads of marketing",
    steps: [
      {
        day: 0,
        subject: "{{SUBJECT}}",
        variants: [
          "quick question on {{BUSINESS}}",
          "creative work at {{BUSINESS}}"
        ],
        body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}"
      },
      {
        day: 5,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\nQuick follow-up: {{FOLLOW_UP}}"
      },
      {
        day: 12,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      }
    ]
  },
  {
    id: "creator-podcast",
    name: "Podcast & Content Repurposing",
    tagline: "Turns podcast episodes into viral vertical clips (Reels, TikToks, Shorts).",
    category: "Creator & Podcast",
    bestFor: "Podcasters, personal brands, and show hosts",
    steps: [
      {
        day: 0,
        subject: "{{SUBJECT}}",
        variants: [
          "shorts & clips for your recent episode",
          "repurposing your podcast"
        ],
        body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}"
      },
      {
        day: 6,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      },
      {
        day: 14,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      }
    ]
  },
  {
    id: "gentle-closeout",
    name: "Gentle 3-Step Follow-Up",
    tagline: "Soft check-in, concrete offer to help, and a polite door-left-open close-out.",
    category: "Follow-up Framework",
    bestFor: "Any B2B sequence to avoid burning bridges",
    steps: [
      {
        day: 0,
        subject: "{{SUBJECT}}",
        variants: [
          "collaboration with {{BUSINESS}}",
          "helping with your upcoming projects"
        ],
        body: "Hi {{FIRST_NAME}},\n\n{{ICEBREAKER}}\n\n{{ONE_LINE}}\n\n{{QUESTION}}"
      },
      {
        day: 5,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\nSoft check-in here: {{FOLLOW_UP}}"
      },
      {
        day: 12,
        subject: "",
        body: "Hi {{FIRST_NAME}},\n\n{{FOLLOW_UP}}"
      }
    ]
  }
];

export const TEMPLATE_CATEGORIES = ["All", "Agency", "Short & Casual", "Creator & Podcast", "Follow-up Framework"] as const;
