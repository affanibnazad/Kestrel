# Kestrel AI chat — complete design spec

Every value in this document is taken from the real code:
`src/app/kestrel-ai-chat/ai-chat.tsx`, `src/app/kestrel-ai-chat/ai-chat.module.css`,
`src/app/kestrel-ai-chat/page.tsx`, `src/lib/ai-chat-script.ts`.

**How to read it:** each table gives the exact value used in the product. Nothing here is a
suggestion — it is what is in the file.

---

## 1. Identity

| Thing | Value |
|---|---|
| Product name | **Kestrel** |
| Page name | **Kestrel AI chat** |
| Route | `/kestrel-ai-chat` |
| Page title (tab) | `Kestrel AI chat` |
| Page description | `Ask Kestrel AI about your leads, campaigns, replies and sending.` |
| Search engines | `robots: { index: false, follow: false }` |
| Brand mark | The letter **K** whose upper arm is a three-feather wing |
| Voice | Calm, plain, one question at a time. No instruction text on screen |
| Look names | **Light**, **Dark**, **Gradient** |

---

## 2. Typography

### Font stack

One font only — the Apple system font. No webfonts, no Inter, no Poppins.

```css
--font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

This variable lives in the **global** stylesheet (`src/app/globals.css`, line 9). The chat's own
CSS module only uses `font-family: var(--font)`.

| | |
|---|---|
| Applied as | `font-family: var(--font)` on `.page` |
| Buttons and inputs | `font-family: inherit` (they never fall back to the browser default) |
| Weights used | **400, 500, 600 only** |
| Numbers that change | `font-variant-numeric: tabular-nums` (step times, counts, message counter) |

### Size scale

| Element | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|
| Page base | 15px | 400 | — | — |
| Top bar brand | 14.5px | 500 | -0.008em | — |
| Empty-state title | `clamp(26px, 3vw, 34px)` | 400 | -0.028em | — |
| Empty-state subtitle | 15px | 400 | — | — |
| Starter question | 14.5px | 500 | -0.006em | — |
| Starter hint | 13px | 400 | — | — |
| Ghost button (top bar) | 13.5px | 500 | — | — |
| Person's message | 15px | 400 | — | 1.5 |
| Attached file note | 12.5px | 400 | — | — |
| "Thinking" head | 13px | 400 | — | — |
| "Thinking" label | 13px | 500 | — | — |
| Step label | 13.5px | 400 | — | — |
| Step detail | 13px | 400 | — | — |
| Step time | 12px | 400 | — | — |
| Receipt pill | 12.5px | 400 | — | — |
| Receipt count | 12.5px | 500 | — | — |
| **The answer** | **15.5px** | 400 | -0.006em | **1.66** |
| Answer bold | 15.5px | 600 | — | — |
| Composer input | 15.5px | 400 | — | 1.55 |
| New-chat button | 13px | 500 | — | — |
| Model button | 13.5px | 500 | — | — |
| Model menu name | 13.5px | 500 | — | — |
| Model menu note | 12px | 400 | — | — |
| Slash command | 13px | 500 | — | — |
| Slash label | 12.5px | 400 | — | — |
| Attached chip | 12.5px | 400 | — | — |
| Rail card title | 12px | 500 | **0.02em**, UPPERCASE | — |
| Rail row | 13px | 400 | — | — |
| Rail value | 13px | 500 | — | — |
| Rail note | 12.5px | 400 | — | 1.5 |
| Rail list item | 12.5px | 400 | — | — |

### Answer spacing

| | |
|---|---|
| Paragraph gap | 13px (last one 0) |
| List indent | 22px |
| List item gap | 6px |
| Bold inside answer | `font-weight: 600` |

---

## 3. Colour system

### Light look (default)

| Role | Hex |
|---|---|
| Primary text | `#1F1F1F` |
| Page background | `#FFFFFF` |
| Strong text | `#3C4043` |
| Secondary text | `#5F6368` |
| Tertiary text | `#80868B` |
| Muted text | `#9AA0A6` |
| Border | `#E8EAED` |
| Soft fill (buttons, pills) | `#F1F3F4` |
| Hover fill | `#F8F9FA` |
| Stronger border | `#DADCE0` |
| Person's bubble | `#EAF0FB` |
| Person's bubble text | `#2A4C7E` |
| Focus border | `#C6DAFC` |
| Accent blue (done dot, receipt icon) | `#5B8DEF` |
| Accent light blue (running dot) | `#7EA5DE` |
| Waiting dot | `#DADCE0` |
| Mic button while listening — background | `#E8F0FE` |
| Mic button while listening — ink | `#174EA6` |
| Remove-file button hover | `#E4E6E9` |
| Look-switch shadow | `rgba(16, 24, 40, 0.10)` |

### Dark look

| Role | Hex |
|---|---|
| Primary text | `#E8EAED` |
| Page background | `#131417` |
| Surface (cards, composer, buttons) | `#1E2024` |
| Surface hover | `#232629` |
| Soft fill (chips, menu items) | `#26282C` |
| Border | `#2C2F34` |
| Stronger border | `#3C4043` |
| Secondary text | `#9AA0A6` |
| Tertiary text | `#80868B` |
| Step label | `#C4C7C5` |
| Person's bubble | `#26354F` |
| Person's bubble text | `#C6DAFC` |
| Focus border | `#3C4A63` |
| Waiting dot | `#3C4043` |
| Send button background | `#E8EAED` |
| Send button ink | `#1B1C1D` |
| Look-switch "on" | `#3C4043` (no shadow) |

### Gradient look

| Role | Hex |
|---|---|
| Primary text | `#0F172A` |
| Page background | `#ECEEF2` |
| Surface | `#FFFFFF` |
| Surface hover | `#FAFBFF` |
| Border | `#E2E6EE` |
| Hover border | `#C7D2FE` |
| Strong text | `#1E293B` |
| Secondary text | `#64748B` |
| Tertiary text | `#94A3B8` |
| Indigo accent | `#4F46E5` |
| Chip background | `#EEF2FF` |
| Chip text | `#3730A3` |
| Chip remove hover | `#E0E7FF` |
| Focus border | `#A5B4FC` |
| Waiting dot | `#CBD5E1` |
| Writing cursor (nib) | `#4F46E5` |

### Shadows

| Where | Value |
|---|---|
| Look-switch button | `0 1px 2px rgba(16, 24, 40, 0.10)` |
| Model menu / slash menu | `0 18px 40px -22px rgba(16, 24, 40, 0.35)` |
| Gradient look — starter card | `0 10px 26px -20px rgba(15, 23, 42, 0.45)` |
| Gradient look — composer | `0 14px 34px -22px rgba(15, 23, 42, 0.42)` |
| Gradient look — rail card | `0 10px 26px -20px rgba(15, 23, 42, 0.40)` |
| Gradient look — receipt pill | `0 6px 16px -14px rgba(15, 23, 42, 0.40)` |
| Gradient look — look-switch "on" | `0 1px 2px rgba(15, 23, 42, 0.10)` |
| Mobile scrim | `rgba(32, 33, 36, 0.32)` |

---

## 4. Gradients

Colour never comes from a flat fill alone. Every gradient is a **`linear-gradient` layer**.
There is **no** `radial-gradient`, **no** `backdrop-filter`, **no** `blur()` anywhere.

### 4.1 The brand gradient (the K mark, the particles, the gradient-look button)

```
linear-gradient(x1=0, y1=1 → x2=1, y2=0)
  0%    #7EA5DE   periwinkle
  52%   #8B5CF6   violet
  100%  #F472B6   pink
```

Used by: the K mark in the Gradient look, the three spinning particles, and the four-point
star shape.

The four-point star (`GemStar`) uses the same three colours but stops at **0% / 55% / 100%**.

### 4.2 The gradient-look bubble and send button

```
linear-gradient(135deg)
  0%    #7EA5DE
  62%   #8B5CF6
  100%  #A855F7
```

Used by: the person's message bubble and the round send button, **only** in the Gradient look.

### 4.3 The canvas wash — Light look

Four stacked `linear-gradient` layers, each fading fully to transparent **well inside the
screen**, so there is no visible edge. The colours blend into each other and into the white.

| Angle | Stops |
|---|---|
| 118deg | `rgba(126,165,222,0.26)` 0% → `0.12` 14% → `0.04` 26% → `0` 40% |
| 298deg | `rgba(139,92,246,0.20)` 0% → `0.09` 15% → `0.03` 28% → `0` 44% |
| 45deg | `rgba(14,165,164,0.16)` 0% → `0.07` 16% → `0.02` 30% → `0` 46% |
| 135deg | `rgba(244,114,182,0.14)` 0% → `0.06` 16% → `0.02` 30% → `0` 46% |

`background-size: 130% 130%` on all four, `background-repeat: no-repeat`.

### 4.4 The canvas wash — Dark look

Same four angles, the same colours, **slightly weaker**:

| Angle | Stops |
|---|---|
| 118deg | `rgba(126,165,222,0.24)` → `0.11` → `0.04` → `0` |
| 298deg | `rgba(139,92,246,0.18)` → `0.08` → `0.03` → `0` |
| 45deg | `rgba(14,165,164,0.14)` → `0.06` → `0.02` → `0` |
| 135deg | `rgba(244,114,182,0.12)` → `0.05` → `0.02` → `0` |

### 4.5 The canvas wash — Gradient look

A different palette, **five** layers (the fifth is a white veil over the top):

| Angle | Stops |
|---|---|
| 118deg | `rgba(99,102,241,0.26)` → `0.11` → `0.03` → `0` (indigo) |
| 298deg | `rgba(236,72,153,0.24)` → `0.10` → `0.03` → `0` (pink) |
| 45deg | `rgba(14,165,164,0.22)` → `0.09` → `0.03` → `0` (teal) |
| 135deg | `rgba(249,115,22,0.18)` → `0.08` → `0.02` → `0` (orange) |
| 180deg | `rgba(255,255,255,0.58)` 0% → `0.22` 38% → `0` 72% (white veil) |

### 4.6 The top bar and the rail — edge fades

| Where | Light | Dark | Gradient |
|---|---|---|---|
| Top bar | `to bottom`: white `0.94` → `0.72` at 55% → `0` at 100% | `#131417` `0.94` → `0.72` → `0` | `#ECEEF2` `0.94` → `0.70` → `0` |
| Rail (desktop) | `to right`: white `0` → `0.72` at 26% → `0.94` at 100% | `rgba(19,20,23,0)` → `rgba(23,24,27,0.72)` at 26% → `rgba(23,24,27,0.94)` | white `0` → `0.55` at 26% → `0.92` at 100% |
| Rail (mobile sheet) | white `0` → `0.80` at 22% → `0.97` at 100% | — | — |

---

## 5. Icons

### 5.1 Drawn inside the chat file (so the shared icon map is untouched)

| Icon | Shape | Stroke / fill |
|---|---|---|
| **Sun** (Light look) | circle r=4.1 + 8 rays | stroke 1.7, round caps |
| **Moon** (Dark look) | crescent, 1 path | stroke 1.7, round caps and joins |
| **Sparkle** (Gradient look) | four-point star, filled | `fill: currentColor` |
| **Paperclip** | 1 path | stroke 1.7, round caps and joins |
| **Arrow up** (send) | 2 paths (stem + chevron) | stroke 1.9, round caps |
| **K mark** | 1 rect (stem) + 3 paths (feathers) + 1 path (leg) | fill, no stroke |
| **GemStar** (particle) | four-point star | filled with the brand gradient |

The four-point star path (used by both the sparkle icon and the particles):

```
M12 1.8c.55 5.85 3.85 9.15 9.7 9.7-5.85.55-9.15 3.85-9.7 9.7-.55-5.85-3.85-9.15-9.7-9.7 5.85-.55 9.15-3.85 9.7-9.7Z
```

### 5.2 The K mark geometry

Drawn on a 32×32 viewBox, **ink only** — no tile around it.

| Part | Shape |
|---|---|
| Stem | rect `x 7.6, y 6, w 4.4, h 20, rx 1.4` |
| Feather 1 | `M12 16Q19 12.8 25.2 5.4Q23.8 11.5 17.2 15.4Z` — opacity **1** |
| Feather 2 | `M12.1 16.9Q18.8 15.3 23.8 10.7Q21.9 14.8 16.9 16.9Z` — opacity **0.8** |
| Feather 3 | `M12.2 17.8Q17.6 17.2 21.6 15.1Q19.7 17.7 15.8 18.2Z` — opacity **0.6** |
| Leg | `M14.6 18.6L24 26H19.5L12.6 20.2Z` |

Each feather rotates from **left center** (`transform-origin: left center`, `transform-box: fill-box`).

### 5.3 Icons from the shared line set (`lucide-react`, via `Line`)

| Where | Icon name |
|---|---|
| Model menu chevron | `chevronDown` |
| Remove file, close rail | `close` |
| Microphone | `mic` |
| New chat | `plus` |
| Open context (mobile) | `sliders` |
| Receipt — leads | `people` |
| Receipt — replies | `inbox` |
| Receipt — campaigns | `folder` |
| Receipt — accounts | `mail` |
| Receipt — business | `building` |
| Receipt — rules | `sliders` |
| Receipt — sequence | `list` |

All line icons: `stroke-width: 1.5`, `fill: none`, `stroke: currentColor`, `18×18` by default.

### 5.4 Icon sizes

| Icon | Size |
|---|---|
| Ghost button | 16px |
| Look switch | 15px (26px on narrow phones) |
| Paperclip, microphone | 17px |
| New chat | 15px |
| Model menu chevron | 14px |
| Send arrow | 16px |
| Receipt icon | 13px |
| Rail item icon | 13px |
| Rail close | 15px |
| K mark — empty state | 30px |
| K mark — answer head | 22px |
| K mark — model button | 15px |

---

## 6. Shape language

### Corner radius

| Element | Radius |
|---|---|
| Send button, icon buttons, look-switch buttons, dots | `50%` (circle) |
| Pills: ghost button, look switch, model button, new chat, receipt, attached chip | `999px` |
| Composer | 26px (22px on narrow phones) |
| Person's bubble | `22px 22px 6px 22px` — **the bottom-left corner is tighter**, so it points back at the composer |
| Starter card | 20px |
| Rail card | 18px |
| Model menu, slash menu | 16px |
| Menu item | 10px |
| Rail close button | 50% |
| Writing cursor (nib) | 1px |

### Borders

| | |
|---|---|
| Standard | `1px solid #E8EAED` (light) |
| Dark look | `1px solid #2C2F34` |
| Gradient look | `1px solid #E2E6EE` |
| Composer focus | `#C6DAFC` (light) / `#3C4A63` (dark) / `#A5B4FC` (gradient) |

---

## 7. Layout

### Desktop

| | |
|---|---|
| Page | flex column, `height: 100dvh`, `overflow: hidden` |
| Top bar | flex row, gap 12px, padding `12px 20px` |
| Body | CSS grid: `minmax(0, 1fr)` + **316px** rail |
| Thread | scrollable, padding `18px 24px 8px`, `scroll-behavior: smooth` |
| Thread content | max-width **760px**, centred, gap **26px** between messages |
| Composer | max-width **760px**, centred |
| Rail | 316px, padding `18px 16px`, own scroll |

### The composer

| | |
|---|---|
| Padding | `12px 12px 10px 18px` |
| Radius | 26px |
| Input | textarea, `min-height 26px`, `max-height 180px`, auto-grows, no resize handle |
| Placeholder | `Ask Kestrel anything, or type / for commands…` |
| Tool row | margin-top 4px, gap 10px, left group gap 4px, right group gap 8px |

### The context rail (right side)

Two cards:

1. **Context** — title is "What I am looking at" once there is a turn, "Context" before that.
   Rows: whatever the turn reports, then **Model** (the AI name the server reported, else the
   picked model), then **Attached** (file count) when files exist.
2. **Searches** — the list of searches, each with its kind icon, the query and the count.

Empty states: "Nothing yet. Ask a question and Kestrel shows what it opens." and
"No searches yet."

### Mobile — 980px and below

| | |
|---|---|
| Grid | one column; the rail becomes a fixed sheet on the right |
| Sheet width | `min(330px, 86vw)`, slides in with `transform: translateX(102%)` → `none` |
| Scrim | fixed, full screen, `rgba(32,33,36,0.32)` |
| Thread padding | `14px 16px 8px` |
| Composer padding | `6px 16px 12px` |
| Starters | one column instead of two |
| Empty state | padding-top `4vh` |
| Person's bubble | max-width 88% (was 78%) |

### Narrow phones — 620px and below

| | |
|---|---|
| Top bar | padding `10px 14px`, brand 14px |
| Button labels | hidden — icons only |
| Look-switch buttons | 26×26 |
| Thread gap | 22px |
| Answer row gap | 9px |
| Composer | padding `10px 10px 8px 14px`, radius 22px, input 15px |
| Step row | reflows to `"dot label ms" / "dot detail detail"` so nothing is squeezed |

---

## 8. Motion

Nine keyframes. **No animation library** — all CSS.

| # | Keyframe | What moves | Duration | Easing | Notes |
|---|---|---|---|---|---|
| 1 | `washDrift` | The canvas wash drifts 2% in each corner | **30s** | ease-in-out, infinite, alternate | 4 background-position layers |
| 2 | `fadeUp` | The person's message and the answer block rise into place | **0.26s** (message) / **0.30s** (answer) | `cubic-bezier(0.22, 1, 0.36, 1)` | `translateY(8px)` → none |
| 3 | `revealIn` | **Each word** fades up as it is written | **420ms** | `cubic-bezier(0.16, 1, 0.3, 1)` | `translateY(6px)` → none. The entrance is longer than the gap between words, so words overlap and the line reads as one smooth wave |
| 4 | `wingBeat` | The three feathers beat, one after the other | **1.05s** | `cubic-bezier(0.45, 0, 0.55, 1)`, infinite | `0° → -17° / -1.6px` at 30% → `8° / 0.6px` at 62% → back to 0°. Delay per feather: **i × 140ms** |
| 5 | `kBreathe` | The K mark breathes while it works | **1.6s** | ease-in-out, infinite | `scale(1)` → `scale(1.07)` |
| 6 | `gemSpin` | The particles drift out and spin | **2.6s / 2.1s / 3s** | linear, infinite | `opacity 0 → 1 (22%) → 0.9 (72%) → 0`, `scale 0.35 → 1`, `rotate 120deg`, travels to `--mx` / `--my`. Delays: 0ms, 420ms, 840ms |
| 7 | `pulse` | The running step dot pulses | **1.2s** | ease-in-out, infinite | `opacity 0.3 → 1`, `scale 0.75 → 1.15` |
| 8 | `blink` | The writing cursor blinks | **1.05s** | ease-in-out, infinite | `opacity 1 → 0.12` |
| 9 | `fade` | The mobile scrim appears | **0.24s** | ease | `opacity 0 → 1` |

### The writing rhythm

The answer is written one word at a time.

| Step | Timing |
|---|---|
| Wait before the first word | **170ms** |
| Between words | the model's `word` value |
| After the last word of a line | the model's `pause` value |
| After the last word of the answer | the mark stops working |

Changing the model **mid-answer** changes the speed immediately — the answer does not restart.

### Model picker — what each one changes

| Model | Note on screen | Think (ms) | Word (ms) | Pause (ms) |
|---|---|---|---|---|
| **Kestrel Pro** | "Best answers, normal speed" | 430 | 68 | 240 |
| **Kestrel Fast** | "Quick answers, shorter steps" | 220 | 40 | 130 |
| **Kestrel Thinking** | "Longer think, every step shown" | 780 | 68 | 290 |

`think` is the pause before a scripted step starts. The real model is chosen by the server; this
picker only changes the local speed and look.

### Small transitions (hover and press)

| Element | Transition |
|---|---|
| Buttons (background, colour) | 0.16s ease |
| Cards, model menu items (background, border) | 0.18s ease |
| Send button on hover | `scale(1.06)`, 0.16s ease |
| Send button on press | `scale(0.95)`, 0.16s ease |
| Mobile rail sheet | `transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)` |
| Thread scrolling | smooth (auto when reduced motion) |

### Reduced motion

`@media (prefers-reduced-motion: reduce)` turns **all** of it off:

- the wash stops drifting
- messages and the scrim stop fading up
- the running dot stops pulsing
- words appear instantly instead of fading in
- the writing cursor stops blinking
- the particles disappear completely (`opacity: 0`)
- the wing stops beating, the mark stops breathing
- scrolling becomes instant
- the send button does not scale on hover or press

The JavaScript also checks the same setting: with reduced motion on, the answer appears in full
at once and the steps run without pauses.

---

## 9. The three looks

| Look | Name | Icon | Page background |
|---|---|---|---|
| `light` | Light | Sun | `#FFFFFF` |
| `dark` | Dark | Moon | `#131417` |
| `gradient` | Gradient | Sparkle | `#ECEEF2` |

### How the look is chosen and remembered

| | |
|---|---|
| Switch | The small sun / moon / sparkle group in the top bar — a `role="radiogroup"` with three `role="radio"` buttons |
| Storage | `localStorage` key **`kestrel-look`**, value `{ "theme": "light" }` |
| Attribute | `data-chat-theme` on `<html>` — this is what the CSS reacts to |
| Also set | `data-theme` on `<html>`: `dark` for Dark, `light` for the other two |
| First visit | Follows the system: `prefers-color-scheme: dark` → Dark, otherwise Light |
| No flash | An inline script in `page.tsx` reads the key and sets the attributes **before the first paint** |

The same `kestrel-look` key is used by the main Kestrel App, so the chat and the app always look
the same.

---

## 10. Component inventory

| Part | Class | What it is |
|---|---|---|
| Page shell | `.page` | flex column, full height |
| Canvas wash | `.wash` | the four-layer colour gradient behind everything |
| Top bar | `.top` | brand + look switch + context button |
| Brand | `.brand` | "Kestrel AI chat" |
| Look switch | `.lookSwitch` / `.lookBtn` / `.lookBtnOn` | Light / Dark / Gradient |
| Ghost button | `.ghostBtn` | quiet outline-free button |
| Body grid | `.body` | thread + rail |
| Thread | `.thread` / `.threadInner` | the scrolling conversation |
| Empty state | `.empty`, `.emptyMark`, `.emptyTitle`, `.emptySub` | "Ask Kestrel" + starters |
| Starter card | `.starter`, `.starterQ`, `.starterHint` | a question you can tap |
| Person's message | `.msgUser`, `.msgFiles` | right-aligned soft bubble |
| Answer row | `.msgBot`, `.botBody` | the K mark + the answer |
| Thinking head | `.botHead`, `.thinkLabel`, `.thinkMeta` | "Thinking" / "Thought through" + step count + total ms |
| Steps | `.steps`, `.step`, `.dot`, `.dotWait`, `.dotRun`, `.dotDone`, `.stepLabel`, `.stepDetail`, `.stepMs` | the visible work |
| K mark | `.kWrap`, `.kmark`, `.feather`, `.kBusy` | the wing and the mark |
| Particles | `.motes`, `.mote` | the three spinning stars |
| Receipts | `.receipts`, `.receipt`, `.receiptQuery`, `.receiptCount` | what it searched for |
| The answer | `.answer`, `.pLine`, `.wordRow`, `.revealWord`, `.nib` | the written text |
| Composer | `.composerWrap`, `.composer`, `.composerInput` | the input card |
| Tool row | `.composerBar`, `.barLeft`, `.barRight`, `.iconBtn`, `.iconBtnLive` | attach, mic, new chat / model, send |
| New chat | `.newChatBtn` | |
| Model picker | `.modelWrap`, `.modelBtn`, `.modelName`, `.modelMenu`, `.modelItem`, `.modelItemOn`, `.modelItemName`, `.modelItemNote` | Claude-style menu |
| Slash menu | `.slashMenu`, `.slashItem`, `.slashCmd`, `.slashLabel` | the `/` commands |
| Attached files | `.attached`, `.attachedChip`, `.attachedName`, `.attachedRemove` | |
| Rail | `.rail`, `.railOpen`, `.railClose`, `.railCard`, `.railTitle`, `.railRows`, `.railRow`, `.railLabel`, `.railValue`, `.railNote`, `.railList`, `.railItem`, `.railItemText` | the right-hand context |
| Scrim | `.scrim` | mobile only |

---

## 11. Every string on the page

| Where | Text |
|---|---|
| Top bar | `Kestrel AI chat` |
| Empty title | `Ask Kestrel` |
| Empty subtitle | `Your leads, campaigns, replies and sending — one question away.` |
| Starter 1 | `How are my campaigns doing?` — "Replies, bounces and what to fix" |
| Starter 2 | `Which replies need an answer?` — "From your Replies" |
| Starter 3 | `Are my email accounts ready to send?` — "Limits, bounces and domain health" |
| Starter 4 | `Write emails for my Good leads` — "First email and follow-ups" |
| Thinking head | `Thinking` → `Thought through` |
| Step counter | `3 steps`, `1 step`, and ` · 1240 ms` when the total is known |
| Composer placeholder | `Ask Kestrel anything, or type / for commands…` |
| New chat | `New chat` |
| Commands | `/campaigns` Campaigns · `/replies` Replies · `/accounts` Email accounts · `/write` Write emails |
| Rail title | `Context` → `What I am looking at` |
| Rail rows | `Model`, `Attached`, `Messages today` |
| Rail card 2 | `Searches` |
| Rail empty | `Nothing yet. Ask a question and Kestrel shows what it opens.` / `No searches yet.` |
| Live model row | the name the server reports, e.g. `Kestrel Pro (live)` |
| Live usage row | `Messages today` → `3 of 20` |
| Error | `Kestrel AI could not answer just now. Try again.` |
| No connection | `No connection. Check your internet and try again.` |

---

## 12. Accessibility

| | |
|---|---|
| Look switch | `role="radiogroup"` + `role="radio"` + `aria-checked` + `aria-label` + `title` |
| Model picker | `aria-haspopup="listbox"`, `aria-expanded`, `role="listbox"`, `role="option"`, `aria-selected` |
| Every icon-only button | an `aria-label` and a `title` |
| Decorative SVGs | `aria-hidden="true"` |
| Numbers that change | `font-variant-numeric: tabular-nums` so they do not jitter |
| Motion | `prefers-reduced-motion` honoured in **both** CSS and JavaScript |
| Keyboard | Enter sends, Shift+Enter makes a new line; every control is reachable by keyboard |
| Focus | the composer border changes colour on focus (no browser-default outline) |

---

## 13. Storage keys

| Key | What it holds |
|---|---|
| `kestrel-ai-chat-v1` | The conversation (`{ msgs: [...] }`) |
| `kestrel-ai-chat-model` | The picked model (`pro` / `fast` / `thinking`) |
| `kestrel-look` | The look (`{ theme: "light" \| "dark" \| "gradient" }`) — shared with the main App |

---

## 14. The rules behind all of this

**Do**

- Use the Apple system font, weights 400 / 500 / 600 only
- Build colour from `linear-gradient` layers
- Keep every style inside the CSS module
- Keep the motion short, calm and eased — nothing bounces, nothing pops
- Leave generous space; use thin borders and soft corners
- Put help in a `?` circle or a tooltip, never as text on the page
- Make sure every button does something

**Do not**

- Do not use `backdrop-filter`, `blur()`, or `radial-gradient`
- Do not touch the global stylesheet for this page
- Do not add a webfont
- Do not add a log-in screen to the chat
- Do not put a secret in the browser
- Do not render an answer as raw HTML

---

## 15. Source files

| File | Lines | What is in it |
|---|---|---|
| `src/app/kestrel-ai-chat/page.tsx` | 33 | The route, the metadata, the pre-paint theme script |
| `src/app/kestrel-ai-chat/ai-chat.tsx` | 858 | Every component, the icons, the model table, the commands, the logic |
| `src/app/kestrel-ai-chat/ai-chat.module.css` | 908 | Every style, every gradient, every keyframe, all three looks |
| `src/lib/ai-chat-script.ts` | 192 | The scripted answers, the starters, the shared types |
| `src/lib/ai-chat-live.ts` | 99 | The live client (session check + NDJSON stream) |
| `src/components/ui.tsx` | 144 | `Line` and `MARK_PATHS` |
| `src/lib/assistant.ts` | 66 | `toBlocks` (markdown → plain blocks) |
