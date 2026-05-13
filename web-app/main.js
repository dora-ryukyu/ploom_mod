import { MAIN_SERVICE_UUID, WRITE_CHAR_UUID, NOTIFY_CHAR_UUID, decodeJson, encodeJson, buildProfileCmds } from './protocol.js';

// ---- UI Elements ----
const els = {
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.panel'),
  btnConnect: document.getElementById('btn-connect'),
  valModel: document.getElementById('val-model'),
  valVersion: document.getElementById('val-version'),
  valHealth: document.getElementById('val-health'),
  valLock: document.getElementById('val-lock'),
  masterGrid: document.getElementById('master-profile-grid'),
  logOutput: document.getElementById('log-output'),
  fileUpload: document.getElementById('file-upload'),
  btnExport: document.getElementById('btn-export'),
  btnApply: document.getElementById('btn-apply'),
  btnReset: document.getElementById('btn-reset'),
  stepsContainer: document.getElementById('steps-container'),
  heatingChart: document.getElementById('heating-chart')
};

// ---- State ----
let bleDevice = null;
let writeChar = null;
let notifyChar = null;
let masterProfile = [];
let currentProfileRaw = null;
let decodedProfile = null;
let deviceState = { autoStart: false, locked: false };

// ---- Tab Switching ----
els.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    els.tabs.forEach(t => t.classList.remove('active'));
    els.panels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.target).classList.add('active');
  });
});

// ---- Utility ----
function log(msg) {
  els.logOutput.textContent += msg + '\n';
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function updateChart() {
  if (!decodedProfile) return;
  els.heatingChart.innerHTML = '';
  
  const maxTemp = 350;
  for (let i = 0; i <= 19; i++) {
    const stepKey = `step${i.toString().padStart(2, '0')}`;
    const step = decodedProfile[stepKey];
    if (step) {
      const bar = document.createElement('div');
      bar.className = 'chart-bar';
      const heightPct = Math.min((Math.abs(step.temperature) / maxTemp) * 100, 100);
      bar.style.height = `${heightPct}%`;
      bar.setAttribute('data-val', `${step.temperature}°`);
      els.heatingChart.appendChild(bar);
    }
  }
}

function renderStepsEditor() {
  els.stepsContainer.innerHTML = '';
  if (!decodedProfile) return;

  for (let i = 0; i <= 19; i++) {
    const stepKey = `step${i.toString().padStart(2, '0')}`;
    const step = decodedProfile[stepKey];
    if (!step) continue;

    const row = document.createElement('div');
    row.className = 'step-row';

    row.innerHTML = `
      <div class="step-label">Step ${i}</div>
      <div class="step-inputs">
        <div class="input-group">
          <label>Temp (°C)</label>
          <input type="number" data-key="${stepKey}" data-prop="temperature" value="${step.temperature}">
        </div>
        <div class="input-group">
          <label>Time (s)</label>
          <input type="number" data-key="${stepKey}" data-prop="time" value="${step.time}">
        </div>
      </div>
    `;
    els.stepsContainer.appendChild(row);
  }

  // Add listeners
  els.stepsContainer.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', (e) => {
      const stepKey = e.target.dataset.key;
      const prop = e.target.dataset.prop;
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        decodedProfile[stepKey][prop] = val;
        updateChart();
      }
    });
  });
}

// ---- Profile Loading & Exporting ----
els.fileUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      currentProfileRaw = JSON.parse(evt.target.result);
      decodedProfile = decodeJson(currentProfileRaw.heatProfileData);
      renderStepsEditor();
      updateChart();
      log(`Loaded profile: ${file.name}`);
      els.btnApply.disabled = false;
      // Switch to profile tab
      els.tabs[1].click();
    } catch (err) {
      log('Error loading JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
});

els.btnExport.addEventListener('click', () => {
  if (!currentProfileRaw || !decodedProfile) return;
  
  // Re-encode and construct final JSON
  const encodedData = encodeJson(decodedProfile);
  const finalJson = { ...currentProfileRaw, heatProfileData: encodedData };
  
  const blob = new Blob([JSON.stringify(finalJson, null, 4)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Custom_${currentProfileRaw.name || 'Profile'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log('Profile exported successfully.');
});

els.btnApply.addEventListener('click', async () => {
  if (!writeChar) {
    alert("デバイスに接続してください。");
    return;
  }
  
  if (!decodedProfile) {
    alert("適用するプロファイルをロードしてください。");
    return;
  }

  if (!confirm("現在のプロファイルをデバイスに焼き込みます。よろしいですか？")) return;

  try {
    log("Building commands...");
    const masterCorrection = masterProfile && masterProfile.length === 20 ? masterProfile : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const cmds = buildProfileCmds(decodedProfile, masterCorrection);
    
    log(`Sending ${cmds.length} commands to device...`);
    
    // Disable UI during write
    els.btnApply.disabled = true;
    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      await sendCommand(cmd);
      // Wait to ensure processing
      await new Promise(r => setTimeout(r, 50));
    }
    
    log("Successfully Applied to Device!");
    alert("焼き込みが完了しました！");
  } catch (err) {
    log("Apply to Device Failed: " + err);
  } finally {
    els.btnApply.disabled = false;
  }
});

// Additional control buttons dynamically generated
document.addEventListener('DOMContentLoaded', () => {
  const actionsDiv = document.querySelector('.actions');
  
  const additionalControls = document.createElement('div');
  additionalControls.className = 'controls';
  additionalControls.style.marginTop = '10px';
  additionalControls.innerHTML = `
    <button id="btnToggleAutoStart" class="btn secondary" disabled>自動加熱 (Auto Start)</button>
    <button id="btnToggleVibe" class="btn secondary" disabled>バイブテスト</button>
  `;
  actionsDiv.appendChild(additionalControls);

  const btnToggleAutoStart = document.getElementById('btnToggleAutoStart');
  const btnToggleVibe = document.getElementById('btnToggleVibe');
  
  els.btnToggleAutoStart = btnToggleAutoStart;
  els.btnToggleVibe = btnToggleVibe;

  btnToggleAutoStart.addEventListener('click', async () => {
    if (!writeChar) return;
    try {
      const newState = !deviceState.autoStart;
      await sendCommand([2, 202, newState ? 1 : 0]);
      deviceState.autoStart = newState;
      btnToggleAutoStart.innerText = `自動加熱 (Auto Start): ${newState ? 'ON' : 'OFF'}`;
      log("Auto Start toggled: " + newState);
    } catch (err) {
      log("Toggle failed: " + err);
    }
  });

  btnToggleVibe.addEventListener('click', async () => {
    if (!writeChar) return;
    try {
      await sendCommand([2, 121, 1]);
      log("Vibration requested.");
    } catch (err) {
      log("Vibration request failed: " + err);
    }
  });
});

els.btnReset.addEventListener('click', async () => {
  if (!writeChar) {
    alert("デバイスに接続してください。");
    return;
  }
  
  if (!confirm("初期（ベーシック）モードにリセットしますか？")) return;
  
  try {
    log("Resetting to Basic Profile...");
    await sendCommand([2, 166, 0]);
    log("Reset complete.");
    setTimeout(() => sendCommand([2, 227, 0]), 1000);
  } catch (err) {
    log("Reset failed: " + err);
  }
});

// ---- BLE Logic ----
async function sendCommand(cmdArray) {
  if (!writeChar) return;
  const cmd = new Uint8Array(cmdArray);
  await writeChar.writeValue(cmd);
}

function parseMasterProfile(idx, data) {
    // raw payload format: [Length, Opcode, payload bytes...]
    // We already know it's Little Endian 16bit.
    const view = new DataView(data.buffer);
    const elements = (data.length - 2) / 2;
    const offset = (idx === 1 ? 0 : (idx === 2 ? 9 : 18));
    
    for (let i = 0; i < elements; i++) {
        masterProfile[offset + i] = view.getUint16(2 + i * 2, true);
    }

    // If we have all 20, render them
    if (masterProfile.filter(v => v !== undefined).length === 20) {
        els.masterGrid.innerHTML = '';
        masterProfile.forEach(val => {
            const cell = document.createElement('div');
            cell.className = 'master-cell';
            cell.textContent = val;
            els.masterGrid.appendChild(cell);
        });
        log('Master Profile fully loaded.');
    }
}

function handleNotify(event) {
    const data = new Uint8Array(event.target.value.buffer);
    if (data.length < 2) return;
    
    const opcode = data[1];
    const hexOpcode = '0x' + opcode.toString(16).toUpperCase().padStart(2, '0');
    
    switch (opcode) {
        case 0x18:
            log(`[RX] Device Status`);
            break;
        case 0x30:
            log(`[RX] Connection Response`);
            // Chain next command
            setTimeout(() => sendCommand([2, 224, 0]), 200);
            break;
        case 0x33:
            els.valHealth.textContent = `${data[2]}%`;
            log(`[RX] Battery Health: ${data[2]}%`);
            break;
        case 0x47:
            if (data.length >= 6) {
                const versionNum = data[2];
                // basic mapping
                const verStr = versionNum === 33 ? '3.3 (AURA)' : `Code:${versionNum}`;
                els.valVersion.textContent = verStr;
                log(`[RX] Version: ${verStr}`);
            }
            // Chain next command
            setTimeout(() => sendCommand([2, 165, 0]), 200);
            break;
        case 0x44:
            parseMasterProfile(1, data);
            break;
        case 0x45:
            parseMasterProfile(2, data);
            break;
        case 0x46:
            parseMasterProfile(3, data);
            break;
        case 0x9F:
            els.valLock.textContent = data[2] === 0 ? 'Unlocked' : 'Locked';
            break;
    }
}

els.btnConnect.addEventListener('click', async () => {
    try {
        log('Requesting Bluetooth Device...');
        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: 'Ploom' }],
            optionalServices: [MAIN_SERVICE_UUID]
        });

        els.valModel.textContent = bleDevice.name;
        els.btnConnect.textContent = 'Connecting...';
        els.btnConnect.disabled = true;

        bleDevice.addEventListener('gattserverdisconnected', () => {
            log('Disconnected');
            els.btnConnect.textContent = 'Connect Device';
            els.btnConnect.disabled = false;
            els.btnReset.disabled = true;
            els.valModel.textContent = '---';
        });

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(MAIN_SERVICE_UUID);
        const characteristics = await service.getCharacteristics();
        
        for (const char of characteristics) {
            if (char.uuid === WRITE_CHAR_UUID) writeChar = char;
            if (char.uuid === NOTIFY_CHAR_UUID) notifyChar = char;
        }

        notifyChar.addEventListener('characteristicvaluechanged', handleNotify);
        
        try {
            await notifyChar.startNotifications();
            log('Notifications started.');
        } catch (e) {
            log('Notification start failed (ensure device is unbound in OS): ' + e);
        }

        els.btnConnect.textContent = 'Connected';
        els.btnConnect.classList.replace('primary', 'secondary');
        els.btnReset.disabled = false;

        // Init Sequence to trigger the cascade of fetching data
        await sendCommand([2, 227, 0]);
        log('Init sequence sent...');

    } catch (error) {
        log('Error: ' + error);
        els.btnConnect.textContent = 'Connect Device';
        els.btnConnect.disabled = false;
    }
});
