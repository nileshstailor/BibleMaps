# Publish checklist — Bible Maps 1.0.0

## Before upload

- [ ] `manifest.json` version is **1.0.0**
- [ ] Smoke: bible.com Acts 13 + Bible Gateway Genesis 12 + side panel map renders
- [ ] Build clean ZIP via `scripts/package-chrome-store.sh` (or use `store/dist/bible-maps-1.0.0.zip`)
- [ ] Confirm ZIP has **no** `.git`, `store/`, `scripts/`, `node_modules`, or test-only junk
- [ ] Host `store/listing/privacy.md` (or equivalent) at a public HTTPS URL

## Developer Dashboard fields

- [ ] Paste short + detailed description from `store/listing/chrome-web-store.md`
- [ ] Single-purpose attestation from the same file
- [ ] Upload screenshots from `store/screenshots/` (1280×800)
- [ ] Upload small promo `store/promo/small-promo-440x280.jpg` (and marquee if desired)
- [ ] Store icon: `icons/icon128.png` / `store/icons/icon128.png`
- [ ] Category: Education
- [ ] Privacy policy URL
- [ ] Reviewer notes: paste `store/listing/reviewer-test-instructions.md`

## After submit

- [ ] Watch for permission/host justification questions; answers are drafted in the listing doc
- [ ] If rejected for screenshots looking “mock”, replace with live captures from a real session (same folder)
- [ ] Tag git `v1.0.0` after approval (optional)

## Asset index

| Asset | Path |
|-------|------|
| Clean ZIP | `store/dist/bible-maps-1.0.0.zip` |
| Screenshots | `store/screenshots/screenshot-1280x800-*.jpg` |
| Small promo | `store/promo/small-promo-440x280.jpg` |
| Marquee | `store/promo/marquee-1400x560.jpg` |
| Icons | `store/icons/icon{16,48,128}.png` |
| Listing copy | `store/listing/chrome-web-store.md` |
| Privacy draft | `store/listing/privacy.md` |
| Reviewer steps | `store/listing/reviewer-test-instructions.md` |
