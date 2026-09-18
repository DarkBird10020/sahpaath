# Credits and provenance

## Educational demonstration data

The five schematic diagrams are authored in this repository from `shared/fixtures.ts` and rendered by `src/components.tsx`. There are no downloaded educational diagrams. The heart sample is a simplified pulmonary pathway, not a complete anatomical illustration. These repository-authored schematic fixtures and their expected graph data are dedicated under CC0 1.0 by the project contributor; no third-party source ownership is asserted. Subject-teacher review is still required before classroom use.

## Generated artwork

`public/assets/shared-classroom.png` — generated through the connected Higgsfield plugin using `gpt_image_2_5`; job `9ac84b7f-101a-4507-9f43-691fa3f0f906`, September 2026. A warm, empty classroom desk with blank books, used as atmospheric artwork. It contains no educational source facts, student data, or purported application screenshot. Confirmed generation cost: 1 credit. Use is subject to the provider's applicable terms; no blanket public-domain claim is made.

Rejected/experimental jobs (2026-09-18), not accepted product artwork:

| Job | Requested model / subject | Credits |
|---|---|---:|
| f23e7e42-6808-4d5c-a157-c95d8c5fc5ab | gpt_image_2_5 / clay book | 1 |
| 51c4ca56-99a9-46de-a558-356d253ce618 | seedance_2_0_mini / first camera | 15 |
| ae24e088-efcc-43f0-b39c-abc670881b5b | seedance_2_0_mini / camera retry | 15 |
| 5d94b8db-6fab-4cb6-bdcf-3e7b6507f0d4 | nano_banana_pro / architectural still | 4 |
| dd422758-4ad9-4d7c-9c18-03f172603aff | nano_banana_pro / natural room A | 4 |
| af2ab7af-623a-4a58-ab4b-583b07f10e1c | nano_banana_pro / natural room B | 4 |

The experimental WorldStory component is unmounted. The three Pro requests completed remotely but are not accepted visuals.

UNVERIFIED: Pro backend model identity — requests named nano_banana_pro but job status reported nano_banana_2 — provider confirmation would resolve whether this is an alias.

Private reference board: docs/ART_REFERENCE_BOARD.html uses .data/art-review images, outside the app build. These belong to their creators; no redistribution license or ownership is asserted. Sources: [Blue World Studio / Emons](https://www.blueworld.studio/en/cases/emons), [Zubair Trabzada / example banner](https://github.com/zubair-trabzada/scroll-cinematic-claude), and [Wright & Wright / library source image](https://cdn.wrightandwright.co.uk/uploads/images/_full_width_xl/18531/Magdalen_Image_Buckler-GF_2023-02-21-115625_gzdy.webp?v=1708522607).

## Software and type

React, Vite, TypeScript, Zod, Three.js, Lucide, Playwright, axe-core, and other dependencies retain their respective package licenses. Manrope and DM Sans are bundled locally via Fontsource and retain their font licenses. The user-supplied `skills-scroll-world/scroll-world` repository includes its own LICENSE; its guidance informs the planned scroll-driven introduction. Consult that license before redistributing any adapted engine code.
