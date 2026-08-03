# 058s 音声出力デバイス指定 技術検証（スパイク・方式決定）

> 状態: **完了（2026-08-03・結論＝② Rust 側再生。採る形は「②-軽」＝通知音だけ Rust・読み上げは Web Audio のまま）**。
> 分割・線引きは親 [058](058-stream-audio-routing.md) を正とする。結果は末尾の「スパイク結果」節。
>
> **必読前提**: 親 [058](058-stream-audio-routing.md)、[`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`AudioContext` の所有者）、
> [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`playWav` の `ctx.destination`）、
> 同型の先行スパイク [044s](044s-obs-websocket-spike.md) / [057s](057s-discord-rpc-streamkit-spike.md)、
> [`docs/security.md`](../security.md)（§1／§4／§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。本タスクは**検証用コードに留め本実装しない**（成果物は決定メモ）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

「通知音・VOICEVOX 読み上げを**配信に載せる／載せない**で切り替える」を実装できる方式があるかを**実測で確定**する。
結論は必ず次の **3 択**に落とす。

1. **① Web 側で成立** — `setSinkId` で出力デバイスを切り替えられる。058a は frontend だけで済む。
2. **② Rust 側再生が必要** — webview では切り替えられず、`rodio` 等を足して Rust から鳴らす必要がある
   （新規 crate ＋「Rust 完全同期」方針への例外 ＋ VOICEVOX の再生経路の移設）。
3. **③ どちらも不可＝機能を出さない** — 058a/058b は着手せず、059 の通知音は「OS 既定デバイスへ出すだけ」に留める。

**「自分の mac で動いた」を配布可否の証拠にしないこと。** 057s の教訓（所有者特権で通ってしまい配布可否を誤判定しかけた）と
同型の罠が、ここでは **OS 差**（WKWebView と WebView2）として現れる。片方だけで判断しない。

## 現在の前提（調査結果・実コード）

- `setSinkId` / `sinkId` / `enumerateDevices` / `navigator.mediaDevices` は**リポジトリ全体で使用ゼロ**（grep 実測）。
- 音出しの実体は `playWav` の `src.connect(ctx.destination)` ただ 1 か所。`ctx` は
  `createTtsQueue` が所有する単一 `AudioContext`（試聴 `voicevoxPreview` は別インスタンス）。
  → **注入点は `AudioContext` の生成箇所しかない**＝方式 ① なら差分は極小で済む。
- webview は **macOS＝WKWebView / Windows＝WebView2（Chromium）**。`setSinkId` は Chromium 系の API で、
  WebKit 系の対応状況は要実測。
- `tauri.conf.json` の `additionalBrowserArgs` にある `--autoplay-policy=no-user-gesture-required` は
  **WebView2 にしか効かない**。macOS 側は `ttsQueue` の `resume()`（ユーザー操作契機）で凌いでいる。
- OBS 連携は**ウィンドウキャプチャ**（[044s](044s-obs-websocket-spike.md) 方式 A）＝**映像のみ**。
  アプリの音が配信に載るのは OBS の「デスクトップ音声」等の別系統。
- Rust の音声 crate（`rodio` / `cpal`）は**未導入**。`Cargo.toml` は「完全同期のまま・async/WS/HTTP crate を足さない」方針で、
  例外は `tauri-plugin-updater` のみ。

## このタスクでやること（検証項目）

### (1) macOS（WKWebView）での `setSinkId` 実測

- `typeof AudioContext.prototype.setSinkId` / `typeof HTMLMediaElement.prototype.setSinkId` の**存在確認**。
- 存在する場合は**実際に切り替わるか**を確認する（存在するが no-op、という最悪ケースを潰す）。
  確認方法＝仮想オーディオデバイスを出力先に指定し、**そのデバイスにだけ音が出て既定デバイスからは出ない**ことを耳と
  OBS の音声メーターで確かめる。**API がエラーを投げないことを「成功」と読まないこと。**
- `navigator.mediaDevices.enumerateDevices()` が `kind: "audiooutput"` を返すか。
  ⚠ **`label` が空文字で返る**（権限なしだとラベルが伏せられる）ケースを必ず確認する。
  ラベルが取れないとユーザーはデバイスを選べない＝実質使えない。

### (2) Windows（WebView2）での同項目

- (1) と同じ 3 点（存在 / 実切替 / 列挙とラベル）。**実機 Windows が要る**ため、
  [098](098-windows-build.md) の VM が使えるならそこで、無理なら 098 と同じタイミングまで待つ。
- ⚠ **Windows 検証が遅れる場合の扱いを先に決める**: 「mac が ① なら Windows も ① と仮定して 058a を進め、
  098 で確認する」のか「両 OS 揃うまで着手しない」のか。**前者を採るなら、058a に
  「Windows 未検証」の注記を必ず残す**（013/019/021/028 に同じ注記の先例がある）。

### (3) 仮想オーディオデバイス前提の運用確認

- macOS（BlackHole 等）/ Windows（VB-CABLE 等）を入れた状態で:
  - `enumerateDevices` にその仮想デバイスが**名前つきで**現れるか。
  - そこへ出した音を **OBS が音声入力キャプチャで拾えるか**（＝実際に配信に載るか）。
  - 「載せない」側（配信者だけが聴く）は既定デバイスへ出せば成立するか。
- → **ユーザーに仮想オーディオデバイスの導入を求めることになるのか**を確定する。求めることになるなら
  058b の UI に案内文言が要る（＝機能の体験コストが上がるので、本人の判断材料として必ず記録する）。

### (4) 方式 ②（Rust 側再生）の評価 — (1)(2) が割れた／ダメだった場合のみ

- `rodio`（または `cpal`）で**出力デバイスを指定して WAV を鳴らせるか**を最小コードで確認。
- 評価すべきコスト（実装せずに見積もるのではなく、最小コードで確かめる）:
  - **「Rust 完全同期」方針への例外になるか**（`rodio` は内部で再生スレッドを持つ。async ランタイムは不要のはず）。
  - **VOICEVOX の再生経路まで移設が要るか**。読み上げだけ Web Audio に残すと、
    「読み上げは載せる／通知音は載せない」の同時成立ができなくなる可能性がある。
  - `cargo audit` を通るか・推移依存が何 crate 増えるか（`.githooks/pre-commit` が `Cargo.lock` 変更時に走る）。
  - 音声データを Rust へ渡す経路（VOICEVOX の WAV は現在 webview の `fetch` が受けている）。
- ⚠ **ここまで来たら「機能を出さない」（③）も対等な選択肢**として本人に提示すること。
  代償（新規 crate・方針例外・再生経路の全面移設）が要望の価値に見合うかは**本人の決定**。

### (5) OBS 側の実態確認（方式に関係なく必要）

- OBS の「デスクトップ音声」がアプリの音をどう拾っているか（アプリ単位で分離できるのか、OS 全体なのか）を
  実機で確認する。**もし OBS 側でアプリ単位の音声キャプチャができるなら、そもそも StreamDock 側で
  デバイスを切り替える必要がない**（＝「OBS 側で設定してください」という案内で要望が満たせる可能性）。
  これは 058 系全体を不要にしうる**最短の逃げ道**なので、**(1) より先に確認してよい**。

## 成果物

- **方式決定メモ**（① / ② / ③ のいずれか・理由＝実現性 / OS 差 / 代償 / 工数）。本ファイル末尾に
  `## スパイク結果（YYYY-MM-DD・実測環境）` として追記する（044s / 057s と同じ形）。
- **058a の実装スコープ確定**（対象ファイル・設定 UI の置き場所・デバイス列挙の可否とフォールバック）。
- ② に倒れた場合は **security 方針の差分ドラフト**（§4 OS 操作・§10 依存）＝058a で
  [`docs/security.md`](../security.md) へ正式追記する内容の下書き。
- ③ に倒れた場合は **058a/058b を `## 保留` へ移す判断**と、059 側で「載せる／載せない」を出さない旨の申し送り。

## このタスクでやらないこと

- **本実装**（058a/058b）。検証コードは使い捨てブランチ／リポジトリ外スクリプトに留め、本体へマージしない。
- 通知音そのものの追加（[059](059-notification-sounds.md)）。
- 依存の本採用（② に倒れても、`Cargo.toml` への追加は 058a で §10 記録＋security-review を通してから）。
- 音量正規化・ダッキング・ミキシングの検証（スコープ外）。
- マイク入力の検証。`getUserMedia` は**呼ばない**（(1) の `enumerateDevices` でラベルが取れなかった場合も、
  権限を取りに行かず「取れない」を結論として記録する）。

## セキュリティ制約（docs/security.md 準拠）

- 検証でも**外部通信を増やさない**（§1）。VOICEVOX は既存の loopback `127.0.0.1:50021` のみ。
- **マイク権限を要求しない**（`getUserMedia` を呼ばない）。配信者の PC のマイクに触れる機能だと誤解される検証をしない。
- デバイス名・デバイス ID を**ログ／外部出力に出さない**（§9）。実測メモに書くときは
  「仮想デバイス A」等の匿名表記にするか、本人環境固有の名前であることを明記する。
- 検証で入れる依存（`rodio` 等）は**検証用**。本採用は 058a で §10 記録＋security-review を通してから。
- 本体コードに検証コードを残さない（下記 `git status` で確認）。

## 完了条件

- (5) → (1) → (2) → (3) の順に実測が済み、**方式が ① / ② / ③ のいずれかに決定**している。
- 決定の理由と実測環境（OS・バージョン・使った仮想オーディオデバイス）が本ファイルに追記されている。
- ② に倒れた場合は security 方針の差分ドラフトが、③ に倒れた場合は保留移動の判断が用意できている。
- 058a の実装スコープ（対象ファイル・UI 位置・フォールバック仕様）が確定している。
- 本体コードに検証コードが残っていない。[`docs/progress.md`](../progress.md) にスパイク結果を記録。

## 確認コマンド

```bash
# 検証は使い捨てブランチ or リポジトリ外スクリプト推奨（044s と同じ作法）。
# (1)(2) は tauri dev の DevTools コンソールで API の存在と実切替を確認する。
pnpm --filter ./apps/desktop tauri dev
# ① DevTools で `typeof AudioContext.prototype.setSinkId` / `typeof HTMLMediaElement.prototype.setSinkId`
# ② `await navigator.mediaDevices.enumerateDevices()` の audiooutput 件数と label の中身（空文字でないか）
# ③ 仮想デバイスを指定して読み上げ→そのデバイスにだけ音が出るか（既定デバイスから出ないこと）を耳と OBS で確認
# ④ OBS の「デスクトップ音声」でアプリ単位の分離ができるか（(5)）

# 本体差分ゼロの担保（検証コードが残っていないこと）
git status --short
git diff --stat   # 本ファイルへの結果追記と docs/progress.md 以外に差分が無いこと
```

## 実装後に必要なレビュー

- 本スパイクは**レビュー対象外**（検証のみ・本体差分ゼロ）。ただし ② に倒れた場合の security 方針
  ドラフト作成までは本タスクの責務で、正式レビューは 058a で実施する。
- ⚠ 検証段階でも「外部通信ゼロ」「マイク権限を取らない」「デバイス名を出力しない」は守ること。

---

## スパイク結果（2026-08-03・macOS / Windows 実測）

検証は**リポジトリ外**（スクラッチパッドの DevTools スニペットと、`cargo new` した使い捨て Rust プロジェクト）で実施し、
**本体コード・依存は一切変更していない**（`apps/` / `package.json` / `pnpm-lock.yaml` / `Cargo.toml` / `Cargo.lock` の差分ゼロを実測）。
アプリの起動・OBS の操作・耳での確認・OS の出力デバイス切替は本人が担当。

### ⚠ 最重要の結論 — 3 択

| 結論 | 判定 | 根拠 |
| --- | --- | --- |
| ① Web 側（`setSinkId`）で成立 | **✕** | **両 OS で成立しない。しかも詰まっている場所が違う**——macOS は `navigator.mediaDevices` ごと存在せず `setSinkId` も無い。Windows は `setSinkId` が**存在するのに使えない**（`enumerateDevices` が `deviceId` も `label` も空の 1 件しか返さず、**渡せる ID が無い**）。`selectAudioOutput` は両 OS とも無く、**マイク権限を取らずに label を得る道は存在しなかった** |
| **② Rust 側再生が必要** | **これ** | `rodio` で**デバイス名・設定に保存できる安定 ID・既定以外への実再生**がすべて成立。依存コストも想定より軽い（下記 (4)） |
| ③ どちらも不可＝機能を出さない | ✕（不採用） | (5) の OBS 案内は**アプリ単位でしか分離できず、読み上げと通知音を区別できない**。「読み上げを載せる」を選ぶと**通知音も必ず載る**ため、本人の判断（2026-08-03）で不採用 |

**採る形は「②-軽」**（本人決定・2026-08-03）＝ **通知音（059）だけ Rust 再生にし、読み上げは Web Audio のまま**。
理由と限界は下記「決定メモ」。

### 実測環境

- macOS **14.6.1 (23G93)** / Apple Silicon（`aarch64-apple-darwin`）/ Rust **1.95.0**
- Windows **10/11 (Windows NT 10.0 / x64)**（実機。098 の VM ではない）
- OBS **32.2.1**（macOS 側で確認。Windows 側のバージョンは未記録）
- webview の実体
  - macOS = **WKWebView**（UA `AppleWebKit/605.1.15`・Version トークン無し）
  - Windows = **WebView2 / Chromium 150**（UA `Chrome/150.0.0.0 Edg/150.0.0.0`）
- アプリの実行形態（**これが (5) の判定を左右した**・下記 ⚠）
  - macOS = `pnpm tauri dev`（`http://localhost:1420`）と **`tauri build --debug` の `StreamDock.app`**（`tauri://localhost`）の両方
  - Windows = `pnpm tauri dev`（`http://localhost:1420`）のみ。**バンドル版は未検証**
- 使った出力デバイス（§9 のため匿名／製品名のみ）: **既定デバイス（内蔵スピーカー）** ／ **仮想オーディオデバイス**
  （本人環境では BlackHole 2ch） ／ **複数出力装置**（macOS の集約デバイス）。**いずれも本人環境に既に導入済みだった**
- 検証用 crate: `rodio` **0.22.2** / `cpal` **0.17.3**（スクラッチパッド側にのみ導入）

### ⚠ 手順上の前提（結論より先に効いた事実）

- **`tauri dev` では (5) を判定できない（macOS）。** dev で走るのは `target/debug/stream-dock` という**素の実行ファイル**で、
  **bundle identifier を持たない**。OBS の macOS アプリケーション音声キャプチャは選択したアプリを bundle ID で保存するため、
  **OK を押しても選択が空に戻る**。`tauri build --debug` で作った `StreamDock.app`（`com.tetsuya.stream-dock`）に替えた瞬間に解決した。
  → **「dev で動かない」を「製品で動かない」の証拠にしてはいけない。** 057s の教訓（自分の環境で動いた＝配布可否ではない）の**実行形態版**。
- Windows の DevTools（Chromium 系）は**コンソールへの貼り付けを既定で拒否**する（self-XSS 警告）。
  `allow pasting` は**警告が出ている最中にだけ**受け付けられる。**Sources → Snippets は貼り付け保護の対象外**なので、そちらが確実。
- Windows では `beforeDevCommand` / `beforeBuildCommand` の `pnpm check:sidecar` が
  `comment-sidecar-x86_64-pc-windows-msvc.exe` を探して落ちる（**098 未完了のため未生成**）。本スパイクでは
  **sidecar を必要としない**（音を鳴らすのは webview であってコメビュ窓ですらなくてよい）ため、そこは回避して実施した。

### (5) OBS 側の実態 — **macOS ✅ / Windows ⚠**

| | macOS | Windows |
| --- | --- | --- |
| ソース種別 | **「アプリケーション音声キャプチャ」あり** | **「アプリケーション音声キャプチャ（ベータ）」あり** |
| 一覧に StreamDock | ✅ 出る（**バンドル版のみ**・dev は選択が保存されない） | ✅ 出る（`.exe` として） |
| StreamDock を選んでメーター | **✅ 振れる** | **✕ 振れない** |
| 代わりに拾える対象 | — | **`Microsoft Edge WebView`（`msedgewebview2.exe`）を選べば ✅ 振れる** |
| 排他性（他アプリの音） | **✅ 振れない**（デスクトップ音声をミュートした状態で、別アプリの再生では振れないことを確認） | 未確認 |
| アプリ再起動をまたぐか | 未確認 | **✅ またぐ**（OBS 側を触らずに再度振れた） |

- **Windows で StreamDock を指定しても拾えない理由は実測で判明している**: Windows の音量ミキサーで音声セッションの持ち主を見ると
  **`Microsoft Edge WebView`** になっている。＝ WebView2 の音は子プロセスから出ており、OBS が `stream-dock.exe` を狙っても届かない。
  **macOS では同じ構造（WKWebView のヘルパープロセス）でも StreamDock として拾えた**ので、**この非対称は OS 側の実装差**である。
- ⚠ **Windows を ⚠ にした理由は技術ではなく案内の質**: 拾わせるには配信者に「`Microsoft Edge WebView` を選んでください」と
  案内することになる。名前が StreamDock ではないうえ、**他の WebView2 アプリの音も同じソースに乗りうる**ので
  「StreamDock の音だけ」という保証が落ちる。
- ⚠ **Windows のバンドル版は未検証**。`StreamDock.exe` なら拾える可能性は残る（OBS がプロセスツリーを辿るなら拾えるはずだが、
  dev では拾えなかった）。**098 の Windows ビルドが済んだときに確認すること。** ただし**この差は結論を変えない**
  （どちらでも「OBS 側の設定で解決する」＝アプリ単位の粒度であることに変わりがないため）。
- ⚠⚠ **(5) が ✅ でも要望は満たせない**（本スパイク最大の発見）。アプリ単位キャプチャは**そのプロセスの音を丸ごと**拾うので、
  **読み上げと通知音を区別できない**。親 058 の「設定の単位は音の種類ごと」は OBS 側では原理的に実現できない。

### (1) macOS（WKWebView）— **✕**

**API の存在**と**実際に切り替わったか**は別項目として記録する（本スパイクの判定規則）。

| 項目 | 実測（`tauri://localhost` の `StreamDock.app`） |
| --- | --- |
| `isSecureContext` | ✅ `true` |
| `navigator.mediaDevices` | **✕ `undefined`**（オブジェクトごと存在しない） |
| `enumerateDevices` | ✕ `undefined` |
| `AudioContext.prototype.setSinkId` | **✕ `undefined`** |
| `HTMLMediaElement.prototype.setSinkId` | **✕ `undefined`** |
| `AudioContext.prototype.createMediaStreamDestination` | ✅ `function`（**あっても意味が無い**——`setSinkId` が無いので要素経由の回避策も成立しない） |
| `navigator.mediaDevices.selectAudioOutput` | ✕ `undefined` |
| **実際に切り替わったか** | **測定不能**（API が存在しないため Probe C を実施せず） |

### (2) Windows（WebView2 / Chromium 150）— **✕**

| 項目 | 実測（`http://localhost:1420` の dev） |
| --- | --- |
| `isSecureContext` | ✅ `true` |
| `navigator.mediaDevices` | ✅ `object` |
| `AudioContext.prototype.setSinkId` | **✅ `function`**（`sinkId` getter も有り） |
| `HTMLMediaElement.prototype.setSinkId` | ✅ `function`（`sinkId` getter も有り） |
| `createMediaStreamDestination` | ✅ `function` |
| `selectAudioOutput` | **✕ `undefined`** |
| `enumerateDevices` の結果 | **`audiooutput` が 1 件のみ・`deviceId` は空文字・`label` も空**（`audioinput` は 0 件） |
| **実際に切り替わったか** | **✕ 不可能**。渡せるデバイス ID が存在しないため、`setSinkId` を呼べても既定デバイス以外を指定できない |

⚠ **「API は存在した」を「切り替えられる」と読まないこと。** Windows はまさにその落とし穴で、
`typeof AudioContext.prototype.setSinkId === "function"` だけを見て ① と判定すると誤る。
Chromium は権限が無いと **`deviceId` も `label` も空の 1 件**を返す仕様で、これが ① を殺している。

⚠ **`getUserMedia` は本スパイクを通じて一度も呼んでいない**（マイク権限を取りに行かない方針を厳守）。
`selectAudioOutput`（マイクではなく speaker-selection 権限を取る別経路）の実行は本人の許可を得ていたが、
**両 OS とも API 自体が存在しなかった**ため実行に至らなかった。
→ **権限を取らずに label を得る手段は、現時点の両 webview に存在しない。**

### (3) 仮想オーディオデバイス前提の運用 — **✅（macOS のみ）**

- Rust（rodio）から**仮想オーディオデバイスを指定して再生**したところ、**既定デバイス（内蔵スピーカー）からは一切鳴らず**、
  **OBS の「音声入力キャプチャ」で当該仮想デバイスを選んだソースのメーターが振れた**。
  ＝ **「載せる」側の経路（アプリ → 仮想デバイス → OBS）が成立する**ことを実測で確認。
- 判定は**2 つ揃って初めて ✅**とした（切替先に届いた／既定からは鳴らない）。仮想デバイスは耳で聞こえないため、
  「聞こえない」だけでは「どこにも出ていない」と区別できない。**OBS のメーターがその区別を与えている。**
- **本人環境には仮想オーディオデバイスと複数出力装置が既に導入済み**だったため、導入コストは本スパイクでは発生していない。
  ⚠ ただし**配布時には一般ユーザーに導入を求めることになる**（058a/059 の UI に案内文言が要る）。
- ⚠ **Windows 未検証**（VB-CABLE 等が未導入のため）。

### (4) 方式②（Rust 側再生）の評価 — **✅**

`rodio` 0.22.2 をスクラッチパッドの使い捨てプロジェクト（`cargo new`）で評価した。**本体の `Cargo.toml` / `Cargo.lock` には触れていない**
（`.githooks/pre-commit` が `Cargo.lock` のステージ時に `cargo audit` を走らせるため、本体の Cargo に触らないことは意図的）。

| 評価軸 | 実測値 |
| --- | --- |
| 直接依存 | **`rodio` 1 本のみ** |
| feature | **`default-features = false, features = ["playback","wav"]` が必須**。⚠ **既定のままだと symphonia 一式（mp3/mp4/flac/vorbis/aac）で 126 crate** に膨らむ |
| 実際に入る crate | **macOS 39 / Windows 38**（`cargo tree --edges normal` の重複除去後） |
| **「Rust 完全同期」方針への例外か** | **✕ 例外にならない。** `tokio` / `async-std` / `futures-executor` は**1 つも引かれない**（`cargo tree -i` がいずれも「該当パッケージなし」） |
| `cargo audit` | **exit 0**（脆弱性 0・警告 0・advisory DB 1186 件） |
| **デバイス名の取得** | **✅ 取れる**（`cpal::DeviceTrait::description()`）。**権限は不要** |
| **設定に保存できる ID** | **✅ ある**（`cpal::DeviceId(HostId, String)`。macOS では `BuiltInSpeakerDevice` のような安定文字列で、cpal のドキュメントが「**再起動・再接続をまたいで持続する一意な識別子**」と明記） |
| 指定デバイスでの再生 | **✅ 成立**（上記 (3)） |

⚠ **`rodio::speakers`（`available_outputs` / `SpeakersBuilder`）は `experimental` feature 配下**。本採用では使わず、
**cpal で列挙し `rodio::DeviceSinkBuilder::from_device(device)` → `open_stream()` で開く安定 API 経路**を使うこと。
（`cpal::DeviceTrait::name()` は deprecated で、`description()` / `id()` が後継。）

**① が詰んだ理由がそのまま ② の長所になっている**: webview は権限が無いと `label` も `deviceId` も空文字しか返さないのに対し、
**Rust は権限なしでデバイス名と安定 ID を返す**。「ユーザーが出力先を選べる」という機能の前提条件は、Rust 側にしか存在しない。

**未実測（②-軽を採ったため測る必要が無くなった項目）**
- WAV を webview から Rust へ渡す IPC のコストとバイト数（②-フルでのみ必要）。
- `ttsQueue` の直列制御・再生完了通知を作り直す工数（同上）。
- Windows での rodio 実再生（**Windows 未検証**）。

### 通信面

- 外部 egress は**ゼロ**。VOICEVOX（`127.0.0.1:50021`）にも接続していない（トーン生成と rodio の正弦波で済ませたため）。
- OBS の確認は**すべて GUI 操作**なので、obs-websocket の loopback（`127.0.0.1:4455`）すら使っていない。
- `cargo add` / `cargo audit` は crates.io と advisory DB を見るが、これは**ビルドツールの取得であってアプリの通信ではない**。

---

## 決定メモ → **② Rust 側再生（採る形は「②-軽」）**

### なぜ ③ ではないか

(5) の OBS 案内は**アプリ単位でしか分離できない**。読み上げも通知音も同じプロセス（StreamDock とその webview ヘルパー）から
出るため、「読み上げを配信に載せる」を選んだ時点で**通知音も必ず載る**。
本人の判断（2026-08-03）は「**音声を配信に載せるかどうかを選べるならよいが、それで結果的に通知音が載るなら保留はダメ**」。
＝ ③ は要件を満たさないので不採用。

### なぜ ②-フルではないか

②-フル（読み上げも Rust 再生）なら読み上げ・通知音の両方に独立したトグルを付けられるが、代償は
**`ttsQueue` の再生経路の全面移設**——WAV を webview から IPC で Rust へ渡し、直列制御と再生完了通知
（現在は `playWav` の Promise 解決＝`onended` 依存）を作り直すことになる。
⚠ **050 でハング対策（合成タイムアウト・再生ストール監視・abort 経路）を入れたばかりの、最も繊細な箇所を書き換える**ため
退行リスクが高い。工数と要望の重み付けの結果、本人が **②-軽** を選択（2026-08-03）。

### ②-軽の成立条件（運用）

| 音 | 再生層 | 出力先 | 配信に | 本人に |
| --- | --- | --- | --- | --- |
| **読み上げ** | Web Audio（**現状のまま無改変**） | **OS 既定**＝仮想オーディオデバイス（または複数出力装置） | **載る** | 聞こえる（複数出力装置、または OBS の音声モニタリング経由） |
| **通知音** | **Rust（rodio）** | 実デバイス（スピーカー / ヘッドホン）を**明示指定** | **載らない** | 聞こえる |

- OBS 側は**アプリケーション音声キャプチャではなく**、**仮想デバイスを「音声入力キャプチャ」で拾う**構成にする
  （アプリ単位キャプチャはデバイス指定を無視してプロセスの音を全部拾うため、②-軽と両立しない）。
- ⚠ **限界: 「読み上げを載せない」は選べない**（読み上げは常に OS 既定＝載る側へ出る）。
  要望②（読み上げの載せる／載せないトグル）は**満たせない**。→ [058b](058b-voicevox-stream-output-toggle.md) は**保留**。
- ⚠ **ユーザーに仮想オーディオデバイスの導入と OBS の構成変更を求めることになる**（体験コストが上がる）。
  058a / 059 の UI に案内文言が必須。

### [058a](058a-audio-routing-foundation.md) の実装スコープ（②-軽版）

⚠ **058a の現行記述は ①（`setSinkId` / `audioRouting.ts` / `applyRoute` / `ttsQueue` の `getRoute`）を前提に書かれており、
本結論により全面的に置き換わる。** 着手時に書き直すこと（本スパイクでは 058a の内容を変更していない＝057s と同じ作法）。

- **層が frontend から Rust へ移る。**
  - Rust: 出力デバイスの**列挙**（名前＋安定 ID）と、**指定デバイスでの WAV 再生**。
    §3 に従い**単一目的の狭いコマンド 2 本**に留める（例: `list_audio_output_devices` / `play_notification_sound`）。
    **汎用の「任意パスの音声を鳴らす」コマンドは作らない**（音源はアプリ同梱アセットに限定し、frontend からパスを渡させない）。
  - frontend: 一覧を受けて選ばせる設定 UI と、選択の永続化のみ。**デバイス ID を frontend が組み立てない**。
- **設定 UI の置き場所**: [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) の音声関連カード。
  書式は [054](054-comment-viewer-settings-readability.md) の階層規則に従う（新しいトークンを発明しない）。
- **設定値の保存**: 既存の localStorage 作法（`stream-dock.comment-viewer.*` 名前空間・`load*`/`save*` ペア・
  不正値は既定へフォールバック）。保存するのは**ユーザーが選んだデバイス ID**のみ。
- **デバイス列挙のフォールバック**: 0 件・列挙失敗・**保存済み ID が現在の一覧に無い**（デバイスを抜いた等）場合は
  **既定デバイスへ落とす**。⚠ このとき「載せないつもりの音が載る」向きに倒れるので、**UI で必ず気付かせること**。
- **`voicevoxPreview.ts` の扱い**: **無改変**（試聴は常に OS 既定デバイス）。②-軽では読み上げ経路を触らないため、
  親 058 の既定（試聴にルーティングを効かせない）がそのまま成立する。
- **`ttsQueue.ts` / `voicevox.ts` も無改変。**

### security 方針の差分ドラフト（058a で [`docs/security.md`](../security.md) へ正式追記する内容）

> ⚠ 下記は**ドラフト**。正式な追記と security-review は 058a で行う（本スパイクの責務はドラフト作成まで）。

- **§10（依存）— 追加する依存（058a・通知音の Rust 再生）**
  - Rust: **`rodio`（`default-features = false, features = ["playback","wav"]`）**。
    理由＝**webview では出力デバイスを選べないことが 058s の実測で確定した**ため（macOS は `setSinkId` ごと非対応、
    Windows は `deviceId`/`label` が空で選択不能）。**feature を絞るのは必須**で、既定のままだと symphonia の
    デコーダ一式が入り 126 crate に膨らむ（実際に必要なのは WAV 再生のみ）。
    実測で **tokio / async ランタイムを引かない**ことを確認済み＝**「Rust は完全同期のまま」の方針を破らない**。
    増える crate は macOS 39 / Windows 38、`cargo audit` は exit 0。
    ⚠ **`rodio::speakers` は `experimental` feature 配下なので使わない**（安定 API の `DeviceSinkBuilder::from_device` を使う）。
  - **明示的に足さないもの**: `cpal` の直接依存（`rodio::cpal` の再エクスポートを使う）／音声デコーダ（WAV のみ）／
    HTTP・async 系 crate。
- **§4（OS 操作）— 音声出力デバイスの列挙と再生**
  - 追加するのは**出力デバイスの列挙**と**アプリ同梱音源の再生**のみ。**入力（マイク）には一切触れない**。
  - コマンドは**単一目的の狭いもの 2 本**に限定し、`run_command` 的な汎用コマンドは作らない（§3）。
    **frontend から任意のファイルパスを受け取らない**（音源はアプリ同梱アセットに限定）。
  - 再生対象デバイスは**列挙結果に存在する ID のみ**を受け付ける（Rust 側で照合・§8）。
- **§9（ログ）— デバイス名・デバイス ID をログに出さない。** 端末外へ送らない・DB に保存しない。
  localStorage に保存するのは**ユーザー自身が選んだデバイス ID**のみで、これは非機密の UI 設定値として扱う。
- **§1（外部通信）— 増えない。** 新規宛先ゼロ・capability 追加ゼロ・`csp: null` 不変。
- **security-review は必須**（新規 crate ＋ §4 の OS 操作面が増えるため）。

### 各タスクの扱い

| タスク | 扱い |
| --- | --- |
| [058a](058a-audio-routing-foundation.md) | **着手可能だが内容の書き直しが要る**（① 前提で書かれているため）。層が Rust へ移り、**security-review 必須**になる |
| [058b](058b-voicevox-stream-output-toggle.md) | **保留。** ②-軽では読み上げのルーティングができないため、要望②のトグルは出せない |
| [059a](059a-comment-notification-sound.md) / [059b](059b-monetary-notification-sound.md) | **再生層が Web Audio → Rust に変わる**。「専用 `AudioContext`」前提の記述は差し替えが要る |

### 再開条件（②-フル / 058b へ進む条件）

- **webview 側が出力デバイス選択に対応したとき。** 具体的には
  (a) WKWebView に `navigator.mediaDevices` と `setSinkId` が入る、
  (b) WebView2 で**マイク権限を取らずに** `deviceId` / `label` が得られるようになる（`selectAudioOutput` の実装、または
  Tauri / wry が WebView2 の `PermissionRequested` を扱えるようになりデバイス列挙の許可を出せるようになる）、
  のいずれか。**現時点ではどちらも成立していない。**
- または **②-フル（読み上げも Rust 再生）の工数を払うと本人が判断したとき**。そのときに測るべき未実測項目は
  「WAV の IPC コスト」と「`ttsQueue` の完了通知の作り直し」の 2 つ（上記 (4) の未実測欄）。

### 残リスク・申し送り

- ⚠ **Windows は rodio 未検証**（(3)(4) とも macOS のみ）。058a の実装時、または 098 のタイミングで
  「WASAPI でデバイス名と安定 ID が取れるか」「指定デバイスで鳴るか」を必ず実測すること。
- ⚠ **Windows のバンドル版での (5) が未検証**。`StreamDock.exe` なら OBS が拾える可能性が残っている（098 で確認）。
- ⚠ **仮想オーディオデバイスの導入をユーザーに求めることになる。** 058a / 059 の UI に案内が必須で、
  「導入しないと『載せない』が機能しない」ことを明示すること。
- ⚠ **フォールバックの向きに注意**: デバイスが見つからないとき既定へ落ちると、
  **「載せないつもりの通知音が配信に載る」**side に倒れる。UI で気付かせること。
- ⚠ **`rodio` の feature 指定を落とさないこと**（`default-features = false`）。落とすと 126 crate に膨らむ。
  `zip` feature を落とすなという 055b の申し送りと同種の地雷。
- ⚠ **OBS 側の構成変更（デスクトップ音声／アプリ単位キャプチャ → 仮想デバイスの音声入力キャプチャ）が前提**になる。
  044a の「OBS へウィンドウキャプチャソースを自動追加する」機能とは**別系統**（あちらは映像のみ）で、衝突はしない。

### 検証コードの所在

**リポジトリ外**（スクラッチパッド）。**本体へは未マージ・依存追加ゼロ**。

- DevTools スニペット 3 本（トーン発生 / Probe A+B＝API 存在確認とデバイス列挙 / Probe C＝実切替）
- Rust 検証プロジェクト（`cargo new` した使い捨てパッケージ・`rodio` はそこにのみ導入）

`apps/desktop/src-tauri/target/debug/bundle/` に **debug ビルドの `StreamDock.app` / `.dmg`** が残っているが、
`target/` は gitignore 済みで**追跡ファイルの差分はゼロ**。
⚠ `tauri build --debug` は最後に **updater の署名鍵（`TAURI_SIGNING_PRIVATE_KEY`）が無い**というエラーで**非ゼロ終了する**が、
`.app` と `.dmg` はその手前で生成済み（本スパイクには無関係）。
