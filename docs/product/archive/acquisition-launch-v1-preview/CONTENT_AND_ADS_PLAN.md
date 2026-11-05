# Mova acquisition launch — implementation and operating plan

## Release status
The website, calculator and three editorial articles are working **static previews**. Waitlist is **not connected**; the page explicitly states this. No ads have been launched, tracking installed, domain chosen, or public site deployed. Do not claim otherwise.

## Launch gates (must complete before traffic)
- [ ] Confirm production domain and deploy with HTTPS on Vercel.
- [ ] Configure canonical URL, `og:url`, Open Graph image, sitemap.xml with final absolute URLs, and Search Console verification.
- [ ] Implement a server-side waitlist endpoint (Supabase Edge Function), input validation, rate limiting, bot protection, duplicate handling, consent timestamp, source/UTM attribution, and a privacy policy. Never expose service-role keys.
- [ ] Update form from preview to real success/error states only after endpoint is tested.
- [ ] Configure consent-respecting analytics and conversion events: `landing_view`, `calculator_view`, `calculator_completed`, `waitlist_submit`, `waitlist_success`, `qualified_artist_signup`.
- [ ] Set up Google Search Console and Bing Webmaster Tools; verify indexability and structured data only where genuinely supported.
- [ ] Validate mobile rendering, accessibility, page speed, links, metadata, and form abuse defenses.
- [ ] Obtain permission for any artist images/testimonials; avoid unverified outcome claims.

## First content cluster
1. `guides/booth-rental-vs-commission.html` — comparison article linking calculator.
2. `booth-rent-vs-commission-calculator.html` — original interactive utility; no lead capture required.
3. `guides/keep-clients-when-changing-salons.html` — consent-first transition guidance.
4. `guides/manage-appointments-across-salons.html` — multi-location scheduling advice.

Editorial QA: interview 3–5 independent hairstylists; add firsthand examples, original insights, author/editorial information, reviewed dates, and cite primary sources for jurisdiction-specific claims. Avoid mass-producing thin articles or fake reviews.

## $200 paid test (after conversion tracking works)
- $150 Meta Ads: one tightly scoped campaign, two creatives (portable client relationships vs portfolio/bookings), one qualified-waitlist conversion goal. Run long enough to learn; do not claim statistically significant lift from small samples.
- $50 reserve: spend only after reviewing cost per qualified signup and signup quality. If no usable signal, retain the money.
- Google Search Ads: hold until Search Console reveals high-intent queries and plausible CPCs.
- Reddit: research and useful disclosed participation first; follow community self-promotion rules. No mass posting or impersonation.

## Proposed ad copy
**A — Independence:** `Your clients shouldn't disappear when you change salons.` Supporting: `Mova is being built to keep your portfolio, bookings and client relationships together. Explore early access.`

**B — Ownership:** `Your portfolio. Your bookings. Your clients. One place.` Supporting: `Meet Mova, a new business home for independent hairstylists. Coming soon.`

Avoid promising a currently available product or accepting waitlist submissions before backend launch.

## 90-day measurement
- Week 1–2: production waitlist + privacy + events + Search Console.
- Week 3–4: publish original resources, interview stylists, validate organic landing pages.
- Month 2: community research, publish useful answers, launch controlled $150 Meta test.
- Month 3: improve messaging and content based on qualified signups; decide whether to use $50 reserve.

North star: **cost per qualified independent-hairstylist signup**. Track source/medium/campaign, landing-page conversion, calculator usage, waitlist conversion, qualification rate, and eventual activation.

## Codex acceptance tests
- [ ] Homepage and each article have unique title and meta description.
- [ ] All internal links resolve when deployed under domain root.
- [ ] Calculator: $1,500 revenue, 40% salon cut, $300 rent, $150 shared expenses -> commission $750, booth $1,050, booth advantage $300.
- [ ] Calculator rejects negative amounts and commission >100%.
- [ ] Calculator never transmits entered financial numbers to third parties.
- [ ] Waitlist shows not-live status until backend enabled; no fake success.
- [ ] With backend enabled, duplicate, invalid, throttled and successful signup cases are covered.
- [ ] No production claim of Google/Apple calendar sync already available.
- [ ] Mobile viewport 360px, keyboard navigation, accessible labels, and Lighthouse audit.
- [ ] No fabricated canonical domain, customer testimonials, or review schema.
