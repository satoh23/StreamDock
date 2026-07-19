# 034c VOICEVOX 話者サンプルボイス試聴（選択で即再生・再生中は中断切替）

> 状態: **未着手（実装サブタスク・独立・並行可）**。分割・線引きは親 [034](034-comment-viewer-obs-ux-round2.md) を正とする。
>
> **必読前提**: 親 [034](034-comment-viewer-obs-ux-round2.md)、第1弾 [033d](033d-voicevox-speaker-select.md)
> （話者選択 UI・`GET /speakers`）、[`docs/security.md`](../security.md)（特に §1「例外（032c-c）」＝VOICEVOX
> ローカル合成のループバック `127.0.0.1:50021`・**許可メソッドの列挙**）。CLAUDE.md どおり **「実装して」まで変更せず、
> まず変更計画と対象ファイルを提示する**。既存の許可メソッド（`/audio_query`・`/synthesis`）の再利用に留める。

## 目的

設定ビューで**話者/スタイルを選ぶと、その声のサンプルが即再生**され、どんな声か分かるようにする。**サンプル再生中に
別の話者を選ぶと、再生中のサンプルを中断して新しい話者のサンプルに切り替える**。**要望2**を満たす。読み上げ本線（実コメントの
TTS）には干渉しない、独立した試聴経路として実装する。

## 現在の前提（調査結果）

- 話者/スタイル選択 UI は設定ビュー [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)
  213-254行（2 段プルダウン）。`onChange`（226-244行）は `onSpeakerIdChange`（＝親の `setSelectedSpeakerId`）を呼ぶだけで、
  **合成・再生は呼んでいない**（サンプル試聴は未実装）。
- 合成・再生プリミティブは [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) に既存:
  - `synthesize(text, speaker, signal)`（94-121行）＝ `POST /audio_query` → `POST /synthesis` で WAV(`ArrayBuffer`) を返す。
    `AbortSignal` 対応。宛先 `VOICEVOX_BASE = "http://127.0.0.1:50021"`（19行）。
  - `playWav(ctx, wav)`（127-137行）＝ Web Audio で 1 回再生。ただし `AudioBufferSourceNode`(`src`)は**関数ローカルで
    保持していない**ため、外から `src.stop()` で中断できない。
- 実コメントの読み上げは [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の FIFO キュー
  （`AudioContext` を 1 つ所有）。試聴はこの本線とは**別経路**にする（本線を止めない・干渉しない）。
- ENGINE 未起動時は話者一覧が空（`speakers.length === 0`）で選択不可の案内を出す既存挙動あり
  （[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx) 215-218行）。

## このタスクでやること

### (1) 試聴用プレイヤー（中断可能）の新設

- `apps/desktop/src/features/comment-viewer/` に**試聴専用の小さなプレイヤー**（例 `voicevoxPreview.ts`）を新設。
  「現在再生中の source と AbortController を保持し、新しい試聴要求が来たら**前の合成/再生を中断**（`AbortController.abort()`
  ＋保持した source の `stop()`）してから新しい声を再生する」責務を持つ。TTS 本線 [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)
  とは**別の `AudioContext`** を使い、キューに積まない（干渉しない）。
- 再生プリミティブは `synthesize()`/`playWav()` を再利用。中断のため **`playWav` を「作成した `AudioBufferSourceNode`
  を返す（or `onended` 前に stop できる）」形へ小改修**するか、試聴用に同等の再生関数を `voicevoxPreview.ts` 内へ持つ
  （実装時に、既存 `playWav` 呼び出し元＝ttsQueue への影響が無い方を選ぶ）。

### (2) 選択時のサンプル再生配線

- 設定ビューの話者/スタイル `onChange`（[`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)
  226-244行）から、選択後の style id で**固定サンプル文**を試聴プレイヤーへ渡して再生する。
- **固定サンプル文**は短い定型（例「こんにちは。VOICEVOXの音声サンプルです。」）を定数化。再生要求ごとに前回を中断して切替。
- ENGINE 未起動時は試聴を行わず、既存の「起動してください」案内に委ねる（例外は握って落とさない・既存 loopback fetch の作法に合わせる）。
- 試聴は「選択トリガー」のみ。必要なら小さな**試聴ボタン**（同じ声をもう一度鳴らす）を添えてよい（実装時に確定）。

## このタスクでやらないこと

- **新規 VOICEVOX エンドポイントの追加**（`/singers` の公式サンプル取得等は使わない）。既存の `/audio_query`・`/synthesis`
  の再利用のみで、`docs/security.md` §1「例外（032c-c）」の許可メソッドを**増やさない**。
- TTS 本線（実コメント読み上げ）の停止 UI・キュー改修（本線は触らない・干渉しない）。
- 話者選択 UI・`GET /speakers`（033d 済み）、速度/抑揚などの合成パラメータ調整。
- Rust 側に HTTP クライアント・音声ライブラリを追加する変更（試聴も viewer webview の fetch＋Web Audio のみ）。

## セキュリティ制約（docs/security.md 準拠・重点 §1 例外(032c-c) / §10）

- 宛先は **ループバック `127.0.0.1:50021` 不変**、使うのは**既存の許可メソッド（`POST /audio_query`・`POST /synthesis`）のみ**。
  **新規メソッド・新規宛先を追加しない**（追加不要なので security.md の許可メソッド列挙は変更しない見込み）。送るのは固定サンプル文
  のみで、コメント本文・著者名・認証情報は送らない。合成結果（WAV）は端末外へ送信しない。
- Rust 側に依存・コマンド・capability を追加しない（viewer webview の fetch＋Web Audio のみ・新規依存ゼロ・§10）。`csp: null` 不変。
- **既存の許可メソッド範囲内の再利用のため security-review は不要**の想定。ただし「新規メソッド/宛先を足していない・本線 TTS に
  干渉していない」ことは実装差分で確認する（新規宛先が混入した場合は security-review 必須へ格上げ）。

## 完了条件

- 設定ビューで話者/スタイルを選ぶと、その声のサンプルが即再生される。
- サンプル再生中に別話者を選ぶと、再生中が中断され新しい話者のサンプルへ切り替わる。
- 実コメントの読み上げ（TTS 本線）に干渉しない（試聴は別 `AudioContext`・別経路）。
- ENGINE 未起動時は試聴せず、既存の起動案内に委ねる。
- 新規 VOICEVOX メソッド/宛先・新しいライブラリ / Tauri command / capability を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 設定で話者選択→サンプル再生／再生中に別話者選択で中断切替／読み上げ本線に影響なしを目視
# ※ 試聴の確認はローカルに VOICEVOX ENGINE 起動が必要
# 宛先確認: 開発ツール Network で 50021 への POST が /audio_query・/synthesis のみ（新規メソッドが無い）こと
```

## 実装後に必要なレビュー

- security-review は原則不要（既存の許可メソッド `/audio_query`・`/synthesis` の再利用・ループバック不変）。ただし実装差分で
  **新規メソッド/宛先を足していない・TTS 本線へ干渉していない**ことを確認し、もし新規宛先/メソッドが入った場合は security-review 必須へ切り替える。
