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
