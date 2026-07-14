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

## 追補（032b 実装後の不具合修正・起動検出＋自動起動の必須化）

初回実装がワンクリック設定として実用にならなかったため、以下を修正した（親設計 032 の決定 3 も改訂）。

- **棒読みちゃん検出の堅牢化（問題2）**: zip 展開型で任意フォルダに置かれても検出できるよう、
  **起動中プロセスの exe パス（sysinfo・読み取り専用）を最優先**し、無ければ一般的な展開先候補
  （Desktop/Downloads/ユーザーフォルダ/ドライブ直下の `BouyomiChan*`）を探す。`configure` の設定ファイル解決も
  同じ install_dir を使う。固定 2 パスのみ依存を解消。
- **起動検出（問題3）**: `scan` に**棒読みちゃんの起動状態**（50001 connect のみ）を追加（`ScanResult.bouyomiRunning`）。
  VOICEVOX（50021）と併せて両アプリの起動を UI に提示する。
- **自動起動（問題3）**: 新コマンド `rakuraku_launch_component(id, component)` を追加。**既導入・同意済みアプリ**
  （VOICEVOX / 棒読みちゃん）を **shell 非経由・検証済み絶対パス**（`process::service::spawn_detached`）で起動する。
  **自動DL/インストール/SAPI 自動登録はしない**（誘導のみ）。frontend は未起動の部品にだけ呼び、起動を scan 再ポーリングで待つ。
- **SAPI For VOICEVOX 導線復活（問題1）**: 配布元 URL（GitHub 公式リリース `shigobu/SAPIForVOICEVOX`）を確定し、
  `official_page("sapi")=Some` / `has_official_page=true` に変更。導入準備ステップに「公式ページを開く」ボタンが出る。
- **halt-on-failure（問題4）**: 実行フローを「前段が失敗したら中断し、以降を『未実行（blocked）』にする」逐次ゲートに変更
  （verify の常時実行を撤回）。ステップ順は scan→prepare→configure→register→**launch**→verify。
- **方針改訂**: `docs/security.md`「らくらくツール設定（外部アプリ連携）方針」に**既導入アプリの自動起動**を追加解禁
  （§4/§5/§6 の一般原則は維持）。`docs/product.md`・親設計 032 も追記。security-review 実施。
- **未検証範囲（098 で確定）**: Windows 実機での 棒読み検出候補の網羅性・プロセス名、自動起動の exe パス、
  **棒読みちゃん起動中に configure すると終了時に設定を上書きされ得る順序問題**（現状は launch を configure の後に置き、
  未起動時のみ起動＝新規起動が新設定を読む前提。既起動時の挙動は 098 で確認）、VOICEVOX エンジン起動の待ち時間。

## 追補2（設計変更・ツール管理登録前提化）

> この節は上の「追補（032b 修正）」の**検出/自動起動の実装方式を上書き（supersede）**する。上の追補で導入した
> FS 広域走査・sysinfo プロセス列挙による導入検出/自動起動を撤回し、**「ツール管理」への登録を前提**にする。
> **仕様更新のみ（本節の時点でコードは未改修・security-review 未実施）**。実コード改修とレビューは別ステップ。

### 何を変えるか

- **前提（gating）**: らくらくツール設定は、対象ツール（**VOICEVOX / 棒読みちゃん**）が既存の**「ツール管理」に
  登録済み**であることを前提にする。未登録ならセットアップを開始できず、登録導線を表示する。
- **導入済み判定 = 登録済み＋パス有効**: 「導入済み」＝ツール管理に該当ツールの登録があり、その `executablePath` が
  **有効（絶対・実在・非ディレクトリ・`.lnk`/`.bat` でない）**か。**FS の広域走査（Desktop/Downloads/`%USERPROFILE%`/
  ドライブ直下の `BouyomiChan*` を `read_dir`）・sysinfo プロセス列挙で導入を推測しない**。
- **ツール↔部品の対応付け（案A）**: 登録済みツール一覧を **exe ファイル名一致**（`VOICEVOX.exe` / `BouyomiChan.exe`・
  大小無視・種別 executable のみ）で部品へ自動対応する。照合対象は「登録済みの小さなリスト」であり FS 全体ではない。
  **対応関係は永続化しない**（毎 scan で照合＝032 決定4「設定状況の永続化なし」を維持）。
- **自動起動 = 登録済み executablePath を管理付き spawn（案X）**: 未起動なら、登録済み `executablePath` を
  **既存の管理付き `process::service::spawn`＋PID registry 登録**（`launch_tool` と同経路）で起動する。起動プロセスは
  **停止/監視の対象になる**（§6「停止は自 spawn PID 限定」と整合＝自分が起動した PID のみ）。`spawn_detached` は廃止。
- **未登録時の導線（D3）**: らくらく画面から「**ツール管理へ追加**」（AddToolScreen へ遷移・**名称プリフィル**、
  パスはファイル選択ダイアログ経由＝生パス注入なし）＋**公式DLページ導線を併記**する。

### 維持する事項（退行させない）

- **起動検知はループバック疎通のまま**（VOICEVOX 50021 は `ureq` GET、棒読み 50001 は `TcpStream` connect のみ・送信なし）。
  **登録≠起動**のため、登録済みでも未起動なら自動起動して疎通を待つ流れは残す。
- **自動DL/インストール/SAPI 自動登録はしない**（誘導のみ）。
- **SAPI For VOICEVOX は起動アプリでも「ツール」でもない**ため登録モデルの対象外。従来どおりレジストリ `KEY_READ`
  読取で SAPI 音声登録の有無を検出し、配布元（`shigobu/SAPIForVOICEVOX`）・付属登録ツールへ誘導する。
- **棒読み設定書換はバックアップ必須・可逆・棒読み自身の設定ファイルのみ**。`install_dir` は**登録済み `executablePath`
  の親ディレクトリ**から解決する（`config_path.starts_with(install_dir)` の担保は維持）。
- **frontend は生パス/URL/ポート/コマンドを受けず `rakuraku_*` 経由のみ**。capabilities/CSP/依存は**増やさない**
  （むしろ広域走査・Windows 経路の sysinfo 利用が消える）。`csp: null` 不変。

### 削除/置換の範囲（実装時）

- **削除**: `bouyomi_process_dir`（sysinfo）／`bouyomi_candidate_dirs`／`subdirs_starting_with`／`bouyomi_install_dir`／
  `process::service::spawn_detached`／`bouyomi_exe_path`／`voicevox_exe_path`（固定パス）／`imp::launch`。
- **作り替え**: `detect_voicevox_installed` / `detect_bouyomi_installed`（登録済み＋パス有効判定へ）、
  `resolve_bouyomi_config`（install_dir＝登録パスの親へ）。`validate_launch_path` はクロスプラットフォームの
  共有バリデータ（`validate_executable_path`）へ昇格して installed 判定に流用。
- **副次効果**: `bouyomi_process_dir` が `#[cfg(windows)]` で使う sysinfo は Cargo.toml で `cfg(target_os="macos")`
  依存のみ宣言されており、098 でコンパイルエラーになり得た**潜在バグ**が、この削除で同時に解消される。

### 未検証範囲（098 で確定）の更新

- **解消**: 広域走査由来のリスク（Downloads/ドライブ直下に置かれた**悪意ある同名 exe を自動起動し得る**問題）は、
  起動パスを登録済み `executablePath` のみに限定したことで**排除**される。
- **残る**: **棒読みちゃん起動中に configure すると終了時に設定を上書きされ得る順序問題**（launch を configure の後に
  置く既存順序を維持）、VOICEVOX エンジン起動の待ち時間。
