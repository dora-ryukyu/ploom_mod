/**
 * Official-faithful profile command builders
 * Gen3: tz + tI (27 cmds)
 * Gen4: tL (32 cmds)
 */
import { HEADERS_GEN3, HEADERS_GEN4 } from './headers.js';
import { signedTargetHeat } from './heatMath.js';
import { u16le, u32le, puffBytes, heatU16 } from './binary.js';

function step(profile, n) {
  return profile['step' + String(n).padStart(2, '0')];
}

/**
 * Step duration on the wire is a single uint8 (official: Number(i.time) into one byte).
 * Values >255 silently wrap in Uint8Array (e.g. 300 → 44) and produce ~4 min sessions.
 */
function stepTimeU8(time, label = 'step') {
  const n = Number(time) || 0;
  if (n < 0 || n > 255 || !Number.isFinite(n)) {
    throw new Error(
      `${label} time=${time} is out of uint8 range (0–255). ` +
        `BLE packs duration as one byte; 300 becomes 44 on the wire.`
    );
  }
  return n | 0;
}

export function buildProfileGen3(profile, masterProfile, profileSlot) {
  const out = [];
  const slot = profileSlot != null ? profileSlot : Number(profile.profileNum);

  HEADERS_GEN3.forEach((hdr, s) => {
    let M = [];
    if (s < 20) {
      const a = step(profile, s);
      if (!a) return;
      const heat = signedTargetHeat(a.temperature, masterProfile, 3);
      if (s === 0) {
        M = [
          ...hdr,
          slot || Number(profile.profileNum),
          ...heatU16(heat),
          stepTimeU8(a.time, `step${String(s).padStart(2, '0')}`),
          0,
          0,
          ...puffBytes(a.puffThreshold),
          Number(a.vibeStart),
        ];
      } else {
        M = [
          ...hdr,
          ...heatU16(heat),
          stepTimeU8(a.time, `step${String(s).padStart(2, '0')}`),
          0,
          0,
          ...puffBytes(a.puffThreshold),
          Number(a.vibeStart),
        ];
      }
    } else if (s === 20) {
      M = [
        ...hdr,
        Number(profile.profileNum),
        ...u16le(Number(profile.hoort || 0)),
        Number(profile.enableStep),
        ...u16le(Number(profile.heaterDegrationCorrect || 0)),
        ...u16le(Number(profile.protectionDetection)),
        ...u16le(Number(profile.protectionReturn)),
      ];
    } else if (s === 21) {
      M = [
        ...hdr,
        ...u32le(Number(profile.filter1)),
        ...u32le(Number(profile.filter2)),
        ...u32le(Number(profile.filter3)),
      ];
    } else if (s === 22) {
      M = [
        ...hdr,
        ...u32le(Number(profile.filter4)),
        ...u32le(Number(profile.filter5)),
      ];
    } else if (s === 23) {
      M = [...hdr];
      for (let i = 1; i <= 9; i++) {
        M.push(...u16le(Number(profile['lastThreshold' + i] || 0)));
      }
    } else if (s === 24) {
      M = [...hdr];
      for (let i = 0; i <= 9; i++) {
        M.push(Number(profile['initialResistanceTime' + i] || 0));
      }
    } else if (s === 25) {
      M = [...hdr];
      for (let i = 0; i <= 4; i++) {
        M.push(...u16le(Number(profile['initialResistanceReturn' + i] || 0)));
      }
    } else if (s === 26) {
      M = [...hdr];
      for (let i = 5; i <= 9; i++) {
        M.push(...u16le(Number(profile['initialResistanceReturn' + i] || 0)));
      }
    }
    if (M.length) out.push(M);
  });
  return out;
}

export function buildProfileGen4(profile, masterProfile) {
  const out = [];

  HEADERS_GEN4.forEach((hdr, n) => {
    let s = [];
    if (n < 20) {
      const i = step(profile, n);
      if (!i) return;
      const rawTemp = Number(i.temperature);
      const heat = signedTargetHeat(rawTemp, masterProfile, 4);
      // Official Gen4: [hdr, (step0: eeprom), heat u16, time, rawTemp u16, puff i32, vibe]
      s = [
        ...hdr,
        ...(n === 0 ? [Number(i.eeprom != null ? i.eeprom : 1)] : []),
        ...heatU16(heat),
        stepTimeU8(i.time, `step${String(n).padStart(2, '0')}`),
        ...u16le(rawTemp | 0),
        ...puffBytes(i.puffThreshold),
        Number(i.vibeStart),
      ];
    } else if (n === 20) {
      s = [
        ...hdr,
        Number(profile.profileNum),
        Number(profile.puffFinishCountEnabled || 0),
        Number(profile.puffFinishCount || 15),
        Number(profile.enableStep),
        Number(profile.preheatReadyTime),
        0,
        ...u16le(Number(profile.protectionDetection)),
        ...u16le(Number(profile.protectionReturn)),
      ];
    } else if (n === 21) {
      s = [
        ...hdr,
        ...u32le(Number(profile.filter1)),
        ...u32le(Number(profile.filter2)),
        ...u32le(Number(profile.filter3)),
      ];
    } else if (n === 22) {
      s = [
        ...hdr,
        ...u32le(Number(profile.filter4)),
        ...u32le(Number(profile.filter5)),
      ];
    } else if (n === 23) {
      s = [...hdr];
      for (let i = 1; i <= 6; i++) {
        s.push(...u16le(Number(profile['lastThreshold' + i] || 0)));
      }
    } else if (n === 24) {
      s = [...hdr];
      for (let i = 7; i <= 12; i++) {
        s.push(...u16le(Number(profile['lastThreshold' + i] || 0)));
      }
    } else if (n === 25) {
      s = [...hdr];
      for (let i = 13; i <= 18; i++) {
        s.push(...u16le(Number(profile['lastThreshold' + i] || 0)));
      }
    } else if (n === 26) {
      s = [...hdr];
      for (let i = 19; i <= 27; i++) {
        s.push(...u16le(Number(profile['lastThreshold' + i] || 0)));
      }
    } else if (n === 27) {
      s = [...hdr];
      for (let i = 0; i <= 9; i++) {
        s.push(Number(profile['initialResistanceTime' + i] || 0));
      }
    } else if (n === 28) {
      s = [...hdr];
      for (let i = 0; i <= 4; i++) {
        s.push(...u16le(Number(profile['initialResistanceReturn' + i] || 0)));
      }
    } else if (n === 29) {
      s = [...hdr];
      for (let i = 5; i <= 9; i++) {
        s.push(...u16le(Number(profile['initialResistanceReturn' + i] || 0)));
      }
    } else if (n === 30 || n === 31) {
      const base = 10 * (n !== 30 ? 1 : 0);
      s = [...hdr];
      for (let k = 0; k < 10; k++) {
        s.push(Number(profile['leaflet' + (base + k)] || 0));
      }
    }
    if (s.length) out.push(s);
  });
  return out;
}

/** @param {number|string} gen e.g. 4, '4.0', 3.1 */
export function buildProfileCmds(profile, masterProfile, gen = 4, profileSlot) {
  const g = typeof gen === 'string' ? parseFloat(gen) : gen;
  if (g >= 4) return buildProfileGen4(profile, masterProfile);
  return buildProfileGen3(profile, masterProfile, profileSlot);
}
