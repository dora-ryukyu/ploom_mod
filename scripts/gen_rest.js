const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'protocol');

const K = JSON.parse(fs.readFileSync(path.join(DIR, '_keymap.json'), 'utf8'));
const H = JSON.parse(fs.readFileSync(path.join(DIR, '_headers.json'), 'utf8'));

const keyFns = `
export const REVERSE_KEY_MAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);

export function decodeKeys(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const dk = KEY_MAP[key] || key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      out[dk] = {};
      for (const [sk, sv] of Object.entries(val)) {
        out[dk][KEY_MAP[sk] || sk] = sv;
      }
    } else {
      out[dk] = val;
    }
  }
  return out;
}

export function encodeKeys(decoded) {
  const out = {};
  for (const [key, val] of Object.entries(decoded)) {
    const ek = REVERSE_KEY_MAP[key] || key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      out[ek] = {};
      for (const [sk, sv] of Object.entries(val)) {
        out[ek][REVERSE_KEY_MAP[sk] || sk] = sv;
      }
    } else {
      out[ek] = val;
    }
  }
  return out;
}
`;

fs.writeFileSync(
  path.join(DIR, 'keyMap.js'),
  '/** heatProfileData map — official 72761 module 46644 + tw extras */\n' +
    'export const KEY_MAP = ' +
    JSON.stringify(K, null, 2) +
    ';\n' +
    keyFns
);

fs.writeFileSync(
  path.join(DIR, 'headers.js'),
  '/** Profile packet headers — official tI (Gen3) / tL (Gen4) */\n' +
    'export const HEADERS_GEN3 = ' +
    JSON.stringify(H.tI) +
    ';\n' +
    'export const HEADERS_GEN4 = ' +
    JSON.stringify(H.tL) +
    ';\n'
);

// Mirror into web-app so static hosting needs no bundler / no parent-dir imports
const webProto = path.join(ROOT, 'web-app', 'protocol');
fs.mkdirSync(webProto, { recursive: true });
for (const name of fs.readdirSync(DIR)) {
  if (!/\.(js|json)$/.test(name)) continue;
  fs.copyFileSync(path.join(DIR, name), path.join(webProto, name));
}
// Keep presets next to index.html for GitHub Pages (no Vite public/ rewrite)
const srcProfiles = path.join(ROOT, 'userHeatProfile');
const dstProfiles = path.join(ROOT, 'web-app', 'profiles');
fs.mkdirSync(dstProfiles, { recursive: true });
if (fs.existsSync(srcProfiles)) {
  for (const name of fs.readdirSync(srcProfiles)) {
    if (!name.endsWith('.json')) continue;
    fs.copyFileSync(path.join(srcProfiles, name), path.join(dstProfiles, name));
  }
}
console.log('keyMap', Object.keys(K).length, 'headers', H.tI.length, H.tL.length);
console.log('synced → web-app/protocol + web-app/profiles');
