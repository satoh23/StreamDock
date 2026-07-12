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
//! - Windows `.exe`（028）: シェル（OS）が表示する実アイコンを `IShellItemImageFactory::GetImage`
//!   （フォールバック `SHGetFileInfoW`）で取得し PNG 化。
//! - Linux / 非バンドル / スクリプト: `Ok(None)`。
//!
//! ⚠️ 028 の Windows 抽出（`#[cfg(windows)] mod windows`）は `#[cfg(windows)]` のため macOS では
//! コンパイル対象外＝**macOS では `cargo check` で未検証**。実コンパイル・実機 E2E は 098 の
//! Windows ARM64(VM) が初（既存 `process/service.rs::mod windows` と同じ「macOS で書いて Windows で初検証」扱い）。

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
    #[cfg(windows)]
    {
        // Windows(.exe): シェルの実アイコンを抽出（失敗は None → 文字フォールバック）。
        Ok(windows::extract(&validated))
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    {
        // Linux / 非バンドルは未対応（文字フォールバック）。
        let _ = validated;
        Ok(None)
    }
}

/// 最大出力辺（px）。DB 肥大化防止のため ≤128px にリサイズする。macOS / Windows 共通。
#[cfg(any(target_os = "macos", windows))]
const MAX_ICON_PX: u32 = 128;

/// アスペクト維持で ≤128px に縮小（元が ≤128px ならそのまま）し、PNG(base64) にエンコードする共通処理。
///
/// 018 では `mod macos` 内にあったが、028 で Windows 抽出も同じ出力仕様（≤128px・PNG・`data:` 無し base64）
/// に合流させるため親モジュールへ引き上げた（macOS 側は呼び出しパス変更のみ・出力は完全不変）。
#[cfg(any(target_os = "macos", windows))]
fn encode_png_base64(mut dynamic: image::DynamicImage) -> Option<String> {
    use base64::Engine;

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
        super::encode_png_base64(image::DynamicImage::ImageRgba8(buffer))
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
        super::encode_png_base64(dynamic)
    }
}

/// 028 Windows App Icon Auto-Extraction。ユーザー選択済み `.exe` の**シェル表示アイコン**を取得し
/// ≤128px の base64 PNG にする。macOS の `NSWorkspace.iconForFile:` に対応する Windows の正攻法。
///
/// ⚠️ **未検証コード**: 本モジュールは `#[cfg(windows)]` のため macOS では `cargo check` の対象外で、
/// 型・API 名・unsafe FFI は windows 0.58 実ソースとの**机上整合のみ**（実コンパイル・実機 E2E は
/// 098 Windows ARM64(VM) が初）。既存 `process/service.rs::mod windows`（前面化）と同じ扱い。
///
/// セキュリティ（docs/security.md §3/§4/§7/§9/§10）:
/// - **読み取り専用**。`GetImage` / `SHGetFileInfoW` はアイコン描画取得のみで、書き込み・削除・外部通信をしない。
/// - 抽出対象は `validate_icon_path` を通過したユーザー選択済みパスのみ（汎用ファイル読取にしない）。
/// - 出力は共有 `super::encode_png_base64` により ≤128px。失敗はすべて `None`（呼び出し側で `Ok(None)` に丸め）。
/// - **ハンドル/COM リークを起こさない**: HICON=`DestroyIcon` / HBITMAP・DC=`DeleteObject`/`ReleaseDC` /
///   COM=`CoUninitialize` を、下記の小さな RAII ガード（`Drop`）で全 early-return・`?` 経路で確実に解放する。
///   `unsafe` FFI は各呼び出し単位の最小スコープに閉じる。
#[cfg(windows)]
mod windows {
    use std::path::Path;

    use ::windows::core::PCWSTR;
    use ::windows::Win32::Foundation::{HWND, RPC_E_CHANGED_MODE};
    use ::windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, DIB_RGB_COLORS,
        HBITMAP, HDC,
    };
    use ::windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use ::windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED,
    };
    use ::windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SHGetFileInfoW, SHFILEINFOW,
        SHGFI_FLAGS, SHGFI_ICON, SHGFI_LARGEICON, SIIGBF, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    /// COM の初期化を所有した場合にのみ `CoUninitialize` を保証する RAII ガード。
    /// `CoInitializeEx` が `S_OK`/`S_FALSE`（自分が初期化した）を返したときだけ `uninit = true`。
    /// `RPC_E_CHANGED_MODE`（既に別 apartment で初期化済み）では自分は初期化していないため uninit しない。
    struct ComGuard {
        uninit: bool,
    }
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.uninit {
                unsafe { CoUninitialize() };
            }
        }
    }

    /// HBITMAP を所有し、Drop で `DeleteObject` する RAII ガード。
    struct OwnedHBitmap(HBITMAP);
    impl Drop for OwnedHBitmap {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe { let _ = DeleteObject(self.0); }
            }
        }
    }

    /// HICON を所有し、Drop で `DestroyIcon` する RAII ガード。
    struct OwnedHIcon(HICON);
    impl Drop for OwnedHIcon {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe { let _ = DestroyIcon(self.0); }
            }
        }
    }

    /// `GetDC(NULL)` で取得した画面 DC を所有し、Drop で `ReleaseDC` する RAII ガード。
    struct ScreenDc(HDC);
    impl Drop for ScreenDc {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                unsafe { ReleaseDC(HWND(std::ptr::null_mut()), self.0); }
            }
        }
    }

    /// 実行ファイルパスからシェル表示アイコンを抽出し base64 PNG を返す。全失敗時は `None`。
    /// 主経路（`IShellItemImageFactory::GetImage`）→ フォールバック（`SHGetFileInfoW`）の順に試す。
    pub fn extract(path: &Path) -> Option<String> {
        if let Some(png) = extract_via_shell_image(path) {
            return Some(png);
        }
        extract_via_file_info(path)
    }

    /// パスを UTF-16 null 終端に変換する（Win32 の PCWSTR 用）。
    fn to_wide(path: &Path) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    /// 主経路: `IShellItemImageFactory::GetImage`（128px, ICONONLY|BIGGERSIZEOK）で HBITMAP を得て PNG 化。
    fn extract_via_shell_image(path: &Path) -> Option<String> {
        // COM 初期化。S_OK/S_FALSE は自分が初期化した（後で CoUninitialize が必要）。
        // RPC_E_CHANGED_MODE は既に別モードで初期化済み＝続行するが自分では uninit しない。
        // それ以外の失敗は諦める。
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return None;
        }
        let _com = ComGuard { uninit: hr.is_ok() };

        let wide = to_wide(path);
        // pbc（IBindCtx）は不要なので None。riid は返り値型 IShellItemImageFactory から解決される。
        let factory: IShellItemImageFactory = unsafe {
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None::<&IBindCtx>)
        }
        .ok()?;

        let size = ::windows::Win32::Foundation::SIZE {
            cx: super::MAX_ICON_PX as i32,
            cy: super::MAX_ICON_PX as i32,
        };
        // アイコンのみ（サムネイル不可）／要求サイズ以上の内蔵表現を許可（BIGGERSIZEOK）。
        let flags = SIIGBF(SIIGBF_ICONONLY.0 | SIIGBF_BIGGERSIZEOK.0);
        let hbitmap = unsafe { factory.GetImage(size, flags) }.ok()?;
        let _bmp = OwnedHBitmap(hbitmap);

        let (w, h, rgba) = hbitmap_to_rgba(hbitmap)?;
        let buffer = image::RgbaImage::from_raw(w, h, rgba)?;
        super::encode_png_base64(image::DynamicImage::ImageRgba8(buffer))
    }

    /// フォールバック: `SHGetFileInfoW`（ICON|LARGEICON）で HICON を得て、そのカラー HBITMAP を PNG 化。
    /// `.ico` 直接指定や、主経路が使えない環境向けの保険。
    ///
    /// 解像度について（意図的トレードオフ・修正しない）: `SHGFI_LARGEICON` はシステムの大アイコン
    /// （通例 32px 前後）で、主経路 `GetImage(128px)` より小さくなり得る。`encode_png_base64` は拡大を
    /// しない（>128px のときだけ縮小）ため、フォールバック時のアイコンは ≤32px になり得るが、これは
    /// あくまで主経路失敗時の保険でありベストエフォートとして許容する。高解像度化（`SHGetImageList` /
    /// `SHIL_JUMBO` 等の別 API 追加）は 028 の「やらないこと」に該当するため本タスクでは行わない。
    fn extract_via_file_info(path: &Path) -> Option<String> {
        let wide = to_wide(path);
        let mut info = SHFILEINFOW::default();
        let ret = unsafe {
            SHGetFileInfoW(
                PCWSTR(wide.as_ptr()),
                FILE_FLAGS_AND_ATTRIBUTES(0),
                Some(&mut info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                // `SHGFI_LARGEICON` は値 0（=大アイコンが既定）。よって `| SHGFI_LARGEICON` は実質 no-op だが、
                // 「小アイコン（`SHGFI_SMALLICON`=1）ではなく大アイコンを要求している」という意図を明示する
                // ための冗長 OR で、意図的にこのまま残す（バグではない）。
                SHGFI_FLAGS(SHGFI_ICON.0 | SHGFI_LARGEICON.0),
            )
        };
        if ret == 0 || info.hIcon.0.is_null() {
            return None;
        }
        let _icon = OwnedHIcon(info.hIcon);

        // HICON → GetIconInfo でカラー/マスクの HBITMAP を取り出す（どちらも解放が必要）。
        // `hbmMask`（AND マスク）は**解放のためだけに所有**し、色への合成は行わない（意図的）。理由:
        // 主経路の `GetImage` は 32bpp アルファ付き HBITMAP を返すため、正攻法ではマスク合成が不要。この
        // フォールバックでもカラーが 32bpp アルファ付きなら `GetDIBits` がそのままアルファを返す。
        // 既知の限界（098 で実機確認）: 旧式のアルファ無しアイコンではカラー HBITMAP にアルファが無く、
        // `GetDIBits`(32bpp) がアルファ全 0＝完全透明 PNG を返し得る（本来は AND マスクで不透明部を復元すべき
        // ケース）。主経路が正常な現状は実害が小さいため本タスクでは合成を入れず、098 で空アイコンが観測
        // されたら「アルファ全 0 を失敗扱い（None→文字フォールバック）」または AND マスク合成を検討する。
        let mut icon_info = ICONINFO::default();
        unsafe { GetIconInfo(info.hIcon, &mut icon_info) }.ok()?;
        let _mask = OwnedHBitmap(icon_info.hbmMask);
        let _color = OwnedHBitmap(icon_info.hbmColor);

        if icon_info.hbmColor.0.is_null() {
            return None;
        }
        let (w, h, rgba) = hbitmap_to_rgba(icon_info.hbmColor)?;
        let buffer = image::RgbaImage::from_raw(w, h, rgba)?;
        super::encode_png_base64(image::DynamicImage::ImageRgba8(buffer))
    }

    /// HBITMAP を 32bpp top-down で読み出し `(幅, 高さ, RGBA バイト列)` を返す。
    ///
    /// `GetDIBits` は 32bpp・`biHeight` 負（top-down）を要求してピクセル列を得る。取得直後は BGRA 並びの
    /// ため R と B を入れ替えて RGBA にする。premultiplied alpha は表示用途では実害が小さいため許容する。
    fn hbitmap_to_rgba(hbitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
        // 幅・高さを取得する。
        let mut bmp = BITMAP::default();
        let got = unsafe {
            GetObjectW(
                hbitmap,
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bmp as *mut BITMAP as *mut core::ffi::c_void),
            )
        };
        if got == 0 || bmp.bmWidth <= 0 || bmp.bmHeight <= 0 {
            return None;
        }
        let width = bmp.bmWidth as u32;
        let height = bmp.bmHeight as u32;

        // 画面 DC（GetDIBits にはビットマップが未選択の互換 DC が要る）。RAII で ReleaseDC。
        let hdc = unsafe { GetDC(HWND(std::ptr::null_mut())) };
        if hdc.0.is_null() {
            return None;
        }
        let _dc = ScreenDc(hdc);

        // 32bpp・top-down（biHeight 負）・無圧縮（BI_RGB=0）で取り出す。
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<::windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = bmp.bmWidth;
        bmi.bmiHeader.biHeight = -bmp.bmHeight; // 負 = top-down（画像は上→下）
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = 0; // BI_RGB

        let mut buf = vec![0u8; (width as usize) * (height as usize) * 4];
        let scanlines = unsafe {
            GetDIBits(
                hdc,
                hbitmap,
                0,
                height,
                Some(buf.as_mut_ptr() as *mut core::ffi::c_void),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        };
        if scanlines == 0 {
            return None;
        }

        // BGRA → RGBA（各 4 バイトの B と R を入れ替える）。
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        Some((width, height, buf))
    }
}
