# 019 Preset Auto-Launch on Boot

## 目的

プリセット追加/編集画面に「**PC起動時にプリセット自動起動**」トグルを追加する（ユーザー要望 5）。
有効にしたプリセットは、PC 起動時に本アプリ（stream-dock）が起動し、そのプリセットに登録された
ツールの一括起動が自動で走る。

ユーザーの想定する「丸い」形＝「PC 起動 → stream-dock 自動起動 → 登録プリセットの一括起動が自動実行」
を実現する。

## 現在の前提

- 008 Bulk Launch / 009 / 010 / 013 完了。`process::service` に一括起動のロジックがある
  （`resolve_preset_targets` で enabled な PresetItem を order 順に取得、`launch_preset_targets` で
  ordered → parallel を best-effort 起動）。`launch_preset` command はこれを呼んでいる。
- Preset モデルは `presets/model.rs`（`Preset` / `CreatePresetInput` / `UpdatePresetInput`）、
  ts-rs バインディングが `apps/desktop/src/features/presets/bindings/`。
- `presets` テーブルは `presets/repository.rs::init()` の `CREATE TABLE IF NOT EXISTS`。
  **マイグレーション基盤は無い**。
- 018 Tool Icon Auto-Extraction で **`util.rs::ensure_column`（冪等 ADD COLUMN ガード）が新設済み**。
  本タスクはこれを再利用する（018 未完なら本タスクで `ensure_column` を先に用意する）。
- アプリのエントリは `lib.rs::run()`。`setup()` で SQLite を開き、各 `init()` を実行し、
  `Mutex<Connection>`（DbState）と process registry（ProcessRegistry）を manage している。
- 現状のプラグインは `tauri-plugin-opener` / `tauri-plugin-dialog` のみ。ログイン項目/autostart の
  仕組みは無い。プリセット編集は 2 ステップウィザード（`AddPresetScreen.tsx`、Step1 に name/description）。

## このタスクでやること

### (1) per-preset フラグ + スキーマ
- `presets` に `auto_launch_on_boot INTEGER NOT NULL DEFAULT 0` を追加。
  `util.rs::ensure_column`（018 で新設）を `presets::repository::init` の
  `CREATE TABLE IF NOT EXISTS` 直後に呼んで冪等に追加する。
- `Preset` に `auto_launch_on_boot: bool`、`CreatePresetInput` / `UpdatePresetInput` に
  `#[serde(default)] #[ts(optional)] auto_launch_on_boot: Option<bool>` を追加。ts-rs 再生成。
- `presets/repository.rs`（`PRESET_COLUMNS` / `row_to_preset` / `insert` / `update`、`as i64` 保存・
  `!= 0` 読取）と `presets/service.rs`（`create` / `update`、既定 `false`）に通す。

### (2) ログイン項目登録（tauri-plugin-autostart）
- `tauri-plugin-autostart`（公式・v2）を導入し、`--autostart` 引数付きで起動するよう設定する
  （`MacosLauncher` 指定 + `Some(vec!["--autostart".into()])`）。
- **ユーザー向けグローバル ON/OFF は作らない**。「フラグ付きプリセットが 1 つ以上あれば有効」という
  不変条件を導出（reconcile）する:
  - preset の create / update / delete 後、および起動時に、フラグ付きプリセット数を数えて
    `enable()` / `disable()` を呼ぶ（`is_enabled()` でガードし冗長な OS 書込を避ける）。
  - reconcile は `AppHandle` / plugin manager に触れるため、**command 層**（`AppHandle` を持てる層）で行う。
    `&Connection` しか持たない service 層で OS 呼び出しをしない。

### (3) 起動時フック（既存一括起動の再利用）
- `lib.rs::setup()` で、DB / registry を manage したあと、**`std::env::args()` に `--autostart` が
  含まれるときのみ**、フラグ付きプリセットを取得して自動起動する。
  - 既存の DB 非依存ランチャ `process::service::{resolve_preset_targets, launch_preset_targets}` を
    再利用する（`launch_preset` command と同処理）。新しい spawn 経路は作らない。
  - `launch_preset_targets` はブロッキング（macOS `.app` 解決の待機を含む）なので、**別スレッド**で実行し
    ウィンドウ生成をブロックしない（`AppHandle` を clone し、スレッド内で State を取得）。
  - 開始/完了を `app_logs` に記録する。
  - **手動起動時（`--autostart` 無し）は自動起動を発火させない**（毎回勝手に起動しないため必須）。
  - 起動時にも (2) の reconcile を実行し、前回セッションで全フラグ解除された場合にログイン項目を是正する。
- `--autostart` 起動時は、ウィンドウを非表示/最小化で開始し、起動時にダイアログ等でブロックしない
  （ユーザー不在でも安全に走る）。

### (4) capabilities / 設定
- `lib.rs` builder に `.plugin(tauri_plugin_autostart::init(...))` を追加。
- `capabilities/default.json` に必要な permission のみ追加:
  `autostart:allow-enable` / `autostart:allow-disable` / `autostart:allow-is-enabled`
  （広い default を追加しない）。
- `Cargo.toml` に `tauri-plugin-autostart = "2"`。
- `tauri.conf.json` はウィンドウ非表示起動に必要な範囲のみ調整。

### (5) frontend 配線
- `AddPresetScreen.tsx` Step1 に `auto_launch_on_boot` トグル（ラベル「PC起動時にプリセット自動起動」）を追加。
  `editingPreset` から初期化し、`createPreset` / `updatePreset` のペイロードに含める。
- presets の types / api（`features/presets/`）を拡張。
- 016 の設定画面とは独立（これはプリセット単位のトグル）。

docs/progress.md を更新する（autostart プラグイン導入理由を含む）。

## このタスクでやらないこと

- グローバルな「起動時にアプリを起動する」ON/OFF トグル UI（フラグから導出するため不要）
- `tauri-plugin-single-instance`（起動時の二重起動対策）の導入 ※必要性は注記に留め、別途検討
- 起動順の高度制御（待機秒数・launch group 等）
- 自動起動したプロセスの自動停止・スケジューリング
- OS 再起動をまたいだプロセス復元
- MainScreen フッタ「起動間隔を設定」プレースホルダの実装

## セキュリティ制約（docs/security.md 準拠）

- ログイン項目は**永続的な OS 連携**（§10 のレビュー対象クラス）。手書きのレジストリ/LaunchAgent 書込は
  §5 違反のため行わず、公式 `tauri-plugin-autostart` を用いる。
- 全フラグ解除時に**必ずログイン項目が解除される**こと。アンインストール時に残留し得ることを既知の限界として
  progress.md / security.md に明記する。
- Tauri capabilities は autostart の 3 permission のみ。広い scope を追加しない。
- 起動時のプロセス起動も、既存 `validate_executable` / 保存済み `executablePath` 経由のみ。
  新規 spawn 面・shell 経由・任意コマンド組立・外部通信を増やさない（§4 / §6）。
- frontend から渡るのは `auto_launch_on_boot`（bool）と既存の presetId 等のみ。任意 path/command を渡さない。
- autostart プラグイン導入・capabilities 変更・起動時プロセス起動のため、実装後に security-review を必須とする。

## 完了条件

- プリセット編集画面に「PC起動時にプリセット自動起動」トグルがあり、保存・再表示できる
- フラグを有効化するとログイン項目が登録され、無効化（全フラグ解除）で解除される
- PC 起動（= `--autostart` 付き起動）で、フラグ付きプリセットのツールが自動一括起動する
- 手動起動（`--autostart` 無し）では自動起動が発火しない
- 自動起動が既存 `resolve_preset_targets` / `launch_preset_targets` を再利用している（新規 spawn 経路なし）
- 自動起動がウィンドウ生成をブロックしない（別スレッド実行）／ユーザー不在でダイアログでブロックしない
- `presets.auto_launch_on_boot` が冪等な `ensure_column` で追加され、既存 DB でも落ちない
- ts-rs バインディングが再生成され frontend の型と整合している
- capabilities は autostart の 3 permission のみ / 危険な汎用 command を追加していない
- `pnpm --filter ./apps/desktop typecheck` / `lint`、`cargo check` が通る
- docs/progress.md が更新されている（autostart 導入理由・既知の限界を含む）

## 確認コマンド

```bash
git diff --stat
git diff --name-only
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cd apps/desktop/src-tauri && cargo check
pnpm --filter ./apps/desktop tauri dev
```

## 実装後に必要なレビュー

autostart プラグイン導入・capabilities 変更・起動時プロセス起動のため、実装後に security-review を必須とする。
最低限:

- ログイン項目が全フラグ解除で確実に解除されるか（残留の既知限界が明記されているか）
- capabilities が autostart の 3 permission に限定されているか
- 起動時プロセス起動が既存 `validate_executable` / 保存済み path 経由のみか（新規 spawn 面・shell を足していないか）
- 手動起動で自動起動が発火しない（`--autostart` ゲート）ことが担保されているか
- frontend から任意 path / command を渡せる設計になっていないか
- 外部通信を追加していないか
