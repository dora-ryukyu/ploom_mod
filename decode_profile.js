const fs = require('fs');

// Ploom_BLE_Protocol.md セクション6の難読化解除マッピング
const KEY_MAP = {
    // ステップ内のパラメータ
    "n": "time",
    "p": "temperature",
    "w": "puffThreshold",
    "q": "vibeStart",

    // メインキー
    "kc": "step00", "vr": "step01", "ht": "step02", "ey": "step03", "mx": "step04",
    "az": "step05", "lf": "step06", "ud": "step07", "bk": "step08", "rw": "step09",
    "gy": "step10", "oc": "step11", "xj": "step12", "it": "step13", "pl": "step14",
    "bc": "step15", "wf": "step16", "dm": "step17", "jh": "step18", "tv": "step19",
    "zx": "profileNum",
    "yb": "puffFinishCountEnabled",
    "kr": "puffFinishCount",
    "st": "enableStep",
    "fg": "preheatReadyTime",
    "nx": "protectionDetection",
    "cm": "protectionReturn",
    "hk": "filter1", "ve": "filter2", "al": "filter3", "ri": "filter4", "bf": "filter5",
    // 閾値群 (uw 〜 av)
    "uw": "lastThreshold1", "do": "lastThreshold2", "xi": "lastThreshold3", "yy": "lastThreshold4", 
    // ※今回はサンプルとして一部のみ定義し、それ以外は元のキー名を表示します
};

// Androidで取得したマスタープロファイル配列 (16bitリトルエンディアンで結合・変換済み)
const masterProfile = [
    1, 1537, 1509, 1503, 2423, 2419, 1912, 1227, 1220, 1119, 
    1454, 1059, 3203, 3192, 1585, 1022, 521, 595, 595, 3512
];

function calculateTargetHeat(degree, t) {
    if (degree === 0) return 0;
    if (degree === 1000) return 1000;
    
    // 特定の基準温度
    if (degree === 230) return t[3];
    if (degree === 260) return t[2];
    if (degree === 295) return t[1];
    if (degree === 320) return t[14];
  
    // 線形補間
    let coeff = (t[11] * (295 - degree)) / 65 + (t[9] * (degree - 230)) / 65;
    let adjDegree = degree;
    if (degree === 220) adjDegree = 226;
    else if (degree === 250) adjDegree = 253;
    else if (degree === 270) adjDegree = 273;
  
    return Math.round(t[3] + (coeff / 1000) * (t[7] / t[8]) * (adjDegree - t[4] / 10));
}

function decodeProfile(profileDataStr) {
    const rawData = JSON.parse(profileDataStr);
    const decoded = {};

    for (const [key, val] of Object.entries(rawData)) {
        const decodedKey = KEY_MAP[key] || key;
        
        if (typeof val === 'object' && val !== null) {
            decoded[decodedKey] = {};
            for (const [subKey, subVal] of Object.entries(val)) {
                const decSubKey = KEY_MAP[subKey] || subKey;
                decoded[decodedKey][decSubKey] = subVal;
                
                // もし温度(temperature)なら、実際のデバイス制御値を計算して付与
                if (decSubKey === "temperature") {
                    const tempRaw = Math.abs(subVal);
                    const controlValue = calculateTargetHeat(tempRaw, masterProfile) * (subVal < 0 ? -1 : 1);
                    decoded[decodedKey]["_deviceControlValue"] = controlValue;
                }
            }
        } else {
            decoded[decodedKey] = val;
        }
    }
    return decoded;
}

try {
    const ecoJsonPath = './userHeatProfile/Eco.json';
    const ecoRaw = fs.readFileSync(ecoJsonPath, 'utf8');
    const ecoProfile = JSON.parse(ecoRaw);

    console.log("=== Ploom Profile Decoder ===");
    console.log(`プロファイル名: ${ecoProfile.name}`);
    
    const decodedData = decodeProfile(ecoProfile.heatProfileData);
    
    console.log("\n[ Step 00 (初期加熱) ]");
    console.log(decodedData.step00);

    console.log("\n[ Step 01 (加熱維持) ]");
    console.log(decodedData.step01);

} catch (e) {
    console.error("エラー:", e);
}
