export const MAIN_SERVICE_UUID = '53654010-a391-4a65-83fa-bc58084aca28';
export const WRITE_CHAR_UUID   = '53654011-a391-4a65-83fa-bc58084aca28';
export const NOTIFY_CHAR_UUID  = '53654012-a391-4a65-83fa-bc58084aca28';

export const KEY_MAP = {
    "n": "time", "p": "temperature", "w": "puffThreshold", "q": "vibeStart",
    "kc": "step00", "vr": "step01", "ht": "step02", "ey": "step03", "mx": "step04",
    "az": "step05", "lf": "step06", "ud": "step07", "bk": "step08", "rw": "step09",
    "gy": "step10", "oc": "step11", "xj": "step12", "it": "step13", "pl": "step14",
    "bc": "step15", "wf": "step16", "dm": "step17", "jh": "step18", "tv": "step19",
    "zx": "profileNum", "yb": "puffFinishCountEnabled", "kr": "puffFinishCount",
    "st": "enableStep", "fg": "preheatReadyTime", "nx": "protectionDetection",
    "cm": "protectionReturn"
};

export const REVERSE_KEY_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));

export function decodeJson(rawJson) {
    const rawData = JSON.parse(rawJson);
    const decoded = {};
    for (const [key, val] of Object.entries(rawData)) {
        const decodedKey = KEY_MAP[key] || key;
        if (typeof val === 'object' && val !== null) {
            decoded[decodedKey] = {};
            for (const [subKey, subVal] of Object.entries(val)) {
                decoded[decodedKey][KEY_MAP[subKey] || subKey] = subVal;
            }
        } else {
            decoded[decodedKey] = val;
        }
    }
    return decoded;
}

export function encodeJson(decodedData) {
    const encoded = {};
    for (const [key, val] of Object.entries(decodedData)) {
        const encKey = REVERSE_KEY_MAP[key] || key;
        if (typeof val === 'object' && val !== null) {
            encoded[encKey] = {};
            for (const [subKey, subVal] of Object.entries(val)) {
                encoded[encKey][REVERSE_KEY_MAP[subKey] || subKey] = subVal;
            }
        } else {
            encoded[encKey] = val;
        }
    }
    return JSON.stringify(encoded);
}

export function calculateTargetHeat(degree, t) {
    if (degree === 0) return 0;
    if (degree === 1000) return 1000;
    if (degree === 230) return t[3];
    if (degree === 260) return t[2];
    if (degree === 295) return t[1];
    if (degree === 320) return t[14];
    
    let coeff = (t[11] * (295 - degree)) / 65 + (t[9] * (degree - 230)) / 65;
    let adjDegree = degree;
    if (degree === 220) adjDegree = 226;
    else if (degree === 250) adjDegree = 253;
    else if (degree === 270) adjDegree = 273;
    
    return Math.round(t[3] + (coeff / 1000) * (t[7] / t[8]) * (adjDegree - t[4] / 10));
}
