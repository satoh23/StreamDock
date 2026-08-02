# 058s 音声出力デバイス指定 技術検証（スパイク・方式決定）

> 状態: **未着手（スパイク＝技術検証・本実装しない）**。分割・線引きは親 [058](058-stream-audio-routing.md) を正とする。
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
