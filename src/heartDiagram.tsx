/*
 * Illustrative heart diagram shared by the landing story and the playground.
 * The copy mirrors the "heart" demo fixture (shared/fixtures.ts). It is kept local on purpose
 * so authored proposals stay out of the browser bundle; nothing here is served to students
 * as a trusted, teacher-approved lesson.
 */
export const parts = [
  { name: "Right ventricle", text: "Pumps blood toward the lungs through the pulmonary artery.", x: 272, y: 404 },
  { name: "Pulmonary artery", text: "Carries blood from the right ventricle toward the lungs.", x: 320, y: 252 },
  { name: "Lungs", text: "The site where oxygen enters the blood and carbon dioxide leaves it.", x: 168, y: 182 },
  { name: "Pulmonary veins", text: "Return blood from the lungs to the left atrium.", x: 250, y: 296 },
  { name: "Left atrium", text: "Receives blood returning from the lungs.", x: 372, y: 336 },
];

const LUNGS = [
  "M150 90 C110 110 95 190 105 250 C112 290 160 300 200 285 C225 275 232 240 230 200 L230 112 C225 86 186 72 150 90Z",
  "M490 90 C530 110 545 190 535 250 C528 290 480 300 440 285 C415 275 408 240 410 200 L410 112 C415 86 454 72 490 90Z",
];
const BRONCHI =
  "M196 116 C192 150 188 180 184 204 M186 150 C170 160 158 176 150 196 M188 172 C172 190 150 214 138 240 M184 204 C170 222 164 246 166 266 M190 186 C204 206 210 228 208 252 M444 116 C448 150 452 180 456 204 M454 150 C470 160 482 176 490 196 M452 172 C468 190 490 214 502 240 M456 204 C470 222 476 246 474 266 M450 186 C436 206 430 228 432 252";
const HEART =
  "M320 470 C250 430 205 390 210 345 C215 305 255 290 285 305 C300 312 312 322 320 335 C328 322 340 312 355 305 C385 290 425 305 430 345 C435 390 390 430 320 470Z";
export const VESSELS = {
  artery: [
    "M292 344 C288 300 300 272 320 252 C300 232 262 216 232 206",
    "M320 252 C345 234 380 216 408 206",
  ],
  veins: ["M214 268 C244 302 300 322 346 332", "M426 268 C422 300 404 318 390 328"],
};

/** Gradients for the living illustration; `prefix` keeps ids unique when drawn twice on a page. */
export function DiagramDefs({ prefix }: { prefix: string }) {
  return (
    <>
      <radialGradient id={`${prefix}-heart`} cx="0.38" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#f9ddd4" />
        <stop offset="0.55" stopColor="#e9a595" />
        <stop offset="1" stopColor="#c86f5f" />
      </radialGradient>
      <radialGradient id={`${prefix}-lung`} cx="0.4" cy="0.3" r="0.85">
        <stop offset="0" stopColor="#fdeee9" />
        <stop offset="0.6" stopColor="#f3c6bc" />
        <stop offset="1" stopColor="#dc9a8c" />
      </radialGradient>
      <linearGradient id={`${prefix}-rv`} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#dfe9f9" />
        <stop offset="1" stopColor="#8eaee4" />
      </linearGradient>
      <linearGradient id={`${prefix}-la`} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#fbd9d0" />
        <stop offset="1" stopColor="#e07e6c" />
      </linearGradient>
      <radialGradient id={`${prefix}-shadow`}>
        <stop offset="0" stopColor="#14365f" stopOpacity="0.22" />
        <stop offset="1" stopColor="#14365f" stopOpacity="0" />
      </radialGradient>
      <pattern id={`${prefix}-alveoli`} width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="2.2" fill="#ffffff" fillOpacity="0.35" />
        <circle cx="11" cy="10" r="1.6" fill="#b86a5c" fillOpacity="0.18" />
      </pattern>
    </>
  );
}

/** The shared diagram geometry, drawn either as plain print or as the living illustration. */
export function Anatomy({
  living = false,
  focus = -1,
  prefix = "ds",
}: {
  living?: boolean;
  focus?: number;
  prefix?: string;
}) {
  const f = (i: number) => (living && focus === i ? " is-focus" : "");
  return (
    <>
      <g className={`organ lungs${f(2)}`}>
        {LUNGS.map((d) => (
          <g key={d}>
            <path d={d} fill={living ? `url(#${prefix}-lung)` : undefined} />
            {living && <path d={d} fill={`url(#${prefix}-alveoli)`} stroke="none" />}
          </g>
        ))}
        <path className="lung-tree" d={BRONCHI} />
      </g>
      <g className="organ heart">
        <path d={HEART} fill={living ? `url(#${prefix}-heart)` : undefined} />
        {living && <path className="heart-shine" d="M252 322 C262 308 282 306 294 314" />}
        <path className="septum" d="M320 338 C318 380 322 420 320 466" />
        <path
          className={`chamber rv${f(0)}`}
          d="M316 350 C300 336 262 328 240 352 C226 372 250 410 312 452Z"
          fill={living ? `url(#${prefix}-rv)` : undefined}
        />
        <ellipse
          className={`chamber la${f(4)}`}
          cx="372"
          cy="336"
          rx="36"
          ry="22"
          fill={living ? `url(#${prefix}-la)` : undefined}
        />
      </g>
      <g className={`vessel artery${f(1)}`}>
        {VESSELS.artery.map((d) => (
          <g key={d}>
            <path d={d} className="vessel-body" />
            {living && <path d={d} className="vessel-core" />}
          </g>
        ))}
      </g>
      <g className={`vessel veins${f(3)}`}>
        {VESSELS.veins.map((d) => (
          <g key={d}>
            <path d={d} className="vessel-body" />
            {living && <path d={d} className="vessel-core" />}
          </g>
        ))}
      </g>
    </>
  );
}
