# 033d VOICEVOX 話者選択＋「ずんだもん読み上げ」→「VOICEVOX読み上げ」改名

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [033](033-comment-viewer-ux-revamp.md) を正とする。
>
> **必読前提**: 親 [033](033-comment-viewer-ux-revamp.md)、[`docs/security.md`](../security.md)（特に §1「例外
> （032c-c）」＝VOICEVOX ローカル合成のループバック `127.0.0.1:50021`・**許可メソッドの列挙**）、先行
> [033b](033b-settings-view-connection.md)（設定ビュー）・[033c](033c-voicevox-toggle-autolink.md)（読み上げトグル）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**本タスクは
> loopback allow-list を拡張するため security-review 必須**。

## 目的

設定ビューで**読み上げる声（VOICEVOX 話者・スタイル）を選べる**ようにし、簡単に声を変えられるようにする。あわせて
「ずんだもん（の）読み上げ」表記を **「VOICEVOX読み上げ」へ統一**する（ずんだもん固定ではなくなるため）。

## 現在の前提（調査結果）

- 話者は**ハードコード**: [`voicevox.ts:26`](../../apps/desktop/src/features/comment-viewer/voicevox.ts#L26)
  `export const ZUNDAMON_NORMAL_SPEAKER_ID = 3;`。`synthesize()` の既定引数（`voicevox.ts:48` 付近）と
  [`ttsQueue.ts:84`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts#L84) で使用。**話者を選ぶ UI・設定は無い**。
- VOICEVOX クライアント [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) が叩くのは
  `GET /version`・`POST /audio_query`・`POST /synthesis` の**3 つのみ**。**`GET /speakers` は未実装**
  （リポジトリ全体で未使用）。`VOICEVOX_BASE = "http://127.0.0.1:50021"`（`voicevox.ts:19`）。
- security.md §1「例外（032c-c）」で許可メソッドが **「GET `/version`／POST `/audio_query`／POST `/synthesis`」に
  限定**と明記（[`docs/security.md:40-41` 付近](../security.md)）。`/speakers` は現状ここに含まれない。
- 「ずんだもん」表記: `CREDIT_NOTICE`（`voicevox.ts` 経由でなく `CommentViewerApp.tsx:41-42`）、`testSpeak` の固定文
  （033a で撤去済み）、033c で追加する読み上げトグルラベル等。非機密 UI 値は localStorage 永続化（033c と同方式）。

## このタスクでやること

### (1) 話者一覧の取得（`GET /speakers`）

- [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) に `fetchSpeakers()` を追加し、
  `GET http://127.0.0.1:50021/speakers` で話者＋スタイル一覧を取得する（`{ name, styles: [{ id, name }] }[]` 形）。
  既存の `checkEngineRunning`/`synthesize` と同じ loopback fetch の作法（例外を握って落とさない）に合わせる。
- ENGINE 未起動時は空一覧＋起動誘導（033c のバナー/トグルと整合）。

### (2) 話者/スタイル選択 UI ＋永続化

- 設定ビュー（033b）の VOICEVOX セクションに**話者・スタイルのセレクタ**を追加。選択値（style id）を localStorage
  永続化（033c の ttsPrefs を拡張、または隣に `speakerStorage` を新設）。
- ENGINE 起動後に一覧を取得して選択肢を埋める（起動前は前回選択値を保持・表示）。

### (3) TTS が選択話者を使う

- [`ttsQueue.ts:84`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts#L84) の固定
  `ZUNDAMON_NORMAL_SPEAKER_ID` を、**選択話者（style id）**へ差し替える。ttsQueue が選択値を参照できるよう、
  生成時オプション or getter で受け渡す（グローバル直参照を避ける）。**未選択時の既定は 3（ずんだもんノーマル）を維持**。

### (4) 「ずんだもん」→「VOICEVOX読み上げ」改名

- 読み上げ機能のユーザー向け表記を **「VOICEVOX読み上げ」**へ統一（033c で先取り済みのトグルラベルを含め残りを掃討）。
- クレジット表記 `CREDIT_NOTICE`（`CommentViewerApp.tsx:41-42`）は VOICEVOX 利用規約に基づく必須表記のため**内容は
  残す**が、選択話者に応じて「VOICEVOX:<話者名>」を促す文面に一般化してよい（規約準拠の範囲で。実装時に確定）。

## このタスクでやらないこと

- 話者プレビュー試聴（サンプル再生）などの追加機能。
- 複数話者の同時読み上げ・話者の自動切替（1 話者選択のみ）。
- `POST /audio_query`・`POST /synthesis` の追加パラメータ調整（速度・抑揚など）。
- 設定ビュー新設（033b）・読み上げトグル/自動連携（033c）・ツール管理（033e）・OBS（033f）。

## セキュリティ制約（docs/security.md 準拠・重点 §1 例外(032c-c) / §10）

- **loopback VOICEVOX allow-list に `GET /speakers` を追加する**。宛先は `127.0.0.1:50021`（ループバック）不変で、
  取得するのは**話者名/スタイル一覧のみ**（コメント本文・著者名・認証情報は送らない）。返る一覧は端末外へ送信しない。
- これに伴い **[`docs/security.md`](../security.md) §1「例外（032c-c）」の許可メソッド列挙を更新**する
  （`/version`・`/audio_query`・`/synthesis` に **`/speakers`（話者一覧・GET）** を追記）。CSP の TODO 記述
  （将来 `connect-src` に 50021 を許可）にも `/speakers` が含まれる旨を必要に応じて注記。`csp: null` 不変。
- Rust 側に HTTP クライアント・音声ライブラリを追加しない（viewer webview の fetch のみ・新規依存ゼロ・§10）。
- **security.md 本文を変更するため security-review 必須**（親 033 の表に準拠）。

## 完了条件

- 設定ビューで話者・スタイルを選べ、選択が localStorage に永続化される。
- 選択話者で読み上げられる（未選択時は既定 3＝ずんだもんノーマル）。
- ユーザー向け表記が「VOICEVOX読み上げ」に統一されている。
- `docs/security.md` §1「例外（032c-c）」の許可メソッドに `GET /speakers` が追記され、宛先はループバック不変。
- 新しいライブラリ / Tauri command / capability を追加していない。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。
- **security-review を通過**している。[`docs/progress.md`](../progress.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 設定で話者選択→選択話者で読み上げ／表記が「VOICEVOX読み上げ」／既定 3 を目視
# ※ 話者一覧取得・読み上げの確認はローカルに VOICEVOX ENGINE 起動が必要
```

## 実装後に必要なレビュー

- security-review: **loopback allow-list への `GET /speakers` 追加**が §1 例外(032c-c) の範囲（宛先ループバック限定・
  一覧のみ取得・端末外送信なし・新規依存ゼロ）に収まり、`docs/security.md` の許可メソッド列挙が実装と一致しているかを確認。
