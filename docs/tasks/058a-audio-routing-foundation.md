# 058a 音声ルーティング基盤（出力先の抽象＋デバイス選択 UI）

> 状態: **未着手（実装サブタスク）。⚠ 2026-08-03: [058s](058s-audio-output-device-spike.md) の結論が
> **②（Rust 側再生・採る形は「②-軽」）**に決まったため、**本ファイルの内容は着手時に書き直しが要る**。
> 下記は ①（Web 側 `setSinkId`）前提で書かれており、`audioRouting.ts` / `applyRoute` / `ttsQueue` の `getRoute` は
> **いずれも成立しない**（`setSinkId` は macOS で非対応、Windows では `deviceId`/`label` が空で選択不能＝実測）。
> **層が frontend から Rust（`rodio`）へ移り、security-review が必須になる。**
> 置き換え後のスコープと security 方針の差分ドラフトは **058s の「スパイク結果」節**を正とする。
> 内容を変更していないのは 057a〜057c と同じ作法（書き直すのは着手時）。**
> 分割・線引きは親 [058](058-stream-audio-routing.md) を正とする。
>
> **必読前提**: 親 [058](058-stream-audio-routing.md)、**方式決定 [058s](058s-audio-output-device-spike.md)（着手条件）**、
> [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`AudioContext` の所有者）、
> [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`playWav`）、
> UI 設定の保存作法 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) と
> [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)（項目名＝13px/700・説明＝`--muted`）、
> [`docs/security.md`](../security.md)（§1／§4／§9／§10／レビュー必須条件）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[058s](058s-audio-output-device-spike.md) の結論が ① または ②**。③（機能を出さない）なら本タスクは着手しない。

## 目的

「配信に載せる／載せない」を**音の種類ごとに**指定できるようにするための**共通基盤**を作る。
本タスクの成果物は「出力先を選ぶ設定」と「その設定を再生経路へ差し込む口」であり、
どの音に適用するかは [058b](058b-voicevox-stream-output-toggle.md) と [059](059-notification-sounds.md) が決める。

## 現在の前提（調査結果・実コード）

- 音出しの実体は `playWav` の `src.connect(ctx.destination)` の 1 か所のみ。`ctx` の出どころは 2 系統:
  - **読み上げ本線** = `createTtsQueue` が所有する単一 `AudioContext`（`dispose` で `close`）
  - **試聴** = [`voicevoxPreview.ts`](../../apps/desktop/src/features/comment-viewer/voicevoxPreview.ts) の別インスタンス
- 出力デバイスを選ぶ仕組みは**存在しない**（`setSinkId` / `enumerateDevices` の使用ゼロ）。
- 設定値の保存は **localStorage の `stream-dock.*` 名前空間**が確立された作法
  （`load*` / `save*` のペア関数・例外は握りつぶし・不正値は既定へフォールバック）。
  `tauri-plugin-store` は使っていない。
- 設定 UI は [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) にカード単位で並ぶ。
  [054](054-comment-viewer-settings-readability.md) で**書式の階層規則**が確定している
  （項目名＝`.fieldLabel` 13px/700/`var(--text)` ／ 説明＝`.note` `var(--muted)` ／ `--text-faint` は無効状態専用）。
  **新しい値を発明せず既存トークンを使うこと。**
- 別窓（オーバーレイ）との設定同期は `storage` イベント購読が既存の作法だが、
  **音は コメビュ窓でしか鳴らない**ので本タスクでは窓間同期は不要。

## このタスクでやること

> ⚠ 以下は **[058s](058s-audio-output-device-spike.md) の結論が ①（Web 側 `setSinkId`）** の場合の記述。
> ② に倒れた場合は (2)(3) が Rust 側実装へ置き換わり、**security-review 必須**になる（下記「② の場合の差分」参照）。

### (1) 出力先の語彙を決める（新規 `audioRouting.ts`）

- `features/comment-viewer/audioRouting.ts` を新設し、**「配信に載せる／載せない」を出力デバイス選択に還元する**
  語彙をここに閉じる。
  - `AudioRoute = "monitor" | "stream"` — `monitor`＝配信者だけが聴く（既定デバイス）、`stream`＝配信に載せる
  - `STREAM_OUTPUT_DEVICE_KEY = "stream-dock.comment-viewer.stream-output-device"` — `stream` 側の
    出力デバイス ID（未設定なら「未構成」＝`stream` を選んでも既定デバイスへ落ちる）
  - `loadStreamOutputDeviceId()` / `saveStreamOutputDeviceId(id)` — 既存の `load*`/`save*` 作法どおり
  - `listAudioOutputDevices()` — `navigator.mediaDevices.enumerateDevices()` を `kind === "audiooutput"` で絞る。
    **ラベルが空文字のデバイスは「名前不明のデバイス」ではなく除外**し、0 件なら「デバイスを選べません」と
    UI に出す（058s (1) でラベルが取れないと判明した場合の逃げ道）。
- **`AudioRoute` ごとの設定値は本ファイルに置かない**。「読み上げを載せるか」「通知音を載せるか」は
  それぞれ [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) と 059 の prefs が持つ
  （＝本ファイルは**出力先の解決だけ**を担い、誰がどう使うかは知らない）。

### (2) 再生経路への差し込み口を作る

- `applyRoute(ctx: AudioContext, route: AudioRoute): Promise<void>` を `audioRouting.ts` に置く。
  `route === "stream"` かつデバイス ID が設定済みなら `ctx.setSinkId(id)`、それ以外は何もしない（既定デバイス）。
- **失敗は握りつぶして既定デバイスへ落とす**（`setSinkId` が投げる／未対応／デバイスが抜かれた）。
  音が鳴らなくなるより、意図と違うデバイスから鳴るほうがマシ＝配信中に無音になる事故を作らない。
  ただし**失敗したことは UI に出す**（(4) のステータス表示）。
- ⚠ **`AudioContext` は使い回される**（`createTtsQueue` が 1 つ所有し続ける）ので、`applyRoute` は
  **設定変更のたびに呼べる冪等な関数**にする。再生のたびに呼ぶ設計にしない（`setSinkId` は非同期で、
  再生直前に呼ぶと 1 件目が旧デバイスから出る）。

### (3) `ttsQueue` / `voicevoxPreview` への接続

- `createTtsQueue` の `TtsQueueOptions` に **`getRoute?: () => AudioRoute` を getter として足す**
  （`getReadingRules` / `getMaxLength` / `getSpeechText` と同じ作法＝**その時点の設定を読む**）。
  キューは自分が所有する `ctx` に対して `applyRoute` を呼ぶ。
- **試聴（`voicevoxPreview`）にはルーティングを効かせない**（親 058 の決定）。試聴は「話者の声を確かめる」操作で、
  配信に載せる必要がない。**この判断はコメントに残す**（後から「試聴も載せたい」と言われたときの再修正トリガー）。

### (4) 設定 UI（`SettingsView.tsx` に「音声出力」カードを新設）

- カード内容:
  - **配信に載せる音の出力先**（`<select>`。`listAudioOutputDevices()` の結果＋「未選択」）
  - 選択できない環境／0 件のときの説明文（`.note`）
  - 直近の `applyRoute` が失敗していたら、その旨の 1 行（`role="status"`）
- ⚠ **「載せる／載せない」のトグルそのものはここに置かない**。読み上げのトグルは
  [058b](058b-voicevox-stream-output-toggle.md) が VOICEVOX カードへ、通知音のトグルは 059 が通知音カードへ置く
  （＝**設定は機能の隣に置く**。045b/054 で確立した「操作は使う場所の近くへ」の方針に従う）。
- 書式は [054](054-comment-viewer-settings-readability.md) の規則に従う（項目名＝`.fieldLabel` / 説明＝`.note` /
  `--text-faint` は無効状態専用）。**新しい px / weight を発明しない。**

### (5) テスト

- `audioRouting.test.ts` を新設し、**純関数部分**を固定する:
  - `loadStreamOutputDeviceId` の未保存 / 不正値 / 例外フォールバック（`overlaySettings.test.ts` と同型）
  - `listAudioOutputDevices` がラベル空文字を除外すること（`navigator.mediaDevices` はモック）
  - `applyRoute` が `monitor` では `setSinkId` を呼ばないこと／`stream` かつ ID 未設定でも呼ばないこと／
    `setSinkId` が reject しても throw しないこと
- `ttsQueue.test.ts` に **`getRoute` を注入したときに `applyRoute` 相当が呼ばれる**ケースを 1 本足す
  （`getMaxLength` の注入テストが「注入した getter が実際に効くこと」を固定している先例と同型。
  ⚠ **getter を足しただけで効いていない、という穴を必ず塞ぐこと**）。
- **ミューテーションで実効性を確認する**（既存タスクの慣習）。最低限、`applyRoute` の
  `route === "stream"` 判定を反転させたときにレッドになること。

### (6) ② に倒れた場合の差分（Rust 側再生）

- `audioRouting.ts` は **invoke の薄いラッパ**になり、実体は Rust の新規モジュール（例 `audio/`）へ移る。
- `Cargo.toml` に `rodio`（等）を追加し、**[`docs/security.md`](../security.md) §10 に理由を記録**。
  §4（OS 操作）にも音声デバイスを扱う旨を追記する。
- コマンドは**単一目的の狭いもの**に留める（§3）。`play_arbitrary_file(path)` のような汎用は作らない。
  想定は `list_audio_output_devices()`（read-only）と `play_sound(kind, route)`（同梱音源 ID の enum を受ける）の 2 本。
- **VOICEVOX の WAV をどう Rust へ渡すか**を決める（現在は webview の `fetch` が受けている）。
  ここが 058b のスコープを大きく変えるので、**058s の段階で見積もっておくこと**。
- → この場合は **security-review 必須**。

## このタスクでやらないこと

- **音の追加**（通知音は [059](059-notification-sounds.md)）。本タスクは既存の読み上げ音を別デバイスへ出せるようにするだけ。
- 読み上げへの適用（[058b](058b-voicevox-stream-output-toggle.md)）。本タスクは `getRoute` の口を開けるまで。
- 音量調整・正規化・ダッキング（読み上げ中に通知音を絞る等）。
- 仮想オーディオデバイスの自動インストール・導入支援。**案内文言のみ**（それも 058b で）。
- マイク入力・`getUserMedia`。**呼ばない。**
- 窓間の設定同期（音はコメビュ窓でしか鳴らない）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。デバイス列挙・音声出力で新しい宛先は増えない。VOICEVOX は既存 loopback のみ。
- **`getUserMedia` を呼ばない。** マイク権限を要求しない。ラベルが取れない環境は「選べない」として扱う。
- **デバイス名・デバイス ID をログ／外部へ出さない**（§9）。localStorage に置くのは選択されたデバイス ID のみで、
  これは**ユーザー自身の UI 設定値**＝§9 追補（046a）が対象とする第三者の個人データではない
  （`OBS_AUTO_ADD_KEY` と同種の非機密値）。
- **capability を増やさない。** ①（Web 側）なら webview 内で完結する。
- **① なら新規依存ゼロ。** ② に倒れた場合のみ §10 に記録し `cargo audit` を通す
  （`.githooks/pre-commit` が `Cargo.lock` のステージを検知して走る）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ。

## 完了条件

- `audioRouting.ts`（新規）に出力先の語彙・保存・列挙・`applyRoute` が閉じており、`ttsQueue` に `getRoute` の口が開いている。
- 設定ビューに「音声出力」カードがあり、デバイスを選べる（選べない環境ではその旨が出る）。
- `applyRoute` の失敗が**音を止めない**（既定デバイスへ落ちる）ことと、失敗が UI に出ることが確認できる。
- `audioRouting.test.ts` の新規テストと `ttsQueue.test.ts` の注入テストが通り、**ミューテーションで実効性を確認**している。
- ①の場合: **新規依存ゼロ・新規 capability ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変**。
- ②の場合: [`docs/security.md`](../security.md) の §4／§10 が更新され、security-review を通っている。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（①の場合は差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/
# 新規依存ゼロの担保（①の場合は差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock

# ②の場合のみ
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo audit -f apps/desktop/src-tauri/Cargo.lock

pnpm --filter ./apps/desktop tauri dev
# ① 設定ビューに「音声出力」カードが出る／デバイス一覧が名前つきで並ぶ（0 件ならその旨が出る）
# ② 仮想オーディオデバイスを選び、読み上げ（058b 未了なら手動で route を stream 固定して）がそのデバイスから出る
# ③ 選んだデバイスを OS から抜く → 音が止まらず既定デバイスへ落ち、UI に失敗が出る
# ④ 試聴（VOICEVOX の話者プレビュー）は常に既定デバイスから出る（ルーティングが効かない）
```

## 実装後に必要なレビュー

- **①（Web 側 `setSinkId`）の場合**: 軽レビュー（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  ただし「`getUserMedia` を呼んでいない」「デバイス ID をログに出していない」は必ず確認する。
- **②（Rust 側再生）の場合**: **security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。
  新規 crate（§10）・OS 操作の拡大（§4）・新規コマンドの権限（§3）が対象。
