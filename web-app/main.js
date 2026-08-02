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
/** One-shot init pipeline (device often emits 0x30 twice) */
let initFlags = {
  requestedVariation: false,
  requestedMaster: false,
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
  els.tabs[1].click();
}

function loadDecodedFromRaw(raw, name) {
  currentProfileRaw = raw;
  const hp = raw.heatProfileData;
  decodedProfile = decodeKeys(typeof hp === 'string' ? hp : JSON.stringify(hp));
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
    }
  };
  reader.readAsText(file);
});

els.selPreset.addEventListener('change', async () => {
  const name = els.selPreset.value;
  if (!name) return;
  try {
    const res = await fetch(`./profiles/${name}.json`);
    if (!res.ok) throw new Error(res.statusText);
    loadDecodedFromRaw(await res.json(), name + ' (preset)');
  } catch (err) {
    log('Preset load failed: ' + err.message);
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

function requestVariationOnce() {
  if (initFlags.requestedVariation) return;
  initFlags.requestedVariation = true;
  sendCommand(REQUESTS.getDeviceVariation).catch((e) => log(String(e)));
}

function requestMasterOnce() {
  if (initFlags.requestedMaster) return;
  initFlags.requestedMaster = true;
  sendCommand(REQUESTS.getMasterNumber).catch((e) => log(String(e)));
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
      // Device may emit 0x30 more than once; only one variation request
      requestVariationOnce();
      break;
    case 0x33:
      els.valHealth.textContent = `${data[2]}%`;
      break;
    case 0x35:
      // Seen on Aura after init (status nibble); keep raw in log only
      break;
    case 0x3c: {
      // Likely battery level / related (payload e.g. 0x57 = 87)
      if (data.length >= 3) {
        log(`op 0x3c payload[2]=${data[2]} (often battery-ish)`);
      }
      break;
    }
    case 0x47: {
      // Official: uint16 LE at offset 2 — Aura log: 21 00 → 33
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const variation = data.length >= 4 ? view.getUint16(2, true) : data[2];
      els.valVersion.textContent = String(variation);
      log(`Device variation raw=${variation}`);
      // Aura A00800GL: keep Gen4 default unless user overrides
      requestMasterOnce();
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
  } else {
    els.connBadge.textContent = 'Disconnected';
    els.connBadge.className = 'badge badge-off';
    els.btnConnect.textContent = 'Connect';
    els.btnConnect.classList.add('primary');
    els.btnConnect.classList.remove('secondary');
    els.btnConnect.disabled = false;
    els.btnVibe.disabled = true;
    els.btnAutostart.disabled = true;
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
    initFlags = { requestedVariation: false, requestedMaster: false };
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

    log('Sending InitSeq…');
    const ack = await sendCommand(REQUESTS.initSeq);
    if (!ack) log('Init: no RX yet (may still arrive).');
  } catch (error) {
    log('Connect error: ' + error);
    setConnectedUi(false);
  }
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

// Boot + deploy stamp (GitHub Pages injects deploy-meta.json on each deploy)
async function loadDeployStamp() {
  const el = $('deploy-stamp');
  const hint = $('deploy-hint');
  try {
    const res = await fetch(`./deploy-meta.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const meta = await res.json();
    const label = `deploy ${meta.short || '?'} · ${meta.deployedAt || ''}`;
    if (meta.runUrl) {
      el.innerHTML = `<a href="${meta.runUrl}" target="_blank" rel="noopener">${label}</a>`;
    } else {
      el.textContent = label;
    }
    if (hint) {
      hint.textContent = `Pages 反映確認: この表示の commit が GitHub の最新と一致すれば更新済み。`;
    }
    log(`Deploy stamp: ${meta.short} @ ${meta.deployedAt}`);
  } catch {
    el.textContent = 'deploy: local / not stamped';
    if (hint) {
      hint.textContent =
        'deploy-meta.json が無い = まだ Pages Actions 未デプロイ、またはローカル配信。';
    }
    log('Deploy stamp: (no deploy-meta.json — local or pre-Actions host)');
  }
}

log('Ploom Studio ready. Protocol: ./protocol (static ESM, no bundler).');
log(`Secure context: ${window.isSecureContext}  bluetooth: ${!!navigator.bluetooth}`);
updateApplyEnabled();
loadDeployStamp();
