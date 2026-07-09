use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::Instant;

/// stream-dock が「現在のアプリ起動セッション中」に起動したプロセス1件のハンドル表現。
///
/// 停止（009）・状態監視（010）は「stream-dock が起動したプロセスだけを対象にする」
/// （docs/security.md §6）を満たす。プラットフォーム／起動経路ごとに掴めるものが異なるため、
/// 不正な組み合わせを表現不能にするよう enum で分岐する:
/// - `Child`（Windows/Linux/非バンドル）: 自分が spawn した子。try_wait / kill / wait で操作でき、
///   PID 再利用による誤停止を避けられる。
/// - `MacResolved`（macOS `.app`）: 013 では `/usr/bin/open`（LaunchServices）経由起動のため掴む
///   Child が実アプリにならない。起動後に同定した実アプリの PID・実体バイナリ絶対パス（`exe_path`）・
///   起動時刻（`start_time`）で管理する。停止/状態確認の直前に PID の現在の exe と start_time が
///   同定時と一致することを再検証し、PID 再利用を弾く。
/// - `MacUnresolved`（macOS `.app`）: `/usr/bin/open` は成功したが、同定ポーリング窓の内に実アプリの
///   プロセスが現れなかった状態（大型アプリのコールドスタート等）。起動自体は成功しているため
///   `Err` にせずこの状態で登録し、以降の `snapshot` / `stop` で `exe_dir`（同定対象ディレクトリ）を
///   使って遅延解決する。`deadline` を過ぎても解決できなければ終了扱いで reap する。
pub enum Handle {
    /// Windows/Linux/非バンドル: 自分が spawn した子。pid は `child.id()`。
    Child(Child),
    /// macOS `.app`: 同定済みの実アプリ PID。`exe_path` + `start_time` を PID 再利用ガードに使う。
    #[cfg(target_os = "macos")]
    MacResolved {
        pid: u32,
        exe_path: PathBuf,
        start_time: u64,
    },
    /// macOS `.app`: `open` 成功後、実 PID 未同定（遅延解決待ち）。
    #[cfg(target_os = "macos")]
    MacUnresolved {
        /// 同定対象の canonical な `<bundle>/Contents/MacOS`。遅延解決の照合に使う。
        exe_dir: PathBuf,
        /// この時刻を過ぎても解決できなければ「起動しなかった」とみなし終了扱いで reap する。
        deadline: Instant,
    },
}

impl Handle {
    /// 同定済みの実 PID を返す。未同定（`MacUnresolved`）なら `None`。
    /// wire 値の決定（[`Self::wire_pid`]）と、ログ／`Option<u32>` の wire 反映に使う。
    pub fn resolved_pid(&self) -> Option<u32> {
        match self {
            Handle::Child(child) => Some(child.id()),
            #[cfg(target_os = "macos")]
            Handle::MacResolved { pid, .. } => Some(*pid),
            #[cfg(target_os = "macos")]
            Handle::MacUnresolved { .. } => None,
        }
    }

    /// frontend / ログ / API 戻り値へ出す `process_id: u32`（wire 値）を導出する。
    /// wire 型は不変（u32）。未同定は `0`（`commands.rs` の NotFound 経路と同じ前例）で、
    /// フロントは診断画面の表示テキスト以外で使わないため安全。
    pub fn wire_pid(&self) -> u32 {
        self.resolved_pid().unwrap_or(0)
    }
}

/// stream-dock が「現在のアプリ起動セッション中」に起動したプロセス1件の管理レコード。
///
/// 停止（009）・状態監視（010）は [`Handle`] を通じて行い、frontend へは停止操作用に
/// `launch_id` のみを返す（raw PID を受け取って kill しない）。
pub struct ManagedProcess {
    /// Rust 側で採番する停止操作用の識別子（frontend から stop 時に渡ってくる）。
    pub launch_id: String,
    pub tool_id: String,
    pub tool_name: String,
    /// 008 一括起動で登録したときのみ Some（Preset 単位停止の絞り込みに使う）。
    pub preset_id: Option<String>,
    /// 008 一括起動で登録したときのみ Some。010 Runtime Status / 013 で
    /// どの PresetItem 由来かを辿れるよう保持する（010 のスナップショットで返す）。
    pub preset_item_id: Option<String>,
    /// 起動時刻。010 Runtime Status のスナップショット表示に使う。
    pub started_at: String,
    /// 停止・状態監視に使うハンドル（プラットフォーム／起動経路で分岐）。
    pub handle: Handle,
}

impl ManagedProcess {
    /// API 戻り値 / ログ用の `process_id: u32`（wire 値）を返す。
    pub fn wire_pid(&self) -> u32 {
        self.handle.wire_pid()
    }
}

/// macOS の遅延解決に必要な猶予時間。`open` 成功後この時間内に実アプリのプロセスを同定できなければ
/// 「起動しなかった」とみなして終了扱いにする（コールドスタートを考慮して余裕を持たせる）。
#[cfg(target_os = "macos")]
pub const RESOLVE_GRACE: std::time::Duration = std::time::Duration::from_secs(10);

/// launch_id をキーに [`ManagedProcess`] を保持する runtime registry。
///
/// lib.rs の setup で `app.manage(...)` により State として共有する。
/// メモリ上のみ（永続化しない）。アプリ再起動で失われる ＝ 009 は current session 限定
/// （PID 再利用の危険があるため過去セッションのプロセスは停止対象にしない）。
pub type ProcessRegistry = Mutex<HashMap<String, ManagedProcess>>;
