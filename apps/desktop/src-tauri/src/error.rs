use serde::Serialize;
use ts_rs::TS;

/// アプリ共通のエラー型。
/// Tauri command の戻り値 `Result<T, AppError>` としてフロントへ JSON でシリアライズされる。
#[derive(Debug, Serialize, TS)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/tools/bindings/")]
pub enum AppError {
    /// 入力バリデーション違反（必須未入力・空文字など）
    Validation(String),
    /// executablePath が既存ツールと重複
    DuplicatePath(String),
    /// プリセット名が既存プリセットと重複
    DuplicateName(String),
    /// 同一プリセット内に同じツールを重複追加しようとした
    DuplicateToolInPreset(String),
    /// 指定された実行ファイルパスが存在しない
    PathNotFound(String),
    /// 対象のツールが見つからない
    NotFound(String),
    /// SQLite / IO などの内部エラー
    Db(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Validation(m) => write!(f, "Validation error: {m}"),
            AppError::DuplicatePath(m) => write!(f, "Duplicate path: {m}"),
            AppError::DuplicateName(m) => write!(f, "Duplicate name: {m}"),
            AppError::DuplicateToolInPreset(m) => write!(f, "Duplicate tool in preset: {m}"),
            AppError::PathNotFound(m) => write!(f, "Path not found: {m}"),
            AppError::NotFound(m) => write!(f, "Not found: {m}"),
            AppError::Db(m) => write!(f, "DB error: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
