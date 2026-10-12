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

/**
 * Indices del eje X que llevan etiqueta: salto uniforme contando desde el ultimo dia (siempre etiquetado), asi las
 * etiquetas quedan a la misma distancia y no se pisan.
 */
export function labelIndexes(count: number, slots: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const step = Math.max(1, Math.ceil((count - 1) / Math.max(1, slots - 1)));
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}
