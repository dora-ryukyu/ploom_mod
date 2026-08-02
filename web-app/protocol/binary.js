/** LE helpers matching official tE/tp, tk/tO, tT */

export function u16le(val) {
  return Array.from(new Uint8Array(new Uint16Array([val & 0xffff]).buffer));
}

export function u32le(val = 0) {
  const t = new Uint32Array(1);
  t[0] = val >>> 0;
  return Array.from(new Uint8Array(t.buffer));
}

export function i32le(val = 0) {
  const t = new Int32Array(1);
  t[0] = val | 0;
  return Array.from(new Uint8Array(t.buffer));
}

/** Official: Int32 LE of (puffThreshold * 1000) */
export function puffBytes(puffThreshold) {
  return i32le(Math.trunc(1000 * Number(puffThreshold)));
}

/** Store signed heat as int16 bit pattern in two LE bytes */
export function heatU16(signedHeat) {
  const t = new Int16Array(1);
  t[0] = signedHeat | 0;
  return Array.from(new Uint8Array(t.buffer));
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
