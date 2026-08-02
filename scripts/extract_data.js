const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', '72761-20c4e98f11d2723f.js'), 'utf8');

// Find KEY_MAP by unique value chain
const anchor = 'puffThreshold';
let pos = 0;
const maps = [];
while (true) {
  const p = src.indexOf('w: "' + anchor + '"', pos);
  if (p < 0) break;
  // walk back to opening brace of object
  let i = p;
  while (i > 0 && src[i] !== '{') i--;
  // ensure this looks like key map (has kc: step00 nearby)
  const window = src.slice(i, i + 800);
  if (window.includes('step00') && window.includes('temperature')) {
    let depth = 0;
    let end = i;
    for (let k = i; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}') {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    const obj = eval('(' + src.slice(i, end + 1) + ')');
    maps.push({ start: i, end, size: Object.keys(obj).length, obj });
  }
  pos = p + 1;
}

console.log(
  'found maps:',
  maps.map((m) => m.size)
);

// Prefer largest map (full Gen4 with soc*)
maps.sort((a, b) => b.size - a.size);
const full = maps[0].obj;

// Also grab tw-style smaller maps and merge missing keys (hoort etc.)
const MERGED = Object.assign({}, full);
for (const m of maps) {
  for (const [k, v] of Object.entries(m.obj)) {
    if (!(k in MERGED)) MERGED[k] = v;
  }
}

function extractNamedArray(varName) {
  // match: tI = [ ... ],  or tL = [ ... ],
  const re = new RegExp(
    varName + ' = \\[\\s*([\\s\\S]*?)\\n        \\],',
    'm'
  );
  const m = src.match(re);
  if (!m) {
    // try alternate indentation
    const re2 = new RegExp(varName + ' = \\[([\\s\\S]*?)\\],\\s*\\n', 'm');
    const m2 = src.match(re2);
    if (!m2) throw new Error('array not found: ' + varName);
    return eval('[' + m2[1] + ']');
  }
  return eval('[' + m[1] + ']');
}

// tI appears once as Gen3 headers; tL as Gen4
// Be careful: there may be multiple. Use lengths 27 and 32.
function findHeaderArrays() {
  const re = /\b(t[IL]) = \[([\s\S]*?)\n        \],/g;
  const found = {};
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const arr = eval('[' + m[2] + ']');
    if (Array.isArray(arr) && arr.length >= 20 && Array.isArray(arr[0])) {
      found[name] = arr;
      console.log('header', name, arr.length);
    }
  }
  return found;
}

const headers = findHeaderArrays();
if (!headers.tI || !headers.tL) {
  // fallback scan for [[12, 167], [11, 168]
  const marker = '[[12, 167], [11, 168], [11, 169]';
  // minified might not have spaces - check
  console.log('looking for header patterns...');
}

const outDir = path.join(ROOT, 'protocol');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '_keymap.json'), JSON.stringify(MERGED, null, 2));
fs.writeFileSync(
  path.join(outDir, '_headers.json'),
  JSON.stringify(
    {
      tI: headers.tI || null,
      tL: headers.tL || null,
    },
    null,
    2
  )
);

console.log('MERGED keys', Object.keys(MERGED).length);
console.log('sample', {
  kc: MERGED.kc,
  hk: MERGED.hk,
  bo: MERGED.bo,
  xy: MERGED.xy,
  zq: MERGED.zq,
  yb: MERGED.yb,
});
