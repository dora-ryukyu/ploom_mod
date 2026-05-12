# Ploom BLE Protocol & Profile Specification

このドキュメントは、Ploomデバイスとアプリケーション間のBluetooth Low Energy (BLE)を通じた通信プロトコルおよび、加熱プロファイルの仕様を完全にリバースエンジニアリングして詳細にまとめたものです。

## 1. BLE通信仕様（UUIDとベースプロトコル）

### 対象デバイス名とフィルタリング
Web Bluetooth 等によるスキャン時には、以下のプレフィックスを利用してデバイスを探索できます。
- **基本シリーズ**: `Ploom X`, `Ploom AURA`, `Ploom aura`, `Ploom cube`
- **限定モデル/AD**: `Ploom X AD`

### UUID一覧
各種コマンドはレスポンスを待つハンドシェイク形式（基本待機インターバル 100ms）で送信されます。

- **Main Service UUID**: `53654010-a391-4a65-83fa-bc58084aca28`
- **Write (書き込み用) UUID**: `53654011-a391-4a65-83fa-bc58084aca28`
- **Indicate/Notify (通知受信用) UUID**: `53654012-a391-4a65-83fa-bc58084aca28`

*※ この他のサービスとして、Device Info(16bit:`0x180A`/10進:`6154`) や DFU Service(UUID:`65269`) も存在します。*

---

## 2. マスター補正ロジック（温度計算アルゴリズム）

Ploomでは、デバイスの個体ごとのヒーター抵抗値のばらつきを吸収するため、デバイスから読み取った「マスター補正値配列（`masterProfile`）」を用いて指定温度（`degree`）からデバイス制御用の実際の制御値へ変換します。

`masterProfile` はデバイスから取得した `masterCorrection1` (9byte)、`masterCorrection2` (9byte)、`masterCorrection3` (2byte) の計20個の数値配列（以下 `t` と表記）から成ります。
ファームウェアのバージョン等に応じて、主に以下の2種類の計算アルゴリズム（A/B）が使い分けられていることが確認されています。

### 計算式 A（基本ロジック）
```javascript
function calculateTargetHeatA(degree, t) {
  // 特別な規定値
  if (degree === 0) return 0;
  if (degree === 1000) return 1000;
  
  // 特定の基準温度の場合はマスタープロファイルの値を直接使用
  if (degree === 230) return t[3];
  if (degree === 260) return t[2];
  if (degree === 295) return t[1];
  if (degree === 320) return t[14];

  // それ以外の温度の場合の線形補間ロジック
  let coeff = (t[11] * (295 - degree)) / 65 + (t[9] * (degree - 230)) / 65;
  let adjDegree = degree;

  // 特定の温度における微調整
  if (degree === 220) adjDegree = 226;
  else if (degree === 250) adjDegree = 253;
  else if (degree === 270) adjDegree = 273;

  // 最終的な制御値の算出
  return Math.round(
    t[3] + (coeff / 1000) * (t[7] / t[8]) * (adjDegree - t[4] / 10)
  );
}
```

### 計算式 B（別バージョンロジック：基準温度などが異なる）
```javascript
function calculateTargetHeatB(degree, t) {
  // 特別な規定値
  if (degree === 0) return 0;
  if (degree === 1000) return 1000;
  
  // 特定の基準温度の場合はマスタープロファイルの値を直接使用
  if (degree === 245) return t[3];  // Aの230から変更
  if (degree === 250) return t[2];  // Aの260から変更
  if (degree === 275) return t[1];  // Aの295から変更
  if (degree === 320) return t[14];

  // それ以外の温度の場合の線形補間ロジック (除数75, 基準も異なる)
  let coeff = (t[11] * (320 - degree)) / 75 + (t[15] * (degree - 245)) / 75;
  let adjDegree = degree;

  // 特定の温度における微調整 (Aとは異なり300度のみのオフセット)
  if (degree === 300) adjDegree = 306;

  // 最終的な制御値の算出
  return Math.round(
    t[3] + (coeff / 1000) * (t[7] / t[8]) * (adjDegree - t[4] / 10)
  );
}
```

**最終結果の算出（共通）**
```javascript
// AまたはBのいずれか環境に応じた関数を使用（負の温度が設定されている場合は反転させる）
let finalValue = calculateTargetHeat(Math.abs(temperature), masterProfile) * (temperature < 0 ? -1 : 1);
```

---

## 3. 通信パケット構造（Heating Profile生成）

加熱ステップごとの設定データは、バイト列の配列に変換されて逐次送信されます。最大20個の加熱ステップ（step00〜step19）と、各種デバイス制御設定（保護・フィルター等）を含めて合計27個のコマンド（`s=0`〜`26`）が送信されます。

データ生成時のヘルパー関数によってエンディアンが決定されます。
- **2byte追加**: リトルエンディアン（`Uint16Array`）
- **4byte追加**: リトルエンディアン（`Int32Array` or `Uint32Array`）

### [Step 00 (s=0)] 加熱プロファイル・スタート
`[Header(2byte), プロファイル番号(1B), 温度補正値(2B), 継続時間(1B), 0, 0, パフしきい値(4B), バイブ開始タイミング(1B)]`

### [Step 01〜19 (s=1〜19)] 以降の加熱ステップ
`[Header(2byte), 温度補正値(2B), 継続時間(1B), 0, 0, パフしきい値(4B), バイブ開始タイミング(1B)]`

### [Step 20 (s=20)] 保護仕様・ヒーター劣化補正パラメータ
`[Header(2byte), プロファイル番号(1B), HOORT(2B), EnableStep(1B), ヒーター劣化補正(2B), 保護検知(2B), 保護リターン(2B)]`
*(※HOORT = Heater Out Of Range Threshold)*

### [Step 21 (s=21)] フィルター設定群1
`[Header(2byte), Filter1(4B), Filter2(4B), Filter3(4B)]`

### [Step 22 (s=22)] フィルター設定群2
`[Header(2byte), Filter4(4B), Filter5(4B)]`

### [Step 23 (s=23)] ラストしきい値群 (LastThreshold)
`[Header(2byte), LastThreshold1(2B) 〜 LastThreshold9(2B)]` (計9パラメータ・18byte)

### [Step 24 (s=24)] 初期抵抗時間配列
`[Header(2byte), InitialResistanceTime0(1B) 〜 InitialResistanceTime9(1B)]` (計10パラメータ・10byte)

### [Step 25 (s=25)] 初期抵抗リターン配列1
`[Header(2byte), InitialResistanceReturn0(2B) 〜 InitialResistanceReturn4(2B)]` (計5パラメータ・10byte)

### [Step 26 (s=26)] 初期抵抗リターン配列2
`[Header(2byte), InitialResistanceReturn5(2B) 〜 InitialResistanceReturn9(2B)]` (計5パラメータ・10byte)

### v4.x向け 拡張フォーマット (Step 20 〜 31)
※ v4.x（Ploom X ADVANCED 等）の場合はStep20のフォーマットが変わり、全体が32パケットに拡張されています。
- **[Step 20] v4.x基本設定**: `[Header(2B), プロファイル番号(1B), PuffFinishCountEnabled(1B), PuffFinishCount(1B), EnableStep(1B), PreheatReadyTime(1B), 0x00, ProtectionDetection(2B), ProtectionReturn(2B)]`
- **[Step 21〜22] フィルター設定1・2**: 旧型と同じ
- **[Step 23〜26] ラスト閾値群**: 閾値が計27個に拡張され、4つのパケットに分割。
- **[Step 27〜29] 初期抵抗/時間**: 旧型のStep24〜26に相当。
- **[Step 30〜31] リーフレット表示配列**: `leaflet0` 〜 `leaflet19` (各1B) のLED等の表示用配列20個分が2パケットに分かれて送信される。

---

## 6. 加熱プロファイル（JSON）の難読化解解除・カスタムマッピング
Ploom公式アプリがAPI(`/userHeatProfile`)から取得、またはデバイスに保存している設定値（`Eco.json`, `Strong.json` 等の `heatProfileData`）は、キー名が2文字に短縮（難読化）されたJSON文字列として扱われています。
これらを元のプロパティ名にマッピング（翻訳）することで、独自の温度や時間を持つ完全にオリジナルのカスタムプロファイルを作成することが可能です。

### ステップ内パラメータのマッピング
- `n` → `time` (時間)
- `p` → `temperature` (温度)
- `w` → `puffThreshold` (パフ判定しきい値)
- `q` → `vibeStart` (バイブレーション開始タイミング)

*(例: `"kc": {"n": 60, "p": 320, "w": 1000, "q": 255}` → `step00` は「60秒間, 目標320度, パフ閾値1000, バイブ255」)*

### メインキー（ステップ・フィルター等）のマッピング表
| 難読化キー | 元のプロパティ名 | 備考 |
|---|---|---|
| `kc` 〜 `tv` | `step00` 〜 `step19` | 順に紐づき。各ステップの加熱内容を定義。|
| `zx` | `profileNum` | |
| `yb` | `puffFinishCountEnabled` | |
| `kr` | `puffFinishCount` | パフ回数上限 |
| `st` | `enableStep` | |
| `fg` | `preheatReadyTime` | プレヒート完了時間 |
| `nx`, `cm` | `protectionDetection`, `protectionReturn`| 保護検知・リターン閾値 |
| `hk`,`ve`,`al`,`ri`,`bf` | `filter1` 〜 `filter5` | フィルター設定群1・2用 |
| `uw` 〜 `av` | `lastThreshold1` 〜 `lastThreshold27` | パフ終了判定等に利用される閾値群 |
| `ni` 〜 `my` | `initialResistanceTime0` 〜 `9` | 初期抵抗測定用 時間配列 |
| `sz` 〜 `jn` | `initialResistanceReturn0` 〜 `9` | 初期抵抗測定用 リターン値配列 |
| `xv` 〜 `tx` | `leaflet0` 〜 `leaflet19` | LED等のインジケーター配列 (v4.x以降で使用) |
| `rc` 〜 | `soc100` 〜 `soc0` 等 (続く) | バッテリー残量(SoC)カーブ定義 |

これらの固定値（フィルターや閾値）は純正アプリが取得している実データ（`Eco.json` など）からそのまま流用し、`kc` (`step00`) 等の温度(`p`) と 時間(`n`) だけを書き換えて文字列化し直すツールを組むことで、**完全に任意のカスタムプリセットが作成可能**になります。

---

## 4. 全コマンド・オペコード一覧 (Request / Response)

### 送信コマンド（Request Opcodes: 先頭が [2, ...] 系など）
Write UUID に対して以下のフォーマットのバイト列を書き込むと、デバイス側がその要求を処理します。

| コマンド列 | 説明 | 備考 |
|---------|------|-----|
| `[2, 227, 0]` | **InitSequence要求** | デバイス初期状態取得 |
| `[2, 255, 0]` | **DFUモード設定** | 本体ファームウェアアップデート開始 |
| `[2, 162, 0]` | **現在プロファイル番号取得** |  |
| `[2, 165, 0]` | **マスター番号(補正値)取得** | **極めて重要:** `t`の算出に必要 |
| `[12, 160, 1, ...lockPattern]` | **ロック有効化設定** | 10桁のロックパターンを指定 |
| `[2, 158, 0/1]` | **ロック状態の強制変更** | 0=解除, 1=ロック |
| `[2, 202, 0/1]` | **自動加熱開始オン/オフ** | |
| `[2, 193, 0]` | **喫煙ログ(Smoking Log)取得** |  |
| `[2, 194, 0]` | **充電ログ(Charge Log)取得** |  |
| `[2, 121, 0/1]` | **バイブレーション設定** | 0=OFF, 1=ON |
| `[2, 224, 0]` | **デバイスバリエーション取得** | Ploomのバージョン判別用 |

### 受信通知オペコード（Response/Notify Opcodes: Header 1byte目）
Notify UUID から受け取るバイト列の先頭のHexコード（オペコード）ごとの挙動です。

| Opcode (Hex) | Dec | ペイロードデータ内容 | 説明・動作 |
|--------|-----|------|------|
| `0x18` | 24 | バッテリーや自動開始フラグ | 接続直後のデバイスステータス |
| `0x30` | 48 | ログカウントなど | 接続完了応答 |
| `0x33` | 51 | バッテリー劣化度 | |
| `0x36`〜`0x3A` | 54-58 | 喫煙・パフの挙動データ | どのように吸ったかの吸煙時間やタイミングのログ |
| `0x3B` | 59 | 充電時間と変化 | 充電ログデータ |
| `0x40` | 64 | マスター補正値など | (FWのバージョンにより充電詳細データになる場合も) |
| `0x44` | 68 | マスター補正値1 (9要素) | |
| `0x45` | 69 | マスター補正値2 (9要素) | |
| `0x46` | 70 | マスター補正値3 (2要素) | |
| `0x47` | 71 | バージョン/バリエーション | `"3.0"`, `"3.05"`, `"3.1"`, `"4.0"`, `"4.1"` 等の判別 |
| `0x9F` | 159 | ロック状態とパターン | |
| `0xFC` | 252 | 電波強度 (RSSI) | |
| `0xFF`系| 240+ | エラー群 (`F2`, `F4`) | デバイスのエラーコード通知 |

---

## 5. デバイス情報の状態構成（Device Object）
アプリが管理・保持しているPloomデバイスの状態ツリー構造です。この情報がデバイスから読み取られ、スマホ側と同期しています。

```json
{
  "status": null,
  "puffSetting": null,
  "serialNumber": null,
  "advertisingName": null,
  "latitude": null,
  "longitude": null,
  "batteryDegradation": null,            // バッテリー劣化度
  "remainingBatteryLevel": null,         // バッテリー残量
  "chargeLogCount": 0,                   // 充電回数ログ
  "smokingLogCount": 0,                  // 吸煙回数ログ
  "profileNumber": null,
  "masterCorrection": [...],             // 20要素
  "version": "3.0" | "3.05" | "3.1" | "4.0" | "4.1", // ファームウェア由来デバイスバージョン
  "isLockingFunctionSetting": null,
  "lockingStatus": null,
  "dfuStatus": null,                     // DFU(Device Firmware Update)ステータス
  "RSSI": null,                          // 信号強度
  "lockPattern": [0,0,0,0,0,0,0,0,0,0],  // ロック解除コマンド（スライダー/ボタンのパターン）
  "sliderStatus": 1,
  "frontPanelStatus": 0,
  "latestError": null,
  "errors": [],
  "vapeTotalCount": null,                // 通算吸引回数
  "batteryCondition": [0,0,0,0,0],
  "isLastVape": false
}
```

これらの仕様に基づいてBLE通信の送信データ構築および受診時の検証・ステータス同期が可能です。
