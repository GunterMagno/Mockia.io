/** Escala "bonita" para conteos enteros: 0..top con pasos 1/2/5 x 10^n y unos 4 intervalos. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  const safe = Number.isFinite(max) && max > 0 ? max : 1;
  const raw = safe / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude);
  const top = Math.ceil(safe / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks };
}

/** Indices del eje X que llevan etiqueta: repartidos por igual, siempre el primero y el ultimo. */
export function labelIndexes(count: number, slots: number): number[] {
  if (count <= 0) return [];
  const wanted = Math.max(2, Math.min(count, slots));
  if (count === 1) return [0];
  const out = new Set<number>();
  for (let i = 0; i < wanted; i += 1) out.add(Math.round((i * (count - 1)) / (wanted - 1)));
  return [...out].sort((a, b) => a - b);
}
