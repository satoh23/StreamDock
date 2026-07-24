# 041 コメビュ読み上げ 読み替え辞書（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 041a〜041b の**分割・線引き・実装順の正**。
>
> **必読前提**: TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（唯一の整形点 `sanitizeForSpeech`・29-35 行／話者 getter `getSpeakerId` 注入・49-53,96 行）、
> VOICEVOX 合成 [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`/audio_query`・`/synthesis`・loopback 50021）、
> 設定の localStorage 流儀 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)・[`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)（レジストリ＋別窓 `storage` 購読同期）、
> 設定 UI [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)・状態保持 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> [`docs/security.md`](../security.md)（§1 外部通信／§3 最小権限／§8 入力検証／§10 依存／CSP 方針）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

コメビュのずんだもん（VOICEVOX）読み上げで、**一般語の読み間違いを減らし**、さらに**ユーザー自身が読み方を追加/変更/削除**できるようにする。ユーザー登録の読みは一般辞書を**上書きして最優先**とする。

対象とする不満:

1. **一般的な読み間違い**: 「ww」→「ダブリューダブリュー」、「チャットgpt」→「チャットグプト」など、ネットスラング・英語/略語が正しく読まれない。
2. **ユーザー独自の読み替え**: 特定単語の読みをユーザーが編集でき、一般辞書より優先される。

## 現在の前提（調査結果・実現性の限界）

- **誤読の原因は VOICEVOX（内部 OpenJTalk）の読み推定**。アプリ側はコメント本文をほぼ生で VOICEVOX に渡している。前処理は [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts) の `sanitizeForSpeech`（URL 除去・絵文字除去・空白畳み込み）のみで、英字→カタカナ変換・辞書・user_dict 登録は**一切ない**。→ 読み替えを足す唯一の整形点はここ。
- `sanitizeForSpeech` は `enqueue`（`ttsQueue.ts:113`）から呼ばれる純関数。キューは話者を `getSpeakerId?()` **getter** で受け取り、選択変更のたびにキューを作り直さずライブ反映する（`ttsQueue.ts:49-53,96`）。**読み替え辞書も同じ getter 注入でライブ反映できる**。
- コメビュ設定は全て **localStorage**（名前空間 `stream-dock.comment-viewer.*`）。`load*/save*`＋例外握りつぶし＋既定フォールバックの定型（`ttsPrefs.ts`）、レジストリ＋別窓 `storage` 購読同期（`overlaySettings.ts`）が既にある。SQLite 基盤（tools/presets/038a）も別途あるが、コメビュ設定は全て localStorage。
- 設定 UI は `SettingsView.tsx`（カード羅列・props 駆動）、状態保持は `CommentViewerApp.tsx`。リスト編集 UI の既存例は add-tool / preset-items。
- **「車輪の再発明回避」の結論**: ライセンス明快で万能な配布辞書は見つからない。参考にするのは「**TTS へ渡す前にテキストを置換する**」という一般的な**手法（アイデア）**のみ（棒読みちゃん等が採る方式・著作権保護の対象外）。VOICEVOX 内部の読み推定を丸ごと再実装（形態素解析器＋大型辞書の追加）はしない。VOICEVOX 公式ユーザー辞書 API（`/user_dict*`）は将来オプションとして認識するのみ（今回は使わない）。

## 確定した方針

- **保存先 = localStorage**（既存コメビュ設定と同方式・frontend 完結・security-review 軽）。内蔵の一般辞書は**コード同梱の固定モジュール**（自前の独自データ）。
- **適用方式 = 自前テキスト置換**（`sanitizeForSpeech` で辞書を適用してから VOICEVOX へ渡す）。VOICEVOX のグローバル状態は変更しない。反復（`wwww`）・記号は正規表現エントリで扱える。アクセントは VOICEVOX が読みから再推定する（コメント読み上げ用途では十分）。
- **優先順位 = ユーザー辞書 > 内蔵一般辞書 > VOICEVOX 既定**。同 surface はユーザー定義が必ず上書きする。
- **VOICEVOX ユーザー辞書 API 連携は今回やらない**（将来オプション。アクセント最良だがエンジンのグローバル辞書を書き換える副作用・接続時同期が必要）。

## サブタスク分割

| ID | 内容 | 外部通信（新規） | security-review |
|----|------|-----------------|-----------------|
| [041a](041a-reading-dictionary-engine-and-builtin.md) | 読み替え適用エンジン（`readingDictionary.ts`）＋内蔵一般辞書（自前データ）＋`ttsQueue.ts` へ getter 注入で組み込み（要求1） | なし | 軽 |
| [041b](041b-user-reading-dictionary-ui.md) | ユーザー辞書 CRUD（localStorage 永続）＋内蔵とのマージ（最優先上書き）＋設定 UI の行エディタ（要求2） | なし | 軽 |

## 依存関係と推奨実装順

```
041(本設計) → 041a → 041b
```

- **041a** で適用エンジンと内蔵辞書を作り、`ttsQueue` に getter 注入で組み込む（この時点で「ww/ChatGPT」等が直る）。
- **041b** で `getReadingDictionary` が返す辞書を「ユーザー辞書 → 内蔵辞書」の順にマージし、ユーザー登録を最優先で重ねる＋編集 UI を足す。

## ライセンス/知的財産の扱い（重要）

VOICEVOX の「解析・再実装・データ流用」は**一切しない**。各サブタスクもこの線引きを守る。

- **VOICEVOX には手を触れない**: 逆コンパイル・解析・音声/読み推定エンジンの再実装をしない。既存どおり**公開 HTTP API のクライアントとして使うだけ**（`/audio_query`・`/synthesis`。宛先 loopback 50021 は既存 allow-list）。VOICEVOX 本体/辞書の再配布もしない。
- **追加するのは「渡す前のテキスト整形」だけ**: コメント本文を VOICEVOX に渡す前に自前の置換テーブルを適用する層。VOICEVOX の内部挙動を模倣するものではない。
- **辞書データは自前の独自データ**: 内蔵辞書は自分たちで書き起こす。棒読みちゃん・第三者配布辞書・VOICEVOX 同梱辞書の**データやコードを転載/流用しない**。参考にするのは「TTS 前に置換する」という手法（アイデア）のみ。
- **外部辞書の DL/同梱をしない**（§1）。ユーザー辞書はユーザー自身が入力した内容のみ。

## 横断セキュリティ方針（docs/security.md 準拠）

- **frontend の表示・設定追加のみ**。外部通信宛先・API・capability・依存・CSP を増やさない（§1/§3/§10・`csp: null` 不変）。純粋なテキスト置換で、通信は既存の loopback 50021（VOICEVOX）のまま。
- localStorage は**非機密の UI 設定のみ**（`overlaySettings.ts` 既存方針）。外部送信しない。
- ユーザー入力（surface/reading）は frontend で trim・制御文字/長さ検証（§8。今回は Rust を経由しない frontend 完結データのため frontend 側検証で足りる）。
- 取得コメントを Rust の DB/ログに出さない（§9・既存踏襲）。

## 完了条件

- 041a〜041b のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 041 系が追記され、**localStorage＋自前テキスト置換・優先順位ユーザー>内蔵・security-review 軽・VOICEVOX user_dict は将来**という前提が明記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する。

## このタスク（親）でやらないこと

- コード実装（041a〜b それぞれで「実装して」後に行う）。
- VOICEVOX ユーザー辞書 API（`/user_dict*`）連携（将来オプション）。
- 形態素解析器（lindera/vibrato 等）＋大型読み辞書の追加（§10・VOICEVOX 内部処理の再実装）。
- SQLite への保存・Rust 側変更・sidecar 変更・オーバーレイ/表示ロジックの変更。
- 外部からの辞書ダウンロード（§1）・CSV 一括インポート（将来検討）。
