/** Request / response catalog from js/20896.js + notify switch in 72761 */

export const REQUESTS = {
  initSeq: [2, 227, 0],
  dfuMode: [2, 255, 0],
  getProfileNumber: [2, 162, 0],
  getDownloadProfileNumber: [2, 163, 0],
  setProfileNumber: (n) => [2, 164, n],
  getMasterNumber: [2, 165, 0],
  resetProfile: [2, 166, 0],
  setDeviceRegistration: (on) => [2, 191, on ? 1 : 0],
  setPuffSetting: (on) => [2, 192, on ? 1 : 0],
  requestSmokingLog: [2, 193, 0],
  requestChargeLog: [2, 194, 0],
  smokingLogFinished: [2, 195, 0],
  setLogDeletePermission: [2, 196, 0],
  setLogDeletePermission2: [2, 197, 0],
  setSmokingAssist: (on) => [2, 198, on ? 1 : 0],
  setHeatAutoStart: (on) => [2, 202, on ? 1 : 0],
  requestChargeCondition: [2, 124, 0],
  requestLastStickCheck: [2, 123, 0],
  requestErrorLog: (index) => [2, 211, index],
  requestErrorLogInfo: [2, 243, 0],
  getProductId: [2, 225, 0],
  getDeviceVariation: [2, 224, 0],
  getStickDetect1: (dest) => [2, 207, dest],
  getStickDetect2: (dest) => [2, 208, dest],
  getStickFalseDetect1: (dest) => [2, 209, dest],
  getStickFalseDetect2: (dest) => [2, 210, dest],
  getRSSI: [2, 253, 0],
  requestVibration: (on) => [2, 121, on ? 1 : 0],
  setLockStatus: (on) => [2, 158, on ? 1 : 0],
  setBluetoothSetting: (on) => [2, 161, on ? 1 : 0],
};

export const RESPONSES = {
  0x18: 'deviceStatus',
  0x30: 'connectionResponse',
  0x33: 'batteryHealth',
  0x3d: 'profileRelated',
  0x3e: 'downloadProfileNumber',
  0x40: 'masterOrCharge',
  0x43: 'heatingProfileWriteDone',
  0x44: 'masterCorrection1',
  0x45: 'masterCorrection2',
  0x46: 'masterCorrection3',
  0x47: 'deviceVariation',
  0x48: 'postWriteRelated',
  0x4a: 'falseDetect1Ack',
  0x4b: 'falseDetect2Ack',
  0x50: 'errorLog',
  0x7a: 'vibrationResult',
  0x9f: 'lockingStatus',
  0xfc: 'rssi',
};

/** Write handshake timing (official waitWriteValueResponse) */
export const WRITE_TIMING = {
  pollMs: 10,
  timeoutMs: 5000,
  onSyncFalseExtraDelayMs: 100,
  profileDoneOpcode: 0x43,
  profileDoneTimeoutMs: 5000,
};

export function parseMasterChunk(data, which) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (which === 1 || which === 2) {
    const arr = [];
    for (let i = 0; i < 9; i++) arr.push(view.getUint16(2 + i * 2, true));
    return arr;
  }
  if (which === 3) {
    return [view.getUint16(2, true), view.getUint16(4, true)];
  }
  throw new Error('which must be 1|2|3');
}

export function mergeMaster(c1, c2, c3) {
  return [...c1, ...c2, ...c3];
}

/** Infer gen from FW string like official setBluetoothConnected */
export function inferGenFromFirmware(fw) {
  const s = fw || '';
  if (s.includes('G4')) return 4;
  if (s.includes('G3.1')) return 3.1;
  return 3;
}
