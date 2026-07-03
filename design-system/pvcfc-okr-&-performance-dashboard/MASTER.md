# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** PVCFC OKR & Performance Dashboard
**Updated:** 2026-07-03
**Category:** Internal enterprise dashboard (B2B/internal tool)

> This file was regenerated from the actual source of truth: `frontend/src/styles.css` (`:root`,
> lines 1–91) and `frontend/index.html`. The original auto-generated version used a dark,
> generic B2B template (`#020617` background, Lexend/Source Sans 3) that does **not** match the
> shipped app. The real app is a light, professional internal tool — do not reintroduce a dark
> theme or swap the fonts below.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary (navy, deep) | `#16234d` | `--primary` |
| Primary light | `#2a3884` | `--primary-light` |
| Accent (navy, interactive) | `#2c398e` | `--accent` / `--brand-navy` |
| Accent hover | `#1f2a6e` | `--accent-hover` |
| Accent bright | `#3a49a8` | `--accent-bright` |
| Accent light (tint bg) | `#eceffb` | `--accent-light` |
| Brand green | `#169045` | `--brand-green` |
| Brand green deep | `#0e7a38` | `--brand-green-deep` |
| Brand green bright | `#1fa851` | `--brand-green-bright` |
| Brand green soft (tint bg) | `#e9f6ef` | `--brand-green-soft` |
| Page background | `#f4f6fb` | `--bg-main` |
| Card background | `#ffffff` | `--bg-card` |
| Main text | `#16213c` | `--text-main` |
| Muted text | `#64748b` | `--text-muted` |
| Border | `#e4e9f2` | `--border` |

**Color Notes:** Light background, navy = interactive/accent, green = brand identity. Never use a
dark page background — this is an internal reporting tool viewed in bright office conditions, not
a marketing site.

**Semantic status (pick ONE of these 4 — never hardcode a new red/amber/blue):**

| Status | Background | Text | Border | Variable prefix |
|---|---|---|---|---|
| Success | `#ecfdf5` | `#047857` | `#a7f3d0` | `--color-success-*` |
| Danger | `#fef2f2` | `#b91c1c` | `#fecaca` | `--color-danger-*` |
| Warning | `#fffbeb` | `#92400e` | `#fde68a` | `--color-warning-*` |
| Info | `#eef1fb` | `#2c398e` | `#c7d0ef` | `--color-info-*` |

### Typography

- **Heading & Body Font:** Be Vietnam Pro (primary), Inter (fallback/auth screens), Segoe UI, system-ui
- **Monospace:** JetBrains Mono (used for codes/IDs only)
- **Base size:** 14px
- **Mood:** corporate, trustworthy, dense-but-readable, professional — optimized for Vietnamese diacritics
- **Already imported in `frontend/index.html`** (do not add a second font import):
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Be+Vietnam+Pro:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

**Type scale:** `--text-xs` (11px) through `--text-4xl` (32px), 10 steps — see `styles.css:~1-91` for the full scale before introducing a new font-size literal.

### Spacing Variables (×4 scale)

| Token | Value |
|-------|-------|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |

### Shadow Depths

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px 0 rgba(22,35,77,.05)` | Subtle lift |
| `--shadow-md` | `0 2px 4px -2px rgba(22,35,77,.06), 0 4px 12px -6px rgba(22,35,77,.06)` | Cards, buttons |
| `--shadow-lg` | `0 8px 18px -8px rgba(22,35,77,.12), 0 4px 8px -6px rgba(22,35,77,.08)` | Hover states, dropdowns |
| `--shadow-premium` | `0 18px 40px -18px rgba(22,35,77,.2), 0 8px 16px -10px rgba(22,35,77,.1)` | Modals, featured cards |

### Radius

| Token | Value |
|---|---|
| `--radius-sm` | 8px |
| `--radius-md` | 12px |
| `--radius-lg` | 18px |

### Motion

- `--transition`: `all 0.16s cubic-bezier(0,0,.2,1)` — default for hover/focus
- `--transition-slow`: `all 0.24s cubic-bezier(0,0,.2,1)` — larger layout shifts
- `--focus-ring`: `0 0 0 3px rgba(44,57,142,.16)` — the single canonical focus ring; every custom `:focus-visible` should reference this, not a new color

---

## Component Specs (as actually implemented)

### Buttons

Base reset applies to every `button`/`.icon-button`; feature buttons layer on top rather than
redefining the reset.

```css
button, .icon-button {
  align-items: center;
  background: #ffffff;
  border: 1px solid #c9d2dc;
  border-radius: var(--radius-sm);
  color: var(--text-main);
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  min-height: 36px;
  padding: 8px 12px;
  font-weight: 500;
  transition: var(--transition);
}
button:hover, .icon-button:hover {
  border-color: var(--accent);
  background-color: var(--bg-main);
  color: var(--accent);
}
button:disabled, .icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
button:focus-visible, .icon-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Primary CTA variant: `.btn-primary` (solid accent) / `.btn-primary-soft` (tinted). Destructive
actions use `.danger-button`. Icon-only buttons must always carry both `title` and `aria-label`
(the codebase had a real gap here — see Pre-Delivery Checklist).

### Cards

Cards are white-on-light-gray, not the dark-glass style from generic templates:

```css
.et-stat-card {
  background: #ffffff;
  border: 1px solid #e1e8ef;
  border-radius: var(--radius-md);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
  transition: var(--transition);
}
.et-stat-card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

Status/tone cards use a left accent stripe (`::before`, 4px) + tinted background per tone
(`tone-good`/`tone-risk`/`tone-na`, or feature-specific tones like `tone-total`/`tone-team`) —
never recolor these globally with `!important`; tone classes are reused across OKR/ET/FI with
context-specific meanings (e.g. `tone-good` is navy in KR panels, green elsewhere).

### Inputs

```css
.auth-input {
  border: 1.5px solid #e2e8f0;
  border-radius: var(--radius-md);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.auth-input:focus-within {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
```

Plain table/inline inputs (KPI cells, admin search) are often intentionally borderless
(`border: 0; background: transparent`) to read as inline-editable text — do not apply a global
bordered-input reset, it will visibly double the border on wrapper-styled fields like
`.auth-input input`.

### Empty / Loading states

```css
.fi-empty-state,
.table-empty-state {
  /* icon + message, centered, muted text — see styles.css tail section */
}
.icon-spin { animation: spin 0.8s linear infinite; }
.loading-inline { /* inline Loader2 + muted text, for non-blocking refetch feedback */ }
```

Reuse `renderEmptyState()` (FIWorkspace) / `NoDataBlock` & `NoPlanBlock` (OKR
`components/EmptyBlocks.tsx`) instead of a bare `<p className="muted">` for "no data" messaging.

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
.modal {
  background: white;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-premium);
}
```

---

## Naming Conventions

Feature-scoped prefixes (not utility classes): `fi-`, `et-`, `okr-`, `kr-`, `o1-`…`o6-`, `admin-`,
`auth-`, `legacy-`, `web-input-`, `sidebar-`, `topbar-`, `matrix-`. Badges/pills follow
`base class (shape) + tone modifier (color)`, e.g. `.admin-status-pill.success`. Breakpoints:
`900px` (tablet, most common), `700px` (mobile), `1200px` (small desktop) — there is no `768px`
breakpoint in this codebase; use `900px` for new tablet rules to stay consistent.

---

## Style Guidelines

**Style:** Dense, trustworthy internal ops tool — not a marketing/landing page. Optimize for
scanability by people who use this daily (shift leads, coordinators), not first-time conversion.

**Anti-patterns already rejected in this app:** dark backgrounds, decorative animated blobs/noise
on auth screens (removed in a prior UX pass — see git history "Fix lai loi UI/UX cua anh Loi"),
two-line ambiguous branding.

---

## Anti-Patterns (Do NOT Use)

- ❌ Dark theme / dark page background — this app is light-only
- ❌ Lexend / Source Sans 3 — not imported, do not introduce; use Be Vietnam Pro / Inter
- ❌ Emojis as icons — use `lucide-react` (already the project's icon set)
- ❌ Missing `cursor:pointer` — but never blanket-override with `!important`; it defeats
  `button:disabled { cursor: not-allowed }`
- ❌ Blanket `!important` CSS overrides appended at end of file — edit the existing rule in place
  instead of shadowing it; this codebase has been bitten by this once already
- ❌ Layout-shifting hovers — avoid scale transforms that shift layout
- ❌ Low contrast text — maintain 4.5:1 minimum contrast ratio
- ❌ Instant state changes — always use `var(--transition)` (150–300ms)
- ❌ Invisible focus states — reuse `--focus-ring`, don't invent a new one
- ❌ Icon-only buttons without both `title` and `aria-label`

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] Colors come from the palette above (or `styles.css :root`), never a new hex literal
- [ ] Fonts are Be Vietnam Pro / Inter — no new font import
- [ ] `cursor: pointer` on clickable elements, respecting `:disabled` → `not-allowed`
- [ ] Icon-only buttons have both `title` and `aria-label`
- [ ] Hover/focus states use `var(--transition)` and `var(--focus-ring)`
- [ ] Empty states use `renderEmptyState`/`NoDataBlock`/`.table-empty-state`, not bare `<p className="muted">`
- [ ] `prefers-reduced-motion` respected for any new animation
- [ ] Responsive at the project's real breakpoints: 700px, 900px, 1200px
- [ ] No horizontal scroll on mobile (grid columns use `minmax(0, 1fr)`, not `minmax(auto, 1fr)`)
- [ ] New CSS is added to the relevant existing rule block in `styles.css`, not appended as a
      separate "overrides" section at the end of the file
