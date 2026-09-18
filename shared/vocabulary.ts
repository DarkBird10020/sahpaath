export const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function vocabularyPattern(terms: string[], capture = true): RegExp {
  const alternatives = [...terms]
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
