# Ploom BLE / Profile Mod — 開発レポート

最終更新: 2026-08-02

---

## 1. 目的

Ploom デバイス（対象: **Ploom aura A00800GL** など）の BLE 加熱プロファイルを、公式アプリ以外から **読み取り・プレビュー・（将来）安全な書き込み** できるようにする。

現状の優先順位:

1. Android Chrome + Web Bluetooth で **読み取りパイプラインを確定**（Init → Version → Master）
2. 公式と一致する **コマンド生成（dry-run）**
3. 書き込みは **明示オプトイン + 0x43 完了待ち** のみ

---

## 2. 現状サマリ

| 領域 | 状態 | メモ |
|------|------|------|
| 公式 JS 入手 | **完了** | `js/72761-*.js`, `js/20896.js` 等 |
| プロトコル整理 | **完了** | 正本 `protocol/`（KEY_MAP 208、Gen3/4 ビルダー） |
| web-app 差し替え | **完了** | `@protocol` 経由。旧 `web-app/protocol.js` は破棄 |
| 全 TX/RX hex ログ | **完了** | Copy ボタンあり |
| Dry-run | **完了** | master 未取得時は zeros プレースホルダ明示 |
| 書き込み安全弁 | **完了** | デフォルト OFF。master 20 必須。二重 confirm |
| 実機 RX（この Aura） | **未** | Windows では RX 空が多発。Android 待ち |
| 書き込み実成功 | **未検証** | 実装はあるが実機未確認 |
| GitHub Pages 配信 | **準備可** | `web-app/` を静的公開（**ビルド不要**） |
| 自宅鯖 + Tailscale | **後回し** | 完成後デプロイ想定 |

---

## 3. アーキテクチャ

```
js/*                        # 公式 minified（immutable 参照）
  ↓ extract_data.js + gen_rest.js
protocol/*                  # 論理の正本（リポジトリルート）
  ↓ sync / gen_rest がコピー
web-app/protocol/*          # ブラウザ用コピー（相対 import）
web-app/index.html + main.js
  ↓ 静的サーブのみ（ビルド不要）
任意の HTTPS ホスト / GitHub Pages
```

**ビルドは不要。** `index.html` → `./main.js` → `./protocol/*.js` の素の ES modules。

| パス | 役割 |
|------|------|
| `protocol/` | 論理の正本（抽出・編集の源） |
| `web-app/protocol/` | 上記のコピー。ブラウザはここだけ見る |
| `web-app/main.js` | 接続・ログ・dry-run・gated apply |
| `web-app/public/profiles/` | Eco / Long / Strong プリセット |
| `docs/SOURCE_INVENTORY.md` | ソース棚卸し |
| `docs/Ploom_BLE_Protocol.md` | 旧手書きメモ（矛盾時は `protocol/` 優先） |
| `cli/pair-watch.js` | Windows noble 実験（本線ではない） |

---

## 4. 公式から確定した仕様

### BLE

- Service `53654010-…-bc58084aca28`
- Write `…4011…` / Notify-Indicate `…4012…`
- Init `[2,227,0]` →（0x30 等）→ Variation `[2,224,0]` → Master `[2,165,0]` → 0x44/45/46

### プロファイル書き込み

- Gen3: ヘッダ表 `tI`（27 cmds）、温度式 A、puff = `Int32LE(trunc(puff*1000))`
- Gen4: ヘッダ表 `tL`（32 cmds）、温度式 B、step0 に eeprom、step に raw temp u16
- 各 cmd: GATT write 完了待ち（公式 `waitWriteValueResponse`）。**notify 1:1 必須ではない**
- バッチ後: **opcode 0x43**（timeout 5s）
- 公式はその後 stick/false-detect 等（未移植・後回し可）

### 難読化 JSON

- `heatProfileData` は 2 文字キー。`protocol/keyMap.js` に **208 エントリ**（soc・leaflet・hoort 含む）

---

## 5. 修正した既知バグ（旧 web-app）

| 問題 | 旧挙動 | 現在 |
|------|--------|------|
| KEY_MAP 不完全 | filter 等が 0 化 | 208 キー decode |
| puff 符号化 | ×1000 なし / 型誤り | Int32×1000 |
| Gen 混在 | tL 固定 + 温度式 A | Gen3/4 分離、UI で override |
| Apply | 50ms 連打で成功扱い | write 失敗で中断 + 0x43 待ち |
| master なし書き込み | zeros で進行 | Apply 不可 |
| ログ | 一部文言のみ | 全 TX/RX hex + Copy |

---

## 6. Windows 実験で分かったこと

- Settings の「接続済み」は `AlwaysShowDeviceAsConnected` 等で **見た目だけ**のことがある
- noble / bleak でもリンク後 GATT Unreachable や **RX 0** が多発
- MediaTek 内蔵 BT + OS 所有の組み合わせがボトルネックになりやすい
- **本線は Android Web Bluetooth**（外出先・自宅どちらでも）
- ドングルは任意。無くても Android で進める方針

---

## 7. web-app の使い方（Android / 開発）

### ローカル（ビルド不要）

```bash
# どれでも可 — web-app をドキュメントルートにする
npx --yes serve web-app
# または
python -m http.server 8080 --directory web-app
```

`file://` だと ES modules / Web Bluetooth が制限されるので、簡単な HTTP サーバを当てる。  
PC ブラウザは WebBT 非対応のことが多い → 実機検証は Pages か HTTPS ホスト。

Vite（`cd web-app && npm run dev`）は任意。HMR 用で、必須ではない。

### GitHub Pages（開発中推奨）

Workflow: `.github/workflows/pages.yml` が **`web-app/` をそのまま** Pages にデプロイ（bundler なし）。

**初回だけ** リポジトリ Settings → **Pages** → Build and deployment → Source を **GitHub Actions** にする。

反映確認:

1. Actions タブで `Deploy web-app to Pages` が緑
2. アプリ画面ヘッダの **`deploy <short-sha> · <UTC time>`**（`deploy-meta.json`）
3. ログ先頭の `Deploy stamp: …`
4. 古いキャッシュが残る場合は URL に `?` を付けるか、Chrome でハードリロード

必要: **HTTPS**、Android **Chrome**、端末の BT オン。

ルートの `protocol/` を直したあとは:

```bash
node scripts/sync_protocol_webapp.js
# または extract 後の gen_rest.js が自動コピー
```

### 初回セッション（書き込み禁止）

1. Connect → Ploom 選択
2. ログに TX/RX hex が出ること
3. Master 20/20 になること
4. **Copy** でログを PC に送る
5. Preset または JSON Load → **Dry-run**（送信しない）
6. Apply は **Enable device writes** を入れるまで押しても無効

### Gen 選択

- デフォルト **Gen4**（Aura 想定）
- 実機 FW / 挙動を見て 3.1 / 3 に変更
- dry-run / apply 両方に効く

---

## 8. 実機キャプチャ（Aura / Android）— Phase A 成功

2026-08 ログ（要約）:

| 項目 | 値 |
|------|-----|
| TX char | write=true, **writeWithoutResponse=false** |
| RX char | **indicate=true** only（notify=false）→ `startNotifications` で OK |
| 0x47 variation | **33** (`05 47 21 00 00 00`) |
| Battery health 0x33 | **100%** (`02 33 64`) |
| Lock 0x9f | unlocked |
| 追加 RX | 0x3c（例: 0x57）、0x35（例: 01 00 00 00）— 未完全解読 |
| Master 20 | `[1, 1537, 1509, 1503, 2423, 2419, 1912, 1227, 1220, 1119, 1454, 1059, 3203, 3192, 1585, 1022, 521, 595, 595, 3512]` |

既知ノイズ（修正済想定）: Init 後 0x30 が複数回来て variation/master 要求が二重化し、`GATT operation already in progress` が出ることがあった → **write キュー + one-shot 連鎖**。

### デバイス上のプロファイル（重要・訂正）

**本体に「複数プロファイルから選ぶ」UIは無い**（ユーザー確認）。

| 状態 | 実機の意味 |
|------|------------|
| Apply 成功（0x43） | **今の加熱レシピがその1本に置き換わる** |
| Reset Basic `[2,166,0]` | **標準（工場/デフォルト）に戻る** |
| アプリ JSON の Eco/Long/SuperLong | **PC/Web 側の素材**。本体メニュー項目ではない |

公式 JS の `profileNumber` 0/1/2 は **アプリ↔デバイス内部フラグ**（カスタム有無・ログ用）であり、「本体で Standard / Custom を切り替える画面」ではない、と解釈する。  
以前の「Apply 後に本体でスロットを選べ」は **誤り**。

### 実測セッション長

| プロファイル | ステップ合計 | 実測 wall | 備考 |
|--------------|--------------|-----------|------|
| **Long**（公式 / 自作クライアント） | 439s（7.32 min） | **~6.5 min** | 比率 約 0.89。経路は信用可 |
| **SuperLong v1**（高温+終端変更+st=9） | 480s 設計 | **~5:30** | 形式が Long から外れ短命化 |
| **SuperLong v2**（step05=**300**) | 543s つもり | **~4 min** | **原因確定: step `time` は wire 上 uint8。300→44 に wrap。実効合計 ≈287s → wall ~4.3 min と一致** |
| **SuperLong v3** | **543s（9.05 min）** | **~7:50** | step05=255 / step06=155。温度 Long 維持。比率 ≈0.86 |
| **SuperLong v4**（現行） | 543s（同上） | 未測 | v3 時間のまま加熱帯 **+10°C**（310 / 231 / 250 / 260、−220 と終端 0 は維持） |

- `puffFinishCountEnabled=0` のため **パフ回数上限は主因にしにくい**
- **ステップ合計 ≠ ウォールタイム** は Long でも確認済み
- **step duration は 1 バイト（0–255 秒/ステップ）**。公式 Long の最長 step は 231s。`buildProfile` は >255 で throw するよう修正済み
- v1 の失敗要因候補: 終端 step を加熱に置換 / 温度上昇 / enableStep=9 の同時変更（v2 とは別問題）

### まだ未解決

1. **SuperLong v4 の実測**（+10°C で長さ ~7:50 を維持できるか）
2. Device Info の FW 文字列（任意）
3. 公式 post-write（`i5`/`i6` stick-detect 等）を Apply 後にやらない影響
4. **Strong.json は空**（使えない）
5. 0x3c / 0x35 の正式意味
6. lastThreshold / 保護による早期終了の有無

---

## 9. 今後のマイルストーン

| Phase | 内容 | 完了条件 |
|-------|------|----------|
| **A** | Android 読み取り | Init/Version/Master + ログ Copy — **完了** |
| **B** | Dry-run | live master で 32 cmds — **完了** |
| **C** | 短い write | Vibe — 実施可 |
| **D** | Profile apply | 0x43 + **実吸い時間**（スロット選択は不要）— **進行中** |
| **D2** | 公式 Long 実測 | **~6.5 min 確認済み** |
| **D3** | SuperLong v3 実測 | **~7:50 確認**（u8-safe 延長成功） |
| **D4** | SuperLong v4 実測 | 時間固定 + 加熱帯 +10°C |
| **E** | 自宅鯖 + Tailscale | Pages から移行（任意） |

---

## 10. 再生成・検証コマンド

```bash
# 公式バンドルから KEY_MAP / headers 再抽出
node scripts/extract_data.js
node scripts/gen_rest.js

# プロトコル単体スモーク（Eco → gen3/4 cmds）
node scripts/smoke_protocol.js

# ブラウザ用コピーを更新
node scripts/sync_protocol_webapp.js
```

直近スモーク（Eco）:

- KEY_MAP 208、未マップキー 0
- gen4: 32 cmds / gen3: 27 cmds
- puff `-0.01` → `f6 ff ff ff`
- 静的 import: `./protocol/index.js`（bundler 不要）


---

## 11. 判断ログ（方針）

| 判断 | 理由 |
|------|------|
| Android 本線 | Win BLE スタックが不安定。WebBT は公式と同じ経路 |
| 開発は GitHub Pages | Secure Context が簡単。完成後 Tailscale 鯖でよい |
| protocol/ を正本 | web-app 内の手書き protocol が公式と乖離していた |
| 書き込みデフォルト OFF | 外出先の誤焼防止。まずキャプチャが価値 |
| Windows CLI は補助 | ペアリング実験には使ったが本線にしない |

---

## 12. 変更ファイル（この整理・差し替え）

- `protocol/*` — 新規正本
- `scripts/extract_data.js`, `gen_rest.js`, `smoke_protocol.js`
- `web-app/main.js`, `index.html`, `style.css`, `vite.config.js`
- `web-app/public/profiles/*`
- `web-app/protocol.js` — 退役（import すると throw）
- `docs/SOURCE_INVENTORY.md`, `docs/DEVELOPMENT_REPORT.md`（本ファイル）
