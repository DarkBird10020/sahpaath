# Reference-led reset — 2026-09-18

Update: the user asked the engineer to choose based on prompt.txt. The selected product-specific direction and copy correspondence are recorded in SAHPAATH_VISUAL_STORY.md. The board's A/B choice is no longer pending; the architectural-room candidate below is retained only as research history.

Status: research complete enough for a concrete direction choice; no accepted new visual direction. The previous clay, architectural-book and room-only directions are not accepted assets. WorldStory is unmounted. No further paid generation during this reset.

## Sources actually reviewed

- [Zubair Trabzada's creator repository](https://github.com/zubair-trabzada/scroll-cinematic-claude): read its workflow and inspected its example banner. It uses a master hero still, image-conditioned animation and extracted frames mapped to scroll. Its advertised prices and sweeping claims about all 3D websites are not adopted here.
- [Chase AI's written tutorial](https://www.chaseai.io/blog/claude-design-seedance-animated-websites): establish composition and text space first; keep the chosen visual consistent when moving to animation. This is the creator's written account, not independent evidence of universal results.
- [Komputer Mechanic's published tutorial](https://komputermechanic.com/tutorials/how-to-build-a-cinematic-3d-scroll-website-with-gpt-6-astra): inspected public prompt examples; separate visual composition from implementation. Did not access gated material or reproduce its prompt pack.
- [Scrolltide's portal tutorial](https://www.scrolltide.co/academy/3d-portal-scroll-website-claude-code): distinguishes layered image depth from an actual 3D scene. Reference-led layering is another option, not evidence that generated video is necessary.
- [Reddit creator account](https://www.reddit.com/r/vibecoding/comments/1p2jhag/i_vibe_coded_this_with_gemini_3_and_nano_banana/): the poster describes using a prior screenshot and selecting an image direction before implementation. Anecdotal workflow evidence, not a quality benchmark.
- [Blue World Studio's Emons case study](https://www.blueworld.studio/en/cases/emons): inspected a real reference image and its described 3D production process. No evidence this agency used Higgsfield.
- [Google's image-prompt guidance](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/): specify subject, composition, camera, materials, lighting and reference roles rather than relying on quality adjectives.

YouTube tutorials were located, including https://www.youtube.com/watch?v=lOHHabby8LI and https://www.youtube.com/embed/1A20nUPbkOc. Direct video retrieval failed; written creator materials were reviewed. No claim of watching these videos is made.

## What went wrong in our implementation

The prompts prioritized symbolic miniature objects over a legible composition. Direction changed between attempts instead of locking a master frame. The drafted 720p video chain was unsuitable for judging a crisp full-screen result, and the rejected footage must not be recycled as accepted work. A higher resolution alone will not fix poor composition or geometry changing between frames.

## Original master-still brief for direction A (not submitted)

Create one original 16:9 architectural visualization for SahPaath, an educational accessibility app. Show a single coherent, human-scale science learning studio. Use the supplied world reference only for spatial clarity and consistent perspective; use the supplied real library reference only for daylight and material behavior. Do not reproduce their buildings, furniture arrangement, identity or text.

View from a slightly elevated three-quarter angle with a 35 mm architectural lens feel, straight verticals and moderate perspective. The room fills the right two thirds of the composition. Reserve the left third as a quiet dark-blue wall and soft shadow for separately rendered website typography. Keep one dominant focal point: an oak lesson table with a white paper sheet and a simple unmarked physical teaching object. Three adjacent work areas belong visibly to the same room: a tactile-object workspace, a reading/display workspace with an unlit screen, and a shared discussion table. Their meaning will be explained by actual website text, not generated symbols.

Use pale oak with subtle grain, matte off-white paper, deep educational-blue acoustic panels, brushed metal and a restrained warm amber accent. Daylight enters from one consistent off-frame window at upper left. Maintain believable contact shadows, modest surface variation, clean silhouettes and readable middle-distance detail. Objects are grounded and constructed plausibly. No miniature toy aesthetic, oversized sculptural books, floating buildings, plastic gloss, decorative particles, glowing trails, fog, bloom, tilt-shift blur, generated lettering, diagram labels, interface screenshots or people. The final image must work as a still before any camera motion is added.

This is an art-direction candidate, not a guaranteed model outcome. Generate only after the user resolves which reference composition matches their intent. Requested model and provider-reported identifier must both be recorded; they differed in earlier jobs.

## Separate motion brief, only after a still passes review

Animate the accepted image as a rigid scene. One short, slow camera dolly toward the lesson table, with a fixed lens and no orbit. Preserve the room layout, object counts, textures, light direction and negative space. No new objects, moving furniture, morphing, text or effects. Use the actual accepted image as conditioning. Confirm current model support and estimate before submission.

Inspect first, middle and last frames at native resolution. Reject geometry drift, flicker, smeared textures, changing object counts or focus pumping. Scrubbing cannot repair flaws in generated footage. Use one bounded motion test before expanding the sequence. If the test fails, retain the accepted still with restrained DOM depth instead of repeatedly spending on a broken chain.

## Acceptance gates

1. A or B composition selected using ART_REFERENCE_BOARD.html; no unrelated style switch.
2. One still inspected at native size and in the actual hero crop, with real heading and CTA overlaid.
3. Image dimensions verified from the downloaded file, not a model marketing label.
4. Animation passes temporal inspection before any scroll encoding.
5. Scroll implementation checked forward and backward, including loading, reduced motion and mobile static fallback. Test frame sequence versus video seeking for actual browser behavior; do not assume either is universally best.
6. Keep artwork separate from trusted lesson content; do not replace educational semantics with an animation.
