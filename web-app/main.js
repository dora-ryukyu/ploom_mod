/**
 * Ploom Studio — Web Bluetooth UI
 * Static ES modules only (no bundler required).
 * Protocol: ./protocol/ (synced copy of repo-root protocol/)
 */
import {
  MAIN_SERVICE_UUID,
  WRITE_CHAR_UUID,
  NOTIFY_CHAR_UUID,
  decodeKeys,
  encodeKeys,
  buildProfileCmds,
  toHex,
  REQUESTS,
  RESPONSES,
  WRITE_TIMING,
  parseMasterChunk,
} from './protocol/index.js';

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const els = {
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.panel'),
  btnConnect: $('btn-connect'),
  connBadge: $('conn-badge'),
  valModel: $('val-model'),
  valVersion: $('val-version'),
  valGen: $('val-gen'),
  valHealth: $('val-health'),
  valLock: $('val-lock'),
  valMaster: $('val-master'),
  masterGrid: $('master-profile-grid'),
  logOutput: $('log-output'),
  dryrunOutput: $('dryrun-output'),
  fileUpload: $('file-upload'),
  selPreset: $('sel-preset'),
  selGen: $('sel-gen'),
  btnExport: $('btn-export'),
  btnApply: $('btn-apply'),
  btnReset: $('btn-reset'),
  btnDryrun: $('btn-dryrun'),
  btnCopyLog: $('btn-copy-log'),
  btnClearLog: $('btn-clear-log'),
  btnCopyDry: $('btn-copy-dry'),
  btnVibe: $('btn-vibe'),
  btnAutostart: $('btn-autostart'),
  btnRefreshInit: $('btn-refresh-init'),
  chkEnableWrite: $('chk-enable-write'),
  stepsContainer: $('steps-container'),
  heatingChart: $('heating-chart'),
};

// ---- State ----
let bleDevice = null;
let writeChar = null;
let notifyChar = null;
/** @type {(number|undefined)[]} */
let masterSlots = new Array(20);
let masterProfile = null; // number[20] when complete
let currentProfileRaw = null;
let decodedProfile = null;
let lastDryrunText = '';
let deviceGen = 4;
let deviceState = { autoStart: false };
/** @type {Map<string, {resolve: Function, reject: Function, timer: any}>} */
const pendingByOpcode = new Map();
/** Serialize GATT writes — Android throws if two writeValueWithResponse overlap */
let writeChain = Promise.resolve();
/** One-shot / pipeline guards */
let initFlags = {
  requestedVariation: false,
  requestedMaster: false,
  pipelineRunning: false,
  gotVariation: false,
  gotMasterDone: false,
};

// ---- Tabs ----
els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((t) => t.classList.remove('active'));
    els.panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.target).classList.add('active');
  });
});

// ---- Logging ----
function ts() {
  return new Date().toISOString().slice(11, 23);
}

function log(msg) {
  els.logOutput.textContent += `[${ts()}] ${msg}\n`;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function logTx(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const op = arr.length > 1 ? arr[1] : 0;
  const name = RESPONSES[op] ? `(req op ${op})` : '';
  log(`TX  ${toHex(arr)}  len=${arr.length} ${name}`);
}

function logRx(data) {
  const op = data.length > 1 ? data[1] : 0;
  const name = RESPONSES[op] || `op0x${op.toString(16)}`;
  log(`RX  ${toHex(data)}  ${name}`);
}

els.btnCopyLog.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.logOutput.textContent);
    log('Logs copied to clipboard.');
  } catch (e) {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = els.logOutput.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    log('Logs copied (fallback).');
  }
});

els.btnClearLog.addEventListener('click', () => {
  els.logOutput.textContent = '';
});

els.btnCopyDry.addEventListener('click', async () => {
  if (!lastDryrunText) return;
  try {
    await navigator.clipboard.writeText(lastDryrunText);
    log('Dry-run hex copied.');
  } catch {
    log('Copy dry-run failed.');
  }
});

// ---- Gen ----
els.selGen.addEventListener('change', () => {
  deviceGen = parseFloat(els.selGen.value);
  els.valGen.textContent = String(deviceGen);
  log(`Gen override → ${deviceGen}`);
  updateApplyEnabled();
});

// ---- Chart / steps ----
function updateChart() {
  if (!decodedProfile) return;
  els.heatingChart.innerHTML = '';
  const maxTemp = 350;
  for (let i = 0; i <= 19; i++) {
    const step = decodedProfile[`step${String(i).padStart(2, '0')}`];
    if (!step) continue;
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${Math.min((Math.abs(step.temperature) / maxTemp) * 100, 100)}%`;
    bar.setAttribute('data-val', `${step.temperature}°`);
    els.heatingChart.appendChild(bar);
  }
}

function renderStepsEditor() {
  els.stepsContainer.innerHTML = '';
  if (!decodedProfile) return;

  for (let i = 0; i <= 19; i++) {
    const stepKey = `step${String(i).padStart(2, '0')}`;
    const step = decodedProfile[stepKey];
    if (!step) continue;

    const row = document.createElement('div');
    row.className = 'step-row';
    row.innerHTML = `
      <div class="step-label">Step ${i}</div>
      <div class="step-inputs">
        <div class="input-group">
          <label>Temp</label>
          <input type="number" data-key="${stepKey}" data-prop="temperature" value="${step.temperature}">
        </div>
        <div class="input-group">
          <label>Time</label>
          <input type="number" data-key="${stepKey}" data-prop="time" value="${step.time}">
        </div>
        <div class="input-group">
          <label>Puff</label>
          <input type="number" step="any" data-key="${stepKey}" data-prop="puffThreshold" value="${step.puffThreshold}">
        </div>
      </div>
    `;
    els.stepsContainer.appendChild(row);
  }

  els.stepsContainer.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const { key, prop } = e.target.dataset;
      const val = parseFloat(e.target.value);
      if (!Number.isNaN(val)) {
        decodedProfile[key][prop] = val;
        updateChart();
      }
    });
  });
}

function onProfileLoaded(name) {
  renderStepsEditor();
  updateChart();
  els.btnExport.disabled = false;
  els.btnDryrun.disabled = false;
  els.btnCopyDry.disabled = false;
  updateApplyEnabled();
  log(`Loaded profile: ${name}`);
  // Switch to Profile tab so chart / steps / dry-run are visible
  els.tabs[1].click();
  // Auto dry-run so "preview" is not a second manual step
  try {
    runDryrun();
  } catch (e) {
    log('Auto dry-run failed: ' + e.message);
  }
}

/**
 * heatProfileData may be: JSON string, already-parsed object, or empty (Strong).
 */
function loadDecodedFromRaw(raw, name) {
  currentProfileRaw = raw;
  let hp = raw?.heatProfileData;
  if (hp == null || hp === '') {
    throw new Error(
      `${name}: heatProfileData が空です（Strong 等は再取得が必要）`
    );
  }
  if (typeof hp === 'string') {
    hp = JSON.parse(hp);
  }
  if (typeof hp !== 'object' || Array.isArray(hp)) {
    throw new Error(`${name}: heatProfileData の形が不正です`);
  }
  decodedProfile = decodeKeys(hp);
  const step0 = decodedProfile.step00;
  log(
    `Decoded ${name}: profileNum=${decodedProfile.profileNum} step00 temp=${step0?.temperature} time=${step0?.time}`
  );
  onProfileLoaded(name);
}

els.fileUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      loadDecodedFromRaw(JSON.parse(evt.target.result), file.name);
    } catch (err) {
      log('Error loading JSON: ' + err.message);
      alert('プロファイル読み込み失敗: ' + err.message);
    }
  };
  reader.readAsText(file);
});

/** Static Pages: files live at ./profiles/ (and legacy ./public/profiles/ for Vite). */
async function fetchPresetJson(name) {
  const paths = [`./profiles/${name}.json`, `./public/profiles/${name}.json`];
  const errors = [];
  for (const p of paths) {
    try {
      const res = await fetch(p + `?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        errors.push(`${p} → HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      return { json, path: p };
    } catch (e) {
      errors.push(`${p} → ${e.message || e}`);
    }
  }
  throw new Error(errors.join(' | ') || 'preset not found');
}

els.selPreset.addEventListener('change', async () => {
  const name = els.selPreset.value;
  if (!name) return;
  log(`Loading preset ${name}…`);
  try {
    const { json, path } = await fetchPresetJson(name);
    log(`Preset fetch OK: ${path}`);
    loadDecodedFromRaw(json, name + ' (preset)');
  } catch (err) {
    log('Preset load failed: ' + err.message);
    alert('Preset 読み込み失敗:\n' + err.message);
  }
});

els.btnExport.addEventListener('click', () => {
  if (!currentProfileRaw || !decodedProfile) return;
  const encoded = encodeKeys(decodedProfile);
  const finalJson = {
    ...currentProfileRaw,
    heatProfileData: typeof currentProfileRaw.heatProfileData === 'string'
      ? JSON.stringify(encoded)
      : encoded,
  };
  const blob = new Blob([JSON.stringify(finalJson, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Custom_${currentProfileRaw.name || 'Profile'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log('Profile exported.');
});

// ---- Dry-run ----
function getMasterOrNull() {
  if (masterProfile && masterProfile.length === 20) return masterProfile;
  return null;
}

function runDryrun() {
  if (!decodedProfile) {
    log('No profile loaded.');
    return;
  }
  const master = getMasterOrNull() || new Array(20).fill(0);
  const usedLive = !!getMasterOrNull();
  const gen = deviceGen;
  const cmds = buildProfileCmds(decodedProfile, master, gen);
  const lines = [
    `# dry-run gen=${gen} cmds=${cmds.length} master=${usedLive ? 'LIVE' : 'ZEROS(placeholder)'}`,
    `# profile=${currentProfileRaw?.name || '?'} profileNum=${decodedProfile.profileNum}`,
  ];
  cmds.forEach((c, i) => {
    lines.push(`${String(i).padStart(2, '0')}  ${toHex(c)}`);
  });
  lastDryrunText = lines.join('\n');
  els.dryrunOutput.textContent = lastDryrunText;
  log(`Dry-run: ${cmds.length} cmds (gen ${gen}, master ${usedLive ? 'live' : 'zeros'}).`);
}

els.btnDryrun.addEventListener('click', runDryrun);

// ---- Write gating ----
function writesEnabled() {
  return els.chkEnableWrite.checked;
}

function updateApplyEnabled() {
  const ok =
    writesEnabled() &&
    !!writeChar &&
    !!decodedProfile &&
    !!getMasterOrNull();
  els.btnApply.disabled = !ok;
  els.btnApply.textContent = !writesEnabled()
    ? 'Apply to Device (writes off)'
    : !writeChar
      ? 'Apply (not connected)'
      : !decodedProfile
        ? 'Apply (no profile)'
        : !getMasterOrNull()
          ? 'Apply (need master 20)'
          : 'Apply to Device';
  els.btnReset.disabled = !(writesEnabled() && writeChar);
}

els.chkEnableWrite.addEventListener('change', () => {
  log(writesEnabled() ? 'Device writes ENABLED' : 'Device writes disabled (safe)');
  updateApplyEnabled();
});

// ---- BLE wait / send ----
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function rejectAllWaiters(reason) {
  for (const [, w] of pendingByOpcode) {
    clearTimeout(w.timer);
    w.reject(reason);
  }
  pendingByOpcode.clear();
}

/**
 * Official waitWriteValueResponse (js/20896 `d`):
 * Waits until GATT write callback fires (hasResponse), NOT until a notify.
 * Second arg syncResponse: if falsy, extra 100ms delay.
 * Per-cmd notify ACK is NOT required; batch completion is opcode 0x43.
 */
function waitOpcode(opcodeHex, timeoutMs = WRITE_TIMING.timeoutMs) {
  const key = opcodeHex.toUpperCase().replace(/^0x/, '');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingByOpcode.delete(key);
      resolve(null);
    }, timeoutMs);
    pendingByOpcode.set(key, { resolve, reject, timer });
  });
}

function notifyWaiters(data) {
  const op = data.length > 1 ? data[1] : 0;
  const key = op.toString(16).toUpperCase();
  const specific = pendingByOpcode.get(key);
  if (specific) {
    clearTimeout(specific.timer);
    pendingByOpcode.delete(key);
    specific.resolve(data);
  }
}

/**
 * Queue GATT writes so only one is in flight (fixes "GATT operation already in progress").
 * @returns {Promise<'ok'|'ok-no-response'|null>} null = hard failure
 */
function sendCommand(cmdArray, { settleMs } = {}) {
  const run = async () => {
    if (!writeChar) throw new Error('Not connected');
    const cmd = cmdArray instanceof Uint8Array ? cmdArray : new Uint8Array(cmdArray);
    logTx(cmd);

    const canWithResponse = !!writeChar.properties.write;
    const canWithout = !!writeChar.properties.writeWithoutResponse;

    try {
      if (canWithResponse && typeof writeChar.writeValueWithResponse === 'function') {
        await writeChar.writeValueWithResponse(cmd);
        await sleep(settleMs ?? 20);
        return 'ok';
      }
      if (canWithout && typeof writeChar.writeValueWithoutResponse === 'function') {
        await writeChar.writeValueWithoutResponse(cmd);
        await sleep(settleMs ?? WRITE_TIMING.onSyncFalseExtraDelayMs);
        return 'ok-no-response';
      }
      await writeChar.writeValue(cmd);
      await sleep(settleMs ?? WRITE_TIMING.onSyncFalseExtraDelayMs);
      return 'ok';
    } catch (e) {
      log('write failed: ' + e);
      return null;
    }
  };

  const p = writeChain.then(run, run);
  // Keep queue alive even if one write fails
  writeChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}

/**
 * Wait until predicate is true or timeout (RX may arrive before/after write).
 */
function waitUntil(predicate, timeoutMs, label) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        log(`waitUntil timeout: ${label} (${timeoutMs}ms)`);
        resolve(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Official-ish init: Init → Variation → Master, with retries.
 * Do NOT fire extra writes from every 0x30 (device can be busy / slow to 0x47).
 */
async function runInitPipeline() {
  if (initFlags.pipelineRunning) return;
  initFlags.pipelineRunning = true;
  try {
    log('Init pipeline: start');
    await sendCommand(REQUESTS.initSeq, { settleMs: 50 });
    // Let unsolicited status (0x30/33/9f/3c) settle — first capture had ~100–150ms bursts
    await sleep(250);

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (initFlags.gotVariation) break;
      log(`Init pipeline: getDeviceVariation attempt ${attempt}/3`);
      initFlags.requestedVariation = true;
      await sendCommand(REQUESTS.getDeviceVariation, { settleMs: 30 });
      const ok = await waitUntil(() => initFlags.gotVariation, 2500, '0x47 variation');
      if (!ok) log('No 0x47 yet — retrying variation…');
    }

    if (!initFlags.gotVariation) {
      log('Init pipeline: variation failed after retries (will still try master)');
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (initFlags.gotMasterDone) break;
      log(`Init pipeline: getMasterNumber attempt ${attempt}/3`);
      initFlags.requestedMaster = true;
      // reset partial master on retry
      if (attempt > 1) {
        masterSlots = new Array(20);
        masterProfile = null;
        els.valMaster.textContent = '0/20';
      }
      await sendCommand(REQUESTS.getMasterNumber, { settleMs: 30 });
      const ok = await waitUntil(() => initFlags.gotMasterDone, 4000, 'master 20/20');
      if (!ok) log('Master incomplete — retrying…');
    }

    if (initFlags.gotMasterDone) {
      log('Init pipeline: SUCCESS (master complete)');
    } else {
      log('Init pipeline: INCOMPLETE — use Refresh init button or reconnect');
    }
  } catch (e) {
    log('Init pipeline error: ' + e);
  } finally {
    initFlags.pipelineRunning = false;
    updateApplyEnabled();
  }
}

function renderMaster() {
  const filled = masterSlots.filter((v) => v !== undefined).length;
  els.valMaster.textContent = `${filled}/20`;
  if (filled < 20) return;

  masterProfile = masterSlots.map((v) => v ?? 0);
  els.masterGrid.innerHTML = '';
  masterProfile.forEach((val, i) => {
    const cell = document.createElement('div');
    cell.className = 'master-cell';
    cell.title = `t[${i}]`;
    cell.textContent = val;
    els.masterGrid.appendChild(cell);
  });
  initFlags.gotMasterDone = true;
  log(`Master complete: [${masterProfile.join(', ')}]`);
  updateApplyEnabled();
}

function handleNotify(event) {
  const data = new Uint8Array(event.target.value.buffer);
  if (data.length < 2) return;
  logRx(data);
  notifyWaiters(data);

  const opcode = data[1];
  switch (opcode) {
    case 0x18:
      break;
    case 0x30:
      // Status only — variation is requested by runInitPipeline (avoids racing writes)
      break;
    case 0x31: {
      // Device status change (stand-by / charge / …) — official case "31"
      if (data.length >= 3) {
        log(`device status byte=${data[2]} slider=${data[3] ?? '-'} panel=${data[4] ?? '-'}`);
      }
      break;
    }
    case 0x33:
      els.valHealth.textContent = `${data[2]}%`;
      break;
    case 0x35:
      break;
    case 0x3c: {
      if (data.length >= 3) {
        // Official batteryLevel-ish mapping uses nearby opcodes; log raw
        log(`op 0x3c b2=${data[2]} (often ~SoC related)`);
      }
      break;
    }
    case 0x47: {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const variation = data.length >= 4 ? view.getUint16(2, true) : data[2];
      els.valVersion.textContent = String(variation);
      initFlags.gotVariation = true;
      log(`Device variation raw=${variation}`);
      break;
    }
    case 0x44: {
      const chunk = parseMasterChunk(data, 1);
      chunk.forEach((v, i) => {
        masterSlots[i] = v;
      });
      log(`master1: [${chunk.join(', ')}]`);
      renderMaster();
      break;
    }
    case 0x45: {
      const chunk = parseMasterChunk(data, 2);
      chunk.forEach((v, i) => {
        masterSlots[9 + i] = v;
      });
      log(`master2: [${chunk.join(', ')}]`);
      renderMaster();
      break;
    }
    case 0x46: {
      const chunk = parseMasterChunk(data, 3);
      masterSlots[18] = chunk[0];
      masterSlots[19] = chunk[1];
      log(`master3: [${chunk.join(', ')}]`);
      renderMaster();
      break;
    }
    case 0x9f: {
      const s = data[2];
      els.valLock.textContent = [1, 17].includes(s) ? `Locked(${s})` : `Unlocked(${s})`;
      break;
    }
    case 0x43:
      log('Profile write done (0x43)');
      break;
    default:
      break;
  }
}

function setConnectedUi(connected) {
  if (connected) {
    els.connBadge.textContent = 'Connected';
    els.connBadge.className = 'badge badge-on';
    els.btnConnect.textContent = 'Disconnect';
    els.btnConnect.classList.remove('primary');
    els.btnConnect.classList.add('secondary');
    els.btnVibe.disabled = false;
    els.btnAutostart.disabled = false;
    if (els.btnRefreshInit) els.btnRefreshInit.disabled = false;
  } else {
    els.connBadge.textContent = 'Disconnected';
    els.connBadge.className = 'badge badge-off';
    els.btnConnect.textContent = 'Connect';
    els.btnConnect.classList.add('primary');
    els.btnConnect.classList.remove('secondary');
    els.btnConnect.disabled = false;
    els.btnVibe.disabled = true;
    els.btnAutostart.disabled = true;
    if (els.btnRefreshInit) els.btnRefreshInit.disabled = true;
    els.valModel.textContent = '---';
    writeChar = null;
    notifyChar = null;
    bleDevice = null;
  }
  updateApplyEnabled();
}

async function disconnect() {
  rejectAllWaiters(new Error('disconnect'));
  try {
    if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
  } catch {
    /* ignore */
  }
  setConnectedUi(false);
  log('Disconnected');
}

els.btnConnect.addEventListener('click', async () => {
  if (bleDevice?.gatt?.connected) {
    await disconnect();
    return;
  }

  if (!navigator.bluetooth) {
    log('Web Bluetooth not available. Use Android Chrome over HTTPS.');
    alert('Web Bluetooth が使えません。Android Chrome + HTTPS が必要です。');
    return;
  }

  try {
    log('Requesting Bluetooth device (Ploom*)…');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Ploom' }],
      optionalServices: [MAIN_SERVICE_UUID],
    });

    els.valModel.textContent = bleDevice.name || '?';
    els.btnConnect.textContent = 'Connecting…';
    els.btnConnect.disabled = true;

    bleDevice.addEventListener('gattserverdisconnected', () => {
      log('gattserverdisconnected');
      rejectAllWaiters(new Error('link lost'));
      setConnectedUi(false);
    });

    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(MAIN_SERVICE_UUID);
    const characteristics = await service.getCharacteristics();

    writeChar = null;
    notifyChar = null;
    for (const char of characteristics) {
      const u = char.uuid.toLowerCase();
      if (u === WRITE_CHAR_UUID.toLowerCase()) writeChar = char;
      if (u === NOTIFY_CHAR_UUID.toLowerCase()) notifyChar = char;
      log(`char ${char.uuid} props=${JSON.stringify({
        read: char.properties.read,
        write: char.properties.write,
        writeWithoutResponse: char.properties.writeWithoutResponse,
        notify: char.properties.notify,
        indicate: char.properties.indicate,
      })}`);
    }

    if (!writeChar || !notifyChar) {
      throw new Error('Required characteristics not found');
    }

    masterSlots = new Array(20);
    masterProfile = null;
    initFlags = {
      requestedVariation: false,
      requestedMaster: false,
      pipelineRunning: false,
      gotVariation: false,
      gotMasterDone: false,
    };
    writeChain = Promise.resolve();
    els.valMaster.textContent = '0/20';
    els.masterGrid.innerHTML = '<div class="empty-state">Loading…</div>';

    notifyChar.addEventListener('characteristicvaluechanged', handleNotify);
    try {
      await notifyChar.startNotifications();
      log('startNotifications OK');
    } catch (e) {
      log('startNotifications failed: ' + e);
      throw e;
    }

    setConnectedUi(true);
    els.btnConnect.disabled = false;
    if (els.btnRefreshInit) els.btnRefreshInit.disabled = false;

    // Sequential init with retries (do not chain off every 0x30)
    await runInitPipeline();
  } catch (error) {
    log('Connect error: ' + error);
    setConnectedUi(false);
  }
});

els.btnRefreshInit?.addEventListener('click', async () => {
  if (!writeChar || initFlags.pipelineRunning) return;
  initFlags.gotVariation = false;
  initFlags.gotMasterDone = false;
  initFlags.requestedVariation = false;
  initFlags.requestedMaster = false;
  masterSlots = new Array(20);
  masterProfile = null;
  els.valMaster.textContent = '0/20';
  els.masterGrid.innerHTML = '<div class="empty-state">Loading…</div>';
  updateApplyEnabled();
  await runInitPipeline();
});

els.btnVibe.addEventListener('click', async () => {
  if (!writeChar) return;
  try {
    await sendCommand(REQUESTS.requestVibration(true));
  } catch (e) {
    log(String(e));
  }
});

els.btnAutostart.addEventListener('click', async () => {
  if (!writeChar) return;
  try {
    const next = !deviceState.autoStart;
    await sendCommand(REQUESTS.setHeatAutoStart(next));
    deviceState.autoStart = next;
    els.btnAutostart.textContent = `AutoStart ${next ? 'ON' : 'OFF'}`;
  } catch (e) {
    log(String(e));
  }
});

els.btnReset.addEventListener('click', async () => {
  if (!writesEnabled()) {
    alert('書き込みが無効です。Enable device writes をオンにしてください。');
    return;
  }
  if (!writeChar) return;
  if (!confirm('Reset to basic profile?')) return;
  try {
    log('Reset profile…');
    const r = await sendCommand(REQUESTS.resetProfile);
    if (r == null) log('Reset: timeout (command may still have been accepted)');
    await sleep(800);
    await sendCommand(REQUESTS.initSeq);
  } catch (e) {
    log('Reset failed: ' + e);
  }
});

els.btnApply.addEventListener('click', async () => {
  if (!writesEnabled()) {
    alert('書き込み無効です。');
    return;
  }
  if (!writeChar || !decodedProfile) return;
  const master = getMasterOrNull();
  if (!master) {
    alert('Master 20 要素が揃ってから実行してください。');
    return;
  }

  const gen = deviceGen;
  const cmds = buildProfileCmds(decodedProfile, master, gen);
  if (
    !confirm(
      `書き込みます。\ngen=${gen}  cmds=${cmds.length}  profile=${currentProfileRaw?.name || '?'}\n本当によろしいですか？`
    )
  ) {
    return;
  }
  if (!confirm('最終確認: デバイスの加熱パラメータを上書きします。続行しますか？')) return;

  els.btnApply.disabled = true;
  try {
    log(`Apply start: ${cmds.length} cmds gen=${gen}`);
    for (let i = 0; i < cmds.length; i++) {
      log(`--- cmd ${i + 1}/${cmds.length} ---`);
      const status = await sendCommand(cmds[i]);
      if (status == null) {
        log(`FAILED at cmd ${i} (GATT write error). Aborting.`);
        alert(`書き込み失敗: cmd ${i}`);
        return;
      }
    }
    log('Waiting 0x43 profile-done…');
    const done = await waitOpcode('43', WRITE_TIMING.profileDoneTimeoutMs);
    if (!done) {
      log('0x43 wait timed out — check logs if 0x43 appeared during writes.');
      alert('コマンド送信は完了。0x43 完了通知が確認できませんでした。ログを確認してください。');
    } else {
      log('Apply SUCCESS (0x43 received).');
      alert('焼き込み完了 (0x43)。');
    }
  } catch (err) {
    log('Apply failed: ' + err);
    alert('Apply failed: ' + err);
  } finally {
    updateApplyEnabled();
  }
});

// Boot + build stamp (branch Pages serves build-info.js from git)
async function loadDeployStamp() {
  const el = $('deploy-stamp');
  const hint = $('deploy-hint');
  try {
    // Prefer committed build-info.js (works on /web-app/ branch Pages)
    const mod = await import(`./build-info.js?t=${Date.now()}`);
    const b = mod.BUILD_INFO || {};
    const label = `build ${b.short || b.id || '?'} · ${b.stampedAt || ''}`;
    el.textContent = label;
    if (hint) {
      hint.textContent =
        '反映確認: この build id が変わる = 新しい main.js が届いている。変わらなければハードリロード。';
    }
    log(`Build stamp: ${b.id || label}`);
  } catch (e) {
    el.textContent = 'build: unknown';
    log('Build stamp failed: ' + e);
  }
  // Optional Actions meta (if ever deployed that way)
  try {
    const res = await fetch(`./deploy-meta.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const meta = await res.json();
      if (meta.short && meta.short !== 'local') {
        log(`Pages Actions meta: ${meta.short} @ ${meta.deployedAt}`);
      }
    }
  } catch {
    /* ignore */
  }
}

log('Ploom Studio ready. Protocol: ./protocol (static ESM, no bundler).');
log(`Secure context: ${window.isSecureContext}  bluetooth: ${!!navigator.bluetooth}`);
updateApplyEnabled();
loadDeployStamp();
