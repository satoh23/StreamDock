use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// frontend に返すエラーコード（機械可読な分類）。
///
/// `AppError.code` と `AppLogEntry.errorCode` の両方で共有する。
/// serde/ts-rs では `SCREAMING_SNAKE_CASE`（例: `VALIDATION_ERROR`）の文字列にシリアライズされる。
/// Deserialize は app_logs が DB の文字列から復元する際に使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub enum ErrorCode {
    ValidationError,
    NotFound,
    UnsupportedFileType,
    LaunchFailed,
    BulkLaunchPartialFailed,
    BulkLaunchFailed,
    StopFailed,
    ProcessAlreadyExited,
    RuntimeStatusFailed,
    StorageFailed,
    PermissionDenied,
    InternalError,
    DuplicatePath,
    DuplicateName,
    DuplicateToolInPreset,
    UpdateCheckFailed,
    UpdateInstallFailed,
}

impl ErrorCode {
    /// ログ／診断サマリーに記録する用の、ユーザー入力を含まない定型文言。
    ///
    /// `AppError.message`（frontend 向けで、プリセット名など詳細を含めてよい）とは役割が異なる。
    /// app_logs に記録する error ログの本文には、raw な `message` ではなくこの固定文言を使う。
    /// これにより、プリセット名やエンティティ ID など自由入力が message 経由で共有用サマリーへ
    /// 流出するのを構造的に防ぐ（docs/security.md §9）。CRUD command（`log_command_err` 経由）と
    /// process command の双方でこの原則に統一している。ID や tool 表示名など識別に必要な値は
    /// message ではなく専用フィールド（tool_id / preset_id / tool_name 等）に入れる。
    /// そのため各文言はフルパス・ユーザー入力・環境情報を一切含まない静的文字列に限定する。
    pub fn log_message(&self) -> &'static str {
        match self {
            ErrorCode::ValidationError => "入力内容に問題があります。",
            ErrorCode::NotFound => "対象が見つかりません。",
            ErrorCode::UnsupportedFileType => "このファイル形式は現在未対応です。",
            ErrorCode::LaunchFailed => "ツールの起動に失敗しました。",
            ErrorCode::BulkLaunchPartialFailed => "一部のツールを起動できませんでした。",
            ErrorCode::BulkLaunchFailed => "一括起動に失敗しました。",
            ErrorCode::StopFailed => "プロセスの停止に失敗しました。",
            ErrorCode::ProcessAlreadyExited => "プロセスは既に終了していました。",
            ErrorCode::RuntimeStatusFailed => "プロセスの状態確認に失敗しました。",
            ErrorCode::StorageFailed => "アプリ内の保存処理に失敗しました。",
            ErrorCode::PermissionDenied => "権限がありません。",
            ErrorCode::InternalError => "予期しないエラーが発生しました。",
            ErrorCode::DuplicatePath => "同じ実行ファイルパスのツールが既に登録されています。",
            ErrorCode::DuplicateName => "同じ名前のプリセットが既に登録されています。",
            ErrorCode::DuplicateToolInPreset => "このツールは既にプリセットに追加されています。",
            ErrorCode::UpdateCheckFailed => "更新の確認に失敗しました。",
            ErrorCode::UpdateInstallFailed => "更新のインストールに失敗しました。",
        }
    }
}

/// アプリ共通のエラー型。
///
/// Tauri command の戻り値 `Result<T, AppError>` としてフロントへ JSON でシリアライズされる。
/// wire 形式は `{ code, message, details?, operation?, occurredAt }`。
///
/// - `message`: ユーザー向けの安全な文言（フルパス・環境変数・stack trace・secret を含めない）
/// - `details`: UI に表示しても安全な補足情報（ファイル名のみ等。フルパス・環境情報は入れない）
/// - `operation`: どの操作で起きたか（任意）
/// - `occurred_at`: 構築時刻（RFC3339）
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[ts(optional)]
    pub details: Option<String>,
    #[ts(optional)]
    pub operation: Option<String>,
    pub occurred_at: String,
}

impl AppError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        AppError {
            code,
            message: message.into(),
            details: None,
            operation: None,
            occurred_at: crate::util::now_rfc3339(),
        }
    }

    /// 入力バリデーション違反（必須未入力・空文字など）
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ValidationError, message)
    }
    /// 対象（ツール・プリセット・実行ファイル等）が見つからない
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }
    /// 登録された実行ファイルパスが存在しない（NotFound に寄せる。message は安全文言にすること）
    pub fn path_not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }
    /// executablePath が既存ツールと重複
    pub fn duplicate_path(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::DuplicatePath, message)
    }
    /// プリセット名が既存プリセットと重複
    pub fn duplicate_name(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::DuplicateName, message)
    }
    /// 同一プリセット内に同じツールを重複追加しようとした
    pub fn duplicate_tool_in_preset(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::DuplicateToolInPreset, message)
    }
    /// プロセスの起動に失敗した（spawn 失敗）。詳細な環境情報は含めない。
    pub fn launch_failed(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::LaunchFailed, message)
    }
    /// `.lnk` / `.bat` など未対応形式を起動しようとした
    pub fn unsupported_file_type(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::UnsupportedFileType, message)
    }
    /// SQLite / IO などの保存処理エラー。生エラー文字列は載せない。
    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::StorageFailed, message)
    }
    /// 予期しない内部エラー
    #[allow(dead_code)]
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InternalError, message)
    }
    /// 055b: アプリの更新確認に失敗した（ネットワーク到達不可 / エンドポイント 404 /
    /// `latest.json` の JSON 破損 / 署名検証失敗を**すべてここに寄せる**）。
    ///
    /// **引数を取らない**のは意図的で、呼び出し側が生エラーを載せられないようにするため。
    /// ⚠ `tauri-plugin-updater` の `Error::Reqwest` は `#[error(transparent)]` で、reqwest の Display は
    /// **エンドポイント URL を含む**（`error sending request for url (https://…)`）。`Error::Network(String)`
    /// も同様。`From<rusqlite::Error>` が DB パスを含みうる生エラー文字列を落としているのとまったく同じ理由で、
    /// **生エラーは frontend にも log にも載せない**（docs/security.md §9）。呼び出し側は必ず
    /// `map_err(|_| AppError::update_check_failed())` の形にし、エラー値を束縛しないこと。
    ///
    /// 種別（到達不可 / 404 / JSON 破損 / 署名検証失敗）で code を分けないのは、①plugin 側で 404 と
    /// JSON 破損が `last_error` / `ReleaseNotFound` に合流しており綺麗に分かれない ②UI 上ユーザーが
    /// 取れる行動が全ケース同一（後で再試行する）③粒度そのものがネットワーク/エンドポイント状態の
    /// 情報になる（§9）ため。再修正トリガー＝099b の実機 E2E で「署名検証失敗だけ別扱いにしたい」
    ///（＝鍵ローテ事故の検出）が出たら、そのとき 1 個だけ足す。
    ///
    /// なお「更新なし」は `Err` ではなく `Ok(AppUpdateStatus { available: false, .. })` で返す。
    /// 「更新なし」と「確認できなかった」を 055c が別表示にできるよう、**ここへ潰さない**こと。
    pub fn update_check_failed() -> Self {
        Self::new(
            ErrorCode::UpdateCheckFailed,
            "更新の確認に失敗しました。時間をおいて再度お試しください。",
        )
    }

    /// 055d: アプリ更新のダウンロード／インストールに失敗した（DL 途中の切断 / read タイムアウト /
    /// **minisign 署名検証失敗** / アーカイブ展開失敗 / 自己置換の権限不足を**すべてここに寄せる**）。
    ///
    /// **引数を取らない**理由は `update_check_failed()` とまったく同じ（生エラーに URL やローカルパスが
    /// 入る・§9）。呼び出し側は必ず `map_err(|_| AppError::update_install_failed())` の形にすること。
    /// ⚠ DL 経路の生エラーは URL に加えて**一時ディレクトリの絶対パス**（`/var/folders/…/tauri_updated_app…`）や
    /// インストール先（`/Applications/StreamDock.app`）も含みうるので、`update_check_failed()` より
    /// 漏らしてはいけない情報が多い。
    ///
    /// **`UpdateCheckFailed` と分けた理由**: `ErrorCode::log_message()` は
    /// `UpdateCheckFailed => "更新の確認に失敗しました。"` を返すので、インストール失敗に流用すると
    /// **文言が事実と食い違う**。一方で 055b が確定した「**種別（到達不可 / 404 / JSON 破損 /
    /// 署名検証失敗）で細かく分けない**」方針はそのまま維持する＝分ける軸は「確認」対「インストール」の
    /// 2 つだけ。ユーザーが取れる行動（後で再試行する）はどちらも同じなので、これ以上は増やさない。
    /// 再修正トリガー＝099b の実機 E2E で「署名検証失敗だけ別扱いにしたい」（＝鍵ローテ事故の検出）が
    /// 出たら、そのとき 1 個だけ足す。
    ///
    /// なお `install_app_update` は「押した時点では更新があったが、再 check したら無かった」場合も
    /// `Ok(())` を返す（ここへ潰さない）。詳細は `app_update::commands::install_app_update` の注記。
    pub fn update_install_failed() -> Self {
        Self::new(
            ErrorCode::UpdateInstallFailed,
            "更新のインストールに失敗しました。時間をおいて再度お試しください。",
        )
    }

    /// UI 表示可の補足情報を付与する（ファイル名のみ等。フルパス・環境情報は入れない）。
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }
    /// どの操作で発生したかを付与する。
    ///
    /// 【未配線・意図的に残置】`operation` は wire（`AppErrorResponse`）の予約フィールドだが、
    /// 011 では error code + message で原因追跡に足りるため、どの command でも設定していない
    /// （常に None）。
    /// どうなったら配線するか: frontend がエラー発生元の操作名で分岐・表示したくなったとき。
    /// その時点で各 command の Err 経路に `.with_operation("launch_tool")` 等を付ける。
    /// 今削除しない理由: 型／bindings を安定させ、配線時に wire を再変更しないための予約枠。
    #[allow(dead_code)]
    pub fn with_operation(mut self, operation: impl Into<String>) -> Self {
        self.operation = Some(operation.into());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(_e: rusqlite::Error) -> Self {
        // rusqlite の生エラー文字列は DB パス等を含みうるため、frontend にも log にも載せない。
        // 開発者向けには code=StorageFailed で保存処理失敗と分かるようにする。
        AppError::storage("アプリ内の保存処理に失敗しました。")
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    //! `ErrorCode` の wire 形式と、055b で追加した `update_check_failed()` の仕様テスト。
    //!
    //! あるべき挙動（docs/security.md §9 / docs/tasks/055b / docs/progress.md 055b ④）:
    //! - `ErrorCode` は SCREAMING_SNAKE_CASE の文字列として送受される。この文字列は
    //!   **`ErrorCode.ts`（ts-rs 生成）と app_logs の DB 復元の両方が依存する契約**なので、
    //!   variant 名を変えても wire 名が変わらないよう固定する。
    //! - **DB 文字列 → `ErrorCode` の復元（app_logs）が往復する**。055b で variant を 1 個足したが、
    //!   既存 variant の復元を壊していないこと（レビュー観点「共有部の非退行」）。
    //! - `AppError::update_check_failed()` は**固定の安全文言だけ**を持ち、
    //!   エンドポイント URL・ホスト名・スキームを一切含まない（§9）。付帯情報（details / operation）も空。
    use super::*;

    /// app_logs が DB の文字列から復元するときと**同じ経路**（`repository::enum_from_db`）。
    /// 実装が変わったらこちらも合わせること。
    fn from_db_string(s: &str) -> Option<ErrorCode> {
        serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
    }

    /// 各 variant の **wire 名（＝frontend と DB に出る文字列）**。
    ///
    /// ⚠ **網羅はコンパイラが強制する**（`match` に arm を足さないとビルドが通らない）。
    /// variant を追加したらここへ wire 名を書くこと。そのとき `ALL` にも足す。
    fn wire_name(code: ErrorCode) -> &'static str {
        match code {
            ErrorCode::ValidationError => "VALIDATION_ERROR",
            ErrorCode::NotFound => "NOT_FOUND",
            ErrorCode::UnsupportedFileType => "UNSUPPORTED_FILE_TYPE",
            ErrorCode::LaunchFailed => "LAUNCH_FAILED",
            ErrorCode::BulkLaunchPartialFailed => "BULK_LAUNCH_PARTIAL_FAILED",
            ErrorCode::BulkLaunchFailed => "BULK_LAUNCH_FAILED",
            ErrorCode::StopFailed => "STOP_FAILED",
            ErrorCode::ProcessAlreadyExited => "PROCESS_ALREADY_EXITED",
            ErrorCode::RuntimeStatusFailed => "RUNTIME_STATUS_FAILED",
            ErrorCode::StorageFailed => "STORAGE_FAILED",
            ErrorCode::PermissionDenied => "PERMISSION_DENIED",
            ErrorCode::InternalError => "INTERNAL_ERROR",
            ErrorCode::DuplicatePath => "DUPLICATE_PATH",
            ErrorCode::DuplicateName => "DUPLICATE_NAME",
            ErrorCode::DuplicateToolInPreset => "DUPLICATE_TOOL_IN_PRESET",
            ErrorCode::UpdateCheckFailed => "UPDATE_CHECK_FAILED",
            ErrorCode::UpdateInstallFailed => "UPDATE_INSTALL_FAILED",
        }
    }

    const ALL: [ErrorCode; 17] = [
        ErrorCode::ValidationError,
        ErrorCode::NotFound,
        ErrorCode::UnsupportedFileType,
        ErrorCode::LaunchFailed,
        ErrorCode::BulkLaunchPartialFailed,
        ErrorCode::BulkLaunchFailed,
        ErrorCode::StopFailed,
        ErrorCode::ProcessAlreadyExited,
        ErrorCode::RuntimeStatusFailed,
        ErrorCode::StorageFailed,
        ErrorCode::PermissionDenied,
        ErrorCode::InternalError,
        ErrorCode::DuplicatePath,
        ErrorCode::DuplicateName,
        ErrorCode::DuplicateToolInPreset,
        ErrorCode::UpdateCheckFailed,
        ErrorCode::UpdateInstallFailed,
    ];

    #[test]
    fn every_code_serializes_to_its_pinned_wire_name() {
        // `ErrorCode.ts` と app_logs の DB 値がこの文字列に依存している。
        for code in ALL {
            let json = serde_json::to_string(&code).expect("ErrorCode は直列化できる");
            assert_eq!(
                json,
                format!("\"{}\"", wire_name(code)),
                "{code:?} の wire 名が変わった（ErrorCode.ts と app_logs の既存レコードが壊れる）"
            );
        }
    }

    #[test]
    fn every_code_round_trips_from_the_db_string() {
        // app_logs は DB に入った文字列から復元する。055b の variant 追加で既存の復元が壊れていないこと。
        for code in ALL {
            assert_eq!(
                from_db_string(wire_name(code)),
                Some(code),
                "{code:?} が DB 文字列から復元できない（app_logs の error_code が欠落する）"
            );
        }
    }

    #[test]
    fn unknown_db_string_degrades_to_none_instead_of_panicking() {
        // 将来 code を削除・改名しても、古いレコードの読み出しで落ちない（劣化して None）。
        assert_eq!(from_db_string("NO_SUCH_CODE"), None);
        assert_eq!(from_db_string(""), None);
        // 過去に書かれた小文字表記なども None に落ちるだけで panic しない。
        assert_eq!(from_db_string("update_check_failed"), None);
    }

    #[test]
    fn update_check_failed_carries_only_a_fixed_safe_message() {
        // §9: updater / reqwest の生エラーは**エンドポイント URL を含む**ため、
        // ここには固定文言以外を載せない。引数を取らない設計なので構造的に載せられない。
        let e = AppError::update_check_failed();
        assert_eq!(e.code, ErrorCode::UpdateCheckFailed);
        assert_eq!(e.message, "更新の確認に失敗しました。時間をおいて再度お試しください。");
        // 付帯情報の経路からも漏らさない。
        assert_eq!(e.details, None);
        assert_eq!(e.operation, None);
    }

    #[test]
    fn update_install_failed_carries_only_a_fixed_safe_message() {
        // 055d: 確認側とまったく同じ構え（引数を取らない＝生エラーを構造的に載せられない）。
        let e = AppError::update_install_failed();
        assert_eq!(e.code, ErrorCode::UpdateInstallFailed);
        assert_eq!(
            e.message,
            "更新のインストールに失敗しました。時間をおいて再度お試しください。"
        );
        assert_eq!(e.details, None);
        assert_eq!(e.operation, None);
    }

    #[test]
    fn update_failures_never_leak_the_endpoint_or_local_paths() {
        // frontend へ渡る JSON と、app_logs へ書かれる固定文言の**両方**を検査する
        //（実装が message ではなく log_message 経由で漏らす退行も止めるため）。
        //
        // ⚠ 055d でインストール側を足したので**両方の code を回す**。DL/インストールの生エラーは
        // URL に加えて一時ディレクトリやインストール先の**絶対パス**も含みうるため、
        // パス断片も leak 語彙に入れている（§9）。
        for (code, error) in [
            (ErrorCode::UpdateCheckFailed, AppError::update_check_failed()),
            (
                ErrorCode::UpdateInstallFailed,
                AppError::update_install_failed(),
            ),
        ] {
            let json = serde_json::to_string(&error).expect("AppError は直列化できる");
            let log = code.log_message();
            for leak in [
                "http",
                "github",
                "githubusercontent",
                "StreamDock-releases",
                "latest.json",
                "://",
                "/Users/",
                "/var/folders",
                "/Applications",
                "tauri_updated_app",
                "tauri_current_app",
                ".app.tar.gz",
            ] {
                assert!(
                    !json.contains(leak),
                    "{code:?} の JSON に {leak:?} が含まれている（§9: URL/パスを frontend へ出さない）"
                );
                assert!(
                    !log.contains(leak),
                    "{code:?} のログ文言に {leak:?} が含まれている（§9: URL/パスを log へ出さない）"
                );
            }
            // wire 形式そのもの（055c / 055d がこの code 文字列で分岐しうる）。
            assert!(json.contains(&format!("\"code\":\"{}\"", wire_name(code))));
        }
    }
}
