# Mr. Mags — landing site

Static one-page landing for [mrmags.org](https://mrmags.org). Editorial-minimalist, photo-first, intentionally not-AI-looking.

## Layout

```text
mrmags-site/
├── index.html           # full-bleed hero + about + teachers + download + footer
├── assets/
│   └── site.css         # all styling, two Google Fonts (Inter + Cormorant Garamond)
├── images/
│   └── hero.jpg         # hero photo — Steve to provide; placeholder gradient until then
├── favicon.ico          # placeholder
└── robots.txt
```

## Putting your photo in

1. Save your photo as `images/hero.jpg` (recommended: 2400×1400 minimum, JPEG, ~70-85% quality, < 500KB).
2. Open `index.html` and change the `<main class="hero">` line to `<main class="hero" data-photo="true">`.
3. Push. The site flips from gradient placeholder to your photo.

The hero is full-bleed, so pick a photo that looks good with logo top-left, nav top-right, and a small italic tagline bottom-right. Faces / text / focal points should sit roughly in the middle-left so the right side stays clean for the nav.

## Deploy

Static site — no build step. Two deploy paths:

### Cloudflare Pages (recommended)

```bash
# One-time
npm install -g wrangler

# Deploy
cd mrmags-site
wrangler pages deploy . --project-name=mrmags --branch=main
```

Then in Cloudflare dashboard:
- Pages → mrmags → Custom domains → add `mrmags.org` and `www.mrmags.org`
- DNS auto-configures (since the domain's nameservers are at Cloudflare)

### CI auto-deploy

Add a `.gitlab-ci.yml` that runs `wrangler pages deploy` on every push to `main`. Same pattern as `modelreins/docs` (see `.gitlab-ci.yml` in modelreins repo for the template).

## Design intent

Reference: Studio Anton, a London interior-design studio. Full-bleed photo, logo top-left, quiet nav top-right, no center text overlay (Steve specified). The aesthetic is editorial / hospitality / Substack — deliberately the opposite of "AI startup landing page" tropes (no aurora gradients, no glassmorphism, no centered hero with bold sans-serif claim, no purple-teal gradient text).

Typography:
- **Inter** (sans-serif) for nav, body, UI
- **Cormorant Garamond** (serif italic) for headings, tagline, section names
- Single accent color: terracotta (`#8c3a2c`) — quiet, unfashionable, warm

If you want to swap the accent: change `--accent` in `assets/site.css`. Tested alternatives that read warm: deep ink-blue (`#21384a`), forest (`#3d5a3d`), warm rust (`#a64a30`).

## Pages to add later

- `/privacy` — privacy policy. Pull from modelreins.com's TOS and rewrite around "we have no data."
- `/about` — could become a long-form origin story page if the inline section gets too short.
- `/teachers/verify` — school-email verification flow (Phase 4).

For now everything lives on `index.html` via anchors.
