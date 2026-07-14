//! 棒読みちゃん × VOICEVOX 連携（Windows 専用）。
//!
//! ⚠️ **未検証 Windows コード**: 実処理は下段の `#[cfg(windows)] mod imp` に閉じており、macOS では
//! `cargo check` の対象外＝**未コンパイル・実機未確認**。型・API・Socket バイナリプロトコル・棒読み
//! ちゃん設定キー・配布元 URL は **机上整合＋`// 098-SPIKE` 仮実装のみ**。実コンパイル・実機 E2E は
//! 098（Windows 11 ARM64 VM）が初（既存 `tools/icon.rs::mod windows` / `process/service.rs::mod windows`
//! と同じ扱い）。098 でコンパイルエラー/不具合が出たら 098 側で最小修正する。
//!
//! 境界（docs/security.md / 032 設計の解禁範囲）:
//! - 通信はループバックのみ（VOICEVOX 50021 / 棒読みちゃん 50001）。
//! - 自動DL・自動実行はしない（公式ページ誘導のみ）。
//! - 設定書換は棒読みちゃん自身の設定のみ・バックアップ先取り必須・可逆。
//! - SAPI 登録等の不可逆・昇格変更はしない（付属ツールへ誘導）。
//! - 失敗詳細（フルパス/OS エラー）は返さず短文に丸める（§9）。

use crate::error::AppResult;

use super::super::model::{ConfigureResult, ScanResult, VerifyResult};
use super::{Integration, IntegrationCtx};

// --- 公式配布元 URL（誘導専用の固定定数。自動DLはしない）。frontend は raw URL を受けない ---
// これらは 032a の integrationRegistry と同じ既知 URL。098 で最終確認する。
const VOICEVOX_OFFICIAL_URL: &str = "https://voicevox.hiroshiba.jp/";
const BOUYOMICHAN_OFFICIAL_URL: &str = "https://chi.usamimi.info/Program/Application/BouyomiChan/";

/// 棒読みちゃん×VOICEVOX 連携の実装（unit 構造体）。
pub struct BouyomiVoicevox;

impl Integration for BouyomiVoicevox {
    fn id(&self) -> &'static str {
        "bouyomi-voicevox"
    }

    fn scan(&self, ctx: &IntegrationCtx) -> AppResult<ScanResult> {
        #[cfg(windows)]
        {
            imp::scan(ctx)
        }
        #[cfg(not(windows))]
        {
            let _ = ctx;
            Ok(ScanResult::unsupported())
        }
    }

    fn configure(&self, ctx: &IntegrationCtx) -> AppResult<ConfigureResult> {
        #[cfg(windows)]
        {
            imp::configure(ctx)
        }
        #[cfg(not(windows))]
        {
            let _ = ctx;
            Ok(ConfigureResult::unsupported())
        }
    }

    fn verify(&self, ctx: &IntegrationCtx) -> AppResult<VerifyResult> {
        #[cfg(windows)]
        {
            imp::verify(ctx)
        }
        #[cfg(not(windows))]
        {
            let _ = ctx;
            Ok(VerifyResult::unsupported())
        }
    }

    /// 公式ページ URL は OS 非依存（ブラウザで開くだけ）。固定定数から解決する。
    /// SAPI For VOICEVOX は配布元 URL が未確定のため `None`（誤った URL を開かせない・098 で確定）。
    fn official_page(&self, component: &str) -> Option<&'static str> {
        match component {
            "voicevox" => Some(VOICEVOX_OFFICIAL_URL),
            "bouyomichan" => Some(BOUYOMICHAN_OFFICIAL_URL),
            // 098-SPIKE: SAPI For VOICEVOX の配布元 URL・バージョン・32bit 入手手順は未確定。
            // 確定するまで開く導線を出さない（scan の has_official_page=false と整合）。
            _ => None,
        }
    }
}

/// Windows 実処理（未検証・098 で初コンパイル/初 E2E）。
///
/// ここに ureq(50021)・`std::net::TcpStream`(50001)・レジストリ読取（SAPI 検出）・棒読みちゃん設定の
/// バックアップ先取り＋書換を置く。import も本モジュールに閉じ、他ターゲットへ漏らさない（028 と同じ）。
#[cfg(windows)]
mod imp {
    use std::io::Write;
    use std::net::{Ipv4Addr, SocketAddr, TcpStream};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
        KEY_WOW64_32KEY, KEY_WOW64_64KEY, REG_SAM_FLAGS,
    };

    use crate::error::{AppError, AppResult};

    use super::super::super::model::{
        ComponentStatus, ConfigureResult, ConfigureStatus, ScanResult, VerifyResult, VerifyStatus,
    };
    use super::IntegrationCtx;

    // --- ループバックの既知エンドポイント（127.0.0.1 限定・§1 解禁範囲） ---
    const VOICEVOX_ENGINE_URL: &str = "http://127.0.0.1:50021/version";
    const BOUYOMI_PORT: u16 = 50001;
    // 短いタイムアウト（UI をブロックしすぎない）。
    const CONNECT_TIMEOUT: Duration = Duration::from_millis(800);
    const IO_TIMEOUT: Duration = Duration::from_millis(1500);

    // ---------------------------------------------------------------------------------------------
    // scan（読み取り専用）
    // ---------------------------------------------------------------------------------------------

    pub fn scan(_ctx: &IntegrationCtx) -> AppResult<ScanResult> {
        let voicevox_installed = detect_voicevox_installed();
        let bouyomi_installed = detect_bouyomi_installed();
        let sapi_registered = detect_sapi_voice_registered();
        let engine_running = engine_running();

        let components = vec![
            ComponentStatus {
                key: "voicevox".to_string(),
                name: "VOICEVOX".to_string(),
                installed: voicevox_installed,
                has_official_page: true,
            },
            ComponentStatus {
                key: "sapi".to_string(),
                name: "SAPI For VOICEVOX".to_string(),
                installed: sapi_registered,
                // 配布元 URL 未確定のため開く導線は出さない（official_page("sapi")==None と整合）。
                has_official_page: false,
            },
            ComponentStatus {
                key: "bouyomichan".to_string(),
                name: "棒読みちゃん".to_string(),
                installed: bouyomi_installed,
                has_official_page: true,
            },
        ];

        Ok(ScanResult {
            supported: true,
            components,
            engine_running,
            message: Some("検出が完了しました。".to_string()),
        })
    }

    /// VOICEVOX ENGINE(50021) がループバックで応答するか（外部通信なし・ヘルスチェックのみ）。
    /// 098-SPIKE: ureq 2.x（default-features=false・TLS なし）の API を実機で確認する。
    fn engine_running() -> bool {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(CONNECT_TIMEOUT)
            .timeout_read(IO_TIMEOUT)
            .build();
        agent.get(VOICEVOX_ENGINE_URL).call().is_ok()
    }

    /// VOICEVOX の導入有無（既知パスの存在確認・読み取り専用・best-effort）。
    /// 098-SPIKE: 実インストールパスを実機で確定する（暫定候補）。
    fn detect_voicevox_installed() -> Option<bool> {
        let candidates = [
            env_join("LOCALAPPDATA", r"Programs\VOICEVOX\VOICEVOX.exe"),
            env_join("PROGRAMFILES", r"VOICEVOX\VOICEVOX.exe"),
        ];
        Some(any_path_exists(&candidates))
    }

    /// 棒読みちゃんの導入有無（既知パスの存在確認・読み取り専用・best-effort）。
    /// 098-SPIKE: 実インストールパスを実機で確定する（暫定候補）。
    fn detect_bouyomi_installed() -> Option<bool> {
        Some(bouyomi_install_dir().is_some())
    }

    /// SAPI 音声トークンに "VOICEVOX" を含む登録があるか（レジストリ読み取り専用・best-effort）。
    /// 32bit SAPI(For VOICEVOX) は WOW6432Node 配下のため 32bit ビューも読む。
    /// Some(true)=登録あり / Some(false)=キーは開けたが未登録 / None=不明（読取不能）。
    /// 098-SPIKE: キー構造・トークン名の判定条件を実機で確定する。
    fn detect_sapi_voice_registered() -> Option<bool> {
        let mut any_opened = false;
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            match sapi_tokens_contains_voicevox(view) {
                Some(true) => return Some(true),
                Some(false) => any_opened = true,
                None => {}
            }
        }
        if any_opened {
            Some(false)
        } else {
            None
        }
    }

    /// `HKLM\SOFTWARE\Microsoft\Speech\Voices\Tokens` のサブキー名に "VOICEVOX" があるか（読み取り専用）。
    fn sapi_tokens_contains_voicevox(view: REG_SAM_FLAGS) -> Option<bool> {
        const SUBKEY: &str = r"SOFTWARE\Microsoft\Speech\Voices\Tokens";
        let subkey = to_wide(SUBKEY);
        let mut hkey = HKEY::default();
        // KEY_READ のみ（書込権限は要求しない・読み取り専用）。開けなければ None（不明）。
        let opened = unsafe {
            RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                PCWSTR(subkey.as_ptr()),
                0,
                KEY_READ | view,
                &mut hkey,
            )
        };
        if opened.is_err() {
            return None;
        }
        let _guard = RegKeyGuard(hkey);

        let mut found = false;
        let mut index = 0u32;
        loop {
            let mut name_buf = [0u16; 256];
            let mut name_len = name_buf.len() as u32;
            let res = unsafe {
                RegEnumKeyExW(
                    hkey,
                    index,
                    PWSTR(name_buf.as_mut_ptr()),
                    &mut name_len,
                    None,
                    PWSTR::null(),
                    None,
                    None,
                )
            };
            // ERROR_NO_MORE_ITEMS を含め、列挙終了/失敗で打ち切る。
            if res.is_err() {
                break;
            }
            let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
            if name.to_ascii_uppercase().contains("VOICEVOX") {
                found = true;
                break;
            }
            index += 1;
            // 暴走ガード（トークン数は現実的に十分小さい）。
            if index > 4096 {
                break;
            }
        }
        Some(found)
    }

    /// レジストリキーの RAII クローズガード（全 early-return 経路で確実に閉じる）。
    struct RegKeyGuard(HKEY);
    impl Drop for RegKeyGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // configure（バックアップ先取り＋書換。棒読み設定のみ・可逆・§5 解禁範囲）
    // ---------------------------------------------------------------------------------------------

    pub fn configure(ctx: &IntegrationCtx) -> AppResult<ConfigureResult> {
        // 1. 棒読みちゃんのインストールフォルダと設定ファイルを解決する。未導入なら NotInstalled。
        let Some((install_dir, config_path)) = resolve_bouyomi_config() else {
            return Ok(ConfigureResult {
                supported: true,
                status: ConfigureStatus::NotInstalled,
                backup_created: false,
                restart_required: false,
                message: "棒読みちゃんが見つかりませんでした。先に導入してください。".to_string(),
                backup_name: None,
            });
        };

        // 2. 書換対象がインストールフォルダ配下であることを再確認する（想定外パスは書かない）。
        //    棒読みちゃん自身の設定ファイルのみを対象にする担保（§5）。
        if !config_path.starts_with(&install_dir) {
            return Ok(ConfigureResult {
                supported: true,
                status: ConfigureStatus::Skipped,
                backup_created: false,
                restart_required: false,
                message: "設定ファイルの場所を確認できませんでした。手動設定をご案内します."
                    .to_string(),
                backup_name: None,
            });
        }

        // 3. 書換前に app 管理領域へバックアップを先取りする。失敗したら書換せず中断（先取りの担保）。
        let backup_name = backup_config(&ctx.backup_root, &config_path)
            .ok_or_else(|| AppError::storage("設定のバックアップに失敗しました"))?;

        // 4. 棒読みちゃん設定のみを書き換える（Socket 連携 ON・声質＝VOICEVOX:ずんだもん）。
        //    対応キーが見つからなければ書換せず Skipped（設定を壊さない）。読取/書込の失敗は Skipped
        //    （＝項目なし）と紛らわしいので Err で区別し、UI に「項目なし」と誤案内しない。書込はアトミック
        //    なので失敗しても元ファイルは無傷（バックアップも先取り済み）。
        match rewrite_bouyomi_config(&config_path)? {
            RewriteOutcome::Written { restart_required } => Ok(ConfigureResult {
                supported: true,
                status: ConfigureStatus::Configured,
                backup_created: true,
                restart_required,
                message: "棒読みちゃんの設定を書き換えました（バックアップ取得済み）。".to_string(),
                backup_name: Some(backup_name),
            }),
            RewriteOutcome::Skipped => Ok(ConfigureResult {
                supported: true,
                status: ConfigureStatus::Skipped,
                backup_created: true,
                restart_required: false,
                message: "設定項目が見つからず、書換をスキップしました。手動設定をご案内します。"
                    .to_string(),
                backup_name: Some(backup_name),
            }),
        }
    }

    /// 書換前バックアップを app 管理領域に取り、退避先の「タイムスタンプ/ファイル名」だけを返す。
    /// フルパスは返さない（§9）。失敗は None（呼び出し側が書換を中断する）。
    fn backup_config(backup_root: &Path, src: &Path) -> Option<String> {
        let ts = filesystem_safe_timestamp();
        let dir = backup_root.join("bouyomi-voicevox").join(&ts);
        std::fs::create_dir_all(&dir).ok()?;
        let file_name = src.file_name()?;
        let dest = dir.join(file_name);
        std::fs::copy(src, &dest).ok()?;
        Some(format!("{}/{}", ts, file_name.to_string_lossy()))
    }

    enum RewriteOutcome {
        Written { restart_required: bool },
        Skipped,
    }

    /// 棒読みちゃん自身の設定ファイルのみを対象に Socket 連携 ON・声質＝VOICEVOX:ずんだもん を設定する。
    /// 098-SPIKE: 実ファイル形式（XML/ini）・要素名・値表現・反映（再起動要否）は実機で確定する。
    /// 既知キーが見つかったときだけ置換し、見つからなければ `Skipped`（壊さない）。読取/書込の失敗は
    /// `Skipped`（＝項目なし）と紛らわしいため `Err` で区別し、UI に「項目なし」と誤案内しない。
    fn rewrite_bouyomi_config(path: &Path) -> AppResult<RewriteOutcome> {
        // 存在は resolve 済みだが、ロック/権限で読めない場合は書換不能なエラー（Skipped と区別）。
        let content = std::fs::read_to_string(path)
            .map_err(|_| AppError::storage("設定ファイルを読み込めませんでした"))?;
        let mut updated = content;
        let mut changed = false;

        // 098-SPIKE: 下記の要素名は仮。棒読みちゃんの設定スキーマ（SettingBase.xml 等）に合わせて確定する。
        if let Some(next) = set_xml_bool(&updated, "SpeechEngineServiceEnabled", true) {
            updated = next;
            changed = true;
        }
        if let Some(next) = set_xml_text(&updated, "VoiceName", "VOICEVOX:ずんだもん") {
            updated = next;
            changed = true;
        }

        // 対応キーが見つからなければ書換せず Skipped（設定を壊さない）。
        if !changed {
            return Ok(RewriteOutcome::Skipped);
        }
        // 一時ファイル経由でアトミックに差し替える（書込途中失敗で元ファイルを truncate 破損させない）。
        // バックアップは先取り済み・可逆。書込失敗は Skipped と区別して Err で返す。
        write_atomic(path, updated.as_bytes())
            .map_err(|_| AppError::storage("設定の書換に失敗しました（変更は行われていません）"))?;
        // 098-SPIKE: 反映に棒読みちゃん再起動が必要かを実機で確認する（暫定 true）。
        Ok(RewriteOutcome::Written {
            restart_required: true,
        })
    }

    /// 一時ファイルへ書いてから rename でアトミックに差し替える（書込途中失敗で元ファイルを壊さない）。
    /// rename は同一フォルダ内なので原子的（Windows も既存ファイルを置換する）。失敗時は一時ファイルを掃除。
    fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
        let tmp = path.with_extension("streamdock-tmp");
        std::fs::write(&tmp, contents)?;
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        Ok(())
    }

    /// `<tag>...</tag>` の中身を `value` に差し替える。tag が無ければ None（追加はしない・壊さない）。
    /// 098-SPIKE: 実スキーマに合わせて置換方式を確定する（暫定の素朴な置換）。
    fn set_xml_text(xml: &str, tag: &str, value: &str) -> Option<String> {
        let open = format!("<{tag}>");
        let close = format!("</{tag}>");
        let start = xml.find(&open)? + open.len();
        let end = xml[start..].find(&close)? + start;
        let mut out = String::with_capacity(xml.len());
        out.push_str(&xml[..start]);
        out.push_str(value);
        out.push_str(&xml[end..]);
        Some(out)
    }

    fn set_xml_bool(xml: &str, tag: &str, value: bool) -> Option<String> {
        set_xml_text(xml, tag, if value { "true" } else { "false" })
    }

    // ---------------------------------------------------------------------------------------------
    // verify（ループバック疎通のみ・§1 解禁範囲）
    // ---------------------------------------------------------------------------------------------

    pub fn verify(_ctx: &IntegrationCtx) -> AppResult<VerifyResult> {
        let engine_healthy = engine_running();
        let test_message_sent = send_bouyomi_test();

        let status = match (engine_healthy, test_message_sent) {
            (true, true) => VerifyStatus::Ok,
            (false, false) => VerifyStatus::Failed,
            _ => VerifyStatus::Partial,
        };
        let message = match status {
            VerifyStatus::Ok => {
                "VOICEVOX の応答を確認し、棒読みちゃんへテスト文を送信しました。".to_string()
            }
            VerifyStatus::Partial => {
                "一部のみ成功しました。VOICEVOX の起動と棒読みちゃんの Socket 連携をご確認ください。"
                    .to_string()
            }
            VerifyStatus::Failed => {
                "疎通に失敗しました。VOICEVOX と棒読みちゃんが起動しているかご確認ください。".to_string()
            }
            VerifyStatus::Unsupported => "この連携は Windows でご利用いただけます。".to_string(),
        };

        Ok(VerifyResult {
            supported: true,
            status,
            engine_healthy,
            test_message_sent,
            message,
        })
    }

    /// 棒読みちゃん Socket 連携（TCP 127.0.0.1:50001）へテスト文を送る（新規依存なし・ループバックのみ）。
    /// 接続＋書込成功を返す（実際に音声が鳴るかは 098 実機で耳視確認する）。
    fn send_bouyomi_test() -> bool {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, BOUYOMI_PORT));
        let Ok(mut stream) = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) else {
            return false;
        };
        let _ = stream.set_write_timeout(Some(IO_TIMEOUT));
        let payload = build_bouyomi_talk_command("接続テストなのだ");
        stream.write_all(&payload).is_ok()
    }

    /// 棒読みちゃん Socket バイナリプロトコル（リトルエンディアン）でコマンドを組み立てる。
    /// 098-SPIKE: 各フィールドの型・値（特に声質の「アプリ現在設定を使う」値）を実機で確認する。
    /// コマンド 0x0001（読み上げ）＋ 速度/音程/音量（-1=アプリ設定）＋ 声質（0=棒読みちゃんの現在設定＝
    /// configure 済みの VOICEVOX:ずんだもんを使う）＋ 文字コード（0=UTF-8）＋ 本文バイト長 ＋ 本文。
    fn build_bouyomi_talk_command(text: &str) -> Vec<u8> {
        let body = text.as_bytes();
        let mut buf = Vec::with_capacity(15 + body.len());
        buf.extend_from_slice(&0x0001i16.to_le_bytes()); // コマンド: 読み上げ
        buf.extend_from_slice(&(-1i16).to_le_bytes()); // 速度: アプリ設定
        buf.extend_from_slice(&(-1i16).to_le_bytes()); // 音程: アプリ設定
        buf.extend_from_slice(&(-1i16).to_le_bytes()); // 音量: アプリ設定
        buf.extend_from_slice(&0i16.to_le_bytes()); // 声質: 0=棒読みちゃんの現在設定を使う（098-SPIKE）
        buf.push(0u8); // 文字コード: 0=UTF-8
        buf.extend_from_slice(&(body.len() as i32).to_le_bytes()); // 本文バイト長
        buf.extend_from_slice(body); // 本文（UTF-8）
        buf
    }

    // ---------------------------------------------------------------------------------------------
    // パス解決ヘルパ（読み取り専用）
    // ---------------------------------------------------------------------------------------------

    /// 棒読みちゃんのインストールフォルダを解決する（既知候補の存在確認）。
    /// 098-SPIKE: 実インストールパスを実機で確定する（暫定候補）。
    fn bouyomi_install_dir() -> Option<PathBuf> {
        let candidates = [
            env_join("PROGRAMFILES(X86)", r"BouyomiChan"),
            env_join("PROGRAMFILES", r"BouyomiChan"),
        ];
        candidates
            .into_iter()
            .flatten()
            .find(|dir| dir.join("BouyomiChan.exe").exists())
    }

    /// 棒読みちゃんのインストールフォルダと設定ファイルパスを解決する。
    /// 098-SPIKE: 実際の設定ファイル名（SettingBase.xml 等）を実機で確定する。
    fn resolve_bouyomi_config() -> Option<(PathBuf, PathBuf)> {
        let install_dir = bouyomi_install_dir()?;
        // 098-SPIKE: ファイル名は仮。実機で確定する。
        let config = install_dir.join("SettingBase.xml");
        if config.exists() {
            Some((install_dir, config))
        } else {
            None
        }
    }

    /// 環境変数のディレクトリに相対パスを結合する（未設定・空なら None）。
    fn env_join(var: &str, rel: &str) -> Option<PathBuf> {
        let base = std::env::var_os(var)?;
        if base.is_empty() {
            return None;
        }
        Some(PathBuf::from(base).join(rel))
    }

    fn any_path_exists(candidates: &[Option<PathBuf>]) -> bool {
        candidates.iter().flatten().any(|p| p.exists())
    }

    /// ファイル名安全なタイムスタンプ（コロンを含まない。Windows のファイル名に使える）。
    fn filesystem_safe_timestamp() -> String {
        chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string()
    }

    /// UTF-16 + NUL 終端（Win32 の PCWSTR 用）。
    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
}
