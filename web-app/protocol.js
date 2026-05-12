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

export function buildProfileCmds(e, masterProfile) {
    const tL = [
      [12, 167], [11, 168], [11, 169], [11, 170], [11, 171], [11, 172], [11, 173], [11, 174], [11, 175], [11, 176], 
      [11, 177], [11, 178], [11, 179], [11, 180], [11, 181], [11, 182], [11, 183], [11, 184], [11, 185], [11, 186], 
      [11, 187], [13, 188], [9, 189], [13, 190], [13, 199], [13, 200], [19, 201], [11, 212], [11, 213], [11, 214], 
      [11, 215], [11, 216]
    ];
    
    const tp = (val) => new Uint8Array(new Uint16Array([val]).buffer);
    const tO = (val = 0) => {
        let t = new Uint32Array(1);
        t[0] = val;
        return new Uint8Array(t.buffer);
    };

    let i = [];
    tL.forEach((a, n) => {
        let s = [];
        if (n < 20) {
            let stepStr = `step${n.toString().padStart(2, '0')}`;
            let stepData = e[stepStr];
            if (!stepData) return;
            let temp = Number(stepData.temperature);
            let heat = temp < 0 ? temp : calculateTargetHeat(temp, masterProfile);
            if (heat < 0) {
                heat = new Uint16Array(new Int16Array([heat]).buffer)[0]; // convert negative to Uint16
            }
            let time = Number(stepData.time);
            let puff = Number(stepData.puffThreshold);
            if (puff < 0 || puff % 1 !== 0) {
                // If puff is a float or negative, mapping logic in original uses tO which casts to Uint32. 
                // We'll mimic the original casting by using new Float32Array if needed, but original used Uint32Array.
                // We'll trust the original JS cast:
                puff = new Uint32Array(new Float32Array([puff]).buffer)[0];
            } else {
                puff = puff;
            }
            let vibe = Number(stepData.vibeStart);
            
            if (n === 0) {
                s = [...a, Number(e.profileNum), ...tp(heat), time, 0, 0, ...tO(puff), vibe];
            } else {
                s = [...a, ...tp(heat), time, 0, 0, ...tO(puff), vibe];
            }
        } else if (n === 20) {
            if (e.puffFinishCountEnabled !== undefined) {
                // Gen4 structure
                s = [...a, Number(e.profileNum), Number(e.puffFinishCountEnabled), Number(e.puffFinishCount), Number(e.enableStep), Number(e.preheatReadyTime), 0, ...tp(Number(e.protectionDetection)), ...tp(Number(e.protectionReturn))];
            } else {
                // Gen3 structure
                s = [...a, Number(e.profileNum), ...tp(Number(e.hoort) || 0), Number(e.enableStep), ...tp(Number(e.heaterDegrationCorrect) || 0), ...tp(Number(e.protectionDetection)), ...tp(Number(e.protectionReturn))];
            }
        } else if (n === 21) {
            s = [...a, ...tO(Number(e.filter1)), ...tO(Number(e.filter2)), ...tO(Number(e.filter3))];
        } else if (n === 22) {
            s = [...a, ...tO(Number(e.filter4)), ...tO(Number(e.filter5))];
        } else if (n === 23) {
            s = [...a, ...tp(Number(e.lastThreshold1)), ...tp(Number(e.lastThreshold2)), ...tp(Number(e.lastThreshold3)), ...tp(Number(e.lastThreshold4)), ...tp(Number(e.lastThreshold5)), ...tp(Number(e.lastThreshold6))];
        } else if (n === 24) {
            s = [...a, ...tp(Number(e.lastThreshold7)), ...tp(Number(e.lastThreshold8)), ...tp(Number(e.lastThreshold9)), ...tp(Number(e.lastThreshold10||0)), ...tp(Number(e.lastThreshold11||0)), ...tp(Number(e.lastThreshold12||0))];
        } else if (n === 25) {
            s = [...a, ...tp(Number(e.lastThreshold13||0)), ...tp(Number(e.lastThreshold14||0)), ...tp(Number(e.lastThreshold15||0)), ...tp(Number(e.lastThreshold16||0)), ...tp(Number(e.lastThreshold17||0)), ...tp(Number(e.lastThreshold18||0))];
        } else if (n === 26) {
            s = [...a, ...tp(Number(e.lastThreshold19||0)), ...tp(Number(e.lastThreshold20||0)), ...tp(Number(e.lastThreshold21||0)), ...tp(Number(e.lastThreshold22||0)), ...tp(Number(e.lastThreshold23||0)), ...tp(Number(e.lastThreshold24||0)), ...tp(Number(e.lastThreshold25||0)), ...tp(Number(e.lastThreshold26||0)), ...tp(Number(e.lastThreshold27||0))];
        } else if (n === 27) {
            s = [...a, Number(e.initialResistanceTime0||0), Number(e.initialResistanceTime1||0), Number(e.initialResistanceTime2||0), Number(e.initialResistanceTime3||0), Number(e.initialResistanceTime4||0), Number(e.initialResistanceTime5||0), Number(e.initialResistanceTime6||0), Number(e.initialResistanceTime7||0), Number(e.initialResistanceTime8||0), Number(e.initialResistanceTime9||0)];
        } else if (n === 28) {
            s = [...a, ...tp(Number(e.initialResistanceReturn0||0)), ...tp(Number(e.initialResistanceReturn1||0)), ...tp(Number(e.initialResistanceReturn2||0)), ...tp(Number(e.initialResistanceReturn3||0)), ...tp(Number(e.initialResistanceReturn4||0))];
        } else if (n === 29) {
            s = [...a, ...tp(Number(e.initialResistanceReturn5||0)), ...tp(Number(e.initialResistanceReturn6||0)), ...tp(Number(e.initialResistanceReturn7||0)), ...tp(Number(e.initialResistanceReturn8||0)), ...tp(Number(e.initialResistanceReturn9||0))];
        } else if (n === 30 || n === 31) {
            let t = 10 * (n !== 30);
            s = [...a, Number(e[`leaflet${t}`]||0), Number(e[`leaflet${t+1}`]||0), Number(e[`leaflet${t+2}`]||0), Number(e[`leaflet${t+3}`]||0), Number(e[`leaflet${t+4}`]||0), Number(e[`leaflet${t+5}`]||0), Number(e[`leaflet${t+6}`]||0), Number(e[`leaflet${t+7}`]||0), Number(e[`leaflet${t+8}`]||0), Number(e[`leaflet${t+9}`]||0)];
        }
        
        // Push the mapped array if it was built
        if (s.length > 0) {
            i.push(s);
        }
    });

    return i;
}
