# 046d 固定コメントオーバーレイの OBS 自動ソース追加（044a を 2 ソースへ拡張）

> 状態: **実装済み（2026-07-29）**。実装記録は [`docs/progress.md`](../progress.md) の 046d 節を正とする。
>
> **必読前提**: [044a](044a-obs-auto-source-impl.md)（OBS 自動ソース追加の本体）、[046b](046b-pinned-overlay-window.md)（この窓の生い立ち）、
> 親 [046](046-pinned-comment-overlay.md)、[`docs/security.md`](../security.md) の「例外（044a・OBS オーバーレイソース自動追加）」。

## 経緯（先送りの撤回）

親 046 と 046b は、固定コメント専用オーバーレイの OBS 自動追加を「やらないこと（**将来タスク**）」として先送りしていた。
その結果 046b は「手動でウィンドウキャプチャを追加してください」という UI 文言で出荷され、E2E で
**「固定しても OBS に自動で反映されない」**として顕在化した。

**先送りに技術的な根拠は無かった。** 記録にあるのは「044a の枠組み拡張・将来タスク」だけで、できない理由は書かれていない。
実際の障害は `obs-client.ts` がソース名／窓名を**モジュール定数 1 組**で持っていたという実装都合のみで、
パラメータ化すれば足りる規模だった。**依頼者の意図は当初から「自動追加の対象内」**であり、
「将来タスク」と書いた時点で確認を取るべきだった（この判断ミス自体を記録として残す）。

## やること

**044a の自動追加を「1 ソース固定」から「オーバーレイ種別ごと」に一般化する。** 宛先・プロトコル・依存はすべて不変で、
差分は OBS のシーンに作られるソースが最大 2 つになる点のみ。

| 種別 | OBS ソース名 | キャプチャ対象の窓（Rust の `.title`） |
|---|---|---|
| `comments` | `StreamDock コメントオーバーレイ` | `open_comment_overlay_window`（033f） |
| `pinned` | `StreamDock 固定コメント` | `open_pinned_overlay_window`（046b） |

窓名の候補一致は `includes` なので、**片方が他方を部分文字列として含んではいけない**
（「StreamDock 固定コメント」は「StreamDock コメントオーバーレイ」を含まない＝取り違えない。046b からの必須条件）。

## 変更ファイル

| ファイル | 変更 |
|---|---|
| `apps/comment-sidecar/src/obs/obs-client.ts` | `ObsOverlayKind` と `OBS_OVERLAYS` 表を新設し、`enable`/`hide`/`ensureOverlaySource`/`findOverlayWindowItem`/`pickWgcMethodValue`/`setOverlaySceneItemEnabled` を種別でパラメータ化 |
| `apps/comment-sidecar/src/index.ts` | 制御フレーム `obs-enable`/`obs-hide` に `overlay` を追加。`parseOverlayKind` で **allow-list 正規化**（未知値・未指定は `"comments"` へ劣化＝後方互換） |
| `apps/desktop/src/features/comment-viewer/commentStream.ts` | `ObsOverlayKind` を定義し `enableObs(port, overlay)` / `hideObs(port, overlay)` へ |
| `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx` | `requestObsAutoAdd/Hide` を種別引数化。`handlePinnedOverlayToggle` が自動反映 ON のとき `enable`/`hide` を出す。固定用の猶予タイマー ref を**別に**持つ。自動反映トグル ON・パスワード保存後の再試行も両方を対象に |
| `apps/desktop/src/screens/comment-viewer/SettingsView.tsx` | 「※対象外です（手動で追加してください）」を撤回し、自動追加される旨＋自動反映 OFF 時の手動手順に差し替え |
| テスト | `commentStream.obs.test.ts`（+1）／`CommentViewerApp.toolbar.test.tsx`（旧「独立」ケースを新仕様 3 ケースへ差し替え）／`SettingsView.obs.test.tsx`（文言の期待を反転） |

## 設計判断

- **viewer からソース名・窓名を渡さない**。制御フレームに載るのは `overlay: "comments" | "pinned"` の**固定 union だけ**で、
  実際の名前は sidecar 内の `OBS_OVERLAYS` に閉じる。§3/§8「ユーザー入力が OS/外部アプリ操作へ渡る経路を作らない」を維持するため。
  `parseOverlayKind` は allow-list 方式で、未知値・未指定は `"comments"` へ落とす（044a 時点のフレームとの後方互換も兼ねる）。
- **接続契機は変えない**。「OBSに自動で反映する」が ON のときだけ OBS へ繋ぐ。OFF なら固定オーバーレイを開いても
  OBS へは一切繋がない（045c が確定させた「表示が主・自動反映は従」「明示的に有効化した時のみ接続」を維持）。
- **猶予タイマーは種別ごとに別 ref**。共有すると片方の ON がもう片方の仕掛かりを取り消してしまう。
- **ソースは削除しない**。OFF は `SetSceneItemEnabled(false)`＝非表示のみ（044a の方針を踏襲）。

## セキュリティ

**通信面は軽レビュー**（方針変更ではなく既存例外の範囲拡張）。

- **宛先・プロトコル・依存はすべて不変**: `ws://127.0.0.1:4455`（ホストピン留め＋`assertAllowedObsUrl` の 2 層）、
  obs-websocket-js、新規 npm/crate ゼロ。外部インターネット宛先は増えない。
- 増えるのは「ユーザーの OBS シーンに作られるソースが最大 2 つになる」点のみ。`docs/security.md` の
  044a 例外に 046d 節として明記した。
- capability・`csp: null`・Rust（完全同期・no-internet）はいずれも不変。OBS パスワードの扱いも不変（stdin private pipe・非ログ）。

### ⚠ データ露出面は 046b/S-1 と同格（レビュー指摘・許容根拠の依存関係）

通信面が軽レビューで足りるのは事実だが、**044a を「明示同意＋security-review 必須」の例外にした理由は通信だけではない**。
044a が定義したのは「ユーザーの OBS シーンへ StreamDock が自動でソースを作る」権限で、046d は
**その対象となる窓の集合を広げる**変更にあたる。そして増えた窓が描くのは、`docs/security.md` §9 追補（046a）が
対象とする**第三者の個人データそのもの**（表示名・本文・投げ銭金額）である。

**したがって本変更の許容根拠には 046b レビュー S-1（コメビュ本体のマウント時にピンストアを空へ倒す）が含まれる。**
S-1 が無ければ 046d は次の完成した経路になる:

> トグルの永続 ON → コメビュ本体のマウントで窓が自動 open → 自動反映 ON なら OBS ソースまで自動作成
> → **前回配信で固定した第三者の個人データが、操作ゼロで本番シーンに出る**

**再レビュー必須トリガー＝S-1 を撤回・緩和するとき**（「配信をまたいで固定を残したい」要望に応じるとき）。
そのときは `docs/security.md` §9 追補の ⚠ 節どおり「前回の固定を復元しますか」を明示操作にし、
**046d も併せて再レビューする**（自動追加されたソースが前回配信の固定を描く経路が復活するため）。

## 完了条件

- 「OBSに自動で反映する」ON の状態で「固定コメントをOBSに表示」を ON にすると、OBS に
  **「StreamDock 固定コメント」ソースが自動追加**され、固定コメントが映る。
- OFF にすると同ソースが**非表示**になる（削除されない）。
- 自動反映 OFF なら、固定オーバーレイを開閉しても OBS へは繋がらない。
- 既存の「StreamDock コメントオーバーレイ」ソースの挙動が従来どおり（別ソースとして独立）。

## 検証

```bash
pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop lint && pnpm --filter ./apps/desktop test
pnpm --filter @stream-dock/comment-sidecar typecheck
node apps/comment-sidecar/scripts/test-obs-client.mjs
node apps/comment-sidecar/scripts/test-host-guard.mjs   # loopback 限定が不変であること
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

**実機**（`COMMENT_SIDECAR_MOCK=1 pnpm tauri dev` ＋ OBS 起動・WebSocket 有効）:

- 「OBSに自動で反映する」ON →「固定コメントをOBSに表示」ON → OBS のソース一覧に
  **「StreamDock 固定コメント」が現れ**、コメントを固定すると映る
- 「固定コメントをOBSに表示」OFF → 同ソースが**非表示**になる（一覧からは消えない）
- 自動反映 OFF で固定オーバーレイを開閉 → OBS に何も起きない（`lsof -i` で 4455 接続が増えない）
- 既存の「StreamDock コメントオーバーレイ」が従来どおり追加・表示/非表示される（**取り違えない**）
- **Windows（098 VM）**: 新ソースにも WGC（Windows 10 1903 以降）が自動設定され、透過窓が黒くならない
