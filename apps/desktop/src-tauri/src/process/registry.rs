use std::collections::HashMap;
use std::process::Child;
use std::sync::Mutex;

/// stream-dock が「現在のアプリ起動セッション中」に起動したプロセス1件の管理レコード。
///
/// 停止（009）は raw PID ではなく、この `child`（[`std::process::Child`] ハンドル）を用いて行う。
/// これにより PID 再利用による誤停止を避け、「stream-dock が起動したプロセスだけを停止する」
/// （docs/security.md §6）を満たす。frontend へは停止操作用に `launch_id` のみを返す。
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
    pub process_id: u32,
    /// 起動時刻。010 Runtime Status のスナップショット表示に使う。
    pub started_at: String,
    /// 起動したプロセスのハンドル。stop 時に try_wait / kill / wait に使う。
    pub child: Child,
}

/// launch_id をキーに [`ManagedProcess`] を保持する runtime registry。
///
/// lib.rs の setup で `app.manage(...)` により State として共有する。
/// メモリ上のみ（永続化しない）。アプリ再起動で失われる ＝ 009 は current session 限定
/// （PID 再利用の危険があるため過去セッションのプロセスは停止対象にしない）。
pub type ProcessRegistry = Mutex<HashMap<String, ManagedProcess>>;
