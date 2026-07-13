# 032b 棒読みちゃん×VOICEVOX 連携（Windows 専用）

> **必読前提**: 実装前に [032（親設計・決定の正）](032-rakuraku-auto-setup-design.md) と
> `docs/security.md` を読むこと。本ファイルは決定の理由・自動化の境界・解禁範囲を 032 に委ねている。
> 加えて本タスクは **Windows 専用・098 まで未検証で書き切る前提**であり、着手時はまず「要調査（スパイク）」
> 項目を洗い出すこと。CLAUDE.md どおり「実装して」と言われるまでコードは変更せず、まず変更計画と対象
> ファイルを提示すること。

## 目的

らくらくツール設定の最初の連携として、**棒読みちゃん×VOICEVOX** を実装し、配信者が**ワンクリック設定 →
ずんだもんの声で読み上げ**（TTS 半分）まで到達できるようにする。stream-dock は **検出・起動・公式DL誘導・
棒読み設定の書換（バックアップ先取り）・疎通テスト**を担い、**インストーラの自動DL/実行と SAPI 音声登録の
自動化は行わない**（誘導のみ）。

本連携は**棒読みちゃん依存のため Windows 専用**。032a の画面枠組みに実行ロジックを差し込む。設計の全体像・
決定事項・自動化の境界は [032-rakuraku-auto-setup-design.md](032-rakuraku-auto-setup-design.md) を正とする。

> 実装順序と検証方針（028 の前例に倣う）: 本タスクの Windows コードは `#[cfg(windows)]` のため、
> **mac 開発環境では `cargo check` の対象外＝その場でコンパイル検証できない**。よって**未検証の Windows
> コードとして書き切り**、実コンパイル・実機 E2E は **098（Windows 11 ARM64 VM）で初めて行う**（本タスクの
> 完了条件には含めない）。⚠️ この前提により、032b の Windows 分岐は「動作未確認のまま main に入る」ことを
> 許容する。098 でコンパイルエラー/挙動不具合が出た場合は 098 側で最小修正する（progress.md に明記）。

## 現在の前提（調査結果）

### 連携方式（032 設計の再掲）

- 3 部品連鎖: **VOICEVOX ENGINE**（`127.0.0.1:50021` REST）← **SAPI For VOICEVOX**（32bit・ずんだもんを
  Windows SAPI5 音声として登録）← **棒読みちゃん**（「声質」で `VOICEVOX：ずんだもん` を選択）。
- 棒読みちゃんへのテキスト送信は Socket 連携（TCP `127.0.0.1:50001`）。既知のバイナリプロトコル
  （コマンド `0x0001`＋速度/音程/音量/声質/文字コード/本文長/本文）で疎通テストを鳴らせる。
- SAPI 音声登録は Windows レジストリ（`HKLM\...\Speech\Voices`、32bit は WOW6432Node）へ書込＝**昇格が
  必要な不可逆変更**のため**自動化しない**（付属の登録ツールへ誘導）。
- ずんだもんは**クレジット「VOICEVOX:ずんだもん」表記が必須**（同意画面で明示 = 032a）。

### 要調査（実装前スパイク・Windows 実機推奨。098 と併走可）

- **棒読みちゃんの設定ファイルの実体**（インストールフォルダ配下の設定 XML/ini の場所・スキーマ）と、
  「Socket 連携 ON」「声質＝VOICEVOX:ずんだもん」に対応するキーの正確な表現。**バックアップ→書換→反映
  （棒読み再起動要否）**の手順を実機で確定する。
- **検出方法**: VOICEVOX / 棒読みちゃんの既知インストールパス・レジストリキー、SAPI 音声トークンの列挙
  （読み取り専用）、VOICEVOX ENGINE 稼働の 50021 疎通確認。
- **SAPI For VOICEVOX の配布元 URL・バージョン・32bit 版の入手手順**（誘導文言に使う。自動DLしない）。
- **VOICEVOX / 棒読みちゃんの公式配布元 URL**（誘導に使う）。

### 再利用する既存構成

- プロセス起動・URL オープン: `process/service.rs`（`spawn` / `open_url`）。
- 読み取り専用 OS イントロスペクション: `tools/icon.rs` の作法（失敗は丸める・フルパス非露出）。
- vertical slice / commands 登録・エラー型（`error.rs`）・入力検証（`util.rs`）。

## このタスクでやること

### (1) Rust `rakuraku` ドメイン（新規 vertical slice）

- `src-tauri/src/rakuraku/{mod,commands,service,model}.rs` ＋ `rakuraku/integrations/{mod,bouyomi_voicevox}.rs`。
- 共通トレイト `Integration`（`scan() -> ScanResult` / `configure() -> ConfigureResult` /
  `verify() -> VerifyResult`）。ガイド手順（導入・SAPI 登録）は**実行せずデータで返す**。
- コマンド（最小・明示。§3）: `rakuraku_scan_integration(id)` / `rakuraku_configure_integration(id)` /
  `rakuraku_verify_integration(id)`。`lib.rs` の `invoke_handler` に登録。
- 実処理は **`#[cfg(windows)]`** に閉じ、非 Windows は「未対応」を返す（032a の OS ゲートと整合）。

### (2) 検出（scan・読み取り専用）

- VOICEVOX / 棒読みちゃんのインストール有無、SAPI 音声登録の有無、VOICEVOX ENGINE 稼働（50021 疎通）を
  検出。書込・外部通信なし（ループバック疎通確認のみ）。失敗詳細は丸め、フルパス/OS エラーを露出しない（§9）。

### (3) 設定書換（configure・バックアップ先取り。§5 解禁範囲）

- **棒読みちゃん自身の設定のみ**を対象に、**書換前に app 管理領域へタイムスタンプ付きバックアップ**を取り、
  Socket 連携 ON・声質＝`VOICEVOX:ずんだもん` を書き込む。SAPI 登録・その他アプリ設定は触らない。
- バックアップは**ファイルのみ**（SQLite への状態記録はしない＝設定状況管理は対象外）。

### (4) 導入・SAPI 登録の誘導（guided・自動実行しない）

- 不足部品は**公式DLページを開く**（`open_url` 相当）＋手順表示。SAPI 音声登録は**付属ツールへ誘導**。
  installer/zip の自動DL・自動実行・レジストリ自動書込は**行わない**。

### (5) 検証（verify・§1 解禁範囲＝ループバックのみ）

- VOICEVOX の 50021 疎通確認（`ureq` で `127.0.0.1:50021` のヘルスチェック）。
- 棒読みちゃんへ **TCP `127.0.0.1:50001`** にテスト文（例「接続テストなのだ」）を送信し、end-to-end で
  ずんだもんが喋ることを確認（`std::net::TcpStream`・新規依存なし）。

### (6) 依存追加（`ureq`。§10）

- `Cargo.toml` に **`ureq`（ブロッキング HTTP クライアント）** を追加し、**理由をコメント明記**
  （`reqwest` は tokio/async を引き込み同期コマンド構成と不整合。用途は `127.0.0.1:50021` ループバックのみ）。
  `Cargo.lock` 更新。**Tauri capability は追加しない**（Rust std/`ureq` は ACL 対象外・frontend から
  ネットワークを直接叩かせない）。

### (7) セキュリティ方針の改訂（security-review と同時）

- `docs/security.md`: 新章「らくらくツール設定（外部アプリ連携）方針」を追加。§1／§5 に例外注記、
  「レビュー必須条件」に本連携（ループバック通信・外部設定書換・`ureq` 追加）を追加。
- `docs/product.md`: 「設定ファイルの自動上書き」に、らくらくツール設定に限る例外（同意＋バックアップ＋
  security-review・可逆な範囲）を追記。
- 032 設計「セキュリティ方針の改訂方針」の文面計画に沿う。

## このタスクでやらないこと

- インストーラ/zip の自動DL・自動実行、SAPI 音声登録の自動化（誘導のみ）。
- 棒読みちゃん以外の外部アプリ設定の書換、SAPI レジストリ等の不可逆・昇格変更。
- 設定解除・設定状況管理・設定更新・復元 UI（バックアップは取るが restore UI は作らない）。
- コメントビューア連携（コメント取り込み）。
- インターネット通信（ループバック `127.0.0.1` 以外への通信）・telemetry。
- macOS / Linux での連携実行（`#[cfg(windows)]` 以外は「未対応」を返す）。

## セキュリティ制約（docs/security.md 準拠・抵触点と解禁範囲）

- **抵触点:** §1（外部通信）／§5（外部設定上書き）／§10（依存 `ureq`）／capabilities 方針。
- **解禁範囲:** ループバック（127.0.0.1:50021/50001）限定通信／自動DL・実行なし（公式ページ誘導のみ）／
  棒読み設定の書換はバックアップ必須・可逆／SAPI 等の不可逆・昇格変更は誘導のみ／明示同意（032a の同意画面）
  ＋ **security-review 必須**。
- frontend からは raw なパス/URL/ポート/コマンドを受けず、限定コマンド（`rakuraku_*`）経由のみ（§2/§3）。
  エラー詳細（フルパス/OS エラー）は丸め、ログ・外部送信を増やさない（§9）。`csp: null` 不変。

## 完了条件（本タスク＝mac 上で達成できるもの）

- Rust `rakuraku` ドメイン（scan/configure/verify・`#[cfg(windows)]` 実装）と `ureq` 追加（理由明記）を
  **実装済み**。032a の実行画面に配線されている。
- **macOS は非退行**（mac で `cargo check` 成功。非 Windows は「未対応」を返す）。
- `docs/security.md` / `docs/product.md` を改訂し、**security-review を実施して結果を docs に反映**
  （ループバック通信・外部設定書換・`ureq` 追加が対象。Windows 実挙動は未検証のため、コードレビュー観点＝
  ループバック限定/バックアップ先取り/誘導のみ/丸め を中心に）。
- Windows コードは**未検証であることを明示**して main に入れる（`cargo check` 未走・実機未確認を
  progress.md に記録）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` が通る。
- docs/progress.md に実装内容・**未検証範囲**・098 へ持ち越す検証項目を追記。

## 098 で確認する完了条件（本タスクでは未達で可）

- Windows ARM64(VM) で `cargo check` / `cargo clippy` が通る（`rakuraku` の Windows 分岐 初コンパイル）。
- 実機で VOICEVOX / SAPI For VOICEVOX / 棒読みちゃんを導入し、ワンクリック設定 → 棒読み設定書換
  （バックアップが取れている）→ 疎通テストでずんだもんが喋る、まで到達。
- 検出が正しく効く（未導入部品はガイド表示・導入済みは設定/テストへ進める）。
- 棒読み設定のバックアップから手動復元でき、書換が可逆であることを確認。

## 確認コマンド

```sh
# --- 本タスク: macOS（非退行確認）---
cd apps/desktop/src-tauri && cargo check   # Windows 分岐は cargo check 対象外。非 Windows 経路が壊れていないこと
cd ../../.. && pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop lint
```

```powershell
# --- 098 へ持ち越し: Windows ARM64 VM 上 ---
cd apps/desktop/src-tauri
cargo check
cargo clippy
cd ../../..
pnpm --filter ./apps/desktop tauri dev   # ワンクリック設定 → 設定書換 → 疎通テストを確認
```
