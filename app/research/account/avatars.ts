/** The account icon choices (canvas A9): the initial plus 23 emoji tiles. No photo upload. */
export const INITIAL = "initial";
const IDS = ["rocket", "chart", "diamond", "crown", "bolt", "fire", "moon", "sun", "wave", "mountain", "compass", "shield", "anchor", "target", "eagle", "bull", "bear", "lion", "dragon", "robot", "brain", "telescope", "coin"];
export const TILES: { id: string; glyph: string; from: string; to: string }[] = [
  ["🚀", "#ff7a5955", "#7a2a8ccc"], ["📈", "#34d39955", "#0f766ecc"], ["💎", "#60a5fa55", "#6d28d9cc"], ["👑", "#f6d36b55", "#b45309cc"],
  ["⚡", "#fde04755", "#d97706cc"], ["🔥", "#fb923c55", "#dc2626cc"], ["🌙", "#a78bfa55", "#312e81cc"], ["☀️", "#fcd34d55", "#f97316cc"],
  ["🌊", "#38bdf855", "#1d4ed8cc"], ["🏔️", "#94a3b855", "#334155cc"], ["🧭", "#f9a8d455", "#9d174dcc"], ["🛡️", "#5eead455", "#0e7490cc"],
  ["⚓", "#7dd3fc55", "#1e3a8acc"], ["🎯", "#f8717155", "#7f1d1dcc"], ["🦅", "#fbbf2455", "#78350fcc"], ["🐂", "#4ade8055", "#14532dcc"],
  ["🐻", "#c4a48455", "#44301ccc"], ["🦁", "#fbbf2455", "#b45309cc"], ["🐉", "#86efac55", "#065f46cc"], ["🤖", "#c4b5fd55", "#4c1d95cc"],
  ["🧠", "#f9a8d455", "#be185dcc"], ["🔭", "#93c5fd55", "#1e40afcc"], ["🪙", "#fde68a55", "#a16207cc"],
].map(([glyph, from, to], i) => ({ id: IDS[i], glyph, from, to }));
export const tileById = (id: unknown) => typeof id === "string" ? TILES.find(tile => tile.id === id) : undefined;
export const tileBackground = (tile: { from: string; to: string }) => `radial-gradient(circle at 30% 25%,${tile.from},${tile.to} 75%),#10161f`;
