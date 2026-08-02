/**
 * pair-watch.js
 * Keeps BLE scanning continuously and connects the instant a Ploom appears.
 * Use this when pairing mode only lasts ~10s:
 *   1) start this script first
 *   2) THEN put the device into pairing mode
 *
 * Read-only: Init / Version / Master / ProfileNum. No profile writes.
 *
 * Usage: node cli/pair-watch.js [watchSeconds=180]
 */
const noble = require('@abandonware/noble');

const MAIN = '53654010a3914a6583fabc58084aca28';
const WRITE = '53654011a3914a6583fabc58084aca28';
const NOTIFY = '53654012a3914a6583fabc58084aca28';
const WATCH_MS = (Number(process.argv[2]) || 180) * 1000;

function hex(b) {
  return Buffer.from(b)
    .toString('hex')
    .match(/.{1,2}/g)
    .join(' ');
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function ts() {
  return new Date().toISOString().slice(11, 23);
}
function log(...args) {
  console.log(`[${ts()}]`, ...args);
}

const master = {};
let phase = 'watch'; // watch | connecting | done
let attempts = 0;

function isPloom(p) {
  const name = p.advertisement.localName || '';
  const uuids = (p.advertisement.serviceUuids || []).map((u) =>
    (u || '').toLowerCase(),
  );
  return /ploom/i.test(name) || uuids.some((u) => u.includes('53654010'));
}

async function readSession(p) {
  attempts += 1;
  const tag = `try#${attempts}`;
  p.on('disconnect', () => log(tag, 'disconnect event, state=', p.state));

  log(
    tag,
    'CONNECT',
    p.advertisement.localName || p.id,
    'rssi',
    p.rssi,
    'conn',
    p.connectable,
  );

  // Fast connect with short retries (pairing window is short)
  let connected = false;
  for (let i = 1; i <= 4; i++) {
    try {
      if (p.state !== 'connected') await p.connectAsync();
      if (p.state === 'connected') {
        connected = true;
        break;
      }
    } catch (e) {
      log(tag, 'connect fail', i, e.message);
      await sleep(200);
    }
  }
  if (!connected) throw new Error('connect failed');
  log(tag, 'link up');

  // Minimal settle — don't burn the pairing window
  await sleep(200);
  if (p.state !== 'connected') throw new Error('dropped before GATT');

  log(tag, 'discover services...');
  const services = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('services timeout 8s')), 8000);
    p.discoverServices([MAIN], (err, svcs) => {
      clearTimeout(t);
      if (err) reject(err);
      else resolve(svcs || []);
    });
  });
  log(
    tag,
    'services',
    services.map((s) => s.uuid),
  );
  let main = services.find((s) => s.uuid.replace(/-/g, '') === MAIN);
  if (!main) {
    const all = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('all-svc timeout')), 8000);
      p.discoverServices([], (err, svcs) => {
        clearTimeout(t);
        if (err) reject(err);
        else resolve(svcs || []);
      });
    });
    log(
      tag,
      'all services',
      all.map((s) => s.uuid),
    );
    main = all.find((s) => s.uuid.replace(/-/g, '') === MAIN);
  }
  if (!main) throw new Error('main service missing');

  const chars = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('chars timeout')), 8000);
    main.discoverCharacteristics([], (err, ch) => {
      clearTimeout(t);
      if (err) reject(err);
      else resolve(ch || []);
    });
  });
  chars.forEach((c) => log(tag, 'char', c.uuid, c.properties.join('|')));

  const writeChar = chars.find((c) => c.uuid.replace(/-/g, '') === WRITE);
  const notifyChar = chars.find((c) => c.uuid.replace(/-/g, '') === NOTIFY);
  if (!writeChar || !notifyChar) throw new Error('write/notify missing');

  notifyChar.on('data', (data) => {
    const buf = Buffer.from(data);
    log('[RX]', hex(buf));
    let op = buf[0];
    let start = 1;
    const known = [0x18, 0x30, 0x33, 0x44, 0x45, 0x46, 0x47, 0x9f, 0x40];
    if (buf.length >= 2 && known.includes(buf[1])) {
      op = buf[1];
      start = 2;
    }
    log('  op=0x' + op.toString(16));
    if (op === 0x47) {
      log('  ver', hex(buf.slice(start)), buf.slice(start).toString('utf8'));
    }
    if (op === 0x44 || op === 0x45 || op === 0x46) {
      const vals = [];
      for (let i = start; i + 1 < buf.length; i += 2) vals.push(buf.readUInt16LE(i));
      master[op] = vals;
      log('  master', vals.join(','));
    }
  });

  await new Promise((resolve, reject) =>
    notifyChar.subscribe((err) => (err ? reject(err) : resolve())),
  );
  log(tag, 'subscribed');

  async function send(cmd, label) {
    if (p.state !== 'connected') throw new Error('gone before ' + label);
    const b = Buffer.from(cmd);
    log('[TX]', label, hex(b));
    await new Promise((resolve, reject) => {
      writeChar.write(b, false, (err) => {
        if (!err) return resolve();
        writeChar.write(b, true, (err2) => (err2 ? reject(err2) : resolve()));
      });
    });
  }

  await send([2, 227, 0], 'Init');
  await sleep(1000);
  await send([2, 224, 0], 'Version');
  await sleep(1000);
  await send([2, 165, 0], 'Master');
  await sleep(2500);
  await send([2, 162, 0], 'ProfileNum');
  await sleep(1000);

  log('=== SUMMARY ===');
  log('master parts', Object.keys(master).map((k) => '0x' + Number(k).toString(16)));
  if (master[0x44] && master[0x45] && master[0x46]) {
    const full = [...master[0x44], ...master[0x45], ...master[0x46]];
    log('FULL', JSON.stringify(full));
    log('len', full.length);
  } else {
    log('incomplete', JSON.stringify(master));
  }

  try {
    await p.disconnectAsync();
  } catch (_) {}
}

async function resumeWatch() {
  phase = 'watch';
  try {
    await noble.startScanningAsync([], true);
    log('watching again... (put device in pairing mode now)');
  } catch (e) {
    log('rescan failed', e.message);
  }
}

async function main() {
  log('pair-watch start, window', WATCH_MS / 1000, 's');
  log('>>> START THIS FIRST, then put Ploom into pairing mode <<<');

  const deadline = setTimeout(() => {
    log('watch window expired without full success');
    process.exit(1);
  }, WATCH_MS);

  // heartbeat so you know it's alive
  const beat = setInterval(() => {
    if (phase === 'watch') log('...still watching (pairing mode ~10s — trigger device now)');
  }, 5000);

  noble.on('stateChange', async (s) => {
    log('adapter', s);
    if (s === 'poweredOn') {
      await noble.startScanningAsync([], true);
      log('scan ON — waiting for Ploom advertisement');
    }
  });

  noble.on('discover', async (p) => {
    if (phase !== 'watch') return;
    if (!isPloom(p)) return;

    phase = 'connecting';
    log(
      'PLOOM SEEN',
      p.advertisement.localName || p.id,
      'rssi',
      p.rssi,
      '— connecting immediately',
    );

    try {
      await noble.stopScanningAsync();
    } catch (_) {}

    // tiny yield only
    await sleep(50);

    try {
      await readSession(p);
      clearTimeout(deadline);
      clearInterval(beat);
      phase = 'done';
      log('SUCCESS');
      process.exit(0);
    } catch (e) {
      log('FAIL', e.message || e);
      // device may still be in pairing window — retry watch immediately
      try {
        if (p.state === 'connected') await p.disconnectAsync();
      } catch (_) {}
      await sleep(300);
      await resumeWatch();
    }
  });

  noble.on('error', (e) => log('noble error', e));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
