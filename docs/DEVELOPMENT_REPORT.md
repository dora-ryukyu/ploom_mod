# Ploom BLE / Profile Mod — 開発レポート

**最終更新:** 2026-08-02  
**対象機:** Ploom Aura A00800GL（ほかシリーズもプロトコル上は共通部分あり）  
**本線:** Android Chrome + Web Bluetooth（GitHub Pages 静的配信）  
**公開 URL:** https://dora-ryukyu.github.io/ploom_mod/

> **現在の検証ステータス:** SuperLong **v6** — v4 温度維持、壁時計 **~10 min** 狙い（ステップ合計 695s）。v5 の 30 分天井はやりすぎのため不採用。

---

## 1. 目的

公式アプリ以外から Ploom の加熱プロファイルを:

1. **読み取る**（Init / Variation / Master）
2. **プレビューする**（Dry-run・公式と同等の cmd 列）
3. **安全に焼き込む**（オプトイン + 0x43 完了確認）

カスタム長時間・やや強めプロファイル（SuperLong）を、公式 Long を壊さずに延長・強化できるところまで到達するのが当面のゴール。

---

## 2. 現状サマリ（2026-08-02）

| 領域 | 状態 | メモ |
|------|------|------|
| 公式 JS 解析 | **完了** | `js/72761-*.js`, `js/20896.js` 等 |
| プロトコル正本 | **完了** | `protocol/`（KEY_MAP 208、Gen3/4） |
| web-app 静的化 | **完了** | ビルド不要 ESM。Pages デプロイ |
| Android 読み取り | **完了** | Master 20 取得・ログ Copy |
| Dry-run | **完了** | live master で Gen4=32 cmds |
| Profile Apply | **成功実績あり** | 0x43 受信。本体は **1 本焼き**のみ |
| Long 実測 | **完了** | 公式・自作とも wall **~6.5 min** |
| SuperLong 長さ | **v3 で成功** | wall **~7:50**（ステップ 543s） |
| SuperLong 温度 | **v4 で +10°C** | wall **~8:00** 維持を確認 |
| SuperLong 長さ | **v6 検証中** | v4 温度 + 合計 **695s** → wall **~10 min** 狙い（v5 30分は撤回） |
| Strong プリセット | **不可** | `heatProfileData` 空 |
| 自宅鯖 + Tailscale | **後回し** | Pages で十分開発可能 |
| DFU / FW 更新 | **触らない** | プロファイル作業と無関係 |

---

## 3. アーキテクチャ

```
js/*                         # 公式 minified（参照のみ）
  ↓ extract_data.js / gen_rest.js
protocol/*                   # 論理の正本
  ↓ sync_protocol_webapp.js
web-app/protocol/*           # ブラウザ用コピー
web-app/index.html + main.js
  ↓ GitHub Actions（bundler なし）
GitHub Pages (HTTPS)
```

| パス | 役割 |
|------|------|
| `protocol/` | ビルダー・KEY_MAP・heatMath の正本 |
| `web-app/` | 静的サイト全体（Pages のルート） |
| `web-app/profiles/` | Eco / Long / SuperLong プリセット |
| `userHeatProfile/` | 公式 API 由来 + 自作 SuperLong の保管 |
| `docs/Ploom_BLE_Protocol.md` | プロトコル詳細メモ |
| `docs/SOURCE_INVENTORY.md` | ソース棚卸し |
| `.github/workflows/pages.yml` | `web-app/` を stamp して Pages へ |

**ビルドは不要。** Secure Context（HTTPS）と Android Chrome が必要。

---

## 4. 確定したプロトコル要点

### BLE

| 項目 | 値 |
|------|-----|
| Main Service | `53654010-a391-4a65-83fa-bc58084aca28` |
| Write | `…4011…` |
| Indicate | `…4012…`（notify=false でも `startNotifications` で可） |
| 他 | Device Info `0x180A`、DFU Service `0xFEF5`（65269） |

**Init パイプライン:**  
`[2,227,0]` → Variation `[2,224,0]` → Master `[2,165,0]` → RX `0x44/45/46`

この Aura 実測:

| 項目 | 値 |
|------|-----|
| variation (0x47) | **33** |
| battery health (0x33) | **100%** |
| Master 20 | `[1, 1537, 1509, 1503, 2423, 2419, 1912, 1227, 1220, 1119, 1454, 1059, 3203, 3192, 1585, 1022, 521, 595, 595, 3512]` |

### プロファイル書き込み

- **Gen4（Aura）:** ヘッダ表 `tL`、**32 cmds**、温度式 B、step0 に eeprom、各 step に raw temp u16
- **Gen3:** `tI` 27 cmds、温度式 A
- puff: `Int32LE(trunc(puffThreshold * 1000))`
- 温度: `signedTargetHeat`（abs → 式 → 符号戻し）。負温度（例 −220）は公式どおり存在
- バッチ完了: **opcode `0x43`**
- 公式 post-write（stick detect 等 i5/i6）は **未移植**（焼付自体は 0x43 で通る）

### 重要制約: step `time` は **uint8（0–255 秒）**

公式も `Number(i.time)` を **1 バイト**として配列に載せ、GATT は `Uint8Array` で送る。

| JSON | wire（実際） |
|------|----------------|
| 231（Long max 級） | 231 |
| **300** | **44**（300 & 0xFF）← v2 事故の原因 |
| 255 | 255（上限） |

`protocol/buildProfile.js` は **time > 255 で throw** するよう修正済み。  
1 ステップ 4 分超の延長は **不可能**。長くするなら **複数 step に分割**する。

### 本体プロファイルモデル

**本体にプロファイル選択 UI は無い**（ユーザー確認）。

| 操作 | 意味 |
|------|------|
| Apply（0x43） | **今の加熱レシピ 1 本を上書き** |
| Reset Basic `[2,166,0]` | **標準に戻る** |
| アプリの Eco/Long/SuperLong | **PC/Web 側の素材**。本体メニュー項目ではない |

公式の `profileNumber` 0/1/2 はアプリ↔デバイス内部フラグであり、「本体でスロット切替」ではない。

### DFU モード（参考・非本線）

- コマンド `[2, 255, 0]`、状態 RX `0xFE`（`dfuStatus`）
- 公式は SUOTA/SPOTA で FW 転送 → reboot
- **加熱プロファイルとは無関係。誤送信禁止**

---

## 5. 実装で潰した既知問題

| 問題 | 症状 | 対処 |
|------|------|------|
| Windows BLE RX 空 | 接続しても notify 来ない | **Android WebBT 本線** |
| GATT already in progress | Init 二重送信 | write キュー + one-shot 連鎖 |
| 0x43 偽タイムアウト | RX に 0x43 があるのに失敗表示 | waiter を write ループ **前**に arm |
| Preset 404 on Pages | Vite `public/` のみに JSON | `web-app/profiles/` + dual fetch |
| Deploy stamp `local` | ブランチ Pages / パス誤解 | Actions で stamp、サイトルートは `/ploom_mod/` |
| step time >255 | SuperLong v2 が ~4 分で終了 | u8 検証 + v3 で 255/155 分割 |
| 「本体でプロファイル選択」誤解 | 焼いたのに別スロット想定 | **1 本焼きモデル**に docs 訂正 |

---

## 6. SuperLong 実験ログ（時系列）

目標の変遷: 公式 Long より **長く**（壁時計 ~8 分）→ その後 **やや熱く**。

### ベースライン: 公式 Long

| 項目 | 値 |
|------|-----|
| enableStep | 8 |
| 有効ステップ秒合計 | **439s（7.32 min）** |
| 実測 wall（公式アプリ / 自作クライアント） | **~6.5 min（390s）** |
| wall / step 比 | **≈ 0.89** |
| 温度骨子 | 予熱 300 → −220 → 221 → 240 → 250 → **終端 temp=0** |
| 最長 step | step05 = **231s**（いずれも ≤255） |

**結論:** 書き込み経路は信用できる。ステップ合計は壁時計より長い（常に wall < step sum）。

### v1 — 失敗（構造破壊 + 高温同時）

- 高温（315 帯）、`st=9`、step07 を加熱延長、終端 temp=0 を破壊
- 設計 480s → 実測 **~5:30**
- 原因切り分け不能（形式・温度・st が同時変更）

### v2 — 失敗（uint8 wrap）※原因確定

- Long 構造維持、温度そのまま、step05=**300** / step06=110、合計つもり 543s
- 実測 **~4 min**
- **300 → wire 44**。実効合計 ≈ **287s** → ×0.89 ≒ **~4.3 min** と実測一致

### v3 — 成功（長さ）

| 項目 | 値 |
|------|-----|
| step05 / step06 | **255s @ 240** / **155s @ 250** |
| その他 | Long と同一温度・`st=8`・step07 temp=**0** |
| ステップ合計 | **543s（9.05 min）** |
| 実測 wall | **~7:50**（計測に多少のブレあり） |
| wall / step 比 | **≈ 0.86**（Long と同系統） |

**結論:**  
- uint8 を守れば **時間延長は本体に効く**  
- 終端 temp=0 と Long 骨格を維持するのが安全  
- 「543s ステップ → 約 8 分壁時計」の換算が使える

### v4 — 完了（温度 +10°C）

時間は **v3 固定**。加熱パスのみ +10°C。

| step | 時間 (s) | Long °C | v4 °C |
|------|----------|---------|-------|
| 00–02 予熱 | 60+19+15 | 300 | **310** |
| 03 特殊 | 15 | −220 | −220（維持） |
| 04 遷移 | 9 | 221 | **231** |
| 05 本加熱 | **255** | 240 | **250** |
| 06 後半 | **155** | 250 | **260** |
| 07 終端 | 15 | **0** | **0**（維持） |
| enableStep | 8 | 8 | 8 |
| ステップ合計 | 543s | | 543s |
| 実測 wall | | | **~8:00** |

**結論:** +10°C でも長さは維持。後半の体感パワー不足は残課題（別途温度 or 配分）。

### v5 — 撤回（30 分天井はやりすぎ）

step0–6 をすべて 255s（合計 **1800s**）にした案を一度デプロイしたが、**実用上やりすぎ**と判断し実測前に撤回。JSON は v6 に置換済み。

### v6 — 検証中（v4 強さ + ~10 min wall）

| step | 時間 (s) | °C |
|------|----------|-----|
| 00–02 予熱 | 80+35+25 | **310**（v4） |
| 03 特殊 | 20 | **−220** |
| 04 遷移 | 15 | **231** |
| 05 本加熱 | **255** | **250** |
| 06 後半 | **250** | **260** |
| 07 終端 | 15 | **0** |
| enableStep | 8 | |
| ステップ合計 | **695s（11.58 min）** | |
| 期待 wall @0.86 | **~10.0 min** | |

v4 より前半・step06 を伸ばし、温度は v4 のまま。

---

## 7. 設計ルール（実験から得た）

1. **一度に一個だけ変える**（長さ XOR 温度。v1 の反省）
2. **step time ≤ 255**。超えるなら step 分割
3. **Long の終端形を壊さない**（最後の有効 step 付近に temp=0）
4. **`enableStep` は公式パターンに寄せる**（Long=8。不用意に 9 にしない）
5. **壁時計目標 → ステップ秒は ÷0.86〜0.89 で多めに積む**
6. 本体は **1 本焼き**。Apply 成功 = それが唯一の現行レシピ
7. DFU・Reset は別物。Reset は標準復帰用

換算の目安:

```
目標 wall (s) ≈ step_sum × 0.86〜0.89
8 分 wall (480s) → step_sum ≈ 540〜560s  （v3 の 543s が実測 7:50 でほぼ妥当）
```

---

## 8. web-app 操作（実機）

1. https://dora-ryukyu.github.io/ploom_mod/ を Android Chrome で開く  
2. ヘッダの **deploy stamp** が期待 commit か確認（古ければハードリロード）  
3. Connect → Init 完了・Master 20/20  
4. Preset **SuperLong** → 自動 Dry-run（32 cmds、step 時間 ≤255）  
5. **Enable device writes** → Apply（二重 confirm）→ **0x43**  
6. 加熱開始〜終了の **mm:ss** と体感を記録（Long と同じ測り方）

安全弁: 書き込みデフォルト OFF / master 必須 / confirm 二回。

Reset Basic で標準に戻せる（カスタムが気に入らないとき）。

---

## 9. マイルストーン

| Phase | 内容 | 状態 |
|-------|------|------|
| **A** | Android 読み取り | **完了** |
| **B** | Dry-run（live master） | **完了** |
| **C** | 短 write（Vibe 等） | 実施可 |
| **D** | Profile apply + 0x43 | **完了** |
| **D2** | Long 実測 ~6.5 min | **完了** |
| **D3** | SuperLong 長さ（v3 ~7:50） | **完了** |
| **D4** | SuperLong 温度（v4 +10°C） | **完了**（wall ~8:00） |
| **D5** | SuperLong 長さ天井 v5 | **撤回**（30 min はやりすぎ） |
| **D6** | SuperLong v6 ~10 min wall | **検証中**（v4 温度維持） |
| **E** | 自宅鯖 + Tailscale | 任意・後回し |
| — | Strong 再取得 / post-write 移植 / opcode 解読 | 低優先 |

---

## 10. 未解決・バックログ

1. **v6 実測**（695s → wall ~10 min か）← **今ここ**
1b. 後半パワー不足（温度再強化は v6 長さ確認後）
2. 公式 post-write（i5/i6）未移植の実害の有無
3. `lastThreshold` / 保護が高温で早期終了するか
4. Strong.json 空（API 再取得が必要）
5. RX `0x3c` / `0x35` の正式意味
6. Device Info の FW 文字列（任意）
7. 255s 超の長時間を **step 分割**でどこまで伸ばせるか

---

## 11. 判断ログ

| 判断 | 理由 |
|------|------|
| Android + Pages 本線 | Win BLE 不安定。HTTPS + WebBT が公式と同経路 |
| protocol/ 正本 | web-app 内手書きが公式と乖離していた |
| 書き込みデフォルト OFF | 誤焼防止。まず読取・dry-run |
| 長さを温度より先に確定 | 変数を分離しないと ~5:30 / ~4:00 の原因が不明のまま |
| uint8 をコードで強制 | v2 再発防止（配列上は 300 に見えて wire は 44） |
| DFU は触らない | FW ブリックリスク。プロファイル目的外 |
| 1 本焼きモデル | ユーザー訂正。スロット選択仮説を廃棄 |

---

## 12. 主要ファイル

| パス | 内容 |
|------|------|
| `protocol/buildProfile.js` | Gen3/4 ビルダー + **time u8 チェック** |
| `protocol/heatMath.js` | 温度式 A/B |
| `protocol/keyMap.js` | 208 エントリ |
| `web-app/main.js` | 接続・キュー・Apply・0x43 |
| `userHeatProfile/SuperLong.json` | **現行 v6** 定義 |
| `userHeatProfile/Long.json` | 公式 Long（比較基準） |
| `docs/Ploom_BLE_Protocol.md` | プロトコル詳細 |
| `docs/DEVELOPMENT_REPORT.md` | 本レポート |

### 再生成

```bash
node scripts/extract_data.js
node scripts/gen_rest.js
node scripts/smoke_protocol.js
node scripts/sync_protocol_webapp.js
```

---

## 13. 一行まとめ

> **焼付は通る。step 時間は 255s 上限。v3/v4 で ~8 分 wall。v5 の 30 分天井は撤回。現行 v6 は v4 温度のまま ~10 分 wall 狙い（695s steps）。**
