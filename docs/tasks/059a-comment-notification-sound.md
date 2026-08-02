# 059a 通知音の基盤＋コメント通知音

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [059](059-notification-sounds.md) を正とする。
>
> **必読前提**: 親 [059](059-notification-sounds.md)、
> 再生プリミティブ [`voicevox.ts`](../../apps/desktop/src/features/comment-viewer/voicevox.ts)（`playWav`）、
> TTS キュー [`ttsQueue.ts`](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts)（`AudioContext` の所有・`resume()`・suspended 時の扱い）、
> コメント受信の合流点 [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)、
> 差分検出 [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)（`{ next, added, updated }`）、
> UI 設定の保存作法 [`ttsPrefs.ts`](../../apps/desktop/src/features/comment-viewer/ttsPrefs.ts)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> ルーティング [058a](058a-audio-routing-foundation.md)（「配信に載せる」を付ける場合のみ）、
> [`docs/security.md`](../security.md)（§1 外部通信／CSP 方針／§9／§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

依頼者の要望①「**コメントが来たときに通知音**（「ポン」というような音）を出す」を実装する。
あわせて [059b](059b-monetary-notification-sound.md)（投げ銭音）が乗る**通知音の基盤**をここで作る。

## 現在の前提（調査結果・実コード）

- **通知音の実装は 0 件。** `public/` はフォントのみで音源アセットは無い。
- 音を鳴らす手本は `playWav`（`ctx.decodeAudioData` → `createBufferSource` → `src.connect(ctx.destination)`）。
  ただし `playWav` は **`AbortSignal` で打ち切れる読み上げ用**で、シグネチャも用途も通知音とは違う。
  **`playWav` を通知音に流用しない**（読み上げの打ち切り契約を通知音が背負う理由がない）。
- `AudioContext` は `createTtsQueue` が 1 つだけ所有している。**通知音がこれを借りるか、別に持つか**が
  本タスク最大の設計判断（下記 (2)）。
- **autoplay の壁**: `AudioContext` は `suspended` で始まりうる。`ttsQueue` は
  「running でなければその 1 件をスキップして `console.debug`」という設計で、`resume()` を
  ユーザー操作契機で呼ぶことで解除している。Windows は `tauri.conf.json` の
  `--autoplay-policy=no-user-gesture-required` があるが **macOS（WKWebView）には効かない**。
- 新着コメントの検出点は既にある: `mergeComments(prev, incoming)` が **`added`** を返す
  （`{ next, added, updated }`。`updated` は 043e の Jewels combo 限定）。
  `CommentViewerApp` はこれを使って読み上げ・視聴者記録へ流している。
  **通知音も `added` に相乗りする**（新しい差分検出を発明しない）。
- 設定値は localStorage の `stream-dock.comment-viewer.*` 名前空間が確立された作法。

## このタスクでやること

### (1) 音源を用意して同梱する

- 「ポン」という短い通知音（**0.1〜0.3 秒程度**）を用意する。
- ⚠ **ライセンスを必ず確認して記録する**。自作、または CC0 / パブリックドメイン等の**再配布可能なもの**に限る。
  出所と条件を [`docs/progress.md`](../progress.md) に残す（配布バイナリに入るため）。
  第三者の効果音素材を条件未確認で同梱しない。
- 置き場所は次のどちらかを選ぶ。**理由をコメントに残すこと。**
  - **(a) base64 定数を TS に埋める**（例 `features/comment-viewer/sounds.ts` に `data:audio/...` 文字列）。
    - 利点＝`public/` の運用も Vite の asset 設定も**一切触らない**。036 系のアイコン data URI と同じ作法で、
      「webview が踏むのは data URI のみ」という既存の不変条件とも整合する。
    - 欠点＝ソースが大きくなる（数十 KB）。
  - **(b) `src/assets/` に置いて Vite に取り込ませる**（`import pon from "./pon.wav"`）。
    - 利点＝ソースが読みやすい。欠点＝バンドル設定の面が増える。
  - **推奨は (a)**。短い音なので容量が小さく、既存の data URI 作法に乗れるため。

### (2) 通知音の再生基盤（新規 `notificationSound.ts`）

`features/comment-viewer/notificationSound.ts` を新設し、次を閉じる。

- **`AudioContext` は `ttsQueue` のものを借りない**。理由＝`ttsQueue` は `dispose()` で `close()` するので、
  読み上げを止めたら通知音も死ぬ。逆に通知音のために `ttsQueue` のライフサイクルを変えるのは筋が悪い。
  → **通知音専用の `AudioContext` を 1 つ持つ**（`voicevoxPreview` が別 `AudioContext` を持っている先例と同型）。
  ⚠ **その代わり autoplay 解除も 2 系統になる**ので、`resume()` を公開し、
  `ttsQueue.resume()` を呼んでいるのと同じユーザー操作契機で**両方**呼ぶこと（(4) で配線する）。
- **デコードは 1 回だけ**。`AudioBuffer` をモジュール内にキャッシュし、鳴らすたびに `decodeAudioData` しない。
- **クールダウン**（レート制限）。`play()` は「直近 `COOLDOWN_MS` 以内に鳴っていたら何もしない」で早期 return する。
  - 初期値は **300ms** 程度を提案。実機で「コメント連投時にうるさくない」と感じる値に調整し、**決めた値と理由をコメントに残す**。
  - ⚠ **キューイングしない**（溜めて後から連打しない）。落とすのが正しい。
- **`suspended` のときは鳴らさずに黙って return**（`ttsQueue` と同じ扱い）。例外を投げない。
- **音量**は `GainNode` を挟んで実装する（`src → gain → destination`）。設定 UI を出すかは (3) で決める。
- 「配信に載せる」を付ける場合は [058a](058a-audio-routing-foundation.md) の `applyRoute(ctx, route)` を
  **設定変更のたびに**呼ぶ（再生直前に呼ばない＝058a に記載済みの罠）。

### (3) 設定（`ttsPrefs.ts` ではなく新規 `soundPrefs.ts`）

- ⚠ **`ttsPrefs.ts` に足さない**。あれは「読み上げ（TTS）の設定」というまとまりで、通知音は別概念。
  `features/comment-viewer/soundPrefs.ts` を新設する。
- キー（すべて `stream-dock.comment-viewer.*` 名前空間・既存作法どおり `load*`/`save*` ペア・
  未保存/不正値/例外は既定へフォールバック）:
  - `sound-comment-enabled`（既定 **false**）— コメント通知音の ON/OFF
  - `sound-volume`（既定 **0.5**）— 音量（0〜1・範囲外はクランプ）
  - `sound-comment-stream-output`（既定 **false**）— 配信に載せるか。**[058a](058a-audio-routing-foundation.md) 完了後に追加**
- **既定 OFF の理由**: 既存ユーザーの環境で、アップデート直後にいきなり音が鳴り始めるのを避ける
  （`OBS_AUTO_ADD_KEY` 等が既定 OFF なのと同じ考え方）。**この判断は JSDoc に残す。**
- **音量スライダーは出す**。通知音は「うるさい／小さすぎる」が使用可否に直結し、
  ユーザー環境（デバイス・音源）で最適値が変わるため、固定音量では実用にならない。

### (4) 配線（`CommentViewerApp.tsx` / `SettingsView.tsx`）

- `CommentViewerApp` の受信 effect で、`mergeComments` の **`added` が 1 件以上あれば `play()` を 1 回だけ呼ぶ**。
  ⚠ **`added.length` の回数だけ呼ばない**（バッチで 20 件届いたら 20 回鳴る）。クールダウンで潰れるとしても、
  意図として「1 バッチ 1 回」を明示すること。
- ⚠ **`updated`（043e の Jewels combo 更新）では鳴らさない**。同じコメントの金額が更新されただけで、
  新しいコメントではない。
- `ttsQueue.resume()` を呼んでいるユーザー操作契機で `notificationSound.resume()` も呼ぶ。
  **ここを忘れると macOS で「設定は ON なのに一度も鳴らない」**という、ログにも出ない不具合になる。
- 設定ビューに **「通知音」カード**を新設（ON/OFF トグル・音量スライダー・試聴ボタン）。
  - **試聴ボタンは必須**。ON にしても次のコメントが来るまで音が確認できないのは体験として悪く、
    音量調整もできない。VOICEVOX の話者プレビュー（[034c](034c-voicevox-speaker-preview.md)）と同じ考え方。
  - 書式は [054](054-comment-viewer-settings-readability.md) の規則どおり。**新しい px / weight を発明しない。**

### (5) テスト

- `notificationSound.test.ts`（新規）:
  - クールダウン内の 2 回目が**鳴らない**こと（`AudioContext` はモック）
  - `suspended` のとき鳴らさず例外も投げないこと
  - 音量が `GainNode` に反映されること・範囲外がクランプされること
  - `decodeAudioData` が**複数回の `play()` で 1 回しか呼ばれない**こと（キャッシュの担保）
- `soundPrefs.test.ts`（新規）: 未保存 / 不正値 / 例外のフォールバック（`overlaySettings.test.ts` と同型）
- `CommentViewerApp` 側: **1 バッチで `added` が複数あっても `play()` が 1 回**であることを固定する
  （⚠ ここを固定しないと、後から `added.forEach` に書き換わっても誰も気づかない）
- **ミューテーションで実効性を確認**する。最低限、クールダウン判定の比較演算子を反転させたときにレッドになること。

## このタスクでやらないこと

- **投げ銭通知音**（[059b](059b-monetary-notification-sound.md)）。本タスクは「コメントが来たら鳴る」1 音のみ。
  ⚠ ただし基盤（`notificationSound.ts`）は **2 音目を足せる形**にしておくこと（音源 ID を引数に取る等）。
- **出力デバイスの選択**（[058a](058a-audio-routing-foundation.md)）。
- ユーザーが自分の音源ファイルを差し替える機能（将来タスク）。
- 視覚エフェクト（[061](061-obs-effects.md)）。
- 読み上げ（VOICEVOX）の変更。通知音と読み上げは独立して鳴る（ダッキングもしない）。
- コメントの内容による出し分け（特定ワードで別の音、等）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。音源はアプリ同梱で、CDN・外部 URL を参照しない。**CSP 方針（外部 media を読み込まない）不変。**
  (1) で (a) base64 を選んだ場合、webview が踏むのは data URI のみ＝036 系の不変条件と整合する。
- **新規依存ゼロ**。再生は既存の Web Audio API で完結する（音声ライブラリを入れない）。
- 追加する localStorage キーは**ユーザー自身の UI 設定値**（bool / 数値）で、§9 追補（046a）が対象とする
  第三者の個人データではない。**通知音の実装でコメント本文・表示名を保存しない・ログに出さない。**
- **Rust・sidecar・capabilities・`tauri.conf.json`・依存はすべて差分ゼロ**。`csp: null` 不変。
- 音源のライセンスを確認し、出所と条件を記録する（配布バイナリに入るため）。

## 完了条件

- コメントが届くと通知音が鳴り、設定ビューの ON/OFF・音量・試聴が動く。既定は OFF。
- **連投時にクールダウンで間引かれる**（10 連投で 10 回鳴らない）。
- **1 バッチで複数コメントが届いても 1 回しか鳴らない。**
- `AudioContext` が `suspended` のとき例外を投げず、ユーザー操作契機の `resume()` 後に鳴る（macOS で確認）。
- 音源のライセンスが確認され [`docs/progress.md`](../progress.md) に記録されている。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・新規 capability ゼロ・`csp: null` 不変。
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
# ① 設定ビューに「通知音」カードが出る（既定 OFF）／試聴ボタンで音が鳴る／音量が効く
# ② ON にして dev-mock でコメントを流す → 1 件で 1 回鳴る
# ③ 連投（バッチ受信）で鳴りっぱなしにならない（クールダウンが効く）
# ④ アプリ起動直後（ユーザー操作前）に鳴らそうとしても例外が出ない → 一度操作すれば鳴る（macOS の autoplay 解除）
# ⑤ 043e の Jewels combo 更新（dev-mock）では鳴らない
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  frontend のみ・新規通信ゼロ・新規依存ゼロのため。
- ⚠ ただし**音源のライセンス確認**はレビューの外で必ず行うこと（コードの問題ではないが配布物に入る）。
