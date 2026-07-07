use std::path::Path;
use std::process::{Child, Command};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::preset_items;
use crate::preset_items::model::{LaunchMode, PresetItem};
use crate::presets;
use crate::tools;
use crate::tools::model::Tool;

use super::model::{
    BulkLaunchPresetResult, BulkLaunchToolResult, RuntimeProcess, RuntimeProcessStatus,
    StopProcessResult, StopStatus,
};
use super::registry::{ManagedProcess, ProcessRegistry};

/// 登録済み Tool の executablePath を検証し、shell を経由せず直接プロセスを起動して
/// `Child` ハンドルを返す。
///
/// 007 では起動して PID を返すだけで `Child` を drop していたが、009 では停止のために
/// `Child` を registry に保持する必要があるため、ここでは **drop せず返す** ようにした
/// （検証・macOS `.app` の起動経路は 007/008 から変更しない）。
///
/// 検証項目（007 から不変）:
/// - executablePath が空でない
/// - 絶対パスである
/// - 実在する
/// - ディレクトリでない（macOS の `.app` バンドルのみ例外的に起動可能）
/// - `.lnk` / `.bat` ではない
pub fn spawn(tool: &Tool) -> AppResult<Child> {
    let path_str = tool.executable_path.trim();
    if path_str.is_empty() {
        return Err(AppError::Validation("実行ファイルパスが未設定です".into()));
    }

    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Validation(
            "実行ファイルパスが絶対パスではありません".into(),
        ));
    }
    if !path.exists() {
        return Err(AppError::PathNotFound(format!(
            "指定された実行ファイルが見つかりません: {path_str}"
        )));
    }

    // macOS の `.app` はバンドル＝ディレクトリだが、LaunchServices（`open`）経由で起動できる
    // 唯一の正規なアプリ実体。そのため `.app` バンドルだけは「起動可能」として扱い、
    // それ以外のディレクトリは従来どおり拒否する。Windows/Linux では常に false。
    #[cfg(target_os = "macos")]
    let is_app_bundle = path.is_dir()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("app"));
    #[cfg(not(target_os = "macos"))]
    let is_app_bundle = false;

    if path.is_dir() && !is_app_bundle {
        return Err(AppError::Validation(
            "指定されたパスはディレクトリです".into(),
        ));
    }

    // 007 では .lnk（ショートカット）/ .bat（バッチ）を起動対象にしない。
    // `.app` バンドルは上で起動可能と判定済みなので、この拒否チェックは通常ファイル経路のみに適用する。
    if !is_app_bundle {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if matches!(ext.as_deref(), Some("lnk") | Some("bat")) {
            return Err(AppError::Validation(
                "この形式のファイルは現在起動に対応していません".into(),
            ));
        }
    }

    // shell を経由せず executablePath を直接起動する。
    // 起動失敗の詳細（OS エラー文字列）は環境情報を含みうるため露出させず、固定メッセージに丸める。
    //
    // 009 注記（macOS `.app`）: `.app` は下記のとおり `/usr/bin/open` 経由で起動するため、得られる
    //   `Child` は起動した実アプリではなく即座に終了する `open` ヘルパのもの。よって registry に
    //   保持しても停止時には「既に終了済み」になり実アプリは止まらない（既知の縮退）。
    //   実アプリを停止できるようにする macOS 対応は 013 macOS App Bundle Stop で別途行う。
    //   Windows(`.exe`)/Linux の直接 spawn 経路では `Child` が実プロセスなので正しく停止できる。
    let child = if is_app_bundle {
        // macOS の `.app` はバンドルを直接 exec できないため、固定の絶対パス `/usr/bin/open` に
        // バンドルパスを配列引数（文字列連結なし・shell 非経由）で渡して LaunchServices 起動する。
        Command::new("/usr/bin/open")
            .arg(path)
            .spawn()
            .map_err(|_| AppError::LaunchFailed("プロセスの起動に失敗しました".into()))?
    } else {
        Command::new(path)
            .spawn()
            .map_err(|_| AppError::LaunchFailed("プロセスの起動に失敗しました".into()))?
    };

    Ok(child)
}

/// 一括起動（008）の対象を DB から解決する。
///
/// ロックを保持したままプロセスを spawn しないよう、ここでは「取得」だけを行い、
/// 実際の起動は [`launch_preset_targets`]（DB 非依存）に分離する（007 の launch_tool と同方針）。
///
/// 以下の場合は一括起動自体を開始しないため `Err` を返す:
/// - Preset が存在しない（`NotFound`）
/// - enabled な PresetItem が1件も無い（`Validation`）
///
/// 個々の Tool 欠落は best-effort で per-item 失敗として扱うため、ここでは `Option<Tool>` として返す
/// （通常は ON DELETE CASCADE で発生しないが、防御的に処理する）。
pub fn resolve_preset_targets(
    conn: &Connection,
    preset_id: &str,
) -> AppResult<Vec<(PresetItem, Option<Tool>)>> {
    // Preset が存在しなければ一括起動を開始しない。
    presets::service::get(conn, preset_id)?;

    // enabled な PresetItem のみを起動対象にする（list_by_preset は order_index 昇順）。
    let enabled: Vec<PresetItem> = preset_items::service::list_by_preset(conn, preset_id)?
        .into_iter()
        .filter(|item| item.enabled)
        .collect();
    if enabled.is_empty() {
        return Err(AppError::Validation("起動できるツールがありません".into()));
    }

    let mut targets = Vec::with_capacity(enabled.len());
    for item in enabled {
        let tool = tools::repository::get(conn, &item.tool_id)?;
        targets.push((item, tool));
    }
    Ok(targets)
}

/// 解決済みの起動対象を best-effort で一括起動し、成功・失敗を集約して返す（DB 非依存）。
///
/// 起動順（MVP）:
/// 1. ordered な item を orderIndex 昇順で先に起動する
/// 2. parallel な item をまとめて起動する
///
/// `std::process::Command::spawn()` は子プロセスの終了を待たず即座に戻る非ブロッキング呼び出しのため、
/// 順に spawn しても起動されたアプリ群は同時並行に走る（008 ではスレッドは使わない）。
/// `targets` は [`resolve_preset_targets`] により order_index 昇順で渡ってくるので、
/// モードで分割しても各グループ内の順序は保たれる。
///
/// 009: 起動に成功したプロセスは `registry` に登録し、`BulkLaunchToolResult.launch_id` に採番した
/// launchId を入れる（Preset 単位停止で presetId から絞り込めるよう `preset_id` を保持する）。
pub fn launch_preset_targets(
    preset_id: &str,
    targets: Vec<(PresetItem, Option<Tool>)>,
    registry: &ProcessRegistry,
) -> BulkLaunchPresetResult {
    let started_at = chrono::Utc::now().to_rfc3339();

    let (ordered, parallel): (Vec<_>, Vec<_>) = targets
        .into_iter()
        .partition(|(item, _)| item.launch_mode == LaunchMode::Ordered);

    let mut results: Vec<BulkLaunchToolResult> = Vec::new();
    for (item, tool) in ordered.into_iter().chain(parallel) {
        results.push(launch_one(&item, tool.as_ref(), preset_id, registry));
    }

    let total_count = results.len() as u32;
    let success_count = results.iter().filter(|r| r.success).count() as u32;
    let failure_count = total_count - success_count;

    BulkLaunchPresetResult {
        preset_id: preset_id.to_string(),
        started_at,
        finished_at: chrono::Utc::now().to_rfc3339(),
        total_count,
        success_count,
        failure_count,
        results,
    }
}

/// PresetItem 1件を起動し、結果を [`BulkLaunchToolResult`] にまとめる。
/// 起動に成功した場合のみ registry に登録し、launchId を採番して結果に含める。
fn launch_one(
    item: &PresetItem,
    tool: Option<&Tool>,
    preset_id: &str,
    registry: &ProcessRegistry,
) -> BulkLaunchToolResult {
    // Tool 欠落（防御的経路）で名前が空になると UI の失敗一覧が空要素になるため、
    // 識別できるよう tool_id をフォールバック名にする。
    let tool_name = tool
        .map(|t| t.name.clone())
        .unwrap_or_else(|| item.tool_id.clone());

    let (success, launch_id, process_id, started_at, error_message) = match tool {
        None => (false, None, None, None, Some("ツールが見つかりません".to_string())),
        Some(tool) => match spawn(tool) {
            Ok(child) => {
                let process_id = child.id();
                let started_at = chrono::Utc::now().to_rfc3339();
                let launch_id = register(
                    registry,
                    tool,
                    Some(preset_id.to_string()),
                    Some(item.id.clone()),
                    child,
                    started_at.clone(),
                );
                (true, Some(launch_id), Some(process_id), Some(started_at), None)
            }
            Err(err) => (false, None, None, None, Some(safe_launch_message(&err))),
        },
    };

    BulkLaunchToolResult {
        preset_item_id: item.id.clone(),
        tool_id: item.tool_id.clone(),
        tool_name,
        launch_mode: item.launch_mode,
        order_index: item.order_index,
        success,
        launch_id,
        process_id,
        started_at,
        error_message,
    }
}

/// 起動した `Child` を registry に登録し、採番した launchId を返す。
///
/// process_id は呼び出し側で登録前に `child.id()` から取得しておくこと
/// （このメソッドに child を move で渡すため、内部でも同じ値を保持する）。
pub fn register(
    registry: &ProcessRegistry,
    tool: &Tool,
    preset_id: Option<String>,
    preset_item_id: Option<String>,
    child: Child,
    started_at: String,
) -> String {
    let launch_id = uuid::Uuid::new_v4().to_string();
    let process_id = child.id();
    let managed = ManagedProcess {
        launch_id: launch_id.clone(),
        tool_id: tool.id.clone(),
        tool_name: tool.name.clone(),
        preset_id,
        preset_item_id,
        process_id,
        started_at,
        child,
    };
    registry
        .lock()
        .expect("process registry mutex poisoned")
        .insert(launch_id.clone(), managed);
    launch_id
}

/// registry から取り出した1件を停止し、[`StopProcessResult`] を返す。
///
/// - `try_wait()` が `Ok(Some(_))`（既に終了） → `already-exited`
/// - まだ動いていれば `kill()` → 成功で `wait()` により終了を回収し `stopped`
/// - kill / try_wait に失敗 → `failed`
///
/// 失敗時のみ `Some(mp)` を返し、呼び出し側が registry へ再挿入して再試行できるようにする。
/// 成功・既に終了済みの場合は `None`（registry から除去したまま破棄）。
pub fn stop_one(mut mp: ManagedProcess) -> (StopProcessResult, Option<ManagedProcess>) {
    match mp.child.try_wait() {
        Ok(Some(_)) => (
            build_stop_result(&mp, StopStatus::AlreadyExited, None, None),
            None,
        ),
        Ok(None) => match mp.child.kill() {
            Ok(()) => {
                // ゾンビを残さないよう終了を回収する。
                let _ = mp.child.wait();
                let stopped_at = chrono::Utc::now().to_rfc3339();
                (
                    build_stop_result(&mp, StopStatus::Stopped, Some(stopped_at), None),
                    None,
                )
            }
            Err(_) => (
                build_stop_result(
                    &mp,
                    StopStatus::Failed,
                    None,
                    Some("プロセスの停止に失敗しました".into()),
                ),
                Some(mp),
            ),
        },
        Err(_) => (
            build_stop_result(
                &mp,
                StopStatus::Failed,
                None,
                Some("プロセスの停止に失敗しました".into()),
            ),
            Some(mp),
        ),
    }
}

fn build_stop_result(
    mp: &ManagedProcess,
    status: StopStatus,
    stopped_at: Option<String>,
    error_message: Option<String>,
) -> StopProcessResult {
    StopProcessResult {
        launch_id: mp.launch_id.clone(),
        tool_id: mp.tool_id.clone(),
        tool_name: mp.tool_name.clone(),
        process_id: mp.process_id,
        status,
        stopped_at,
        error_message,
    }
}

/// runtime process registry のスナップショットを取得する（010 Runtime Status）。
///
/// registry に登録された managed process だけを対象に `std::process::Child::try_wait()` で
/// 状態を確認する。frontend から raw PID / path / command を受け取らず、shell も一切使わない。
///
/// - `try_wait()` が `Ok(None)` → Running
/// - `try_wait()` が `Ok(Some(_))` → Stopped（終了検知）。`ended_at` を付与する。
/// - `try_wait()` が `Err(_)` → Error。安全な短文の `error_message` を付与する。
///
/// `preset_id` を渡した場合は、その preset に紐づく managed process だけを対象にする
/// （単体起動 007 は preset_id = None のため、preset 絞り込みでは含まれない）。
///
/// 終了・エラーを検知したプロセスは registry から除去する（Child ハンドルを drop する）。
/// これは 009 の「停止したら registry から消す」方針に合わせるもので、UI へはこの応答で
/// 一度 `stopped` を返し、以降は不在として扱う。
///
/// 注記: `try_wait()` は `&mut Child` を要する非ブロッキング呼び出しのため、ここでは lock を
/// 保持したまま走査してよい（kill / wait のようなブロッキング操作は行わない）。
///
/// 設計メモ（読み取り command が registry を mutate する点について）:
/// この関数は「状態取得（read）」でありながら、終了検知したプロセスを registry から除去する
/// という副作用を持つ。`list_runtime_processes` / `list_preset_runtime_processes` という
/// 命名からは純粋な read に見えるため、意図的にこの doc へ理由を残す。
///
/// なぜ現状こうなっているか:
/// - 終了検知（try_wait が Some/Err）は snapshot 時にしか起こせない。別途 refresh 用 command を
///   分けると command 数が増え、010 の「MVP では command を増やしすぎない」方針に反する。
/// - 除去タイミングを snapshot に寄せることで、009 の「停止したら registry から消す」方針と
///   状態遷移を一元化でき、終了済み Child ハンドルを保持し続けない（リソース面でも安全）。
/// - セキュリティ上の対象範囲は変わらない（あくまで stream-dock が起動した registry 内プロセス
///   のみ。外部プロセスの列挙・監視・停止は一切増えていない）。
///
/// どうなったら分離を検討すべきか:
/// - read 系 command が増え、「状態を見るだけ」の呼び出しで registry が変化することが
///   バグ・混乱の原因になり始めたとき。
/// - 終了検知と除去のタイミングを UI 側で細かく制御したくなったとき
///   （例: 「停止済み」を一覧に残す期間を明示管理したい等）。
/// - その場合は read（純粋な snapshot）と reap（終了検知・除去）を別関数／別 command に分離し、
///   除去のみを明示的な refresh 経路に寄せることを検討する。
pub fn snapshot(registry: &ProcessRegistry, preset_id: Option<&str>) -> Vec<RuntimeProcess> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut reg = registry.lock().expect("process registry mutex poisoned");

    let mut out: Vec<RuntimeProcess> = Vec::new();
    // 終了・エラーを検知した launchId（走査後に registry から除去する）。
    let mut finished: Vec<String> = Vec::new();

    for (launch_id, mp) in reg.iter_mut() {
        if let Some(pid) = preset_id {
            if mp.preset_id.as_deref() != Some(pid) {
                continue;
            }
        }

        let (status, ended_at, error_message) = match mp.child.try_wait() {
            Ok(None) => (RuntimeProcessStatus::Running, None, None),
            Ok(Some(_)) => (RuntimeProcessStatus::Stopped, Some(now.clone()), None),
            Err(_) => (
                RuntimeProcessStatus::Error,
                Some(now.clone()),
                Some("プロセスの状態確認に失敗しました".to_string()),
            ),
        };

        if !matches!(status, RuntimeProcessStatus::Running) {
            finished.push(launch_id.clone());
        }

        out.push(RuntimeProcess {
            launch_id: mp.launch_id.clone(),
            tool_id: mp.tool_id.clone(),
            tool_name: mp.tool_name.clone(),
            preset_id: mp.preset_id.clone(),
            preset_item_id: mp.preset_item_id.clone(),
            process_id: mp.process_id,
            status,
            started_at: mp.started_at.clone(),
            updated_at: now.clone(),
            ended_at,
            error_message,
        });
    }

    // 終了・エラー検知分は registry から除去（Child を drop）。以降は不在として扱う。
    for launch_id in finished {
        reg.remove(&launch_id);
    }

    out
}

/// 一括起動結果の error_message を、フロントに出しても安全な短文へ丸める。
/// PathNotFound はメッセージにフルパスを含むため、パスを出さない固定文言に置き換える。
fn safe_launch_message(err: &AppError) -> String {
    match err {
        // Validation / LaunchFailed の文言は固定文言でパス・環境情報を含まない。
        AppError::Validation(m) | AppError::LaunchFailed(m) => m.clone(),
        // PathNotFound はフルパスを含むため丸める。
        AppError::PathNotFound(_) => "指定された実行ファイルが見つかりません".to_string(),
        _ => "起動に失敗しました".to_string(),
    }
}
