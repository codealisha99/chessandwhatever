/** Rating delta for a player scoring `score` (1, 0.5, 0) against `opp`. Provisional players move faster. */
export function eloDelta(rating: number, opp: number, score: number, gamesPlayed: number): number {
  const k = gamesPlayed < 20 ? 40 : rating >= 2400 ? 16 : 24;
  const expected = 1 / (1 + 10 ** ((opp - rating) / 400));
  return Math.round(k * (score - expected));
}
