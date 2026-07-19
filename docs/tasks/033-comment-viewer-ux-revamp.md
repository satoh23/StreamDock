# 033 コメントビューア UX 刷新（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 033a〜033f の**分割・線引き・実装順の正**。
>
> **必読前提**: 親設計 [032c](032c-comment-viewer-voicevox-design.md)（内蔵コメビュ×VOICEVOX の設計）と
> [`docs/security.md`](../security.md)（特に §1 外部通信・「## コメントビューア（配信サービス連携）方針」・
> 「例外（032c-c）」ループバック VOICEVOX）を読むこと。CLAUDE.md どおり **「実装して」と言われるまでコードは
> 変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

内蔵コメントビューア（別ウィンドウ label `comment-viewer` / 実体
[`apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx)・
535 行）は 032c-a〜d で Twitch/YouTube 取得・VOICEVOX 合成読み上げまで配線が完了したが、**UI が検証用のまま**で
実運用に耐えない。本タスク群は、このコメビュを「配信中に実運用できる UI」へ刷新し、**今後ここへ機能を足していく
土台**にする。単一 535 行に全部入っている現状を、**設定ビュー分離＋コンポーネント整理**で保守可能にする。

現状の主な問題（本人指摘）:

1. ヘッダー「コメントビューア」が冗長（OS 窓タイトルが既に「コメントビューア」）。
2. コメント総数がヘッダーにあり、取得した一覧の近くにない。
3. モック追加/クリア/読み上げテストの検証用ボタンが残存。
4. YouTube/Twitch 接続 UI が本体に露出し、接続済み/取得中が分かりにくい。
5. 縦長（420×640）で狭い。
6. VOICEVOX 読み上げが常時 ON・ずんだもん固定で、ON/OFF・話者を選べない。
7. クレジット表記が常時表示（読み上げしない人にも出る）。
8. ツール管理でコメビュだけ「開く」ボタンで、他ツールの再生/停止・起動済み表示と不揃い。
9. コメント一覧を OBS へ透過反映する手段がない。

## 確定した方針

- **設定はコメビュ窓内の「設定ビュー」に集約**（歯車ボタンで `comment` / `settings` を切替）。YouTube/Twitch 接続と
  VOICEVOX 設定をここへ寄せる。**理由**: 接続の sidecar 通信はコメビュ窓に閉じており、設定を**メイン窓**へ置くと
  sidecar/WS をメイン窓へ引き込む必要が生じ、`docs/security.md` §1 /「コメントビューア方針②」の
  **「main ウィンドウと Rust command は no-internet を維持」**に反する。メイン窓の
  [`SettingsScreen.tsx`](../../apps/desktop/src/screens/settings/SettingsScreen.tsx)（テーマのみ）は**変更しない**。
- **OBS 透過連携は「透過オーバーレイ窓」方式**（obs-websocket は採らない）。既存のウィンドウ生成
  （`WebviewWindowBuilder`）を再利用し、**追加依存・新規外部通信ゼロ**。ユーザーは OBS の「ウィンドウキャプチャ」で
  取り込む。obs-websocket による自動ソース追加は新規 localhost 接続面・新規依存でレビューが重く、本バッチでは採らない。
- **1 タスク 1 機能で分割**（CLAUDE.md）。033a〜f ＋ 本親 033。

## サブタスク分割

| ID | 内容 | 対象問題 | security-review |
|----|------|---------|-----------------|
| [033a](033a-comment-viewer-declutter.md) | コメビュ本体の軽量化・レイアウト整理（タイトル削除・総数移動・モック撤去・窓サイズ拡大） | 1,2,3,5 | 不要 |
| [033b](033b-settings-view-connection.md) | 設定ビュー新設＋接続UI移設＋接続状態インジケータ（円アイコン＋テキスト） | 4 | 軽（宛先/capability 不変の確認） |
| [033c](033c-voicevox-toggle-autolink.md) | VOICEVOX 読み上げ ON/OFF トグル＋クレジット条件表示＋自動起動/自動連携 | 6,7 | 不要（既存起動経路の再利用のみ） |
| [033d](033d-voicevox-speaker-select.md) | VOICEVOX 話者選択＋「ずんだもん読み上げ」→「VOICEVOX読み上げ」改名 | 6 | **必須**（loopback に `GET /speakers` 追加） |
| [033e](033e-tool-management-play-stop.md) | ツール管理でコメビュを再生/停止・起動済み表示（他ツールと統一） | 8 | **必須**（窓/プロセス ライフサイクル） |
| [033f](033f-obs-transparent-overlay.md) | OBS 用透過オーバーレイ窓（ワンクリック） | 9 | **必須**（新規窓・透過・新規 capability） |

## 依存関係と推奨実装順

```
033a → 033b → 033c → 033d      （コメビュ UI チェーン・逐次）
              └→ 033f          （一覧描画の分割を再利用／単独でも可）
033e                            （ツール管理・独立・並行可）
```

推奨: **033a → 033b → 033c → 033d** を逐次、**033e** を並行、**033f** を最後。033b で切り出す
`SettingsView` / `StatusIndicator` / `CommentList` を後続が再利用する。

## 横断セキュリティ方針（docs/security.md 準拠）

- **メイン窓の no-internet 維持が最優先**。設定ビュー内包で接続 UI をコメビュ窓に閉じ込め、メイン窓・その Rust
  command に通信面を増やさない（§1 /「コメントビューア方針②」）。
- 新規 npm/crate/plugin・新規外部通信・`csp` 変更は原則入れない。VOICEVOX はループバック `127.0.0.1:50021` の
  例外（032c-c）内に留める。追加する場合は理由明記＋レビュー（CLAUDE.md §依存 / §10）。
- **既存挙動（Twitch/YouTube 取得・VOICEVOX 合成・internal 起動）を壊さない**線引きを各サブタスクの
  「このタスクでやらないこと」で明示する。

## 完了条件

- 033a〜033f のタスクファイルが本親の分割・依存どおりに存在し、各々が既存フォーマット（§各ファイルの共通フォーマット）に沿う。
- [`docs/task-board.md`](../task-board.md) に 033 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。
- 各サブタスク完了時に [`docs/progress.md`](../progress.md) を更新する（各ファイルの完了条件に含む）。

## このタスク（親）でやらないこと

- コード実装（033a〜f それぞれで行う）。
- 設定をメイン窓 `SettingsScreen` へ置く設計（no-internet 境界のため不採用）。
- obs-websocket による OBS 自動連携（不採用・将来検討）。
