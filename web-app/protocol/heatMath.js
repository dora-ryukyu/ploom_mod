/** Temperature → device control value (official formulas A/B) */

export function calculateTargetHeatGen3(degree, t) {
  if (degree === 0) return 0;
  if (degree === 1000) return 1000;
  if (degree === 230) return t[3];
  if (degree === 260) return t[2];
  if (degree === 295) return t[1];
  if (degree === 320) return t[14];
  const coeff = (t[11] * (295 - degree)) / 65 + (t[9] * (degree - 230)) / 65;
  let adj = degree;
  if (degree === 220) adj = 226;
  else if (degree === 250) adj = 253;
  else if (degree === 270) adj = 273;
  return Math.round(t[3] + (coeff / 1000) * (t[7] / t[8]) * (adj - t[4] / 10));
}

export function calculateTargetHeatGen4(degree, t) {
  if (degree === 0) return 0;
  if (degree === 1000) return 1000;
  if (degree === 245) return t[3];
  if (degree === 250) return t[2];
  if (degree === 275) return t[1];
  if (degree === 320) return t[14];
  const coeff = (t[11] * (320 - degree)) / 75 + (t[15] * (degree - 245)) / 75;
  let adj = degree;
  if (degree === 300) adj = 306;
  return Math.round(t[3] + (coeff / 1000) * (t[7] / t[8]) * (adj - t[4] / 10));
}

/** Official: abs(temp) → formula → re-apply sign */
export function signedTargetHeat(temperature, masterProfile, gen = 4) {
  const n = Number(temperature);
  const abs = Math.abs(n);
  const fn = gen >= 4 ? calculateTargetHeatGen4 : calculateTargetHeatGen3;
  const v = fn(abs, masterProfile);
  return n < 0 ? -v : v;
}
