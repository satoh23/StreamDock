# 032 らくらくツール設定 設計（棒読みちゃん×VOICEVOX 連携）

> 状態: **設計確定**。本ファイルは確定した設計判断・アーキテクチャ・方針改訂計画の記録であり、
> 実装は **032a（らくらくツール設定 画面枠組み）** / **032b（棒読みちゃん×VOICEVOX 連携）** に
> 分割して行う（本タスク＝設計そのものはコード・依存・capability を変更しない）。

## 目的

らくらくツール設定に、**棒読みちゃん×VOICEVOX を連携し、配信コメントをずんだもんの声で読ませる**
新機能を追加する。加えて、らくらくツール設定画面自体の枠組み（やりたいことベースの機能一覧 →
詳細 → 同意 → ワンクリック設定）と、連携ごとに保守しやすい per-integration アーキテクチャを確立する。

本機能は**ローカルアプリとの通信**と**外部アプリ設定の書換**を伴い、現行のセキュリティ方針
（`docs/security.md` §1／§5）および `docs/product.md` の MVP スコープと衝突する。本タスクで
**限定的な解禁範囲**を確定し、実装（032a/032b）でその範囲に沿って `docs/security.md` /
`docs/product.md` を改訂する（security-review 必須）。

## 現在の前提（調査結果・確定事項）

### 連携の技術的実体（調査で判明した「連携方式」）

棒読みちゃんは VOICEVOX を**直接呼ばない**。コミュニティ標準の連携は次の 3 部品の連鎖:

1. **VOICEVOX ENGINE**（`http://127.0.0.1:50021` の REST。GUI 版に同梱、または ENGINE 単体）を起動。
2. **SAPI For VOICEVOX**（第三者製プラグイン。32bit 版が棒読みちゃん連携用）が、ずんだもん等を
   **Windows の SAPI5 音声**として登録する（付属の「スタイル登録ツール」で音声トークンを登録）。
3. **棒読みちゃん**（SAPI5 対応）の「声質」プルダウンで `VOICEVOX：ずんだもん（ノーマル）` 等を選ぶ。

棒読みちゃんへの**テキスト送信**は Socket 連携（TCP `127.0.0.1:50001`）または HTTP（`50080`）で行える。
`std::net::TcpStream` で既知のバイナリプロトコル（コマンド `0x0001`＋速度/音程/音量/声質/文字コード/
本文長/本文）を送れば、**新規依存なし**で疎通テスト（例:「接続テストなのだ」）を鳴らせる。

**プラットフォーム:** 棒読みちゃんは **Windows 専用アプリ**。SAPI 音声登録は Windows レジストリ
（`HKLM\...\Speech\Voices`、32bit は WOW6432Node 配下）へ書き込み、**通常は管理者昇格が必要**。
VOICEVOX は Windows/macOS/Linux 対応だが、本連携は棒読みちゃんに依存するため **Windows 専用**。

**ライセンス:** VOICEVOX のずんだもん音声は商用・非商用とも無償だが、**クレジット「VOICEVOX:ずんだもん」の
表記が必須**（省略時は 1 キャラ 40 万円＋税の契約）。stream-dock は VOICEVOX/ずんだもん資産を再配布
しないが、**同意画面でクレジット義務を明示**する（`voicevox.hiroshiba.jp/term/` 準拠）。

### 再利用できる既存構成

- プロセス起動: `src-tauri/src/process/service.rs` の `spawn`（shell 非経由・PID 管理）/ `open_url`
  （既定ブラウザ委譲。`tauri-plugin-opener` の Rust API で ACL 不要）。
- OS イントロスペクション（インストール検出の参考）: `src-tauri/src/tools/icon.rs`（読み取り専用の
  OS API 呼び出し。macOS `NSWorkspace` / Windows Shell。失敗は `Ok(None)` に丸める）。
- vertical slice: `src-tauri/src/<domain>/{mod,commands,service,repository,model}.rs`。
- TS 側: `src/features/<domain>/`（+ `bindings/`）+ `src/screens/<name>/`。ヘッダーセクション定義の
  単一ソース `src/components/headerSections.ts`。らくらくツール設定の画面 ID `rakuraku-tools` は既存
  （`types.ts` の `Screen` union）で、現状は ComingSoon（準備中）プレースホルダ。
- Rust 側は **HTTP クライアント無し・async runtime 無し**（全 Tauri command が同期）。既存依存は
  `rusqlite` / `sysinfo` / `windows`（feature 限定）/ `tauri-plugin-opener` / `tauri-plugin-autostart`。

## 決定事項（論点 1〜5 の確定）

### 1. セキュリティ方針の扱い（§1／§5 の限定解禁）

`docs/security.md` に**新章「らくらくツール設定（外部アプリ連携）方針」**を追加し、以下に**限って**
解禁する（一般原則の禁止は維持）。詳細な改訂計画は後述「セキュリティ方針の改訂方針」に記す。

- **ローカルループバック通信のみ**を許可（`127.0.0.1` の既知ポート = VOICEVOX 50021 / 棒読み 50001）。
  インターネット通信・telemetry・外部 API は引き続き禁止。
- **インストーラの自動DL・自動実行はしない**。不足アプリは**公式配布元ページを開いて誘導**するのみ
  （§1 の「公式サイトを開く」許可の範囲内）。
- **外部アプリ設定の書換は、可逆な範囲＋バックアップ必須**。棒読みちゃん自身の設定ファイルのみを
  対象とし、書換前に app 管理領域へバックアップする。**SAPI レジストリ登録など不可逆・昇格を伴う
  変更は自動化せず、付属ツールへ誘導**する。
- **明示同意（同意画面）＋ security-review 必須**。

### 2. 技術的実現性・対応OS

- **対応OS:** らくらくツール設定の**画面枠組みは Windows/macOS 両対応**（今後 macOS 対応の連携項目を
  追加しうるため）。ただし**棒読みちゃん×VOICEVOX 連携は Windows 専用**。連携ごとに OS 対応可否を
  メタデータに持ち、一覧/詳細に **OS 対応バッジ（Windows専用 / Mac専用 / 両OS対応）** を出す。
  非対応 OS では「ワンクリック設定」を無効化し、その旨を表示する。
- **連携方式:** SAPI プラグイン経由（上記「技術的実体」）。stream-dock は VOICEVOX ENGINE の疎通確認
  （50021）と棒読みちゃんへのテスト送信（50001）を担い、SAPI 登録自体は付属ツールへ誘導する。
- **新規依存:** VOICEVOX REST の正式利用のため **`ureq`（ブロッキング HTTP クライアント）を追加**する。
  理由 = `reqwest` は tokio/async ランタイムを引き込み、既存の**同期コマンド構成と不整合**になるため、
  同期・小型の `ureq` を選ぶ（`docs/security.md` §10 準拠で Cargo.toml にコメント明記）。用途は
  **`127.0.0.1:50021` のループバックのみ**。棒読みちゃんへの送信は `std::net::TcpStream`（新規依存なし）。
- **Tauri capability:** 追加なし。Rust の `std::net` / `ureq` は IPC/ACL 対象外（frontend からは
  ネットワークを直接叩かせず、限定コマンド経由のみ）。`csp: null` も不変。
- **ライセンス:** ずんだもんのクレジット義務を同意画面に明示（決定事項 1・現在の前提を参照）。

### 3. アプリ検出/DL/自動設定の実装方式（自動化の境界）

自動化は**「設定書換のみ自動」**とする（自動DL/インストールと SAPI 自動登録は**採らない**。理由は
未署名第三者バイナリの実行・昇格を伴うシステム全体への不可逆変更・中途半端な失敗状態・AV/SmartScreen
での中断・保守/信用リスクが高いため。詳細は本チャットで別途整理済み）。

- **検出（scan / 読み取り専用）:** VOICEVOX / 棒読みちゃんのインストール有無、SAPI 音声登録の有無、
  VOICEVOX ENGINE 稼働（50021 疎通）を検出する。`icon.rs` と同様の読み取り専用 OS イントロスペクション
  ＋ループバック疎通確認のみ（書込・外部通信なし）。
- **導入（guided）:** 不足アプリは**公式DLページを開く**（`open_url` 相当）＋手順表示。**自動DL/実行しない**。
- **設定書換（auto・backup-first）:** 棒読みちゃん自身の設定（Socket 連携 ON・声質 = `VOICEVOX:ずんだもん`）
  のみを**バックアップしてから書換**（app 管理領域へタイムスタンプ付き退避。§5）。
- **SAPI 音声登録（guided）:** プラグイン付属の登録ツールへ誘導（レジストリ/昇格を伴うため自動化しない）。
- **検証（verify）:** VOICEVOX の 50021 疎通確認＋棒読みちゃんへテスト送信（50001）で end-to-end を確認。

### 4. per-integration アーキテクチャ

各連携を **scan → prepare(guided) → configure(auto) → register(guided) → verify** のステップに抽象化し、
連携追加＝1 モジュール追加で済む構成にする。

- **TS 側 `src/features/rakuraku/`:** 連携の**静的レジストリ**（id / タイトル =「やりたいこと」/
  「設定すると何ができるか」説明 / OS 対応可否 / 必要部品 / 同意・免責テンプレ / ステップ定義）。
  `bindings/` で Tauri コマンドをラップ。画面は `src/screens/rakuraku-tools/`（一覧 → 詳細 → 同意 → 実行）。
- **Rust 側 `src-tauri/src/rakuraku/`:** vertical slice（`{mod,commands,service,model}`）＋
  `integrations/`（`integrations/bouyomi_voicevox.rs`）。共通トレイト `Integration`（`scan/configure/verify`）
  を各連携が実装。ガイド手順（導入・SAPI 登録）は**実行せずデータとして UI に返す**。コマンドは
  `rakuraku_scan_integration` / `rakuraku_configure_integration` / `rakuraku_verify_integration` の
  最小構成（§3）。**設定状況の永続化は行わない**（バックアップはファイルのみ・SQLite テーブル追加なし）。

### 5. UI/UX・MVP スコープ

- **画面遷移:** 一覧（やりたいこと＋OS 対応バッジ）→ 詳細（設定すると何ができるか・必要部品・前提）→
  同意（新規DL可否・設定上書き可否・免責・**ずんだもんクレジット義務**）→ 実行（進捗・成功/失敗表示）。
- **MVP スコープ:** 初回は **棒読みちゃん×VOICEVOX の 1 連携**のみ。範囲は **TTS 半分に限定**
  =「棒読みちゃんがずんだもんの声で喋る」まで（検出・起動・DL 誘導・設定書換・テスト送信）。
  **配信コメントの取り込み（コメントビューア連携）は対象外**（別連携として後日）。
- **対象外（現段階）:** 設定解除・設定状況管理・設定更新（後々対応）。

## セキュリティ方針の改訂方針（実装 032b で反映・security-review 必須）

### `docs/security.md`

- 新章「### らくらくツール設定（外部アプリ連携）方針」を追加し、決定事項 1 の 5 点（ループバック限定／
  自動DL・実行しない／設定書換は可逆＋バックアップ必須／SAPI 等の不可逆・昇格変更は誘導のみ／
  明示同意＋security-review 必須）を明文化する。
- §1（外部通信）に「ただし `127.0.0.1` の既知ポートへのループバック通信は、上記新章の条件下で許可する」
  旨の例外注記を加える。
- §5（外部設定上書き）に「棒読みちゃん設定の書換は、バックアップ必須・可逆・同意済みの条件で許可する。
  SAPI レジストリ等の不可逆・システム全体変更は自動化しない」旨の例外注記を加える。
- 「レビュー必須条件」に本連携（ループバック通信・外部設定書換・新規依存 `ureq`）を追加する。

### `docs/product.md`

- 「MVP でやらないこと」の「設定ファイルの自動上書き」に、**らくらくツール設定に限り
  （明示同意＋バックアップ＋security-review を条件に、可逆な範囲で）例外的に許可する**旨を追記する。

## 実装タスクへの分割（032a / 032b）

- **032a らくらくツール設定 画面枠組み（Windows/macOS・mac で検証可）**
  frontend の一覧/詳細/同意/実行 UI、連携の静的レジストリ（OS 対応バッジ・同意/免責テンプレ含む）、
  `rakuraku-tools` 画面の ComingSoon 差し替え。**この段階では外部通信・設定書換・新規依存・capability
  変更を行わない**（027/031 と同じ低リスク・frontend 中心）。棒読み×VOICEVOX 連携は「Windows 専用・
  実行は 032b で有効化」の表示に留める。
- **032b 棒読みちゃん×VOICEVOX 連携（Windows 専用・098 で実機検証）**
  Rust `rakuraku` ドメイン（scan/configure/verify コマンド）、`ureq` 追加（理由明記）、ループバック
  通信（§1 解禁）、棒読み設定のバックアップ＋書換（§5 解禁）、導入/SAPI のガイド手順、
  `docs/security.md`/`docs/product.md` 改訂、security-review。Windows コードは既存前例（013/019/021/028）
  に倣い、mac では `cargo check` 対象外＝**未検証で main に入れ、098 で初検証**する。

## このタスク（設計）でやること

- 論点 1〜5 の決定事項を本ファイルに確定記録する（済）。
- 実装タスク 032a / 032b を作成し、`docs/task-board.md` に反映する。
- `docs/security.md` / `docs/product.md` の**改訂方針**を固める（実際の改訂は 032b で実施）。

## このタスク（設計）でやらないこと

- コード・依存（`ureq` 等）・Tauri capability・`docs/security.md` / `docs/product.md` 本文の変更
  （これらは 032a/032b で行う）。
- 自動DL/インストール・SAPI 自動登録の設計（不採用と決定。誘導方式に留める）。
- コメントビューア連携（コメント取り込み）・設定解除・設定状況管理・設定更新の設計（対象外）。

## セキュリティ制約（docs/security.md 準拠・抵触点と解禁範囲）

- **抵触点:** §1（外部通信）／§5（外部設定上書き）／§10（依存追加 `ureq`）／capabilities 方針。
- **解禁範囲（本設計で確定・実装 032b で明文化）:** ループバック（127.0.0.1）限定通信／自動DL・実行なし／
  棒読み設定書換はバックアップ必須・可逆／SAPI 等の不可逆変更は誘導のみ／明示同意＋security-review 必須。
- **本タスク（設計）自体:** docs 追記のみ。コード・依存・capability・security.md/product.md 本文は
  一切変更しない。

## 完了条件

- 論点 1〜5 の決定事項が本ファイルに確定記録されている。
- 032a / 032b が作成され、`docs/task-board.md` に反映されている。
- `docs/security.md` / `docs/product.md` の改訂方針が本ファイルに明記されている。
- 「設計中プレースホルダ」「別チャット用プロンプト」表記が外れ、実装着手可能な状態になっている。
- docs/progress.md が更新されている。

## 確認コマンド

```bash
# 設計タスクのためコード変更なし。docs 差分のみ確認する。
git status
git diff --stat docs/
```
