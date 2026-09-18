/** Atmospheric Higgsfield artwork; the adjacent DOM label supplies its meaning. */
export default function PathwayEmblem({ kind }: { kind: "explore" | "read" | "ask" }) {
  return <span className={`pathway-emblem emblem-${kind}`} aria-hidden="true" />;
}
