//! 018 Tool Icon Auto-Extraction。
//!
//! ユーザーがピッカーで選択した実行ファイルパスから**実アイコン**を抽出し、`data:` プレフィックス
//! 無しの base64 PNG（≤128px）を返す。抽出はベストエフォートで、非対応形式・失敗・パス検証 NG は
//! すべて `Ok(None)`（frontend は文字ラベルにフォールバック）。
//!
//! セキュリティ（docs/security.md §3/§4/§7/§9）:
//! - **読み取り専用**。書き込み・削除・外部通信は一切行わない。
//! - 抽出前に `process/service.rs::validate_executable` 相当のパス検証を行い、検証を通った
//!   ユーザー選択パスのみを read する（汎用ファイル読取にはしない）。
//! - 出力は ≤128px に制限（DB 肥大化防止）。エラー詳細（フルパス等）は返さず `Ok(None)` に丸める。
//!
//! プラットフォーム別:
//! - macOS `.app`: Info.plist の `CFBundleIconFile` → `Contents/Resources/<name>.icns` を PNG 化。
//! - Windows `.exe` / Linux / 非バンドル / スクリプト: 現状 `Ok(None)`（Windows は別タスクで実装）。

use std::path::{Path, PathBuf};

use crate::error::AppResult;

/// 実行ファイルパスからアイコン（base64 PNG）を抽出する。非対応・失敗時は `Ok(None)`。
pub fn extract_app_icon(path: &str) -> AppResult<Option<String>> {
    // 検証を通ったパスのみ read する。NG はフローを止めず Ok(None)。
    let Some(validated) = validate_icon_path(path) else {
        return Ok(None);
    };

    #[cfg(target_os = "macos")]
    {
        Ok(macos::extract(&validated))
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows(.exe) / Linux / 非バンドルは現状未対応（文字フォールバック）。
        let _ = validated;
        Ok(None)
    }
}

/// `validate_executable` 相当のパス検証（読み取り可否の判定用）。
///
/// 017/007 の検証と強度を揃える（非空・絶対・実在・非ディレクトリ〔macOS `.app` バンドルのみ例外〕・
/// `.lnk`/`.bat` 拒否）。ただし本コマンドはベストエフォートのため `AppError` ではなく
/// `Option`（NG は `None`）で返し、呼び出し側で `Ok(None)` にフォールバックする。
/// `process/service.rs::validate_executable`（起動系）は 017 で確定済みのため変更しない。
fn validate_icon_path(path: &str) -> Option<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let p = Path::new(trimmed);
    if !p.is_absolute() || !p.exists() {
        return None;
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);

    // .lnk（ショートカット）/ .bat（バッチ）は対象外。
    if matches!(ext.as_deref(), Some("lnk") | Some("bat")) {
        return None;
    }

    // ディレクトリは拒否。ただし macOS の `.app` バンドルのみ例外的に許可する。
    let is_app_bundle = cfg!(target_os = "macos") && p.is_dir() && ext.as_deref() == Some("app");
    if p.is_dir() && !is_app_bundle {
        return None;
    }

    Some(p.to_path_buf())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::{Path, PathBuf};

    use base64::Engine;

    /// 最大出力辺（px）。DB 肥大化防止のため ≤128px にリサイズする。
    const MAX_ICON_PX: u32 = 128;

    /// `.app` バンドルから実アイコンを抽出し base64 PNG を返す。非対応・失敗時は `None`。
    pub fn extract(path: &Path) -> Option<String> {
        // `.app` バンドルのみ対象（それ以外の macOS 実行ファイルは埋め込みアイコンを持たない）。
        let is_app = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("app"));
        if !is_app {
            return None;
        }

        // 主経路: Info.plist の `CFBundleIconFile` → `Contents/Resources/<name>.icns`（pure-Rust）。
        if let Some(icns_path) = resolve_icns(path) {
            if let Some(png) = icns_to_png_base64(&icns_path) {
                return Some(png);
            }
        }

        // フォールバック: `.icns` を持たない `.app`（アイコンが `Assets.car` 内にのみ存在する
        // Calendar 等の Apple システムアプリ）は AppKit の `NSWorkspace` で実アイコンを取得する。
        nsworkspace_icon_png(path)
    }

    /// Info.plist の `CFBundleIconFile` から `.icns` の実パスを解決する。
    fn resolve_icns(app: &Path) -> Option<PathBuf> {
        let info_plist = app.join("Contents/Info.plist");
        // plist は XML/バイナリ両対応。読み取りのみ。
        let value = plist::Value::from_file(&info_plist).ok()?;
        let icon_file = value
            .as_dictionary()?
            .get("CFBundleIconFile")?
            .as_string()?
            .trim();
        // `CFBundleIconFile` は Resources 直下のベース名のみを想定する。Info.plist は信頼しないため、
        // パス区切り（`/` `\`）や親参照（`..`）を含む値はバンドル外読み取り（パストラバーサル）を防ぐ
        // ため拒否する（docs/security.md §7/§8）。
        if icon_file.is_empty()
            || icon_file.contains('/')
            || icon_file.contains('\\')
            || icon_file.contains("..")
        {
            return None;
        }

        // 拡張子が無ければ `.icns` を補完する。`.icns` 以外の拡張子が付いている場合はそのまま扱い、
        // 後段の `icns::IconFamily::read` が失敗して `None` になる（＝主経路を諦めて後述の NSWorkspace
        // フォールバックへ流す）。ここで無理に別形式を扱わないのは意図的で、非 `.icns` や解決不能な
        // `CFBundleIconFile` はエラーではなく「フォールバックで救済すべきケース」として設計している。
        let mut file_name = icon_file.to_string();
        if Path::new(&file_name).extension().is_none() {
            file_name.push_str(".icns");
        }

        // 実在しなければ `None` を返し、`extract` 側で NSWorkspace フォールバックに委ねる（意図的）。
        let icns_path = app.join("Contents/Resources").join(&file_name);
        icns_path.exists().then_some(icns_path)
    }

    /// `.icns` をデコードし、最大サイズのアイコンを ≤128px PNG(base64) にする。
    fn icns_to_png_base64(icns_path: &Path) -> Option<String> {
        let file = std::fs::File::open(icns_path).ok()?;
        let family = icns::IconFamily::read(std::io::BufReader::new(file)).ok()?;

        // 利用可能なアイコンのうち最大解像度のものを選ぶ。
        let icon_type = family
            .available_icons()
            .into_iter()
            .max_by_key(|t| t.pixel_width())?;
        let decoded = family.get_icon_with_type(icon_type).ok()?;
        let rgba = decoded.convert_to(icns::PixelFormat::RGBA);

        let buffer = image::RgbaImage::from_raw(rgba.width(), rgba.height(), rgba.data().to_vec())?;
        encode_png_base64(image::DynamicImage::ImageRgba8(buffer))
    }

    /// `NSWorkspace` フォールバック。ユーザー選択済みパスの Finder 表示アイコンを取得し ≤128px PNG(base64)
    /// にする。`.icns` を持たない `.app`（アセットカタログのみ）でも解決できる。失敗時は `None`。
    ///
    /// 読み取り専用（アイコン取得のみ・書き込み/外部通信なし）。呼び出しは `validate_icon_path` を
    /// 通過したパスに限定する。
    ///
    /// スレッドについて: 本関数は `#[tauri::command] extract_app_icon`（同期コマンド）経由で Tauri の
    /// ワーカースレッドから呼ばれる。`NSWorkspace.iconForFile:` / `TIFFRepresentation` はいずれも
    /// 読み取り系 API で、非メインスレッドからの呼び出しでも実用上問題にならないため、あえて
    /// `run_on_main_thread` 等でメインスレッドへディスパッチしていない（アイコン抽出はベストエフォート
    /// であり、そのためだけにスレッド往復の複雑さを持ち込まない）。仮に取得に失敗しても、以下は
    /// すべて `?` で `None` に丸まりパニックしないので、フォールバックの失敗が呼び出しフローを止めない。
    fn nsworkspace_icon_png(path: &Path) -> Option<String> {
        use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
        use objc2_foundation::{NSDictionary, NSString};

        let ns_path = NSString::from_str(path.to_str()?);
        let workspace = NSWorkspace::sharedWorkspace();
        let image = workspace.iconForFile(&ns_path);
        // NSImage → TIFF → NSBitmapImageRep → PNG バイト列。
        let tiff = image.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
        // 空のプロパティで PNG エンコード（`properties` は当該 storage_type に対し空辞書で妥当）。
        // `representationUsingType:properties:` は unsafe（generics 整合が呼び出し側責任）。
        let png_data = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }?;

        // NSBitmapImageRep が生成した PNG をここで**あえて再デコード**し、`encode_png_base64` の
        // 共通リサイズ経路（≤128px 上限を一元管理）に合流させる。stride やカラースペースの差異を
        // 自前で扱わずに済ませるための意図的なトレードオフで、無駄な二度手間ではない。TIFF を直接
        // デコードしないのは、`image` を `png` feature のみで有効化して依存面を最小化しているため
        // （TIFF コーデックは持たない前提）。よって上段で必ず PNG に変換してから読み込む。
        let dynamic = image::load_from_memory_with_format(&png_data.to_vec(), image::ImageFormat::Png)
            .ok()?;
        encode_png_base64(dynamic)
    }

    /// アスペクト維持で ≤128px に縮小（元が ≤128px ならそのまま）し、PNG(base64) にエンコードする共通処理。
    fn encode_png_base64(mut dynamic: image::DynamicImage) -> Option<String> {
        let (width, height) = (dynamic.width(), dynamic.height());
        if width.max(height) > MAX_ICON_PX {
            dynamic = dynamic.resize(
                MAX_ICON_PX,
                MAX_ICON_PX,
                image::imageops::FilterType::Lanczos3,
            );
        }

        let mut png: Vec<u8> = Vec::new();
        dynamic
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .ok()?;

        Some(base64::engine::general_purpose::STANDARD.encode(&png))
    }
}
