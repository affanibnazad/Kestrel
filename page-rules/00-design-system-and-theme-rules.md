# Page Rules 00: Design System & Theme Rules

This document defines the universal visual rules for the Kestrel application. Every page and component must follow these guidelines.

---

## 1. Typography
- **Font**: Apple SF Pro (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", -apple-system-subheadline, sans-serif`).
- **Hierarchy**:
  - Page Titles (`h1`): 22px–24px, 600 weight.
  - Section Headers (`h2`): 16px–18px, 600 weight.
  - Card Titles (`b`): 14px–15px, 600 weight.
  - Body Text (`p`, `span`): 13.5px–14.5px, 400–500 weight.
  - Micro / Captions (`small`): 11.5px–12.5px, 400 weight.

---

## 2. Universal Capsule Toggles
All tab selectors and filter bars must be rendered as **rounded capsule toggle systems**:
- Selector classes: `.seg`, `.kcamp-tabs [role="tablist"]`, `.ktabs`, `.int-tabs`, `.br-filters`, `.kinbox-tabs`.
- Structure:
  - Container: Pill shape (`border-radius: 9999px`), 1px subtle border, height 34px–36px, `display: inline-flex`, `padding: 2px 4px`.
  - Active button: Pill shape (`border-radius: 9999px`), bold text, solid contrasting background.
  - Inactive button: Transparent background, muted text, smooth hover.
- **Strict Prohibition**: **ZERO bottom underlines**. **ZERO full-width divider lines** across the page underneath tablists.

---

## 3. 100% Rounded Button System
- Every button site-wide has `border-radius: 9999px !important;`.
- Applies to `.btn`, `.kbtn`, `.kcamp-add`, action buttons, modal triggers, search buttons, and review capsules.
- Haptic press: `transform: scale(0.96);` on `:active`.

---

## 4. Flat Grounded Layout (Zero Floating Shadows)
- Cards, lists, and tables must sit flat on the surface: `box-shadow: none !important;`.
- No `translateY(-2px)` hover elevation lifts.
- Clean separation achieved strictly with 1px solid borders (`var(--k-border)` or `#E2E6EE`).

---

## 5. Theme Rules

| Theme | Canvas | Card Background | Primary Text | Accent |
|---|---|---|---|---|
| **Light** | Warm stone `#F9F9F8` | `#FFFFFF` | `#1F1E1C` | `#3B82F6` |
| **Dark** | Pure deep slate `#0B0E14` | `#141822` | `#F3F4F6` | `#3B82F6` |
| **Gradient (SaaS)** | Modern grayish `#ECEEF2` | White body + multi-color radiant top mesh | `#0F172A` | `#6366F1` / `#8B5CF6` |
| **Auto** | Matches OS preference | Matches OS preference | Matches OS preference | Dynamic |

---

## 6. Single Outer Outline Rule
- Input boxes, search bars, and dropdown triggers must never display nested boxes.
- Only one clean 1px border on the outer boundary.
