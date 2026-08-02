/** Copy repo-root protocol/* → web-app/protocol/* for static ES module serving */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'protocol');
const dst = path.join(ROOT, 'web-app', 'protocol');
fs.mkdirSync(dst, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(src)) {
  if (!/\.(js|json)$/.test(name)) continue;
  fs.copyFileSync(path.join(src, name), path.join(dst, name));
  n++;
}
console.log(`synced ${n} files → web-app/protocol`);
