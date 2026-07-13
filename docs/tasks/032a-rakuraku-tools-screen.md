# 032a らくらくツール設定 画面枠組み

> **必読前提**: 実装前に [032（親設計・決定の正）](032-rakuraku-auto-setup-design.md) と
> `docs/security.md` を読むこと。本ファイルは決定の理由・自動化の境界・解禁範囲を 032 に委ねている。
> CLAUDE.md どおり「実装して」と言われるまでコードは変更せず、まず変更計画と対象ファイルを提示すること。

## 目的

らくらくツール設定に「**やりたいことベース**の機能一覧 → 詳細 → 同意 → ワンクリック設定（実行）」の
**画面枠組み**を実装する。連携ごとに保守しやすい **per-integration の静的レジストリ**（TS）を用意し、
一覧/詳細に **OS 対応バッジ（Windows専用 / Mac専用 / 両OS対応）** を出す。

本タスクは **frontend 中心・Windows/macOS 両対応**で、mac 開発環境で表示・遷移を検証できる。**外部通信・
外部設定書換・新規依存・Tauri capability の変更は行わない**（027/031 と同じ低リスク方針）。実際の連携
実行ロジック（検出・設定書換・疎通テスト）は **032b** で有効化する。設計の全体像は
[032-rakuraku-auto-setup-design.md](032-rakuraku-auto-setup-design.md) を正とする。

## 現在の前提（調査結果）

- 画面遷移は React Router 不使用。`apps/desktop/src/App.tsx` の `useState<Screen>` で切替、props で
  バケツリレー。`Screen` union に `"rakuraku-tools"` は既存（`apps/desktop/src/types.ts`）。
- らくらくツール設定は現状 ComingSoon（準備中）プレースホルダ。ヘッダー導線は単一ソース
  `apps/desktop/src/components/headerSections.ts` の `rakuraku` エントリ（`implemented: false`）。
  ラベルは 031 で「らくらくツール設定」に改名済み前提（未了なら本タスクで確認）。
- 画面は `apps/desktop/src/screens/<name>/` 単位。既存の実画面（`add-tool` / `add-preset` / `main` /
  `settings` / `diagnostics`）と ComingSoon（`coming-soon`）が参考。
- feature の静的定義の先例: `headerSections.ts`（配列＋型）、`features/tutorial/tutorialSteps.ts`。
- プリミティブ: `apps/desktop/src/components/primitives.tsx`（`Button` は `...rest` 透過）。
- 外部リソース非読込・`csp: null`・localStorage 直書き（`features/theme/theme.ts`）等、既存 frontend の
  制約と作法を踏襲する。

## このタスクでやること

### (1) 連携の静的レジストリ（新規 feature `src/features/rakuraku/`）

- `integrationRegistry.ts` — 連携定義の配列＋型。各エントリ:
  - `id`（例 `"bouyomi-voicevox"`）
  - `title`（やりたいこと。例「コメントをずんだもんに読ませたい」）
  - `summary` / `benefits`（詳細画面の「設定すると何ができるか」）
  - `osAvailability: "windows" | "macos" | "both"`（OS 対応バッジの元）
  - `requiredComponents`（例: VOICEVOX / SAPI For VOICEVOX / 棒読みちゃん。名称・公式ページ URL・
    導入がガイドか自動かの区別）
  - `consent`（同意/免責テンプレ: 新規DL可否・設定上書き可否・免責文・**ずんだもんクレジット義務**）
  - `steps`（scan/prepare/configure/register/verify の表示用定義。**この段階では実行しない**）
  - `executable: boolean`（032b で実装が入るまで false。false の間は「ワンクリック設定」を無効化）
- 初回エントリは **棒読みちゃん×VOICEVOX 1 件のみ**（`osAvailability: "windows"` / `executable: false`）。

### (2) 画面（新規 `src/screens/rakuraku-tools/`）

- **一覧**: 連携カードを並べる。各カードに OS 対応バッジ（Windows専用 / Mac専用 / 両OS対応）を表示。
  現在の OS（既存 `host_os` コマンド／`features/platform`）で対応外なら「この機能は◯◯でご利用いただけます」
  と補足し、カードから詳細へは行けるが「ワンクリック設定」は無効化。
- **詳細**: `summary`/`benefits`（設定すると何ができるか）、必要部品、前提、OS バッジを表示。
  「ワンクリック設定」ボタン（`executable && OS 対応` のときのみ活性）。
- **同意**: `consent` テンプレ（新規DL・設定上書き・免責・クレジット義務）を表示。「同意する」で実行画面へ。
- **実行**: ステップ進捗の枠（scan → prepare → configure → register → verify）と成功/失敗表示の**器**。
  032b が実装を差し込むまでは「準備中（Windows で 032b 実装後に有効化）」を表示する。

### (3) 導線の差し替え

- `headerSections.ts` の `rakuraku` エントリを `implemented: true` にし、ComingSoon ではなく本画面へ遷移。
  `App.tsx` の画面分岐に `rakuraku-tools` → `RakurakuToolsScreen` を追加（バケツリレーの作法を踏襲）。
- ComingSoon（`obs-effects`）は現状維持。

## このタスクでやらないこと

- 検出・設定書換・疎通テストの実装、Rust コマンド・`ureq` 追加・ループバック通信（**032b**）。
- `docs/security.md` / `docs/product.md` の改訂（**032b** で security-review と同時に実施）。
- Tauri capabilities / CSP / DB スキーマの変更。新規 crate/plugin の追加。
- コメントビューア連携・設定解除・設定状況管理・設定更新（設計上の対象外）。
- 内部識別子 `rakuraku-tools` の変更。

## セキュリティ制約（docs/security.md 準拠）

- frontend のみの変更。OS 操作・ファイル操作・プロセス操作・外部通信を追加しない（§1 / §2 / §4 / §5）。
- 新しい Tauri command / capabilities / 依存を追加しない（§3 / §10）。外部リソースを読み込まない（§CSP）。
- 同意/免責テンプレは表示のみ（この段階では何も実行しない）。ずんだもんのクレジット義務を明示する。

## 完了条件

- らくらくツール設定が実画面（一覧 → 詳細 → 同意 → 実行の器）になっている。
- 連携一覧に OS 対応バッジが表示され、非対応 OS では「ワンクリック設定」が無効化されている。
- 棒読みちゃん×VOICEVOX が Windows 専用・`executable: false`（実行は 032b で有効化）で登録されている。
- 同意画面に新規DL/設定上書き/免責/ずんだもんクレジット義務が表示される。
- 新しいライブラリ / Tauri command / capabilities を追加していない。Rust / CSP 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。
- docs/progress.md が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop tauri dev   # 一覧→詳細→同意→実行の遷移・OS バッジ・無効化を目視確認
```
