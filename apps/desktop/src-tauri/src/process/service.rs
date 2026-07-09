use std::path::Path;
use std::process::Command;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::util::{now_rfc3339, require_non_empty, with_filename_detail};
use crate::preset_items;
use crate::preset_items::model::{LaunchMode, PresetItem};
use crate::presets;
use crate::tools;
use crate::tools::model::Tool;

use super::model::{
    BulkLaunchPresetResult, BulkLaunchToolResult, RuntimeProcess, RuntimeProcessStatus,
    StopProcessResult, StopStatus,
};
use super::registry::{Handle, ManagedProcess, ProcessRegistry};

/// 登録済み Tool の executablePath を検証し、shell を経由せずプロセスを起動して
/// registry 登録用の [`Handle`] を返す。
///
/// 007 では PID を返すだけで `Child` を drop していたが、009 以降は停止・状態監視のために
/// ハンドルを registry に保持する。
///
/// - Windows/Linux/非バンドル: `Handle::Child`（自分が spawn した子）。
/// - macOS `.app`（013）: `.app` の実体 Mach-O を直接 exec すると LaunchServices を通らず、
///   macOS の launch constraints / コード署名の起動コンテキスト検証に違反して一部アプリ
///   （特に Apple システムアプリ）が SIGKILL される。そのため `.app` は `/usr/bin/open` で起動し、
///   起動した実アプリの PID を [`launch_app_bundle`] で同定して `Handle::MacResolved` を返す。
///   停止（009）・状態（010）はこの PID を用いる（`stop_one` / `snapshot` を参照）。
///
/// 検証項目（007 から不変）:
/// - executablePath が空でない
/// - 絶対パスである
/// - 実在する
/// - ディレクトリでない（macOS の `.app` バンドルのみ例外的に起動可能）
/// - `.lnk` / `.bat` ではない
pub fn spawn(tool: &Tool) -> AppResult<Handle> {
    let (path, is_app_bundle) = validate_executable(tool)?;

    // shell を経由せず起動する。起動失敗の詳細（OS エラー文字列）は環境情報を含みうるため露出させず、
    // 固定メッセージに丸める。
    //
    // macOS `.app`: `/usr/bin/open`（LaunchServices）で起動し、実アプリ PID を同定して返す。
    // `is_app_bundle` は非 macOS では常に false のため、この分岐は macOS でのみコンパイルする。
    #[cfg(target_os = "macos")]
    if is_app_bundle {
        return spawn_app_bundle(&path);
    }
    // 非 macOS では is_app_bundle を参照する分岐が無いため、未使用警告を避ける。
    #[cfg(not(target_os = "macos"))]
    let _ = is_app_bundle;

    // Windows/Linux/非バンドル（macOS の非バンドルも含む）: 自分が spawn した子を掴む（007/008 から不変）。
    let child = Command::new(&path)
        .spawn()
        .map_err(|_| AppError::launch_failed("プロセスの起動に失敗しました"))?;
    Ok(Handle::Child(child))
}

/// registry が管理する既存プロセスを**前面化（アクティブ化）**する。「開く」ボタン用（バグ1）。
///
/// frontend からは launchId のみを受け取り、コマンド側（[`super::commands::focus_process`]）が
/// registry から解決した実 PID（Windows 用）と Tool（macOS の `.app` バンドルパス用）を渡す。
/// **新規インスタンスは絶対に起動しない**（従来 Windows/Linux で `spawn` フォールバックしていた
/// 二重起動の不具合を根絶する）。registry には登録しない（監視対象・停止対象を増やさない）。
///
/// - Windows: 保持 PID とその子プロセスツリーからトップレベルウィンドウを特定して前面化する
///   （最小化なら復元）。ウィンドウが見つからなければ何もしない（no-op・新規起動しない）。
/// - macOS `.app`: `/usr/bin/open <bundle>`（LaunchServices が既存インスタンスを前面化・新規起動しない）。
/// - Linux / 非バンドル: 前面化 API を持たないため no-op（新規起動しない・アクティブ化は非対応の既知の限界）。
///
/// `pid` は Windows でのみ使い、`tool` は macOS でのみ使う。他プラットフォームでは該当引数を無視する。
pub fn focus(pid: Option<u32>, tool: Option<&Tool>) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        // macOS `.app`: `/usr/bin/open` は起動済みなら前面化するだけ（新規起動しない）。
        // 固定絶対パス・バンドルパスは配列引数（文字列連結なし・shell 非経由）。
        let _ = pid;
        if let Some(tool) = tool {
            let (path, is_app_bundle) = validate_executable(tool)?;
            if is_app_bundle {
                let status = Command::new("/usr/bin/open")
                    .arg(&path)
                    .status()
                    .map_err(|_| AppError::launch_failed("プロセスの起動に失敗しました"))?;
                if !status.success() {
                    return Err(AppError::launch_failed("プロセスの起動に失敗しました"));
                }
            }
            // 非バンドル（生バイナリ）はアクティブ化 API を持たないため no-op。
        }
        Ok(())
    }

    #[cfg(windows)]
    {
        // Windows: 保持 PID（とその子孫）のトップレベルウィンドウを前面化する。見つからなければ no-op。
        let _ = tool;
        if let Some(pid) = pid {
            windows::focus_by_pid(pid);
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        // Linux 等: アクティブ化 API を実装しない方針（本命は Windows）。ただし二重起動しないよう
        // 従来の `spawn` フォールバックは廃止し、no-op にする。
        let _ = (pid, tool);
        Ok(())
    }
}

/// executablePath を検証し、`(絶対パス, macOS `.app` バンドルか)` を返す。[`spawn`] / [`focus`] 共通。
///
/// 検証項目（007 から不変・強度を下げない）:
/// - executablePath が空でない
/// - 絶対パスである
/// - 実在する
/// - ディレクトリでない（macOS の `.app` バンドルのみ例外的に起動可能）
/// - `.lnk` / `.bat` ではない
fn validate_executable(tool: &Tool) -> AppResult<(std::path::PathBuf, bool)> {
    let path_str = tool.executable_path.trim();
    require_non_empty(path_str, "実行ファイルパスが未設定です")?;

    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::validation(
            "実行ファイルパスが絶対パスではありません",
        ));
    }
    if !path.exists() {
        // フルパスは frontend / log に露出させない。安全な文言にし、details にはファイル名のみを入れる。
        let err = AppError::path_not_found(
            "登録された実行ファイルが見つかりません。ツールのパスを確認してください。",
        );
        return Err(with_filename_detail(err, path));
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
        return Err(AppError::validation("指定されたパスはディレクトリです"));
    }

    // 007 では .lnk（ショートカット）/ .bat（バッチ）を起動対象にしない。
    // `.app` バンドルは上で起動可能と判定済みなので、この拒否チェックは通常ファイル経路のみに適用する。
    if !is_app_bundle {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if matches!(ext.as_deref(), Some("lnk") | Some("bat")) {
            return Err(AppError::unsupported_file_type(
                "このファイル形式は現在未対応です。",
            ));
        }
    }

    Ok((path.to_path_buf(), is_app_bundle))
}

/// macOS `.app` を `/usr/bin/open` で起動し、起動した実アプリの PID を同定して [`Handle`] を返す。
/// 同期窓内に同定できなければ `Handle::MacUnresolved`（遅延解決）を返す。
/// `is_app_bundle`（macOS のみ true）成立時にのみ呼ばれる。
#[cfg(target_os = "macos")]
fn spawn_app_bundle(bundle: &Path) -> AppResult<Handle> {
    match macos::launch_app_bundle(bundle)? {
        macos::Launch::Resolved {
            pid,
            exe_path,
            start_time,
        } => Ok(Handle::MacResolved {
            pid,
            exe_path,
            start_time,
        }),
        macos::Launch::Unresolved { exe_dir, deadline } => {
            Ok(Handle::MacUnresolved { exe_dir, deadline })
        }
    }
}

/// macOS `.app` の起動（`/usr/bin/open`）・実 PID 同定・PID ベースの停止/状態確認を担う。
///
/// 013 の要（docs/security.md 準拠）:
/// - 起動は `/usr/bin/open`（固定絶対パス・配列引数・shell 非経由）。
/// - 実 PID は `open` 実行の前後差分（before/after）で同定し、**新規に現れた PID を優先**する。
///   これにより、ユーザーが手動で先に起動していた既存インスタンスの取り込みを避ける。
/// - 停止・状態確認の直前に PID の現在の exe が同定時の exe と一致することを再検証し、PID 再利用を防ぐ。
/// - プロセス列挙・kill は `sysinfo`（読み取り＋自 PID kill のみ・外部通信なし）で行い、shell を使わない。
#[cfg(target_os = "macos")]
mod macos {
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    use crate::error::{AppError, AppResult};

    /// PID 同定の同期ポーリング上限（回数 × 間隔 ≒ 0.5 秒）。
    ///
    /// 実アプリのプロセスは多くの場合 `open`（LaunchServices）の exec 直後にプロセステーブルへ現れる
    /// ため、この短い窓で速いパス（新規 PID を before 集合で優先）を捉えられる。窓内に現れなかった
    /// 場合（大型アプリのコールドスタート等）は `Err` にせず遅延解決（`Launch::Unresolved`）に落とし、
    /// 以降の `snapshot` / `stop` で同定する。窓を短く保つことで一括起動（`launch_one` を逐次呼ぶ）の
    /// ブロッキング時間を抑える。
    const POLL_ATTEMPTS: usize = 5;
    const POLL_INTERVAL_MS: u64 = 100;

    /// `<bundle>/Contents/MacOS` を返す（実アプリの実体バイナリが置かれる唯一のディレクトリ）。
    ///
    /// firmlink（例: `/Applications` → `/System/Volumes/Data/Applications`）やシンボリックリンクで
    /// ユーザー登録パスと sysinfo が返す exe パスの表記が食い違い、同定に失敗する（＝起動成功なのに
    /// `launch_failed` になる）のを避けるため canonicalize する。canonicalize 失敗時は素のパスへ
    /// フォールバックする（照合側で素の等価も試すため取りこぼさない）。
    fn macos_dir(bundle: &Path) -> PathBuf {
        let raw = bundle.join("Contents").join("MacOS");
        std::fs::canonicalize(&raw).unwrap_or(raw)
    }

    /// `exe` の親ディレクトリが `dir`（canonicalize 済み `<bundle>/Contents/MacOS`）と同一か。
    /// 素の等価を先に試し（多くの実プロセスはこれで一致し syscall を増やさない）、食い違う場合のみ
    /// exe 親を canonicalize して firmlink/シンボリックリンク差を吸収する。
    fn same_macos_dir(exe: &Path, dir: &Path) -> bool {
        match exe.parent() {
            Some(parent) => {
                parent == dir || std::fs::canonicalize(parent).is_ok_and(|c| c == dir)
            }
            None => false,
        }
    }

    /// 既存の `System` を exe のみで全プロセス再列挙する（`start_time` は基本情報として常に取得される）。
    /// 用途は PID 解決（exe 親一致＋起動時刻）に限るため、cpu/memory 等は読み取らない。
    /// ポーリング等で `System` を使い回して都度の再生成コストを避けるために分離する。
    fn refresh(sys: &mut System) {
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
    }

    /// 全プロセスを1回列挙した `System` を返す（単発用途。ポーリングでは [`refresh`] で使い回す）。
    fn refresh_all() -> System {
        let mut sys = System::new();
        refresh(&mut sys);
        sys
    }

    /// exe の親が `dir`（= canonicalize 済み `<bundle>/Contents/MacOS`）に一致するプロセスの
    /// `(pid, start_time, exe)` を集める。実アプリの実体プロセスだけを分離するためのフィルタ。
    fn matching(sys: &System, dir: &Path) -> Vec<(u32, u64, PathBuf)> {
        sys.processes()
            .values()
            .filter_map(|p| {
                let exe = p.exe()?;
                if same_macos_dir(exe, dir) {
                    Some((p.pid().as_u32(), p.start_time(), exe.to_path_buf()))
                } else {
                    None
                }
            })
            .collect()
    }

    /// `/usr/bin/open` 起動＋同定の結果。
    pub enum Launch {
        /// 実アプリ PID を同定できた。
        Resolved {
            pid: u32,
            exe_path: PathBuf,
            start_time: u64,
        },
        /// `open` は成功したが、同期ポーリング窓内に実アプリのプロセスが現れなかった。
        /// `snapshot` / `stop` で `exe_dir` を使って遅延解決する。
        Unresolved { exe_dir: PathBuf, deadline: Instant },
    }

    /// `/usr/bin/open <bundle>` で起動し、実アプリ PID・exe 絶対パス・起動時刻を同定する。
    ///
    /// `open` 自体が失敗した場合のみ `Err`。`open` 成功後に同期窓内で同定できなければ
    /// `Ok(Launch::Unresolved{..})` を返し、遅延解決に委ねる（起動は成功しているため）。
    pub fn launch_app_bundle(bundle: &Path) -> AppResult<Launch> {
        let dir = macos_dir(bundle);

        // プロセス列挙は1つの `System` を使い回す（ポーリングごとの再生成コストを避ける）。
        let mut sys = System::new();
        refresh(&mut sys);

        // before: 既存の一致 PID（手動起動済みインスタンス等）を記録しておく。
        let before: HashSet<u32> = matching(&sys, &dir)
            .into_iter()
            .map(|(pid, _, _)| pid)
            .collect();

        // `/usr/bin/open` は固定絶対パス、バンドルパスは配列引数（文字列連結なし・shell 非経由）。
        // open ヘルパの終了を待つ（LaunchServices への受け渡し完了を待つだけで、アプリ終了は待たない）。
        let status = Command::new("/usr/bin/open")
            .arg(bundle)
            .status()
            .map_err(|_| AppError::launch_failed("プロセスの起動に失敗しました"))?;
        if !status.success() {
            return Err(AppError::launch_failed("プロセスの起動に失敗しました"));
        }

        // 新規に現れた一致 PID を優先して同定する（最大 ~0.5 秒ポーリング）。
        let mut newest_existing: Option<(u32, u64, PathBuf)> = None;
        for attempt in 0..POLL_ATTEMPTS {
            refresh(&mut sys);
            let matches = matching(&sys, &dir);

            let newest_new = matches
                .iter()
                .filter(|(pid, _, _)| !before.contains(pid))
                .max_by_key(|(_, start, _)| *start)
                .cloned();
            if let Some((pid, start, exe)) = newest_new {
                return Ok(Launch::Resolved {
                    pid,
                    exe_path: exe,
                    start_time: start,
                });
            }

            // 新規が最後まで出ない場合（再アクティブ化）に備え、既存一致の最新を控える。
            newest_existing = matches.into_iter().max_by_key(|(_, start, _)| *start);
            // 最終回はこの後すぐ抜けるので待たない（無駄な 1 スリープを省く）。
            if attempt + 1 < POLL_ATTEMPTS {
                sleep(Duration::from_millis(POLL_INTERVAL_MS));
            }
        }

        // 新規 PID が出なかった（既起動アプリの再アクティブ化）: 既存の一致 PID を採用する。
        // ※ 手動起動インスタンスを管理対象に取り込みうる点は docs/security.md §6 の既知の限界。
        if let Some((pid, start, exe)) = newest_existing {
            return Ok(Launch::Resolved {
                pid,
                exe_path: exe,
                start_time: start,
            });
        }

        // 窓内に現れなかった（コールドスタート等）: 起動は成功しているので遅延解決へ。
        Ok(Launch::Unresolved {
            exe_dir: dir,
            deadline: Instant::now() + super::super::registry::RESOLVE_GRACE,
        })
    }

    /// 指定 PID を1件だけリフレッシュし、同定時の `exe` と `start_time` が一致する生存プロセスなら
    /// `Some(true)`。生存するが exe/start_time が食い違う（PID 再利用）場合は `Some(false)`、不在なら `None`。
    fn refresh_one(process_id: u32, exe_path: &Path, start_time: u64) -> Option<bool> {
        let pid = Pid::from_u32(process_id);
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
        sys.process(pid)
            .map(|p| p.exe() == Some(exe_path) && p.start_time() == start_time)
    }

    /// 実アプリ PID を停止する。
    /// - `Some(true)`: kill 送信に成功（停止）
    /// - `Some(false)`: 生存しているが kill 送信に失敗（権限等）
    /// - `None`: 既に終了、または別プロセスが PID を再利用（exe / start_time 不一致）→ **絶対に kill しない**
    ///
    /// PID 再利用ガードは `exe` 一致に加えて `start_time` 一致も要求する。exe 単体だと、同じ実体パスの
    /// 別インスタンス（例: ユーザーが手動で起動し直したもの）へ PID が再割当された場合に取り違えるため。
    pub fn stop_by_pid(process_id: u32, exe_path: &Path, start_time: u64) -> Option<bool> {
        let pid = Pid::from_u32(process_id);
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
        let proc = sys.process(pid)?;
        // PID 再利用ガード: 同定時の exe と start_time の両方が一致しなければ触らない。
        if proc.exe() != Some(exe_path) || proc.start_time() != start_time {
            return None;
        }
        if proc.kill() {
            return Some(true); // SIGKILL 送信成功（Child.kill() と同じ挙動）
        }

        // kill が false を返した場合、「自然終了直前でプロセスが消えていた（ESRCH）」と「生存中だが
        // 送信に失敗」を区別する。もう一度リフレッシュして不在なら既終了扱い（None）にし、「停止失敗」を
        // 誤報告して registry へ dead エントリを戻すのを防ぐ。
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
        );
        match sys.process(pid) {
            // まだ同一プロセスが生存 → 本当に送信失敗。
            Some(p) if p.exe() == Some(exe_path) && p.start_time() == start_time => Some(false),
            // 消えた or 別プロセスへ再利用 → もう居ない扱い。
            _ => None,
        }
    }

    /// 実アプリ PID が生存し、exe と start_time が一致していれば true（= Running）。
    pub fn is_running(process_id: u32, exe_path: &Path, start_time: u64) -> bool {
        refresh_one(process_id, exe_path, start_time).unwrap_or(false)
    }

    /// 未同定（`MacUnresolved`）エントリ停止の結果。
    ///
    /// 「一致プロセスが列挙に無い（まだ起動処理中の可能性）」を、`stop_by_pid` の `None`
    /// （同定直後に消えた/PID 再利用）と**区別する**ために専用 enum で返す。呼び出し側
    /// （[`super::stop_one`]）はこの区別と `deadline` を突き合わせ、コールドスタート中の停止で
    /// エントリを取りこぼさないよう分岐する。
    pub enum UnresolvedStop {
        /// 実 PID を同定して kill 成功。
        Killed(u32),
        /// 同定したが kill 送信失敗（生存・権限等）。
        SendFailed,
        /// 同定直後に消えた／PID 再利用 → もう居ない扱い。
        Gone,
        /// 一致プロセスが列挙に無い（まだ起動処理中の可能性がある）。
        NotAppeared,
    }

    /// 未同定（`MacUnresolved`）エントリの停止。`exe_dir` から実アプリ PID を今解決して停止する。
    /// - 一致プロセスが見つからない → `NotAppeared`（まだ現れていない可能性。呼び出し側が `deadline` で判断）。
    /// - 見つかれば [`stop_by_pid`] に委ねる（`Killed` 停止 / `SendFailed` 送信失敗 / `Gone` もう居ない）。
    pub fn stop_unresolved(exe_dir: &Path) -> UnresolvedStop {
        let sys = refresh_all();
        let best = matching(&sys, exe_dir)
            .into_iter()
            .max_by_key(|(_, start, _)| *start);
        match best {
            Some((pid, start, exe)) => match stop_by_pid(pid, &exe, start) {
                Some(true) => UnresolvedStop::Killed(pid),
                Some(false) => UnresolvedStop::SendFailed,
                None => UnresolvedStop::Gone,
            },
            None => UnresolvedStop::NotAppeared,
        }
    }

    /// 未同定エントリ1件の遅延解決結果。
    pub enum Resolution {
        /// 実アプリ PID を同定できた。以降は `MacResolved` として扱う。
        Resolved {
            pid: u32,
            exe_path: PathBuf,
            start_time: u64,
        },
        /// まだ現れていないが `deadline` 前。楽観的に Running 扱いで据え置く。
        StillPending,
        /// `deadline` を過ぎても現れなかった。終了扱いにして reap する。
        Expired,
    }

    /// 未同定（`MacUnresolved`）エントリ群を **1回の全プロセス列挙**でまとめて遅延解決する。
    ///
    /// - プロセステーブルの列挙は `refresh_all()` を **1度だけ** 行う（`snapshot` の registry ロックは
    ///   保持しない前提で呼ぶこと）。
    /// - `claimed` は既に他エントリ（解決済み含む）が占有する PID の集合。1回の解決内で同一 PID を
    ///   複数エントリが取り合わないよう、割り当てた PID を随時 `claimed` に追加する
    ///   （同一 `.app` 二重起動時の共有 PID 対策）。
    /// - 各 `exe_dir` について、未占有の一致プロセスの中から最新起動（`start_time` 最大）を採用する。
    pub fn resolve_pending(
        pending: &[(String, PathBuf, Instant)],
        claimed: &mut HashSet<u32>,
    ) -> Vec<(String, Resolution)> {
        let sys = refresh_all();
        let now = Instant::now();
        pending
            .iter()
            .map(|(launch_id, dir, deadline)| {
                let best = matching(&sys, dir)
                    .into_iter()
                    .filter(|(pid, _, _)| !claimed.contains(pid))
                    .max_by_key(|(_, start, _)| *start);
                let resolution = match best {
                    Some((pid, start, exe)) => {
                        claimed.insert(pid);
                        Resolution::Resolved {
                            pid,
                            exe_path: exe,
                            start_time: start,
                        }
                    }
                    None if now >= *deadline => Resolution::Expired,
                    None => Resolution::StillPending,
                };
                (launch_id.clone(), resolution)
            })
            .collect()
    }
}

/// Windows で「開く」（前面化）を担う。stream-dock が保持する PID（とその子プロセスツリー）に
/// 属するトップレベルウィンドウを特定し、Win32 API で前面化する（shell 非経由・新規起動しない）。
///
/// docs/security.md 準拠:
/// - 操作対象は stream-dock が起動して registry に保持する PID と、その**子孫プロセス**のみ
///   （＝間接的に自分が起動したもの）。プロセス名だけで他人のウィンドウを探して操作しない（§6）。
/// - frontend から raw PID / ウィンドウハンドルを受け取らない（コマンド側で registry から解決した PID を渡す）。
/// - ウィンドウタイトル等は読み取らず（存在有無のみ判定）、ログ・画面・外部送信もしない（§9）。
#[cfg(windows)]
mod windows {
    use std::collections::HashSet;

    use ::windows::Win32::Foundation::{BOOL, FALSE, HWND, LPARAM, TRUE};
    use ::windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32First, Process32Next, PROCESSENTRY32, TH32CS_SNAPPROCESS,
    };
    use ::windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowTextLengthW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        GW_OWNER, SW_RESTORE, SW_SHOW,
    };

    /// 子プロセスツリー探索の上限（暴走・循環に対する保護）。
    const MAX_TREE_DEPTH: usize = 8;
    const MAX_TREE_NODES: usize = 1024;

    /// `root_pid` とその子孫プロセスの PID 集合を返す。
    ///
    /// `CreateToolhelp32Snapshot` で全プロセスの `(pid, ppid)` を1回取得し、`root_pid` から
    /// 子孫を BFS で辿る。ランチャ／中間プロセスが実ウィンドウを持つ子プロセスを起動する構成に対応する。
    /// PID 再利用で ppid が別プロセスを指しうるため深さ・件数を上限で保護する（既知の限界）。
    fn collect_process_tree(root_pid: u32) -> HashSet<u32> {
        let mut result = HashSet::new();
        result.insert(root_pid);

        // 全プロセスの (pid, ppid) を列挙する。
        let mut edges: Vec<(u32, u32)> = Vec::new();
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return result;
            };
            // PROCESSENTRY32 は Default を導出しないため zeroed で初期化し、dwSize のみ設定する
            // （ToolHelp API の要件）。全体が unsafe ブロック内。
            let mut entry: PROCESSENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;
            if Process32First(snapshot, &mut entry).is_ok() {
                loop {
                    edges.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32Next(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = ::windows::Win32::Foundation::CloseHandle(snapshot);
        }

        // root からの子孫を BFS で収集（深さ・件数の上限で保護）。
        let mut frontier = vec![root_pid];
        let mut depth = 0;
        while !frontier.is_empty() && depth < MAX_TREE_DEPTH && result.len() < MAX_TREE_NODES {
            let mut next = Vec::new();
            for &parent in &frontier {
                for &(pid, ppid) in &edges {
                    // ppid == 0 は System Idle 等の擬似親のため辿らない。
                    if parent != 0 && ppid == parent && !result.contains(&pid) {
                        result.insert(pid);
                        next.push(pid);
                    }
                }
            }
            frontier = next;
            depth += 1;
        }
        result
    }

    /// `EnumWindows` コールバックへ渡す走査状態。lifetime を跨がないよう PID 集合は生ポインタで持つ。
    struct FindCtx {
        pids: *const HashSet<u32>,
        found: Option<HWND>,
    }

    /// `EnumWindows` コールバック。`pids` に属し、可視・オーナー無し・タイトル有りの
    /// トップレベルウィンドウを見つけたら記録して走査を打ち切る。
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut FindCtx);
        let pids = &*ctx.pids;

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || !pids.contains(&pid) {
            return TRUE; // 継続
        }
        // 主ウィンドウの選定: 可視 / オーナー無し（＝ツールウィンドウやダイアログでない） / タイトル有り。
        let visible = IsWindowVisible(hwnd).as_bool();
        let no_owner = GetWindow(hwnd, GW_OWNER).map_or(true, |o| o.0.is_null());
        let has_title = GetWindowTextLengthW(hwnd) > 0;
        if visible && no_owner && has_title {
            ctx.found = Some(hwnd);
            return FALSE; // 発見。走査終了
        }
        TRUE
    }

    /// `pids` のいずれかに属する主ウィンドウを1つ探す。
    fn find_main_window(pids: &HashSet<u32>) -> Option<HWND> {
        let mut ctx = FindCtx {
            pids: pids as *const _,
            found: None,
        };
        unsafe {
            // 見つかると enum_proc が FALSE を返して EnumWindows は Err を返すため、結果は ctx で判定する。
            let _ = EnumWindows(Some(enum_proc), LPARAM(&mut ctx as *mut _ as isize));
        }
        ctx.found
    }

    /// ウィンドウを前面化する。最小化なら復元し、フォアグラウンド制限を回避して最前面に出す。
    fn activate(hwnd: HWND) {
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }

            // SetForegroundWindow のフォアグラウンド制限を回避するため、現在の前面ウィンドウの
            // 入力スレッドへ一時的にアタッチする（AttachThreadInput）。
            let foreground = GetForegroundWindow();
            let mut fg_pid = 0u32;
            let fg_thread = GetWindowThreadProcessId(foreground, Some(&mut fg_pid));
            let cur_thread = GetCurrentThreadId();
            let attached = fg_thread != 0
                && fg_thread != cur_thread
                && AttachThreadInput(cur_thread, fg_thread, TRUE).as_bool();

            let _ = BringWindowToTop(hwnd);
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);

            if attached {
                let _ = AttachThreadInput(cur_thread, fg_thread, FALSE);
            }
        }
    }

    /// 保持 PID（とその子孫）のトップレベルウィンドウを前面化する。見つからなければ no-op。
    pub fn focus_by_pid(root_pid: u32) {
        let pids = collect_process_tree(root_pid);
        if let Some(hwnd) = find_main_window(&pids) {
            activate(hwnd);
        }
    }
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
        return Err(AppError::validation("起動できるツールがありません"));
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
    let started_at = now_rfc3339();

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
        finished_at: now_rfc3339(),
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
            Ok(handle) => {
                // macOS `.app` 未同定時は実 PID がまだ無い（None）。BulkLaunchToolResult.process_id は
                // Option<u32> なのでそのまま None を載せる（起動自体は成功扱い）。
                let process_id = handle.resolved_pid();
                let started_at = now_rfc3339();
                let launch_id = register(
                    registry,
                    tool,
                    Some(preset_id.to_string()),
                    Some(item.id.clone()),
                    handle,
                    started_at.clone(),
                );
                (true, Some(launch_id), process_id, Some(started_at), None)
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

/// 起動結果 [`Handle`] を registry に登録し、採番した launchId を返す。
pub fn register(
    registry: &ProcessRegistry,
    tool: &Tool,
    preset_id: Option<String>,
    preset_item_id: Option<String>,
    handle: Handle,
    started_at: String,
) -> String {
    let launch_id = uuid::Uuid::new_v4().to_string();
    let managed = ManagedProcess {
        launch_id: launch_id.clone(),
        tool_id: tool.id.clone(),
        tool_name: tool.name.clone(),
        preset_id,
        preset_item_id,
        started_at,
        handle,
    };
    registry
        .lock()
        .expect("process registry mutex poisoned")
        .insert(launch_id.clone(), managed);
    launch_id
}

/// registry から取り出した1件を停止し、[`StopProcessResult`] を返す。
///
/// - `Handle::Child`（Windows/Linux/非バンドル）: `try_wait()` が `Ok(Some(_))`（既に終了）→ `already-exited` /
///   まだ動いていれば `kill()` → 成功で `wait()` により終了を回収し `stopped` / kill・try_wait 失敗 → `failed`。
/// - `Handle::MacResolved`（macOS `.app`）: 同定した PID + exe + start_time で停止する（[`macos::stop_by_pid`]）。
///
/// 失敗時のみ `Some(mp)` を返し、呼び出し側が registry へ再挿入して再試行できるようにする。
/// 成功・既に終了済みの場合は `None`（registry から除去したまま破棄）。
pub fn stop_one(mp: ManagedProcess) -> (StopProcessResult, Option<ManagedProcess>) {
    // 結果／再試行用に metadata を先に控え、ハンドルは所有権ごと match で消費する。
    let ManagedProcess {
        launch_id,
        tool_id,
        tool_name,
        preset_id,
        preset_item_id,
        started_at,
        handle,
    } = mp;
    // 未同定を実解決して kill した場合に実 PID を結果へ反映する（未同定の wire 値は 0）。
    let base_process_id = handle.wire_pid();

    // (status, stopped_at, error_message, 失敗時に戻すハンドル, 実解決した PID の上書き値)
    let (status, stopped_at, error_message, keep_handle, resolved_override): (
        StopStatus,
        Option<String>,
        Option<String>,
        Option<Handle>,
        Option<u32>,
    ) = match handle {
        Handle::Child(mut child) => match child.try_wait() {
            Ok(Some(_)) => (StopStatus::AlreadyExited, None, None, None, None),
            Ok(None) => match child.kill() {
                Ok(()) => {
                    // ゾンビを残さないよう終了を回収する。
                    let _ = child.wait();
                    (StopStatus::Stopped, Some(now_rfc3339()), None, None, None)
                }
                Err(_) => (
                    // 再試行できるよう Child を戻して返す。
                    StopStatus::Failed,
                    None,
                    Some("プロセスの停止に失敗しました".to_string()),
                    Some(Handle::Child(child)),
                    None,
                ),
            },
            Err(_) => (
                StopStatus::Failed,
                None,
                Some("プロセスの停止に失敗しました".to_string()),
                Some(Handle::Child(child)),
                None,
            ),
        },
        // macOS `.app`: 同定した PID + exe + start_time で停止する。
        // - kill 成功 → `stopped`
        // - 既に終了 or PID 再利用（exe / start_time 不一致）→ `already-exited`（何も kill しない）
        // - kill 送信失敗 → `failed`（再試行できるよう Some(mp) を返す）
        #[cfg(target_os = "macos")]
        Handle::MacResolved {
            pid,
            exe_path,
            start_time,
        } => match macos::stop_by_pid(pid, &exe_path, start_time) {
            Some(true) => (StopStatus::Stopped, Some(now_rfc3339()), None, None, None),
            None => (StopStatus::AlreadyExited, None, None, None, None),
            Some(false) => (
                StopStatus::Failed,
                None,
                Some("プロセスの停止に失敗しました".to_string()),
                Some(Handle::MacResolved {
                    pid,
                    exe_path,
                    start_time,
                }),
                None,
            ),
        },
        // macOS `.app` 未同定: `exe_dir` から実 PID を今解決して停止する。
        // - Killed → `stopped`（同定した実 PID を結果へ反映）
        // - SendFailed → `failed`（再試行できるようハンドルを戻す）
        // - Gone（同定直後に消えた/再利用）→ `already-exited`
        // - NotAppeared（まだ現れていない）: `deadline` を尊重し、期限前なら `failed` ＋ ハンドルを戻して
        //   再試行可能にする（snapshot の StillPending と対称）。期限超過なら起動しなかった扱いで `already-exited`。
        #[cfg(target_os = "macos")]
        Handle::MacUnresolved { exe_dir, deadline } => match macos::stop_unresolved(&exe_dir) {
            macos::UnresolvedStop::Killed(pid) => {
                (StopStatus::Stopped, Some(now_rfc3339()), None, None, Some(pid))
            }
            macos::UnresolvedStop::SendFailed => (
                StopStatus::Failed,
                None,
                Some("プロセスの停止に失敗しました".to_string()),
                Some(Handle::MacUnresolved { exe_dir, deadline }),
                None,
            ),
            macos::UnresolvedStop::Gone => (StopStatus::AlreadyExited, None, None, None, None),
            macos::UnresolvedStop::NotAppeared => {
                if std::time::Instant::now() >= deadline {
                    // deadline 超過 = 起動しなかった扱い（破棄）。
                    (StopStatus::AlreadyExited, None, None, None, None)
                } else {
                    // まだ起動処理中の可能性。registry へ戻し、アプリ出現後の再 stop で kill できるようにする。
                    (
                        StopStatus::Failed,
                        None,
                        Some(
                            "アプリの起動処理中のため停止できませんでした。少し待って再試行してください"
                                .to_string(),
                        ),
                        Some(Handle::MacUnresolved { exe_dir, deadline }),
                        None,
                    )
                }
            }
        },
    };

    let process_id = resolved_override.unwrap_or(base_process_id);
    let result = StopProcessResult {
        launch_id: launch_id.clone(),
        tool_id: tool_id.clone(),
        tool_name: tool_name.clone(),
        process_id,
        status,
        stopped_at,
        error_message,
    };
    let keep = keep_handle.map(|handle| ManagedProcess {
        launch_id,
        tool_id,
        tool_name,
        preset_id,
        preset_item_id,
        started_at,
        handle,
    });
    (result, keep)
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
/// 注記: `Handle::Child::try_wait()` / `Handle::MacResolved` の単一 PID 確認は軽量な非ブロッキング
/// 呼び出しのため lock を保持したまま走査してよい（kill / wait のようなブロッキング操作は行わない）。
/// ただし macOS の未同定エントリ（`Handle::MacUnresolved`）の遅延解決は全プロセス列挙を伴うため、
/// **ロックを解放してから 1 回だけ**まとめて解決し、再取得して結果を反映する（3フェーズ構成）。
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
    let now = now_rfc3339();

    let mut out: Vec<RuntimeProcess> = Vec::new();
    // 終了・エラーを検知した launchId（走査後に registry から除去する）。
    let mut finished: Vec<String> = Vec::new();

    // macOS 遅延解決用: Phase A で未同定エントリと、既に占有済みの実 PID を収集する。
    #[cfg(target_os = "macos")]
    let mut pending: Vec<(String, std::path::PathBuf, std::time::Instant)> = Vec::new();
    #[cfg(target_os = "macos")]
    let mut claimed: std::collections::HashSet<u32> = std::collections::HashSet::new();

    // Phase A: ロック内で軽量判定（Child::try_wait / MacResolved の単一 PID 確認）。
    //          未同定（MacUnresolved）は重い全列挙を要するため収集のみ行い、ロック外へ回す。
    {
        let mut reg = registry.lock().expect("process registry mutex poisoned");
        for (launch_id, mp) in reg.iter_mut() {
            // 解決済み PID は preset フィルタに関係なく「占有済み」として控え、
            // 遅延解決が他 preset のエントリと同じ PID を二重に取り込むのを防ぐ。
            #[cfg(target_os = "macos")]
            if let Handle::MacResolved { pid, .. } = &mp.handle {
                claimed.insert(*pid);
            }

            if let Some(pid) = preset_id {
                if mp.preset_id.as_deref() != Some(pid) {
                    continue;
                }
            }

            // `&mut mp.handle` の借用は match 式の評価で閉じるため、以降の mp.* 読み取りと衝突しない。
            let (status, ended_at, error_message) = match &mut mp.handle {
                Handle::Child(child) => match child.try_wait() {
                    Ok(None) => (RuntimeProcessStatus::Running, None, None),
                    Ok(Some(_)) => (RuntimeProcessStatus::Stopped, Some(now.clone()), None),
                    Err(_) => (
                        RuntimeProcessStatus::Error,
                        Some(now.clone()),
                        Some("プロセスの状態確認に失敗しました".to_string()),
                    ),
                },
                #[cfg(target_os = "macos")]
                Handle::MacResolved {
                    pid,
                    exe_path,
                    start_time,
                } => {
                    // claimed への登録は上のフィルタ前ブロックで済ませている。
                    if macos::is_running(*pid, exe_path, *start_time) {
                        (RuntimeProcessStatus::Running, None, None)
                    } else {
                        // 実 PID が居ない or exe / start_time 不一致（PID 再利用）→ 終了検知。
                        (RuntimeProcessStatus::Stopped, Some(now.clone()), None)
                    }
                }
                #[cfg(target_os = "macos")]
                Handle::MacUnresolved { exe_dir, deadline } => {
                    // 収集のみ（Phase B でロック外解決、Phase C で push）。
                    pending.push((launch_id.clone(), exe_dir.clone(), *deadline));
                    continue;
                }
            };

            if !matches!(status, RuntimeProcessStatus::Running) {
                finished.push(launch_id.clone());
            }
            out.push(build_runtime(mp, status, ended_at, error_message, &now));
        }
    }

    // Phase B（macOS）: 未同定エントリを **1 回の全列挙**でまとめて解決する（ロック非保持）。
    #[cfg(target_os = "macos")]
    let resolutions = if pending.is_empty() {
        Vec::new()
    } else {
        macos::resolve_pending(&pending, &mut claimed)
    };

    // Phase C: ロックを取り直し、解決結果を反映してから終了検知分を除去する。
    {
        let mut reg = registry.lock().expect("process registry mutex poisoned");

        #[cfg(target_os = "macos")]
        {
            for (launch_id, resolution) in resolutions {
                // Phase A/B の間に stop 等で消えたエントリはスキップ。
                let Some(mp) = reg.get_mut(&launch_id) else {
                    continue;
                };
                match resolution {
                    macos::Resolution::Resolved {
                        pid,
                        exe_path,
                        start_time,
                    } => {
                        // 以降は解決済みとして扱う。
                        mp.handle = Handle::MacResolved {
                            pid,
                            exe_path,
                            start_time,
                        };
                        out.push(build_runtime(mp, RuntimeProcessStatus::Running, None, None, &now));
                    }
                    macos::Resolution::StillPending => {
                        // deadline 前: 起動直後の楽観表示として Running（handle は未同定のまま = pid 0）。
                        out.push(build_runtime(mp, RuntimeProcessStatus::Running, None, None, &now));
                    }
                    macos::Resolution::Expired => {
                        // deadline を過ぎても現れなかった: 起動しなかったものとして終了扱い＋reap。
                        finished.push(launch_id.clone());
                        out.push(build_runtime(
                            mp,
                            RuntimeProcessStatus::Stopped,
                            Some(now.clone()),
                            None,
                            &now,
                        ));
                    }
                }
            }
        }

        // 終了・エラー検知分は registry から除去（ハンドルを drop）。以降は不在として扱う。
        for launch_id in &finished {
            reg.remove(launch_id);
        }
    }

    out
}

/// snapshot の 1 エントリ分の [`RuntimeProcess`] を組み立てる。`process_id` は現在の handle から導出する
/// （解決済みなら実 PID、未同定なら 0）。
fn build_runtime(
    mp: &ManagedProcess,
    status: RuntimeProcessStatus,
    ended_at: Option<String>,
    error_message: Option<String>,
    now: &str,
) -> RuntimeProcess {
    RuntimeProcess {
        launch_id: mp.launch_id.clone(),
        tool_id: mp.tool_id.clone(),
        tool_name: mp.tool_name.clone(),
        preset_id: mp.preset_id.clone(),
        preset_item_id: mp.preset_item_id.clone(),
        process_id: mp.wire_pid(),
        status,
        started_at: mp.started_at.clone(),
        updated_at: now.to_string(),
        ended_at,
        error_message,
    }
}

/// 一括起動結果の error_message を、フロントに出しても安全な短文へ丸める。
///
/// AppError の再設計（011）で、`message` はいずれも安全文言（フルパス・環境情報を含まない）に
/// 統一済みのため、ここでは message をそのまま採用する（サニタイズ境界としての役割は維持）。
fn safe_launch_message(err: &AppError) -> String {
    err.message.clone()
}
