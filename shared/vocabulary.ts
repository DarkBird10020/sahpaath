import type { Caption, Published, Term, TermHit, TermSurfaces } from "./schema";
import { normalize } from "./domain";

export const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function vocabularyPattern(terms: string[], capture = true): RegExp {
  const alternatives = [...terms]
    .filter((t) => t.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapePattern)
    .join("|");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${capture ? "(" : "(?:"}${alternatives || "(?!)"})(?![\\p{L}\\p{N}])`,
    "giu",
  );
}
export function correctVocabulary(
  text: string,
  heard: string,
  canonical: string,
): string {
  const pattern = vocabularyPattern([heard], false);
  if (!pattern.test(text))
    throw new Error(
      "That phrase was not found as a complete term in this passage.",
    );
  return text.replace(vocabularyPattern([heard], false), () => canonical);
}

export interface TermMatch {
  termId: string;
  canonical: string;
  matched: string;
}
type MatchableTerm = Pick<Term, "id" | "name" | "aliases">;
const surfaceIndex = (terms: MatchableTerm[]) => {
  const index = new Map<string, TermMatch>();
  for (const term of terms) {
    index.set(normalize(term.name), {
      termId: term.id,
      canonical: term.name,
      matched: term.name,
    });
    for (const alias of term.aliases)
      if (!index.has(normalize(alias)))
        index.set(normalize(alias), {
          termId: term.id,
          canonical: term.name,
          matched: alias,
        });
  }
  return index;
};
/** Every complete-term occurrence (canonical or teacher alias) mapped to its
 * approved vocabulary term. Longest surface wins, so a full canonical term is
 * never split by a shorter alias. Pure: never mutates the terms. */
export function matchTranscriptTerms(
  text: string,
  terms: MatchableTerm[],
): TermMatch[] {
  const index = surfaceIndex(terms);
  const surfaces = [...index.keys()].sort((a, b) => b.length - a.length);
  return [...text.matchAll(vocabularyPattern(surfaces))].map((m) => {
    const hit = index.get(normalize(m[0]));
    return { termId: hit!.termId, canonical: hit!.canonical, matched: m[0] };
  });
}
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length];
}
/** A recogniser's near-miss of an approved term ("pulmonary artary"). Kept
 * strict so ordinary words are not captured: the surface has 6+ letters, every
 * word starts with the same letter, and at most one edit per 8 characters. */
function nearSpelling(heard: string, surface: string): boolean {
  if (surface.length < 6 || heard === surface) return false;
  const hw = heard.split(" ");
  const sw = surface.split(" ");
  if (hw.length !== sw.length || hw.some((w, i) => w[0] !== sw[i][0])) return false;
  return editDistance(heard, surface) <= Math.max(1, Math.floor(surface.length / 8));
}
/** Approved-term hits in one caption line with character offsets. Exact and
 * alias matches use the whole-word rules above; near spellings are reported as
 * such. The text itself is never changed: the original words stay on record. */
export function matchCaptionTerms(text: string, terms: MatchableTerm[]): TermHit[] {
  const index = surfaceIndex(terms);
  const surfaces = [...index.keys()].sort((a, b) => b.length - a.length);
  const hits: TermHit[] = [];
  for (const m of text.matchAll(vocabularyPattern(surfaces))) {
    const hit = index.get(normalize(m[0]))!;
    const start = m.index ?? 0;
    hits.push({
      termId: hit.termId,
      canonical: hit.canonical,
      matched: m[0],
      start,
      end: start + m[0].length,
      method: normalize(m[0]) === normalize(hit.canonical) ? "exact" : "alias",
    });
  }
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((w) => ({
    word: normalize(w[0]),
    start: w.index ?? 0,
    end: (w.index ?? 0) + w[0].length,
  }));
  const taken = (start: number, end: number) => hits.some((h) => start < h.end && end > h.start);
  for (const surface of surfaces) {
    const size = surface.split(" ").length;
    for (let i = 0; i + size <= words.length; i++) {
      const window = words.slice(i, i + size);
      const start = window[0].start;
      const end = window[size - 1].end;
      if (taken(start, end) || !nearSpelling(window.map((w) => w.word).join(" "), surface)) continue;
      const hit = index.get(surface)!;
      hits.push({ termId: hit.termId, canonical: hit.canonical, matched: text.slice(start, end), start, end, method: "near_spelling" });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}
export interface Segment {
  text: string;
  termId: string | null;
  method?: TermHit["method"];
}
/** Split text into plain and hit segments using precomputed hits. */
export function segmentsFromHits(text: string, hits: TermHit[]): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < last) continue;
    if (h.start > last) out.push({ text: text.slice(last, h.start), termId: null });
    out.push({ text: text.slice(h.start, h.end), termId: h.termId, method: h.method });
    last = h.end;
  }
  if (last < text.length) out.push({ text: text.slice(last), termId: null });
  return out;
}
/** Split text into plain and matched segments for caption rendering; a matched
 * segment carries the canonical approved term id. */
export function highlightSegments(
  text: string,
  terms: MatchableTerm[],
): Segment[] {
  const index = surfaceIndex(terms);
  const surfaces = [...index.keys()].sort((a, b) => b.length - a.length);
  const segments: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(vocabularyPattern(surfaces))) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), termId: null });
    segments.push({
      text: match[0],
      termId: index.get(normalize(match[0]))!.termId,
    });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), termId: null });
  return segments;
}
/** Deterministic surface map for one approved term of a published version:
 * where the canonical term is actually usable right now. Speech-recognition
 * vocabulary remains an AWS-deferred surface and is deliberately absent. */
export function getTermSurfaces(
  termId: string,
  published: Published,
  captions: (Pick<Caption, "text"> & { matchedTerms?: Pick<TermHit, "termId">[] })[] = [],
): TermSurfaces {
  const term = published.vocabulary.find((t) => t.id === termId);
  if (!term)
    throw new Error("This term is not part of the approved lesson version.");
  return {
    explorer: published.map.parts.some((p) => p.id === termId),
    glossary: true,
    audio: term.definition.trim().length > 0,
    captions: captions.some(
      (c) =>
        c.matchedTerms?.some((h) => h.termId === termId) ||
        matchTranscriptTerms(c.text, [term]).length > 0,
    ),
    communicationAnchor: true,
  };
}
