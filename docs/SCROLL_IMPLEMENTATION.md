# Implemented lesson journey — 2026-09-18

COMPLETED

Replaced the landing hero with four scroll-controlled chapters. The lesson sheet separates into a concept map, caption excerpt and contextual question. CSS perspective and translateZ render actual DOM planes in depth; this is not a generated-video fly-through or a volumetric WebGL model. The visual lesson is explicitly illustrative. Chapter buttons, skip link, mobile static composition and depth-off mode provide conventional alternatives. Reduced-motion and narrow-screen preferences default to static presentation. The existing Higgsfield classroom image remains in the closing section; no new credits spent.

FILES CHANGED

src/LessonJourney.tsx, src/lesson-journey.css, src/App.tsx, tests/e2e/classroom.spec.ts, docs/reports/axe-story-vocabulary.json, docs/reports/axe-story-mobile.json and story screenshots. App copy encoding repaired during review.

AWS SERVICES USED

None. AWS remains deferred.

TESTS EXECUTED / TEST RESULTS

- npm.cmd run build: TypeScript and Vite passed, 1992 modules transformed. Existing lazy SpatialGraph chunk remains 528.11 kB with Vite's size warning.
- npm.cmd run test:e2e: 7 passed (28.5s), including classroom publishing and student communication.
- After mobile spacing changes, targeted story test found transient low text contrast during opacity transitions. Removed those fades.
- npm.cmd run test:e2e -- --grep 'scroll story': final targeted rerun, 1 passed (6.1s). It checks chapter selection, keyboard activation, reduced motion, 320px overflow and axe scans on the vocabulary and mobile story states. Both final axe reports have no violations; incomplete automated checks remain for manual review.
- Desktop inspected in the browser and captured test screenshot. Mobile full-page screenshot inspected; illustration moved below copy after initial overlap.

KNOWN LIMITATIONS

UNTESTED: real screen-reader pass, Safari/iOS, physical low-powered mobile hardware and frame-rate measurement. Full suite preceded the final CSS-only spacing/transition fixes; the affected story was rerun afterward. This does not claim WCAG conformance or a jury outcome. The visual example is not a real approval action. No new natural photographic plate or generated camera chain was produced.

NEXT PHASE

Evaluate the actual running composition with the user, then refine materials and storytelling without replacing stable educational labels with generated pixels.
