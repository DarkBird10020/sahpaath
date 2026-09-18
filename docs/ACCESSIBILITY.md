# Accessibility verification

This is a verification record, not a claim of whole-product WCAG conformance. Automated scans cannot establish every success criterion or screen-reader usability.

## Completed baseline, 2026-09-18

`npm run test:e2e` completed **6 passed (23.1s)** before the scroll-world integration. The suite used Chromium and `@axe-core/playwright` with WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tags. Thirteen reports in `docs/reports/axe-*.json` covered landing, login, narrow login, teacher review, pipeline, manual editor, explorer, captions, communication, inbox, evaluation, narrow explorer, and high-contrast/large-text explorer. Each had zero reported violations at that baseline. Read `incomplete` entries as manual-review requirements, not passes. The initial muted landing-footnote contrast failure was fixed and rescanned.

The subsequent scroll-world interface requires its own updated reports. Do not apply the baseline result to an untested later edit.

## Keyboard evidence

Automated keyboard actions verify the skip link and main focus; tree Up/Down, Left/Right and Home/End behavior; focus-scoped tree navigation; and sending a classroom phrase using Enter. The explorer also offers a conventional concept selector and text descriptions. Teacher approval and publication are exercised through semantic controls in browser tests, but the full teacher workflow has **not** yet been traversed manually using only a physical keyboard.

The concept tree follows a root/children hierarchy with roving tab index. A focused parent expands/collapses with Right/Left. Live announcements include the selected concept and relevant context. Status uses text and icons as well as color. Buttons have 44px minimum heights; keyboard focus styles are visible. At 320px, tested login/explorer screens had no horizontal page overflow. A forced no-WebGL environment displayed the text fallback.

## Outstanding checks and limits

- UNTESTED: real NVDA, JAWS, VoiceOver and TalkBack sessions, including spoken tree positions and live-region behavior.
- UNTESTED: a complete manual keyboard-only audit of every workflow and validation error.
- UNTESTED: real browser 200% zoom across all screens, Windows forced-colors mode, iOS seeking, and lower-performance physical devices.
- Browser speech depends on the host's voices and may be unavailable. Text remains present. It is not tested Polly output.
- Generated artwork is decorative/conceptual; it does not carry lesson facts. All story content is in headings, paragraphs and links.
- Reduced-motion and static story modes must avoid loading/scrubbing videos. The separately enabled Three.js graph remains optional with a DOM equivalent.

The reports provide evidence for specific automated checks such as accessible names, label association, semantic roles, heading structure, and tested contrast. They do not independently prove every related WCAG success criterion. No conformance badge is displayed.
