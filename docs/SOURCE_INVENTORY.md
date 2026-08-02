# Source Inventory

## 結論

**公式 Web アプリ由来の minified JS はリポジトリに揃っている。**  
足りないのは主に「この Aura 個体の実機キャプチャ」だけ。プロトコル論理は `protocol/` に整理済み。

開発中の配信は **GitHub Pages** で問題ない（HTTPS = Secure Context）。完成後に自宅鯖 + Tailscale へ載せ替えればよい。

---

## あるもの（公式由来）

| パス | 役割 |
|------|------|
| `js/72761-20c4e98f11d2723f.js` | 本丸。温度式・Gen3/4 ビルダー・notify 解析・KEY_MAP |
| `js/20896.js` | write / waitWriteValueResponse / 全 request API |
| `js/setHeatingProfile.js` | 書き込みループ抜粋 |
| `js/10512-*.js` | 周辺（auth 等）。BLE 中核ではない |
| `userHeatProfile/*.json` | Eco / Long / Strong 実データ |
| `docs/Ploom_BLE_Protocol.md` | 手書きメモ（矛盾時は `protocol/` 優先） |

## 無いもの

| 項目 | 要不要 |
|------|--------|
| 非 minified ソース / source map | 不要（論理は読める） |
| FW バイナリ | 加熱書き込みには不要 |
| **Aura 実機 TX/RX hex** | **要**（Gen 確定・ACK 形） |
| 公式 golden TX | あると回帰が楽。無くてもビルダーは再現可 |

---

## 整理先 `protocol/`（正本）

再生成:

```bash
node scripts/extract_data.js
node scripts/gen_rest.js
```

（`buildProfile.js` / `commands.js` / `heatMath.js` / `binary.js` は手整理の正本）

| ファイル | 内容 |
|----------|------|
| `uuids.js` | Service / TX / RX UUID |
| `keyMap.js` | 難読化 208 キー + decode/encode |
| `headers.js` | Gen3 tI (27) / Gen4 tL (32) |
| `heatMath.js` | 温度式 A/B + 符号 |
| `binary.js` | LE + **puff×1000 Int32** |
| `buildProfile.js` | Gen3 27cmd / Gen4 32cmd |
| `commands.js` | Request/Response / WRITE_TIMING / master パース |
| `index.js` | 一括 export |
| `_keymap.json` / `_headers.json` | 抽出生データ |

### 確定している仕様（ソース根拠あり）

- UUID 3 種
- Init `[2,227,0]` → Version `[2,224,0]` → Master `[2,165,0]` → 0x44/45/46
- setHeatingProfile: 各 cmd を waitResponse、最後に **0x43**
- wait: poll 10ms / timeout 5s / sync false なら +100ms
- puff: `Int32LE(trunc(puff * 1000))`
- Gen3/Gen4 でヘッダ表・step レイアウト・温度式が異なる
- FW 文字列 `G4` / `G3.1` で gen 推定

### 実機待ち

- この個体の master 20 要素
- 0x47 / Device Info の実値
- 各 write の ACK 生バイト
- Android WebBT での indicate 挙動

---

## 旧コードとの関係

| 旧 | 状態 |
|----|------|
| `web-app/protocol.js` | **退役**（import で throw）。実体は `@protocol` → `../protocol` |
| `web-app/main.js` | **更新済み**（hex ログ、dry-run、write ゲート、0x43 待ち） |
| `decode_profile.js` | 実験用。KEY_MAP は `protocol/keyMap.js` へ |
| `docs/Ploom_BLE_Protocol.md` | 参考。矛盾時は `protocol/` + 本 inventory 優先 |
| `docs/DEVELOPMENT_REPORT.md` | **進捗の正本レポート** |

---

## データフロー

```
js/*                 # 公式・immutable 参照
  ↓ extract_data.js / gen_rest.js
protocol/*           # 論理の正本
  ↓ sync_protocol_webapp.js（gen_rest でも自動）
web-app/protocol/*   # 静的ホスト用コピー
web-app/*            # index.html + main.js（ビルド不要）
  ↓ HTTPS
GitHub Pages / 後で自宅鯖+Tailscale
```

web-app 操作・マイルストーンは `docs/DEVELOPMENT_REPORT.md` を参照。
