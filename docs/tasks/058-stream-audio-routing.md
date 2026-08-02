# 058 配信音声ルーティング（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 058s〜058b の**分割・線引き・実装順の正**。
>
> **必読前提**: TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`AudioContext` を 1 つだけ所有する層）、
> 再生プリミティブ [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`playWav`）、
> 試聴 [`voicevoxPreview.ts`](../../apps/desktop/src/features/comment-viewer/voicevoxPreview.ts)、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> UI 設定の保存作法 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> OBS 連携の方式決定 [044s](044s-obs-websocket-spike.md)（**ウィンドウキャプチャ＝映像のみ**）、
> [`docs/security.md`](../security.md)（§1 外部通信／§4 OS 操作／§10 依存／レビュー必須条件）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

StreamDock がアプリ内で鳴らす音（**VOICEVOX 読み上げ**・**コメント通知音**（[059a](059a-comment-notification-sound.md)）・
**投げ銭通知音**（[059b](059b-monetary-notification-sound.md)））について、
**「配信に載せる／載せない」を音の種類ごとにユーザーが選べる**ようにするための**共通の土台**を作る。

本親は「載せる／載せないをどう実現するか」の**方式決定**と、その方式を 3 機能へどう配るかの線引きだけを担う。
個々の音そのもの（音源・鳴らす条件・レート制限）は [059](059-notification-sounds.md) の領分。

## 現在の前提（調査結果・実コード）

- **出力デバイスを選ぶ仕組みはコードベースに存在しない。** `setSinkId` / `sinkId` / `enumerateDevices` /
  `navigator.mediaDevices` の使用箇所は **desktop / sidecar とも 0 件**（grep 実測）。
- 音は**すべて frontend の Web Audio API**で鳴っている。Rust 側に `rodio` / `cpal` は無く、Rust がやるのは
  VOICEVOX ENGINE プロセスの起動（`launch_voicevox_engine`）だけ。
  - [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `createTtsQueue` が
    **`AudioContext` を 1 つだけ所有**し（`dispose` で閉じる）、FIFO 直列で 1 件ずつ再生する。
  - 実際の音出しは [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) の
    `playWav(ctx, wav, signal)`。中で `ctx.createBufferSource()` → **`src.connect(ctx.destination)`**。
    ＝**出力先は常に `ctx.destination`（OS 既定デバイス）**で、注入点は `ctx` の 1 か所しかない。
  - 試聴は [`voicevoxPreview.ts`](../../apps/desktop/src/features/comment-viewer/voicevoxPreview.ts) が
    **別の `AudioContext`** を持つ（キューとは独立）。方式決定後、ここにも同じルーティングを通すか決める必要がある。
- **OBS 連携はウィンドウキャプチャ方式**（[044s](044s-obs-websocket-spike.md) で方式 A を実測決定）。
  ウィンドウキャプチャは**映像しか取らない**＝アプリの音が配信に載る経路は OBS の「デスクトップ音声」等**別系統**で、
  現状は「OS 既定デバイスに出る音が全部載るか、全部載らないか」の 2 択しかない。
- webview の実体は **macOS＝WKWebView / Windows＝WebView2（Chromium）** と非対称。
  `tauri.conf.json` の `additionalBrowserArgs` に `--autoplay-policy=no-user-gesture-required` があるが、
  これは WebView2 にしか効かない（macOS 側の autoplay 対策は `ttsQueue` の `resume()` が担っている）。
- 依存は増やさない方針が徹底されている（desktop の frontend dependencies は 5 個だけ）。
  Rust も「完全同期のまま・async/WS/HTTP crate を足さない」が明文の方針で、例外は `tauri-plugin-updater` の 1 件のみ。

## 確定した方針

- **方式は実測で決める（[058s](058s-audio-output-device-spike.md) 先行）。** [044s](044s-obs-websocket-spike.md) /
  [057s](057s-discord-rpc-streamkit-spike.md) と同型で、**スパイクが通らなければ「載せる／載せない」機能は出さない**。
  事前の決め打ちをしない理由は下記の非対称にある:
  - `AudioContext.setSinkId` / `HTMLMediaElement.setSinkId` は **Chromium 系の API**。WebView2（Windows）では
    期待できるが、**WKWebView（macOS）は非対応の公算が高い**。ここが割れると「Windows だけ動く機能」になり、
    そのまま出すと配信者に「mac では設定項目が効かない」体験を与える。
  - 代替は Rust 側再生（`rodio` 等）だが、これは**新規 crate ＋「Rust 完全同期」方針への例外**で、
    しかも VOICEVOX の再生経路（Web Audio）まで巻き取る大工事になる。**スパイクなしに払える代償ではない。**
- **「載せる／載せない」の意味は「どの出力デバイスへ出すか」に還元する。** 配信に載せる＝OBS が拾っている
  デバイス（＝仮想オーディオデバイス、または OS 既定）へ出す。載せない＝配信者だけが聴くデバイスへ出す。
  **StreamDock 側で音声をミックスして OBS へ送り込む方式は採らない**（新規の音声ストリーム経路＝設計・権限とも重い）。
- **設定の単位は「音の種類ごと」**（読み上げ／コメント通知音／投げ銭通知音の 3 つ）。1 個のグローバル設定にしない。
  依頼者の要望が「読み上げは載せたいが通知音は自分だけ聴きたい」といった出し分けだから。
- **設定値は非機密の UI 値**なので [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) と
  同方式の localStorage（`stream-dock.comment-viewer.*` 名前空間）に置く。§9 の対象外
  （第三者の個人データではなくユーザー自身の設定値）。
- **デバイス列挙・選択の UI は 1 か所に集約する**（設定ビューの「音声出力」カード）。3 機能がそれぞれ独自の
  デバイス選択を持つ形にはしない。

### 決めること（058s の結論で確定させる）

| 論点 | 決め方 |
|---|---|
| Web 側（`setSinkId`）で成立するか | 058s (1)(2) の実測 |
| 成立しない OS が出たとき、Rust 側再生へ倒すか／機能を出さないか | 058s (4) の評価＋**本人の決定** |
| 試聴（`voicevoxPreview`）にもルーティングを効かせるか | 058a で確定（既定＝**効かせない**＝試聴は常に既定デバイス） |
| 仮想オーディオデバイスの導入をユーザーに求めるか（案内の要否） | 058s (3) の実測後、058b の UI 文言で確定 |

## 子タスクと線引き

| 子 | 内容 | 層 | 外部通信（新規） | レビュー |
|---|---|---|---|---|
| [058s](058s-audio-output-device-spike.md) | **スパイク**。出力デバイス指定の可否を実測し方式を決定（**本実装しない**） | — | なし | — |
| [058a](058a-audio-routing-foundation.md) | 決定方式でのルーティング基盤（出力先の抽象＋デバイス列挙＋設定の永続化＋設定 UI） | 方式次第 | なし | **方式次第で security-review 必須**（Rust 再生に倒れた場合＝新規 crate・§4/§10） |
| [058b](058b-voicevox-stream-output-toggle.md) | VOICEVOX 読み上げに「配信に載せる」を適用（要望②） | frontend | なし | 軽レビュー |

- **058a は「音を鳴らす経路に出力先を差し込めるようにする」ところまで**。どの音に何を適用するかは 058b と 059 が決める。
- **058b は 058a の抽象を読み上げ 1 系統に適用するだけ**（VOICEVOX 固有の話はここに閉じる）。
- 通知音への適用は [059a](059a-comment-notification-sound.md) / [059b](059b-monetary-notification-sound.md) 側で行う
  （058 は API を提供するだけで、059 のファイルを触らない）。

## 依存関係と推奨実装順

```
058s ──> 058a ──> 058b
                └──> 059a / 059b の「配信に載せる」トグル（059 側で実装）
```

- **058s が全体のボトルネック**。ここの結論が「③ どちらも不可」なら 058a/058b は着手しない。
- [059a](059a-comment-notification-sound.md) は**「配信に載せる」トグル抜きなら 058s の前でも着手できる**
  （音を鳴らすだけなら既存の Web Audio で足りる）。トグルは 058a 完了後に足す。

## 横断セキュリティ方針（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。音源はアプリ同梱、VOICEVOX は既存の loopback（`127.0.0.1:50021`）のみ。
  デバイス列挙・音声出力で新しい宛先は増えない。
- **マイク入力は一切扱わない**。`getUserMedia` を呼ばない（`enumerateDevices` がデバイス**ラベル**を返すために
  マイク権限を要求する挙動が実測で確認された場合は、**権限を取りに行かず「既定デバイス」で妥協する**方向で 058s が判断する）。
  配信者の PC のマイクに触れる機能だと誤解される実装にしない。
- **デバイス名・デバイス ID を外部へ送らない・ログに出さない**（§9）。localStorage に保存するのは
  ユーザーが選んだデバイス ID のみで、これは非機密の UI 設定値として扱う。
- **新規依存は 058s の結論が「Rust 側再生」になった場合のみ**。そのとき 058a で §10 に理由を記録し、
  `cargo audit` を通し、**security-review を必須**にする（`.githooks/pre-commit` が `Cargo.lock` 変更を検知して監査する）。
- **capability を増やさない**。デバイス選択・音声再生はいずれも webview 内で完結する想定
  （Rust 再生へ倒れた場合も、コマンドは単一目的の狭いもの 1〜2 本に留める＝§3）。

## 完了条件（親）

- 058s〜058b のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 058 系が追記されている。
- **058s の結論（3 択）が本ファイルまたは 058s に記録され、058a の実装スコープが確定している。**
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。

## このタスク（親）でやらないこと

- コード実装（058s〜058b それぞれで行う）。
- **音そのものの追加**（通知音は [059](059-notification-sounds.md)）。本親は「どこへ出すか」だけを扱う。
- StreamDock 側での音声ミキシング・仮想オーディオデバイスの自前実装・OBS への音声ストリーム送出。
- マイク入力・音声認識・入力デバイスの扱い。
- 音量の正規化やダッキング（読み上げ中に通知音を絞る等）。必要になったら別タスク。

## 実装後に必要なレビュー

- 058s: レビュー対象外（検証のみ・本体差分ゼロ）。ただし結論は必ず記録する。
- 058a: **方式が Rust 側再生なら security-review 必須**（新規 crate・§4 OS 操作・§10）。
  Web 側 `setSinkId` で収まるなら軽レビュー。
- 058b: 軽レビュー（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
