# 067s Branch Output 技術検証（スパイク・実測メモ）

> 状態: **実施済み（2026-09-09・macOS 実機）**。親 [067](067-multistream-output-split.md) の「段 0」がこれ。
> ⚠ **本体コードは 1 行も変更していない**（検証は obs-websocket 経由 ＋ リポジトリ外の使い捨てスクリプト）。
> ⚠⚠ **結論に影響する訂正が 5 件出た**。親 067 の §9-A-3 / §8 / §17 / §19 / §23 を本ファイルで上書きする。

## 実測環境

| | |
|---|---|
| OS | macOS 14.6.1（Apple Silicon）・ディスプレイ 2 枚 |
| OBS | **32.2.2**（親 067 が調べた 32.2.1 の次・2026-08-14） |
| obs-websocket | **5.7.4**（RPC v1・`auth_required=false`・loopback 4455） |
| Branch Output | **1.0.9**（依頼者が GUI インストーラで導入・案内文どおりで詰まりなし） |
| 配信先 | ⚠ **本番キーは 1 度も使っていない**。`ffmpeg -listen 1` の**ローカル RTMP 受け 2 本**（127.0.0.1:1935 / :1936） |
| コメント | `COMMENT_SIDECAR_MOCK=1`（外部通信ゼロ・Twitch と YouTube を同時接続） |

## 結果サマリ

| # | 検証項目 | 結果 |
|---|---|---|
| S-1 | 非アクティブシーンの `window_capture` が止まらないこと | ✅ **止まらない**（対照実験つき） |
| S-2 | 設定 JSON で実際に配信が始まること | ✅ 始まる（⚠ **キーに訂正 5 件**） |
| S-3 | `SetSourceFilterEnabled` で開始/停止できること | ✅ できる（⚠⚠⚠ **重大な前提条件あり**） |
| S-4 | 音声が乗ること | ✅ 乗る（⚠ **`custom_audio_source` が必須**） |
| S-5 | 未導入時のエラーで導入判定できること | ✅ **code 607** で確定 |
| S-6 | 2 出力同時・映像が別内容になること | ✅ **成立**（実映像で確認） |
| S-7 | 負荷の実測 | ✅ 測定（⚠ **ソフトウェアエンコードで CPU +50pt/出力**） |
| S-8 | Windows 実機 | ❌ **未実施**（VM 未着手） |

---

## ⚠⚠⚠ 最大の発見 — obs-websocket で作ったフィルタは、OBS を再起動するまで動かない

**現象**: `CreateSourceFilter` でフィルタを作り、設定を書き、`SetSourceFilterEnabled(true)` にしても、
**45 秒待っても 1 バイトも送出されず、OBS のログにプラグインの行が 1 つも出ない**。
削除して作り直しても、`SetSourceFilterSettings` で `update()` を叩いても変わらない。

**切り分け**:
1. 受け側は正常（こちらから `ffmpeg` で流し込むと 178KB 書けた）。
2. 保存された設定は正しい（`GetSourceFilter` で読み戻して確認）。
3. `ensureInfrastructure` は失敗を **LOG_ERROR** で出すが、その行が**1 つも無い**
   ⇒ **`restartOutput()` まで到達していない**。
4. **OBS を再起動したら、同じフィルタが起動直後に自動で配信を開始した**（30 秒で 27MB）。
   以後は `SetSourceFilterEnabled(true/false)` が**正しく効く**。

**帰結（設計に直結）**:
- ⚠⚠ **067c は「シーンとフィルタを作って、そのまま配信開始」ができない。**
  初回構築のあとに **OBS の再起動を挟む**必要がある。
- ⚠ 逆に言えば、**構築（1 回だけ）と配信開始（毎回）を分離すれば運用できる**。
  ⇒ セットアップウィザードの最後を「**OBS を再起動してください**」で締める設計にする。
  ⚠ これは Branch Output の導入手順（同じく OBS 再起動が要る）と**同じ 1 回で済ませられる**。
- ⚠ 原因はプラグイン側の `initialized` / QTimer がフィルタ生成時の文脈に依存しているためと見られるが、
  **断定しない**（本スパイクの目的は「回避できるか」であり、特定できている必要はない）。

### ⚠ 副産物: `filterEnabled: false` は OBS 再起動をまたいで守られる

再起動直後、**有効だった Twitch 側は自動で配信を開始したが、無効にしてあった YouTube 側は開始しなかった**。
⇒ 親 067 §9-A-3 の「**フィルタは必ず `filterEnabled: false` で作る**」は、
**再起動を挟んでも安全側で成立する**ことが実測で確認できた。⚠ この規約は絶対に外さないこと。

---

## S-1 — 非アクティブシーンでも `window_capture` は止まらない ✅

プログラムシーンを `StreamDock Twitch出力` に固定し、**非アクティブな** `StreamDock YouTube出力` の出力を録画。

- 録画 t=9s と t=49s の**内容が完全に別**（コメントが流れている）。
- **対照実験**（同じソース・同じ非アクティブ状態で出力だけ切り替え）:

| Branch Output | 5 秒ごと 4 回の描画変化 |
|---|---|
| **OFF** | **0/3**（＝止まる） |
| **ON** | **3/3**（＝生きている） |

⇒ **「非アクティブだから止まる」のではなく「誰もレンダリングしていないから止まる」**。
Branch Output が有効な間は trigger-render が回るので、**本設計は成立する**。
⚠ 親 067 §12-1 の「将来: シーン切り替えを StreamDock 側に持ってくる」案は**生きている**。
⚠ R-2 のフォールバック（キャンバス外に 1 枚置いて showing を保つ）は**不要**。

### ⚠ 調査中に一度ハマった罠（記録）

出力を止めた状態で `GetSourceScreenshot` を撮ると**必ず同じ画像が返る**。
これを「窓が壊れている」と誤読しかけた。**実際の窓は生きていた**（`screencapture` で直接撮って確認）。
⇒ ⚠⚠ **`GetSourceScreenshot` はソースの生死ではなく「最後にレンダリングされた内容」を返す**。
OBS 経由の観測を根拠にするときは、**そのソースを誰かがレンダリングしているか**を必ず先に確かめること。

---

## S-2 — 設定キーの実測（⚠ 親 067 §9-A-3 を訂正する）

`GetSourceFilterDefaultSettings("osi_branch_output")` で**プラグインが持つ既定値の現物**を取得して照合した。

| キー | 親 067 の記述 | **実測** | 判定 |
|---|---|---|---|
| `streaming_enabled` | 既定 false・要 true | 既定 **false** | ✅ 正しい |
| `service_count` | 既定値が無い・要 1 | **既定に存在しない**（0 扱い） | ✅ 正しい |
| `server` / `key` | index 0 は無印 | 無印で正しい（`getIndexedPropNameFormat(0)` は `"%1"`） | ✅ 正しい |
| `streaming_output_enabled_0` | ⚠ **既定 false**・要 true | ⚠⚠ **既定 true**（0〜7 すべて true） | ❌ **誤り** |
| `custom_audio_source` | 必須 true | **必須で正しい**（既定 false・チェック可能グループ） | ✅ 正しい |
| `multitrack_audio` | false を指定 | ⚠ **1.0.9 にこのキーは無い** | ❌ **誤り** |
| `audio_dest` | `"streaming"` | 既定 **`"both"`**。`"both"` で動作確認 | ⚠ 要修正 |
| `audio_source` / `audio_track` | `"master_track"` / 1 | 既定でそのとおり | ✅ 正しい |
| **`recording_output_enabled`** | ⚠ **記載なし** | ⚠⚠⚠ **既定 true** | ❌ **抜け** |
| **`video_encoder`** | 記載なし | 既定 **`obs_x264`（ソフトウェア）** | ❌ **抜け** |

### ⚠⚠⚠ `recording_output_enabled` の既定 true は危険

そのまま有効化すると、配信と同時に **`~/Movies` へ勝手に録画が始まる**（既定の保存先も実測で確認）。
⇒ **067c は必ず明示的に `false` を書くこと**（`replay_buffer` も同様に false）。
⚠ 「既定値一覧に無いキーは指定しない」という判断は**危険**——**既定が有効なキー**を見落とす。

### 067c が書くべき最小設定（実測で動作確認済み）

```jsonc
{
  "streaming_enabled": true,
  "service_count": 1,
  "server": "<プラットフォームの RTMP URL>",
  "key": "<配信キー>",
  "streaming_output_enabled_0": true,   // ⚠ 既定 true だが明示する（既定に依存しない）
  "recording_output_enabled": false,    // ⚠⚠⚠ 既定 true。書かないと勝手に録画される
  "replay_buffer": false,
  "stream_recording": false,
  "custom_audio_source": true,          // ⚠⚠ これが無いと完全な無音になる（S-4）
  "audio_source": "master_track",
  "audio_track": 1,
  "audio_dest": "both"
}
```

---

## S-3 — 開始/停止 ✅（前提は上記の「OBS 再起動」）

再起動後は `SetSourceFilterEnabled(true)` で**即座に開始**、`false` で停止する。
⚠ 停止直後に受け側のファイルが数百 KB 伸びるが、これは**受け側のバッファのフラッシュ**（送出は止まっている）。

## S-4 — 音声 ✅（`custom_audio_source` が必須）

| 設定 | 実測音量 |
|---|---|
| `custom_audio_source` **なし** | **mean -91.0 dB / max -91.0 dB**（＝デジタル無音） |
| `custom_audio_source: true` ＋ `master_track` / track 1 | **mean -21.1 dB / max -11.7 dB** ✅ |

⚠ 無音時、OBS のログには `Use filter audio for track 1` と出る＝**フィルタ自身の音声**を使っている。
シーンに付けたフィルタは音声を持たないので**完全な無音**になる（README の警告どおり）。
⚠⚠ **音声トラック自体は AAC 163kb/s で存在する**ので、「音が出ない」ことに**ファイル検査だけでは気づけない**。
⇒ **`volumedetect` まで見ること**。067c の受け入れ条件に「音が乗っている」を残すのは正しい。

⚠ この検証は**環境に音源が無いと成立しない**。本スパイクでは 440Hz のトーン動画を一時ソースとして投入した
（測定後に削除済み）。⚠ 依頼者環境の `音声入力キャプチャ` は **BlackHole2ch（仮想ループバック）**で、
何も流していなければ常に -91dB になる。**これを「プラグインの不具合」と誤読しないこと。**

## S-5 — 導入判定 ✅ `code === 607`

| 呼び出し | result | code |
|---|---|---|
| `GetSourceFilterDefaultSettings("chroma_key_filter_v2")`（対照） | ✅ | 100 |
| `GetSourceFilterDefaultSettings("osi_branch_output")`（未導入時） | ❌ | **607** |
| `CreateSourceFilter(osi_branch_output, 実在シーン)`（未導入時） | ❌ | **607** |
| `CreateSourceFilter(osi_branch_output, 存在しないシーン)` | ❌ | **600** |
| `CreateSourceFilter(chroma_key_filter_v2, 存在しないシーン)` | ❌ | **600** |

⚠⚠ **判定には `GetSourceFilterDefaultSettings` を使うこと**（`CreateSourceFilter` ではない）。
理由＝**非破壊**。`CreateSourceFilter` は導入済み環境では**成功してしまう**ので、
判定のたびにゴミフィルタを作って消すことになる。**同じ 607 が返るのに副作用が無い。**
⚠ シーン名の間違い（600）と**別コード**なので、「エラーが出た＝未導入」の雑な判定を避けられる。
⇒ 親 067 §8・§17 #4 の「`CreateSourceFilter` の成否」は**差し替える**。

## S-6 — 2 出力同時・別内容 ✅

2 本の出力を同時に走らせ、**受け側の録画から実フレームを取り出して目視**した。

- **Twitch 出力**の映像 … **Twitch のコメントだけ**（8 件すべて Twitch バッジ・YouTube は 0 件）
- **YouTube 出力**の映像 … **Twitch と YouTube の両方**が混在

⇒ ⚠⚠⚠ **本タスクの存在理由（Twitch の配信映像に他サイトのコメントを載せない）が、実機で成立している。**
⚠ ただし**実配信での最終確認は依頼者にしかできない**（本スパイクはローカル RTMP 受けまで）。

## S-7 — 負荷（⚠ ソフトウェアエンコードでの値）

| 出力数 | OBS の CPU（中央値） | RSS |
|---|---|---|
| 0 本 | 40.8% | 582MB |
| 1 本 | **90.4%**（+49.6pt） | 786MB |
| 2 本 | **128.1%**（+37.7pt） | 1219MB |

⚠⚠ **既定エンコーダが `obs_x264`（ソフトウェア）**なのが主因。
⇒ **067c はハードウェアエンコーダを選ぶべき**（macOS は VideoToolbox・Windows は NVENC 等）。
⚠ 何も指定しないと**出力ごとに CPU が +50pt** 積まれる。⚠ ただし**自動で画質を下げてはいけない**（R-7）。

## S-8 — Windows ❌ 未実施

[098](098-windows-build.md) の VM が未着手のため。⚠ **WGC・透過・フィルタ設定は未検証のまま**。

---

## 親 067 へ差し戻す項目

| 箇所 | 変更 |
|---|---|
| §9-A-3 | 設定キーを**実測版に差し替え**（`recording_output_enabled` / `video_encoder` を追加、`multitrack_audio` を削除） |
| §9-A-3 | ⚠⚠⚠ **「obs-websocket で作ったフィルタは OBS 再起動まで動かない」を追記** |
| §8・§17 #4 | 導入判定を `GetSourceFilterDefaultSettings` の **607** に差し替え |
| §12-1・§23 R-2 | S-1 が通ったので**フォールバック不要**・将来案は生きている、と更新 |
| §16-1 | セットアップウィザードの最後に **「OBS を再起動してください」** を入れる（プラグイン導入と同じ 1 回で済む） |
| §19 段 3 | 「構築」と「配信開始」を**別の操作に分ける**（再起動を挟むため） |
| §24 Q-5 | **未検証のまま**（RTMPS は本番 ingest でしか試せない） |

## 検証コードの所在

`scratchpad`（リポジトリ外・使い捨て）。依存ゼロ（Node 22 の標準 `WebSocket` のみ）。
⚠ **本体・`package.json` ともに無変更**。`obs-websocket-js` も入れていない。
