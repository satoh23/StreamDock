# 058b VOICEVOX 読み上げの「配信に載せる」設定

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [058](058-stream-audio-routing.md) を正とする。
>
> **必読前提**: 親 [058](058-stream-audio-routing.md)、**基盤 [058a](058a-audio-routing-foundation.md)（`AudioRoute` / `applyRoute` / `getRoute` の正）**、
> 読み上げ設定の保存 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> [`docs/security.md`](../security.md)（§1／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[058a](058a-audio-routing-foundation.md) 完了**。

## 目的

依頼者の要望②「VOICEVOX 読み上げについて、**配信に音を載せるかどうかの設定項目**を追加したい」を実装する。
[058a](058a-audio-routing-foundation.md) が用意した `AudioRoute` を、読み上げ 1 系統に適用するだけの薄いタスク。

## 現在の前提（調査結果・実コード）

- 読み上げ関連の設定はすべて [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) が
  localStorage で持つ（`tts-enabled` / `voicevox-autolink` / `speak-twitch` / `speak-youtube` / `tts-max-length`）。
  **`load*` / `save*` のペア関数・例外は握りつぶし・不正値は既定へフォールバック**が確立した作法。
- `createTtsQueue` は `TtsQueueOptions` の getter 群（`getReadingRules` / `getMaxLength` / `getSpeechText`）を
  **`enqueue` のたびに呼んでその時点の設定を読む**設計。[058a](058a-audio-routing-foundation.md) が
  同じ作法で `getRoute` を足している。
- 設定 UI の VOICEVOX 関連は `SettingsView.tsx` の読み上げカードに集まっている
  （読み上げ ON/OFF・話者選択・試聴・サイト別フィルタ・最大文字数）。
- ⚠ **既定値の設計判断が要る**: 既存ユーザーは現在「OS 既定デバイスへ出る」＝OBS のデスクトップ音声設定次第で
  配信に載っている。ここで既定を `stream` にすると、**デバイス未選択なら既定デバイスへ落ちる**（058a の仕様）ので
  挙動は変わらない。既定を `monitor` にしても同じく既定デバイスへ出る。
  → **どちらでも既存挙動は不変**だが、**ユーザーが「配信に載せる」を選んだのに出力先未設定で載らない**、という
  ねじれが起きうる。UI で必ず解消すること（下記 (2)）。

## このタスクでやること

### (1) 設定値の追加（`ttsPrefs.ts`）

- `TTS_STREAM_OUTPUT_KEY = "stream-dock.comment-viewer.tts-stream-output"` を追加。
  `loadTtsStreamOutput(): boolean` / `saveTtsStreamOutput(enabled: boolean): void` を既存作法どおり実装
  （未保存・不正値・例外はすべて既定へフォールバック）。
- **既定は `false`（配信に載せない）**。理由＝「勝手に配信へ音を足さない」ほうが安全側で、
  058a の仕様上どちらの既定でも既存挙動は変わらないため、意味論として安全な側を採る。
  ⚠ **この判断は JSDoc に残す**（`OBS_AUTO_ADD_KEY` 等が既定 OFF の理由を書いている先例と同型）。

### (2) 設定 UI（読み上げカードへ 1 項目追加）

- 読み上げカードに **「読み上げを配信に載せる」トグル**を足す（`ToggleSwitch` を再利用）。
- ⚠ **出力先が未設定のときの導線が必須**。ON にしたのに [058a](058a-audio-routing-foundation.md) の
  「配信に載せる音の出力先」が未選択だと、**設定した気になって載らない**という最悪の体験になる。
  対処＝ON かつ出力先未設定なら、トグルの直下に `.note` で
  「出力先が未選択です（音声出力の設定で選んでください）」を出す。
  **音声出力カードへ画面内で移動させる導線は付けない**（054 の E2E 追補②で「カード間の導線文言は削除」と
  決めた経緯があるため。同じカード群の中なので探せる）。
- 書式は [054](054-comment-viewer-settings-readability.md) の規則どおり（項目名＝`.toggleLabel` /
  説明＝`.note` / `--text-faint` は無効状態専用）。**新しい px / weight を発明しない。**

### (3) キューへの接続（`CommentViewerApp.tsx`）

- `createTtsQueue` に渡す `getRoute` を `() => (loadTtsStreamOutput() ? "stream" : "monitor")` にする。
  **getter なので「その時点の設定」が読まれる**＝トグルの切り替えが次の読み上げから効く。
- ⚠ **`applyRoute` は設定変更のたびに呼ぶ**（058a の仕様）。トグル操作時に呼ぶ effect を足すこと。
  再生直前に呼ぶ設計にすると 1 件目が旧デバイスから出る（058a に記載済みの罠）。

### (4) テスト

- `ttsPrefs.test.ts` に新キーの load/save（未保存・不正値・例外）を足す（既存ケースと同型）。
- `SettingsView` のテストにトグルの存在と、**出力先未設定時に注意文が出る**ことを足す。
- ⚠ **「ON にしたのに載らない」を防ぐ注意文は、テストで固定しないと静かに消える**ので必ず 1 ケース入れる。
- ミューテーションで実効性を確認（既定値を `true` に反転させたときにレッドになること）。

## このタスクでやらないこと

- **出力デバイスの選択 UI**（[058a](058a-audio-routing-foundation.md)）。本タスクは「載せるか」のトグルだけ。
- **通知音への適用**（[059a](059a-comment-notification-sound.md) / [059b](059b-monetary-notification-sound.md)）。
- 試聴（`voicevoxPreview`）へのルーティング適用（親 058 の決定で**効かせない**）。
- 音量調整・ダッキング・読み上げ速度などの音声パラメータ。
- 仮想オーディオデバイスの導入支援（案内文言のみ）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。VOICEVOX は既存の loopback `127.0.0.1:50021` のみで、新規宛先なし。
- 追加する localStorage キーは**ユーザー自身の UI 設定値**（bool 1 個）＝§9 追補（046a）が対象とする
  第三者の個人データではない。`OBS_AUTO_ADD_KEY` / `PINNED_OVERLAY_ENABLED_KEY` と同種の非機密トグル値。
- **frontend のみ**の変更。Rust・sidecar・capabilities・`tauri.conf.json`・依存はすべて差分ゼロ。
- `csp: null` 不変。

## 完了条件

- 読み上げカードに「読み上げを配信に載せる」トグルがあり、切り替えると次の読み上げから出力先が変わる。
- ON かつ出力先未設定のとき、**注意文が出る**（設定した気になって載らない事故を防ぐ）。
- 既定は OFF で、**既存ユーザーの挙動が変わらない**。
- `ttsPrefs.test.ts` / `SettingsView` のテストが追加され通る。ミューテーションで実効性を確認している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・`csp: null` 不変・新規 capability ゼロ。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① トグルを ON → 出力先未選択なら注意文が出る
# ② 音声出力で仮想デバイスを選ぶ → 注意文が消え、読み上げがそのデバイスから出る（既定デバイスからは出ない）
# ③ トグルを OFF → 読み上げが既定デバイスへ戻る（配信者にだけ聴こえる）
# ④ OBS の音声メーターで、①③ のときに読み上げが載らず、② のときに載ることを確認
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  frontend のみ・新規通信ゼロ・非機密トグル 1 個の追加のため。
