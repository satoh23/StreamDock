# 059 通知音（コメント／投げ銭）（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 059a〜059b の**分割・線引き・実装順の正**。
>
> ⚠⚠ **2026-08-03 の [058s](058s-audio-output-device-spike.md) の結論により、通知音の再生層が変わる（申し送り）**:
> 結論は **②-軽**＝**通知音は Rust（`rodio`）で鳴らし、出力デバイスを指定する**。読み上げ（Web Audio）は無改変。
> 理由＝**webview では出力デバイスを選べないことが実測で確定**したため（macOS は `setSinkId` ごと非対応、
> Windows は `deviceId`/`label` が空で選択不能）。**Web Audio のままだと「配信に載せない」が原理的に作れない**
> （OBS はアプリ単位でしか分離できず、読み上げと通知音を区別できない）。
> → **本ファイルおよび 059a/059b の「専用 `AudioContext` で鳴らす」前提は差し替えが要る。**
> 実装形・security 方針の差分ドラフトは **058s の「スパイク結果」節**を正とする。
>
> **必読前提**: 音声ルーティングの親 [058](058-stream-audio-routing.md)（「配信に載せる」の土台）、
> 再生プリミティブ [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`playWav` / `AudioContext`）、
> TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（直列 FIFO・課金優先キュー・`resume()`）、
> 課金判定 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)（`isMonetaryEvent`）、
> 課金読み上げ [049](049-monetary-event-speech.md)、
> UI 設定の保存作法 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> [`docs/security.md`](../security.md)（§1 外部通信／§9／§10 依存）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

依頼者の要望①④のうち「音」の部分を実装する。

- **コメントが来たときに通知音**（「ポン」というような音）。ON/OFF と、**配信に載せるか**を選べる。
- **投げ銭（課金チャット）を検知したときは別の音**。同じく ON/OFF と配信に載せるかを選べる。

配信者が「画面を見ていなくてもコメントが来たことに気づける」「投げ銭は音で区別して即座に気づける」状態を作る。

## 現在の前提（調査結果・実コード）

- **通知音の実装は存在しない。** `sound` / `.mp3` / `.wav` / 効果音に相当する実装は 0 件で、
  `public/` にはフォント以外のアセットが無い（`assets/` も同様）。
- 音を鳴らすプリミティブは既にある: [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts) の
  `playWav(ctx, wav, signal)`（`ctx.decodeAudioData` → `createBufferSource` → `connect(ctx.destination)`）。
  ただしこれは**読み上げ用**で、`ttsQueue` が所有する単一 `AudioContext` に紐づいている。
- **課金イベントの判定は既にある**: `isMonetaryEvent(eventType)`（[`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)）。
  `MONETARY_EVENT_TYPES` に `superchat` / `subscription` / `membership` / `gift` / `donation` / `jewels` が入る。
  **この 1 本を通知音でも使う**（判定を 2 実装に分裂させると片方だけ更新漏れが起きる。
  036a のアバターガードが 2 実装に分裂しかけた教訓と同型）。
- `ttsQueue` は既に**課金優先キュー**（`priorityQueue`）を持ち、課金イベントを先に読む。
  通知音も課金／通常で扱いを分けるが、**キューは別系統にする**（下記「確定した方針」）。
- **autoplay の壁**: Windows は `tauri.conf.json` の `--autoplay-policy=no-user-gesture-required` で回避済み。
  macOS（WKWebView）は `ttsQueue` の `resume()`（ユーザー操作契機で呼ぶ）で凌いでいる。
  `AudioContext` が `suspended` のままだと `ttsQueue` は**その 1 件をスキップして `console.debug` を出す**設計。
  通知音も同じ壁を踏むので、**同じ回避策に相乗りする**。
- 依存は増やさない方針（desktop frontend の dependencies は 5 個だけ）。

## 確定した方針

- **音源はアプリ同梱**。外部 CDN・外部 URL は参照しない（[`docs/security.md`](../security.md) §1／CSP 方針）。
  形式と置き場所は 059a で決める（候補＝`src/assets/` に置いて Vite に取り込ませる ／ base64 定数として
  TS に埋める。**後者なら `public/` の運用も Vite の asset 設定も触らずに済む**）。
- **通知音のキューは読み上げとは別系統**。理由＝通知音は「コメントが来た瞬間」に鳴らないと意味がなく、
  読み上げの直列 FIFO（1 件ずつ完了を待つ）に載せると数十秒遅れて鳴る。
  ただし**同じ `AudioContext` を共有するか**は 059a で決める（別 `AudioContext` を増やすと autoplay 解除も 2 系統になる）。
- **レート制限は必須。** コメントが 10 連投したら 10 回鳴る、は実用にならない。
  「直近 N ミリ秒以内に鳴っていたら鳴らさない」の単純なクールダウンで足りる（059a で値を決める）。
  ⚠ **これはテストで固定する**（連投時に 1 回しか鳴らないこと）。
- **コメント通知音と投げ銭通知音は排他**。課金コメントが来たとき、コメント音と投げ銭音の**両方を鳴らさない**
  （投げ銭音だけ鳴らす）。二重に鳴ると「別の音にした」意味が消える。
- **「配信に載せる」は [058a](058a-audio-routing-foundation.md) の `AudioRoute` に相乗りする**。
  059 側で独自のデバイス選択は作らない。**058a 未了なら、トグル抜きで先行実装してよい**（後述）。
- 設定値は非機密の UI 値なので [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts) と
  同方式の localStorage（`stream-dock.comment-viewer.*` 名前空間）。§9 の対象外。

### 決めること（各子タスクで確定）

| 論点 | 決める場所 |
|---|---|
| 音源の形式・置き場所（同梱アセット / base64 定数） | 059a |
| クールダウンの値（ミリ秒） | 059a（実機で「うるさくない」と感じる値に調整） |
| 音量調整 UI を出すか（既定音量固定で済ませるか） | 059a |
| 投げ銭音を金額で出し分けるか（一律 1 種類か） | 059b（**既定は一律 1 種類**。金額ティアは [061](061-obs-effects.md) のエフェクト側の仕事） |

## 子タスクと線引き

| 子 | 内容 | 層 | 外部通信（新規） | レビュー |
|---|---|---|---|---|
| [059a](059a-comment-notification-sound.md) | 通知音の基盤（音源・再生・クールダウン・設定）＋**コメント通知音** | frontend | なし | 軽レビュー |
| [059b](059b-monetary-notification-sound.md) | **投げ銭通知音**（別音・課金判定・コメント音との排他） | frontend | なし | 軽レビュー |

- **059a が土台**（音を鳴らす仕組み・クールダウン・設定の作法）。059b はそこに 2 音目と課金判定を足すだけ。
- 「配信に載せる」トグルは両方に付く（実体は [058a](058a-audio-routing-foundation.md) の `AudioRoute`）。

## 依存関係と推奨実装順

```
059a ──> 059b
  ↑
058a（「配信に載せる」トグルのみ依存。音を鳴らす部分は非依存）
```

- ~~**059a は [058s](058s-audio-output-device-spike.md) の前でも着手できる**（音を鳴らすだけなら既存の Web Audio で足りる）~~
  → ⚠ **2026-08-03 に無効化。** 058s の結論（②-軽）により**通知音の再生層は Rust（`rodio`）**になる。
  Web Audio で先行実装すると**後で必ず作り直しになる**（Web Audio では出力デバイスを選べず「配信に載せない」が作れないため）。
  **058a（Rust 側の列挙＋再生の基盤）を先に済ませてから 059a に入ること。**
- ⚠ **[058s](058s-audio-output-device-spike.md) は ③ には倒れなかった**（結論＝②-軽）。
  「配信に載せる」トグルは**通知音には付く**が、**読み上げには付かない**（[058b](058b-voicevox-stream-output-toggle.md) は保留）。

## 横断セキュリティ方針（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。音源はアプリ同梱で、CDN・外部 URL を参照しない。CSP 方針（外部 media を読み込まない）不変。
- **新規依存ゼロ**。音の再生は既存の Web Audio API で完結する（音声ライブラリを入れない）。
- 追加する localStorage キーは**ユーザー自身の UI 設定値**（ON/OFF・音量）で、§9 追補（046a）が対象とする
  第三者の個人データ（コメント本文・表示名・金額）ではない。**通知音の実装でコメント本文を保存しない。**
- **Rust・sidecar・capabilities・`tauri.conf.json` はすべて差分ゼロ**の見込み（frontend のみ）。`csp: null` 不変。
- 音源ファイルを同梱する場合は**ライセンスを確認して記録する**（自作 or CC0 等の再配布可能なもの）。
  ⚠ 第三者の効果音素材を無断で同梱しない。出所と条件を [`docs/progress.md`](../progress.md) に残すこと。

## 完了条件（親）

- 059a〜059b のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 059 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。

## このタスク（親）でやらないこと

- コード実装（059a〜b それぞれで行う）。
- **出力デバイスの選択・ルーティングの実装**（[058](058-stream-audio-routing.md)）。059 は `AudioRoute` を使う側。
- **視覚エフェクト**（[061](061-obs-effects.md)）。投げ銭を配信画面に出すのはそちら。
- ユーザーが自分の音源ファイルを差し替える機能（将来タスク。まずは同梱音で出す）。
- 読み上げ（VOICEVOX）の変更。通知音と読み上げは独立して鳴る。
- 音量の正規化・ダッキング（読み上げ中に通知音を絞る等）。

## 実装後に必要なレビュー

- 059a / 059b とも **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  frontend のみ・新規通信ゼロ・新規依存ゼロ・非機密の設定値のみのため。
- ⚠ ただし**音源のライセンス確認**だけは軽レビューの外で必ず行うこと（コードの問題ではないが配布物に入る）。
