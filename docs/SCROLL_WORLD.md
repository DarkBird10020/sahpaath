# Scroll-world production record

## Current status — reference-led reset, 2026-09-18

All directions below are historical rejected experiments, not accepted work. WorldStory is unmounted and the original DOM Pathways hero restored. See ART_REFERENCE_BOARD.html and ART_RESEARCH.md for inspected references and an original candidate prompt. No further generation until the desired composition is resolved. Live remaining balance: 553.5 credits. `npm.cmd run build` passed after the removal (TypeScript and Vite, 1990 modules); lazy SpatialGraph retains a 528.11 kB chunk warning. UNTESTED: browser regression after this latest removal; the reference board has not received browser visual QA.

## Latest direction: natural photographic spaces

The user also rejected the architectural sculpture still and asked for natural-looking images based on reference research. No video was generated from that still. The new direction drops miniatures, oversized books, sculptural metaphors and exposed CGI language. It uses ordinary full-size classrooms/reading rooms, human eye-level framing, plausible daylight, real furniture construction and restrained color. Two 4K still candidates are in review; do not treat them as accepted by the user or animate them automatically.

Additional research: [Google's Nano Banana Pro prompting tips](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/), [Higgsfield's published expert prompts](https://higgsfield.ai/blog/Nano-Banana-Pro-Expert-Use-Cases), and [Wright & Wright's Magdalen College project](https://www.wrightandwright.co.uk/projects/magdalen-college-oxford). These informed subject/composition/location/style separation, specific camera and lighting direction, and natural interior depth/material cues. No original hidden prompt can be recovered from a reference photo. Reference photographs are not licensed app assets and are not included in the product.

Candidate A: shared learning table, job `dd422758-4ad9-4d7c-9c18-03f172603aff`.
Candidate B: classroom and courtyard, job `af2ab7af-623a-4a58-ab4b-583b07f10e1c`.
Requested model: `nano_banana_pro`, 4K, 16:9. Preflight 4 credits each, 8 total. Status responses for the earlier Pro request used the internal model label `nano_banana_2`; record both requested and reported identifiers without claiming an unverified backend alias.

## Quality reset after user review

The user rejected the initial images and Seedance Mini videos as ugly, blurry and glitching. They are rejected draft assets, not accepted deliverables. The pending second-leg generation call was cancelled; it returned no job ID. The verified balance after the rejected first still and two clips was 565.5 credits. Do not continue that chain.

Research checked 2026-09-18:

- [Blue World Studio's Emons case study](https://www.blueworld.studio/en/cases/emons) describes modular 3D animation, animatic iteration and delivery as video sequences/loops. It does **not** claim Higgsfield was used. This is a workflow reference, not a layout or asset to copy.
- [Higgsfield's pipeline guide](https://higgsfield.ai/blog/generate-ai-videos-higgsfield-api) separates still composition/lighting from motion generation. Its dollar-priced API is separate from the connected credit-based MCP used here.
- [Higgsfield Nano Banana guidance](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-nano-banana) and the connected model catalog support Nano Banana Pro 4K stills.
- [Kling's model guide](https://kling.ai/quickstart/klingai-video-3-model-user-guide) and the connected Higgsfield `kling3_0` schema support image-conditioned video; MCP exposes `mode: 4k`, start/end frames and audio off. Exact output dimensions still require ffprobe verification after rendering.

New art brief: architectural exhibition CGI, precise engineered geometry, deep-blue enamel, honed ivory stone, fine paper and restrained brass. One coherent book/pavilion connects three distinct access stations. No clay figurines, no tilt shift, no shallow depth of field, no haze/bloom, no moving props or newly appearing buildings. Deep focus and a single short camera move. Test one still and one clip before expanding.

Current estimates: Nano Banana Pro 4K 4 credits/image; Kling 3.0 4K silent 5 seconds 30 credits/clip. First revised still: `5d94b8db-6fab-4cb6-bdcf-3e7b6507f0d4`. The earlier 111-credit Mini plan is superseded by the user's explicit quality correction; the original total credit ceiling remains binding.

The user explicitly requested the local `skills-scroll-world/scroll-world/skills/scroll-world/SKILL.md` and Higgsfield. The existing brand/product brief supplies the subject, palette, and accessibility constraints. Camera, tier, and mobile choices were offered. After the user instructed continuation, the recommended bounded plan was selected: calm fixed-angle glide, Seedance 2.0 Mini 720p, desktop only; responsive stills on phones. No separate portrait camera chain is claimed.

## Storyboard

1. One lesson: an open blank book feeds three blue paths.
2. Teacher review: linked concept tiles, amber awaiting review and green checked, explained by actual DOM text rather than color alone.
3. Explore: a connected physical concept model, with text explaining keyboard and description paths.
4. Captions: a quiet reading space and blank pages; local transcript functionality described honestly.
5. Communication: a shared table and a question token; context-anchored student questions remain real UI.
6. Shared vocabulary: paths reconnect around one learning space.

Art is a metaphor, not an educational source or screenshot. The source style is matte clay/papercraft, ivory #F4F1E9, blue #193B59, amber #DBA34B, green #42715E and pale blue #BCD4E0. No decorative particles, generated text or autoplay audio.

## Pipeline

Use the connected Higgsfield MCP, whose current model schema supports image-conditioned Seedance Mini videos. The skill's CLI-only reference restrictions do not apply to this MCP; completed job and uploaded media IDs are supported. ffmpeg/ffprobe run in Higgsfield's media-processing sandbox; no local machine is inspected by that tool. Processed assets are downloaded into the repository.

Architecture A: first scene starts at the generated still; every subsequent clip starts at the actual previous final frame. No invented endpoint is substituted. Outputs are encoded at native 1280×720, H.264, CRF 20, GOP 8, faststart, without audio. Extracted first frames are the posters. Inspect boundary images and the browser's actual seek behavior before completion. Conditioning is not proof of pixel-identical generated boundaries.

The React implementation adapts the workflow's Blob playback and coalesced seeking, using normal document sections, chapter anchors and a skip link. It loads only the active clip near the viewport, releases Blob URLs, and preserves static content on error. Mobile and reduced-motion use stills. The artwork does not require WebGL. The Three.js educational concept graph is independent and lazy-loaded.

## Render log

- Opening still: `f23e7e42-6808-4d5c-a157-c95d8c5fc5ab`, 1 credit.
- First camera attempt: `51c4ca56-99a9-46de-a558-356d253ce618`, 15 credits. Final frame turned toward a front-facing teacher, diverging from the requested fixed-angle composition; retry requested.
- Revised first leg: `ae24e088-efcc-43f0-b39c-abc670881b5b`, 15 credits, in progress when this entry was written.

Complete the render log and QA evidence before claiming the chain is finished. Reserved ceiling: 111 credits for this sequence, separate from the earlier 1-credit classroom still.
