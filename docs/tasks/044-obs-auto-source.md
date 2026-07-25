# 044 OBS オーバーレイ 自動ソース追加（obs-websocket・親設計／方針反転）

> 状態: **未着手（親設計・線引きの正）**。実装は [044s](044s-obs-websocket-spike.md)（スパイク＝技術検証）→ [044a](044a-obs-auto-source-impl.md)（実装）の順。
>
> **必読前提**: 反転元 [033](033-comment-viewer-ux-revamp.md)・[033f](033f-obs-transparent-overlay.md)（**「obs-websocket は使わない・透過窓を手動ウィンドウキャプチャ」の決定**）、
> オーバーレイ開閉 [034d](034d-overlay-controls-in-settings.md)、[`docs/security.md`](../security.md)（§1 外部通信／allow-list／「コメントビューア（配信サービス連携）方針」＝通信は sidecar 封じ込め・§10 依存）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**新規 loopback 通信＋新規依存＋方針反転のため security-review 必須**。

## 目的

OBS オーバーレイを ON にしたとき、**OBS 側にオーバーレイのソースを自動追加**し、ワンクリックで配信画面にコメントビューアーが出るようにする（要望①）。
現状は透過オーバーレイ窓を**ユーザーが手動で**「ウィンドウキャプチャ」として OBS に追加する必要があり、初回の手間と分かりにくさが UX を損ねている。

## 方針反転の明示（033 / 033f の決定を覆す）

- [033](033-comment-viewer-ux-revamp.md)（37-39・84 行）・[033f](033f-obs-transparent-overlay.md)（16・59 行）で、**「obs-websocket による OBS 自動ソース追加は採らない」**（追加依存・新規 localhost 接続面を避け、透過窓＋手動ウィンドウキャプチャにする）と明示的に決定していた。
- 本親は **UX 優先でこの決定を反転**する。反転に伴うコスト＝ **新規 loopback 通信（OBS WebSocket `127.0.0.1:4455`）＋新規依存（`obs-websocket-js`）＋（方式次第で）ローカル HTTP サーバ**。これらは §1（外部通信をしない）・§10（依存）・レビュー必須条件（外部通信）に該当するため、**方針の再定義と security-review を必須**とする。反転の記録として本ファイルを残す。

## 現在の前提（調査結果・実コード）

- **obs-websocket 連携は存在しない**（[`Cargo.toml`](../../apps/desktop/src-tauri/Cargo.toml)・desktop/sidecar の `package.json` に obws / obs-websocket-js 無し・`4455` 参照無し）。
- 現行オーバーレイは透過ネイティブ窓（label `comment-overlay`）を [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) の `open_comment_overlay_window`（174-219 行・`transparent`/`decorations(false)`/`always_on_bottom`）で開き、**OBS の「ウィンドウキャプチャ」**（窓名「StreamDock コメントオーバーレイ」）で取り込む。開閉トグルは設定ビュー [`SettingsView.tsx`](../../apps/desktop/src/screens/comment-viewer/SettingsView.tsx)（364-425 行・ON/OFF＋Windows 向けキャプチャ注記）。**オーバーレイ用 HTTP サーバは無い**。
- 通信面の方針: インターネット通信は Node sidecar に封じ込め、**Rust は完全同期のまま（async/WS/HTTP crate を足さない）**。sidecar の宛先は [`host-guard.ts`] の allow-list で fail-closed。sidecar の WS サーバは `127.0.0.1:17331`（既定・[`apps/comment-sidecar/src/index.ts`](../../apps/comment-sidecar/src/index.ts) 49 行）。
- → **obs-websocket クライアントは Node sidecar 側（`obs-websocket-js`）に置く**のが方針整合（Rust に async/WS を持ち込まない）。

## 方式候補（044s で決定）

- **方式 A（ウィンドウキャプチャ自動追加）**: 既存透過窓を obs-websocket で「ウィンドウキャプチャ」ソースとして自動作成。既存構成を再利用し **HTTP サーバ不要**。ただしソース種別/ウィンドウ指定が **OS 依存で脆い**（Windows の title:class:exe 形式、mac の画面収録権限・ScreenCaptureKit）。
- **方式 B（ブラウザソース自動追加）**: オーバーレイを**ローカル HTTP 配信**し「ブラウザソース」を自動作成。OBS 標準的で**透過が安定・クロスプラットフォーム一貫**。ただし**ローカル HTTP サーバ新設**でアーキ変更が大きい（オーバーレイを窓配信から HTTP 配信へ、または併存）。

## 子タスクと線引き

| 子 | 内容 | 実装有無 | レビュー |
|---|---|---|---|
| [044s](044s-obs-websocket-spike.md) | obs-websocket 疎通・ソース自動作成の技術検証、方式 A/B 決定、mac 権限・認証の実測、security 方針差分ドラフト | **検証のみ（本実装しない）** | 方針ドラフトのみ |
| [044a](044a-obs-auto-source-impl.md) | 決定方式で自動ソース追加を実装＋失敗時フォールバック案内＋security.md 追記 | 実装 | **security-review 必須** |

## このタスク（親）でやらないこと

- 実装（子タスク）。方式の事前確定（044s の実測で決める）。obs-websocket 以外の OBS 連携（プラグイン等）。
- **外部インターネット通信の追加**（OBS 連携は loopback `127.0.0.1:4455` のみ・外に出さない）。

## セキュリティ制約（docs/security.md 準拠）

- OBS 連携は **loopback（`127.0.0.1:4455`）のみ**・**ユーザーが OBS 連携を有効化した時のみ**接続（明示同意）。外部インターネット通信は増やさない。
- 通信面は **sidecar に封じ込め**（Rust は完全同期のまま・async/WS/HTTP crate を足さない）。allow-list（[`host-guard.ts`]）に loopback 4455 を通す設計を 044s で定義し 044a で実装。
- OBS WebSocket のパスワードは**非ログ・非外部送信**（§9）。新規依存（`obs-websocket-js`）・（方式 B なら）ローカル HTTP サーバは §10 で理由を記録。
- **方針反転＋新規通信面＋新規依存のため security-review 必須**（044a）。

## 完了条件（親）

- 044s で方式（A/B）が実測に基づき決定され、security 方針の差分ドラフトができている。
- 044a でオーバーレイ ON 時に OBS へソースが自動追加され（既存なら再利用）、失敗時は手動手順へフォールバックする。security.md に方針が追記され security-review を通過している。
- OBS 連携は loopback のみ・明示同意時のみ・sidecar 封じ込め。外部インターネット通信は増えていない。

## 実装後に必要なレビュー

- 044s＝方針ドラフト（レビューは 044a で本実施）。044a＝**security-review 必須**（下記 044a 参照）。
