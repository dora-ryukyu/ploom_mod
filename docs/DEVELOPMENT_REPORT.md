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

`web-app/` 配下をそのまま公開すればよい（`index.html` が入口）。  
`dist/` ビルドや bundler は不要。

必要: **HTTPS**（Pages は標準で満たす）、Android **Chrome**、端末の BT オン。

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

## 8. 未解決・実機待ち

1. **この個体の master 20・0x47 生値・FW 文字列**
2. Android での indicate / startNotifications 成否
3. 書き込み時 0x43 の確実な受信
4. **Strong.json は `heatProfileData: ""` で中身が空**（再取得が必要。Eco/Long のみプリセット有効）
5. 公式 post-write（i5/i6/i7 相当）の要否
6. プロファイル読み戻しによるビット一致検証（公式も弱い）

---

## 9. 今後のマイルストーン

| Phase | 内容 | 完了条件 |
|-------|------|----------|
| **A** | Android 読み取り | Init/Version/Master + ログ Copy |
| **B** | Dry-run 突き合わせ | live master で Eco 等の hex を保存 |
| **C** | 短い write 試験 | Vibe / Reset の挙動確認 |
| **D** | Profile apply | 全 cmd + 0x43、体感 or スロット確認 |
| **E** | 自宅鯖 + Tailscale | Pages から移行 |

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
