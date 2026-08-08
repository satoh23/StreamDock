//! 060b: オーバーレイテーマの検証・保存・取り出し。
//!
//! ## §5 例外（`app_data_dir/themes/` への書き込み）の実体はここ
//!
//! ⚠⚠ **保存先の組み立てにユーザー入力を 1 バイトも結合しない。** パスは
//! 「`app_data_dir()` → `join(THEMES_DIR)` → `join(<uuid v4>.css)`」の固定形だけで、
//! 元ファイル名も `name` もファイル名に使わない。したがって**パストラバーサルが構造的に成立しない**。
//! さらに多層防御として、パスへ結合する直前に必ず [`is_managed_file_name`] を通す（[`managed_path`]）。
//!
//! ⚠ **`canonicalize` は意図的に呼ばない。** canonicalize に意味があるのは「元パスが保存先の組み立てに
//! 影響するとき」だが、上のとおり影響しない。足すとネットワークボリューム・権限まわりの失敗経路が
//! 増えるだけで、防げるものが 1 つも無い。
//!
//! ⚠ **シンボリックリンクも拒否しない。** アプリはユーザー権限で動くので、リンク越しに読めるのは
//! ユーザーが元々読めるファイルだけ＝**特権境界を跨がない**。拒否すると Dropbox / iCloud を
//! シンボリックリンクしている正当な構成が壊れる。
//!
//! ## 検証（§8・frontend を信用しない）
//!
//! `path` は dialog 由来の生パス、`css` は他人が書いた任意のテキスト、`name` はユーザーの自由入力。
//! **すべてここで検証する。** 変換（利便性）は frontend でよいが、検証は委ねない。

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::util::{now_rfc3339, reject_control_chars, require_non_empty, with_filename_detail};

use super::model::{OverlayThemeImportResult, OverlayThemeOrigin, OverlayThemeRecord};
use super::repository;
use super::sanitize;

/// `app_data_dir` 直下の管理ディレクトリ名。
const THEMES_DIR: &str = "themes";

/// 取り込める CSS の上限（256KB）。
///
/// 根拠: 060a の実測で、注入時に毎回走る `rewriteSelectors` は 248KB の現実的入力で 12.3ms、
/// 535KB の病的入力でも 8.6ms だった。実在のチャット CSS は数 KB なので 100 倍近い余裕がありつつ、
/// 注入経路（060d）が重くならない範囲に収まる。
/// ⚠ **上限が無いと巨大ファイルで webview が固まる**（055c の `clampNotes` と同じ発想）。
///
/// ⚠⚠ **060c への申し送り（レビューで結論を出した・`docs/tasks/060c-*.md` の (5) が正）**:
/// 060c の取得上限（案 512KB）はこの値を超えており、「取得 CSS を前置して保存し直す」設計なので
/// **合成後にここで落ちうる**。**下げるのは 060c 側**である。理由:
/// ①この 256KB は 060a の実測に紐づく**注入経路の予算**（`rewriteSelectors` は 060d が注入のたびに
/// 毎回走らせる）。取得は 1 回・注入は毎回なので、**動かしてよいのは取得側**。
/// ②保存上限が事実上の合計上限である以上、取得に成功してから保存で落ちると**帯域も同意も無駄**になり、
/// ユーザーには「同意したのに失敗した」としか見えない。
/// → 060c は「取得**前**に `既存 CSS 長 + 取得上限 <= MAX_CSS_BYTES` を検査」＋「取得上限を
/// `MAX_CSS_BYTES - 既存 CSS 長` の動的値にする」の 2 段にすること。
const MAX_CSS_BYTES: u64 = 256 * 1024;

/// テーマ名の長さ上限（文字数。バイト数ではない）。一覧の 1 行に収まる長さ。
const MAX_NAME_CHARS: usize = 80;

/// 登録できるテーマの件数上限。
///
/// ⚠ **無制限にディスクが増える経路を作らないため**。取り込みコマンドはアプリ定義コマンドなので
/// **全 4 窓から呼べる**（ACL 対象外）＝上限は構造側に持たせる。
const MAX_THEMES: u32 = 200;

// --- 純粋な検証（テストの主対象）-----------------------------------------------------------------

/// uuid v4 の文字列表現（ハイフン付き 36 文字）か。
///
/// 大文字の 16 進も通すのは、厳密一致ではなく**「パス片になりうる文字が入っていない」ことの保証**が
/// 目的だから（`/` `\` `.` `:` はいずれも通らない）。
fn is_theme_id(id: &str) -> bool {
    id.len() == 36
        && id.chars().enumerate().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// 管理ディレクトリ配下の実ファイル名として妥当か（`<uuid v4>.css` 完全一致）。
///
/// ⚠⚠ **管理ディレクトリの外へ出る唯一の可能性を潰す純関数**。`../evil.css` / 絶対パス /
/// 区切り文字入り / 拡張子違い / 空文字はすべて false になる。
/// 保存時（自分で組み立てた名前）にも、読み出し・削除時（DB から来た名前）にも通す。
/// ⚠ DB を書ける相手は既に端末を持っているので**多層防御**だが、
/// 「`name` に `../evil` を入れても外へ出ない」をここで直接テストできるのが効く。
pub fn is_managed_file_name(file_name: &str) -> bool {
    match file_name.strip_suffix(".css") {
        Some(stem) => is_theme_id(stem),
        None => false,
    }
}

/// テーマ名を検証して trim 済みの値を返す。
///
/// ⚠ **`char::is_control` は U+0080..=U+009F も含み、JS の `/[\x00-\x1F\x7F]/` より広い。**
/// 060d が同じ検証を UI に置くときは、**Rust と同じか狭く**すること（frontend が通したものを
/// Rust が弾くと「入力できるのに保存できない」になる）。⚠ 058a の `is_selectable_device_id` とは
/// 向きが逆である点に注意——あちらは列挙 API（狭いほうへ揃える）、こちらは入力フォーム。
pub fn validate_theme_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    require_non_empty(name, "テーマ名は必須です")?;
    reject_control_chars(name, "テーマ名に制御文字は使用できません")?;
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::validation(
            "テーマ名が長すぎます。80 文字以内にしてください。",
        ));
    }
    Ok(name.to_string())
}

/// CSS 本文として受け入れてよいか。BOM を剥がした本文を返す。
///
/// ⚠ **`util::reject_control_chars` は使えない**。`char::is_control` は改行・タブも弾くので、
/// CSS 本文に当てると**まともなファイルが 1 つも通らない**。ここでは CSS が空白として扱う
/// `\t` / `\n` / `\r` / `\u{0C}` を許し、それ以外の C0 と DEL を拒否する。
/// ⚠ `name` の規則（`reject_control_chars`）とは**意図的に違う**。片方を直すときはもう片方も見ること。
fn validate_css_body(raw: &str) -> AppResult<String> {
    // CSS 仕様上、スタイルシートは BOM で始まってよい。剥がさないと先頭の規則が壊れる。
    // ⚠ 途中の U+FEFF は制御文字ではない（ゼロ幅スペース）ので触らない。
    let css = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    if css.len() as u64 > MAX_CSS_BYTES {
        return Err(AppError::validation(
            "CSS が大きすぎます。256KB 以内にしてください。",
        ));
    }
    if css.chars().any(is_forbidden_in_css_body) {
        return Err(AppError::unsupported_file_type(
            "この CSS には使用できない制御文字が含まれています。テキストファイルか確認してください。",
        ));
    }
    Ok(css.to_string())
}

/// CSS 本文に現れてはいけない文字（NUL 等の C0 と DEL。空白扱いの 4 種は除く）。
fn is_forbidden_in_css_body(c: char) -> bool {
    match c {
        '\t' | '\n' | '\r' | '\u{0C}' => false,
        '\u{7F}' => true,
        _ => (c as u32) < 0x20,
    }
}

// --- パス -----------------------------------------------------------------------------------

/// 管理ディレクトリ（`app_data_dir/themes/`）。**`app_data_dir()` を呼ぶ唯一の場所**。
pub fn themes_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::storage("アプリの保存先を解決できませんでした。"))?;
    Ok(base.join(THEMES_DIR))
}

/// 管理ディレクトリ配下の実ファイルパス。**ファイル名を結合する唯一の場所**。
fn managed_path(dir: &Path, file_name: &str) -> AppResult<PathBuf> {
    if !is_managed_file_name(file_name) {
        // ⚠ 「見つからない」に寄せる（何が起きたかを攻撃者に教えない・§9）。
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    Ok(dir.join(file_name))
}

/// dialog 由来の生パスを検証する（§7 / §8）。
///
/// ⚠ **エラーにフルパスを載せない**。`with_filename_detail` でファイル名のみを `details` に入れる（§9）。
/// ⚠ trim するのは `tools::service` の `executable_path` に揃えるため。帰結として
/// **前後に空白を含むファイル名は取り込めない**（macOS では正当な名前）が、既存のパス検証と
/// 挙動を分けるほうの害が大きいので一貫性を採る。
fn validate_source_path(raw: &str) -> AppResult<PathBuf> {
    let trimmed = raw.trim();
    require_non_empty(trimmed, "CSS ファイルが選択されていません")?;
    reject_control_chars(trimmed, "ファイルパスに制御文字は使用できません")?;

    // ⚠⚠ **UNC / ネットワークパスは触る前に拒否する**（security-review S-4）。
    // `import_overlay_theme` はアプリ定義コマンド＝**ACL 対象外で全 4 窓から呼べる**ので、
    // `path` が dialog 由来である保証は無い（Rust からは確かめようがない）。Windows で
    // `\\evil.example\share\x.css` を渡されると、下の `fs::metadata` の時点で
    // **OS が攻撃者ホストへ SMB 接続し、既定設定では NTLM でユーザー/マシンの資格情報ハッシュが飛ぶ**
    // ——ユーザー操作ゼロ・ダイアログ非経由で、§1 の趣旨（アプリが外へ出ない）に直接反する。
    // ⚠ 拡張子チェックより**前**に置くこと（`.css` 以外でも接続は起きてしまうため）。
    // ⚠ macOS の `/Volumes/...`（マウント済み共有）は拒否しない——ユーザーが既にマウントした先だけが
    // 見えるので、**新しい宛先を作らない**。POSIX の `//foo` と Windows の `\\?\C:\`（ローカルの
    // 拡張長パス）も巻き添えで落ちるが、ファイル選択ダイアログはどちらの形も返さない。
    if trimmed.starts_with("\\\\") || trimmed.starts_with("//") {
        return Err(AppError::validation(
            "ネットワーク上のファイルは取り込めません。ローカルにコピーしてから選んでください。",
        ));
    }

    let path = PathBuf::from(trimmed);
    let has_css_extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("css"));
    if !has_css_extension {
        return Err(with_filename_detail(
            AppError::unsupported_file_type("CSS ファイル（.css）を選んでください。"),
            &path,
        ));
    }

    let metadata = std::fs::metadata(&path).map_err(|_| {
        with_filename_detail(
            AppError::path_not_found("指定された CSS ファイルが見つかりません。"),
            &path,
        )
    })?;
    if !metadata.is_file() {
        return Err(with_filename_detail(
            AppError::validation("ファイルを選んでください。"),
            &path,
        ));
    }
    // 読む前に落とす（4GB のファイルをメモリへ載せない）。
    if metadata.len() > MAX_CSS_BYTES {
        return Err(with_filename_detail(
            AppError::validation("CSS ファイルが大きすぎます。256KB 以内にしてください。"),
            &path,
        ));
    }
    Ok(path)
}

/// 検証済みパスから CSS を読む。
fn read_source_css(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path).map_err(|_| {
        with_filename_detail(
            AppError::path_not_found("CSS ファイルを読み取れませんでした。"),
            path,
        )
    })?;
    // ⚠ metadata を見てから read するまでにファイルが伸びうる（TOCTOU）ので、実バイト長で取り直す。
    if bytes.len() as u64 > MAX_CSS_BYTES {
        return Err(with_filename_detail(
            AppError::validation("CSS ファイルが大きすぎます。256KB 以内にしてください。"),
            path,
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        with_filename_detail(
            AppError::unsupported_file_type(
                "この CSS ファイルは UTF-8 として読み取れません。テキストファイルか確認してください。",
            ),
            path,
        )
    })
}

// --- 取り込み -------------------------------------------------------------------------------

/// 検証済みの取り込み元（読み終えた CSS と、正規化済みのテーマ名）。
pub struct ImportSource {
    css: String,
    name: String,
}

/// 取り込み元の `.css` を検証して読む。
///
/// ⚠⚠ **DB ロックを取る前に呼ぶこと**（security-review 指摘）。`path` はユーザーが dialog で選んだ
/// 場所＝**ネットワークボリューム上にありうる**。ここを `db.lock()` の内側で行うと、応答しない
/// ボリュームを掴んだときに**アプリ全体の DB コマンド（コメント記録・プリセット起動・ログ）が
/// まとめて止まる**。読み込みだけをロックの外へ出しておけば、詰まるのはこの取り込み 1 本で済む。
pub fn read_import_source(raw_path: &str, raw_name: &str) -> AppResult<ImportSource> {
    // 名前を先に見る（ファイル読み込みという重い処理の前に落とす）。
    let name = validate_theme_name(raw_name)?;
    let path = validate_source_path(raw_path)?;
    let css = read_source_css(&path)?;
    Ok(ImportSource { css, name })
}

/// 読み終えた取り込み元を登録する（**DB ロックを取ってから**呼ぶ）。
///
/// `origin` をここで `Local` に固定するので、コマンド層は出自を指定できない
/// （`Snapshot` を作れるのは 060c が足す経路だけ）。
pub fn import_local_source(
    dir: &Path,
    conn: &Connection,
    source: &ImportSource,
) -> AppResult<OverlayThemeImportResult> {
    store_sanitized_css(
        dir,
        conn,
        &source.css,
        &source.name,
        OverlayThemeOrigin::Local,
    )
}

/// 060e: **貼り付けられた CSS テキスト**を取り込む（ファイルを一切経由しない）。
///
/// ⚠ `import_local_source` と同じく [`store_sanitized_css`] へ委譲するだけ——**検証を別実装にしない**
/// （060b からの申し送りの核心。`exactly_one_place_sanitizes_and_exactly_one_place_writes` が
/// 「サニタイズは 1 か所・書き込みは 1 か所」を出現回数で固定している）。
/// したがって貼り付け経路でも、名前検証・**256KB 上限**・制御文字・**200 件上限**・外部参照の除去・
/// uuid 採番・書き込み → INSERT の順序・失敗時の掃除が**そのまま**効く。
///
/// ⚠ 出自は **`Local`**。`Snapshot` は「外部 `@import` を取得してインライン化したもの」（060c）専用で、
/// 貼り付けた CSS は**端末外へ 1 バイトも出ていない**＝出自としてはローカルと同じである。
/// ⚠⚠ **`origin` をここで定数として渡すのが要点**。`commands.rs` 側に `origin` の文字が現れると
/// `the_theme_origin_is_never_settable_from_the_frontend` が落ちる（＝ frontend から出自を騙れなくする仕組み）。
/// **060c が text 版を足すときも同じ形にすること**（コマンド引数に `origin` を生やさない）。
pub fn import_pasted_text(
    dir: &Path,
    conn: &Connection,
    raw_css: &str,
    raw_name: &str,
) -> AppResult<OverlayThemeImportResult> {
    store_sanitized_css(dir, conn, raw_css, raw_name, OverlayThemeOrigin::Local)
}

/// 060c: **外部 `@import` を取得してインライン展開した CSS** を取り込む（スナップショット）。
///
/// ⚠ 実体は [`import_pasted_text`] とまったく同じで、違いは **`origin` の定数だけ**——
/// どちらも [`store_sanitized_css`] へ委譲するので、名前検証・**256KB 上限**・制御文字・**200 件上限**・
/// 外部参照の除去・uuid 採番・書き込み → INSERT の順序・失敗時の掃除がそのまま効く。
/// **検証を別実装に分けない**（060b からの申し送りの核心。
/// `exactly_one_place_sanitizes_and_exactly_one_place_writes` が出現回数で固定している）。
///
/// ⚠⚠ **`Snapshot` を立てられるのはこの関数だけ**である。`commands.rs` は `origin` の文字を 1 つも
/// 持たないので frontend から出自を騙れない（`the_theme_origin_is_never_settable_from_the_frontend`）。
///
/// ⚠ **ここは取得を行わない。** 取得は sidecar（`apps/comment-sidecar/src/theme-import.ts`）の責務で、
/// Rust は最後まで no-internet のままである（`never_reimplements_the_selector_rewrite_or_reaches_the_network`
/// が `reqwest` / `TcpStream` 等の不在を固定している）。渡ってくるのは
/// 「**ユーザーが URL を目で見て同意し、専用ガードを通った 1 回の GET の結果**を、除去済み CSS の前に
/// 前置した文字列」で、**この関数から見れば貼り付けテキストと区別が付かない**——だからこそ検証は同一でよい。
pub fn import_fetched_snapshot(
    dir: &Path,
    conn: &Connection,
    raw_css: &str,
    raw_name: &str,
) -> AppResult<OverlayThemeImportResult> {
    store_sanitized_css(dir, conn, raw_css, raw_name, OverlayThemeOrigin::Snapshot)
}

/// **検証・サニタイズ・保存の共通コア。**
///
/// ⚠ **どの取り込み経路もこの関数を呼ぶだけにすること。** 検証を別実装に分けると、片方だけ緩んだときに
/// 気づけない（060b で最も避けたかった形。`exactly_one_place_sanitizes_and_exactly_one_place_writes`
/// が「サニタイズ 1 か所・書き込み 1 か所」を出現回数で固定している）。
///
/// ⚠⚠ **取り込み経路は 3 本ある**（2026-08-09・060c で 3 本目が入った）。**どれも本関数へ委譲するだけ**:
/// [`import_local_source`]（ファイル・`Local`）／[`import_pasted_text`]（貼り付け・`Local`）／
/// [`import_fetched_snapshot`]（外部 `@import` のスナップショット・`Snapshot`）。
///
/// - `origin` は**必ず Rust 側の定数**で渡すこと（`commands.rs` に `origin` の文字が現れると
///   `the_theme_origin_is_never_settable_from_the_frontend` が落ちる）。
/// - ⚠⚠ **060c で `takes_no_arbitrary_path_or_content_from_the_frontend` の
///   「`css: String` は 1 本だけ」が設計どおり落ちた**。**数字だけ 2 へ書き換えて通してはいない**——
///   §3 の再評価を `docs/security.md` §5 の 060b 例外節へ「③ Snapshot 経路」として書き足し、
///   security-review の対象にしたうえで 2 本目を解禁している。再評価の要点は
///   「**増えるのは本文の出所（ネットワーク由来）だけで、書ける場所は 1 バイトも動かない**」こと。
/// - ⚠ 4 本目を足すときも同じ手順を踏むこと（テストが再び落ちるようにしてある）。
pub fn store_sanitized_css(
    dir: &Path,
    conn: &Connection,
    raw_css: &str,
    raw_name: &str,
    origin: OverlayThemeOrigin,
) -> AppResult<OverlayThemeImportResult> {
    let name = validate_theme_name(raw_name)?;
    let css = validate_css_body(raw_css)?;
    if repository::count(conn)? >= MAX_THEMES {
        return Err(AppError::validation(
            "登録できるテーマの上限に達しています。不要なテーマを削除してください。",
        ));
    }

    // ⚠ ここが本タスクの核心。取り除ききれない形は Err で返る（fail-closed）。
    let outcome = sanitize::sanitize_css(&css)?;

    // ファイル名は**アプリが採番した id 由来**。元ファイル名も name も使わない（§5）。
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.css");
    let path = managed_path(dir, &file_name)?;

    std::fs::create_dir_all(dir)
        .map_err(|_| AppError::storage("テーマの保存先を用意できませんでした。"))?;
    std::fs::write(&path, outcome.css.as_bytes())
        .map_err(|_| AppError::storage("テーマを保存できませんでした。"))?;

    let now = now_rfc3339();
    let theme = OverlayThemeRecord {
        id,
        name,
        origin,
        stripped_count: outcome.stripped_count,
        created_at: now.clone(),
        updated_at: now,
    };

    // ⚠ **書き込み → INSERT の順**。INSERT に失敗したらファイルを掃除する。
    // 逆順（INSERT → 書き込み）にしないのは、失敗したときに残るものの質が違うから——
    // 孤児**ファイル**は不可視で無害だが、孤児**DB 行**は一覧に出て開けない「可視の故障」になる。
    // 掃除自体が失敗しても、残るのは前者なので受容できる。
    if let Err(e) = repository::insert(conn, &theme, &file_name) {
        let _ = std::fs::remove_file(&path);
        return Err(AppError::from(e));
    }

    Ok(OverlayThemeImportResult {
        theme,
        stripped_import_urls: outcome.stripped_import_urls,
        truncated_to_eof: outcome.truncated_to_eof,
    })
}

// --- 取り出し・更新・削除 -----------------------------------------------------------------------

pub fn list(conn: &Connection) -> AppResult<Vec<OverlayThemeRecord>> {
    Ok(repository::list(conn)?)
}

/// 保存済みテーマの CSS を文字列で返す（060d の注入元）。
///
/// ⚠ **frontend からパスを受け取らない。** `id` で DB を引き、DB の `file_name` を
/// [`managed_path`] に通してから読む。id 自体も形を検査する（2 段の防御）。
pub fn read_css(dir: &Path, conn: &Connection, id: &str) -> AppResult<String> {
    if !is_theme_id(id) {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    let file_name = repository::file_name_of(conn, id)?
        .ok_or_else(|| AppError::not_found("テーマが見つかりません。"))?;
    let path = managed_path(dir, &file_name)?;
    let bytes = std::fs::read(&path)
        .map_err(|_| AppError::not_found("テーマの CSS を読み取れませんでした。"))?;
    String::from_utf8(bytes).map_err(|_| AppError::storage("テーマの CSS が壊れています。"))
}

pub fn rename(conn: &Connection, id: &str, raw_name: &str) -> AppResult<OverlayThemeRecord> {
    if !is_theme_id(id) {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    let name = validate_theme_name(raw_name)?;
    if repository::update_name(conn, id, &name, &now_rfc3339())? == 0 {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    repository::get(conn, id)?.ok_or_else(|| AppError::not_found("テーマが見つかりません。"))
}

/// テーマを削除する（DB 行とファイル実体の両方）。
///
/// ⚠ **DB 行を先に消す**。逆順にすると、行の削除に失敗したときに「一覧に出るのに開けないテーマ」が
/// 残る（可視の故障）。この順なら残りうるのは孤児ファイルだけ（不可視・無害）。
/// ファイルが既に無い場合は無視する（冪等）。2 回目の削除は行が 0 件なので `NotFound`
/// （`tools::delete` と同じ挙動）。
pub fn delete(dir: &Path, conn: &Connection, id: &str) -> AppResult<()> {
    if !is_theme_id(id) {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    let file_name = repository::file_name_of(conn, id)?;
    if repository::delete(conn, id)? == 0 {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    if let Some(file_name) = file_name {
        if let Ok(path) = managed_path(dir, &file_name) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 060b の検証・保存まわりの仕様テストと、**ソース文字列の契約テスト**。
    //!
    //! 契約テストは `audio::service` / `obs_config` / `app_update::commands` /
    //! `lib.rs::pinned_overlay_contract` の先例と同型で、
    //! **テストでは踏めないセキュリティ不変条件を機械的に守る**ためのもの。
    //! ⚠ needle は必ず `format!` で実行時に組む（`include_str!` は自ファイルを読むので、
    //! 検索文字列を直書きすると自己ヒットで判定が骨抜きになる）。

    use super::*;
    use crate::error::ErrorCode;

    // --- テスト用の足場 -------------------------------------------------------------------------

    fn conn() -> Connection {
        let conn = match Connection::open_in_memory() {
            Ok(conn) => conn,
            Err(e) => panic!("in-memory SQLite を開けない: {e}"),
        };
        if let Err(e) = repository::init(&conn) {
            panic!("init に失敗: {e}");
        }
        conn
    }

    /// コマンド層と**同じ 2 段**（ロック外で読む → ロック内で登録する）を 1 行で呼ぶテスト用の合成。
    /// ⚠ 本番の順序を変えたらここも合わせること（テストだけ旧経路を使い続けないため）。
    fn import_from_path(
        dir: &Path,
        conn: &Connection,
        raw_path: &str,
        raw_name: &str,
    ) -> AppResult<OverlayThemeImportResult> {
        let source = read_import_source(raw_path, raw_name)?;
        import_local_source(dir, conn, &source)
    }

    /// テスト専用の一時ディレクトリ（`Drop` で片付ける）。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join("stream-dock-overlay-theme-test")
                .join(uuid::Uuid::new_v4().to_string());
            if let Err(e) = std::fs::create_dir_all(&path) {
                panic!("一時ディレクトリを作れない: {e}");
            }
            TempDir(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
        fn write(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            if let Err(e) = std::fs::write(&path, contents) {
                panic!("テスト用ファイルを書けない: {e}");
            }
            path
        }
        fn entries(&self) -> Vec<String> {
            let Ok(read_dir) = std::fs::read_dir(&self.0) else {
                return Vec::new();
            };
            let mut names: Vec<String> = read_dir
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // --- is_managed_file_name（管理ディレクトリの外へ出ないことの直接の担保）-----------------------

    #[test]
    fn only_uuid_named_css_files_are_treated_as_managed() {
        assert!(is_managed_file_name(
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301.css"
        ));
        // 大文字の 16 進も通す（狙いは「パス片が入っていない」保証）。
        assert!(is_managed_file_name(
            "3F2504E0-4F89-41D3-9A0C-0305E82C3301.css"
        ));

        for bad in [
            "",
            ".css",
            "..",
            "../evil.css",
            "../../etc/passwd.css",
            "/etc/passwd.css",
            "C:\\evil.css",
            "sub/3f2504e0-4f89-41d3-9a0c-0305e82c3301.css",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301.txt",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
            "3f2504e0-4f89-41d3-9a0c-0305e82c330.css",  // 1 文字短い
            "3f2504e0-4f89-41d3-9a0c-0305e82c33011.css", // 1 文字長い
            "3f2504e0_4f89-41d3-9a0c-0305e82c3301.css", // 区切りが違う
            "3f2504e0-4f89-41d3-9a0c-0305e82c330g.css", // 16 進でない
            "配信用.css",
        ] {
            assert!(!is_managed_file_name(bad), "管理下と誤判定した: {bad:?}");
        }
    }

    // --- 名前の検証 -----------------------------------------------------------------------------

    #[test]
    fn theme_names_are_trimmed_and_bounded() {
        assert_eq!(
            validate_theme_name("  配信用  ").ok(),
            Some("配信用".to_string())
        );
        assert_eq!(
            validate_theme_name(&"あ".repeat(MAX_NAME_CHARS)).ok(),
            Some("あ".repeat(MAX_NAME_CHARS))
        );

        for bad in [
            "",
            "   ",
            "配信\n用",
            "配信\u{0}用",
            // ⚠ U+0085 は JS の /[\x00-\x1F\x7F]/ では通るが char::is_control は弾く。
            //   Rust 側のほうが広いので、060d は同じか狭い判定にすること。
            "配信\u{85}用",
        ] {
            assert!(
                validate_theme_name(bad).is_err(),
                "受け入れてはいけない名前を通した: {bad:?}"
            );
        }
        // 長さ上限（文字数で数える＝マルチバイトでも 80 文字まで）。
        assert!(validate_theme_name(&"あ".repeat(MAX_NAME_CHARS + 1)).is_err());
    }

    // --- 本文の検証 -----------------------------------------------------------------------------

    #[test]
    fn the_css_body_keeps_whitespace_controls_but_rejects_the_rest() {
        // CSS は改行・タブ・フォームフィードを空白として使う。`reject_control_chars` を
        // そのまま当てるとここが全滅する（だから別規則にしてある）。
        assert!(validate_css_body(".a{\n\tcolor:red;\r\n}\u{0C}").is_ok());

        for bad in [".a{\u{0}}", ".a{\u{1}}", ".a{\u{7F}}", ".a{\u{1B}}"] {
            let err = match validate_css_body(bad) {
                Ok(_) => panic!("制御文字入りの CSS を通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::UnsupportedFileType);
        }
    }

    #[test]
    fn a_leading_bom_is_stripped_so_the_first_rule_still_parses() {
        let body = validate_css_body("\u{FEFF}.a{color:red}").ok();
        assert_eq!(body, Some(".a{color:red}".to_string()));
        // 途中の U+FEFF は制御文字ではないので触らない。
        assert_eq!(
            validate_css_body(".a{content:\"\u{FEFF}\"}").ok(),
            Some(".a{content:\"\u{FEFF}\"}".to_string())
        );
    }

    #[test]
    fn the_size_limit_is_enforced_on_the_body_at_its_exact_boundary() {
        let at_limit = "a".repeat(MAX_CSS_BYTES as usize);
        assert!(validate_css_body(&at_limit).is_ok());
        let over_limit = "a".repeat(MAX_CSS_BYTES as usize + 1);
        let err = match validate_css_body(&over_limit) {
            Ok(_) => panic!("上限超えの CSS を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    // --- パスの検証 -----------------------------------------------------------------------------

    #[test]
    fn source_paths_must_be_existing_css_files_within_the_size_limit() {
        let dir = TempDir::new();
        let ok_path = dir.write("theme.css", b".a{color:red}");
        assert!(validate_source_path(&ok_path.to_string_lossy()).is_ok());
        // 拡張子は ASCII 大小無視。
        let upper = dir.write("theme.CSS", b".a{color:red}");
        assert!(validate_source_path(&upper.to_string_lossy()).is_ok());

        // 拡張子違い。
        let txt = dir.write("theme.txt", b".a{color:red}");
        let err = match validate_source_path(&txt.to_string_lossy()) {
            Ok(_) => panic!(".txt を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::UnsupportedFileType);

        // 拡張子なし・空・存在しない・ディレクトリ。
        let no_ext = dir.write("theme", b".a{color:red}");
        assert!(validate_source_path(&no_ext.to_string_lossy()).is_err());
        assert!(validate_source_path("   ").is_err());
        assert!(validate_source_path(&dir.path().join("missing.css").to_string_lossy()).is_err());
        let sub = dir.path().join("nested.css");
        assert!(std::fs::create_dir_all(&sub).is_ok());
        let err = match validate_source_path(&sub.to_string_lossy()) {
            Ok(_) => panic!("ディレクトリを通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);

        // サイズ超過。
        let big = dir.write("big.css", &vec![b'a'; MAX_CSS_BYTES as usize + 1]);
        let err = match validate_source_path(&big.to_string_lossy()) {
            Ok(_) => panic!("大きすぎるファイルを通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    #[test]
    fn network_paths_are_refused_before_the_filesystem_is_touched() {
        // ⚠⚠ security-review S-4。`import_overlay_theme` は ACL 対象外＝全 4 窓から任意文字列で呼べる。
        // Windows で UNC を渡されると `fs::metadata` の時点で SMB 接続が起き、既定設定では NTLM で
        // 資格情報ハッシュが飛ぶ（ユーザー操作ゼロの egress）。**拡張子より前に**弾くこと。
        for bad in [
            r"\\evil.example\share\x.css",
            r"\\evil.example\share\x.txt", // 拡張子チェックより前に落ちる
            r"\\?\UNC\evil.example\share\x.css",
            "//evil.example/share/x.css",
        ] {
            let err = match validate_source_path(bad) {
                Ok(_) => panic!("ネットワークパスを通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::ValidationError, "{bad:?}");
            // ⚠ ファイル名を details に出さない（そもそもディスクへ触っていない）。
            let json = serde_json::to_string(&err).unwrap_or_default();
            assert!(!json.contains("evil.example"), "入力を持ち帰っている: {json}");
        }
        // ローカルの絶対パスは通る（過剰に弾いていないこと）。
        let dir = TempDir::new();
        let ok_path = dir.write("theme.css", b".a{color:red}");
        assert!(validate_source_path(&ok_path.to_string_lossy()).is_ok());
    }

    #[test]
    fn binary_files_named_css_are_refused() {
        let dir = TempDir::new();
        // PNG のシグネチャ（`.css` にリネームしたバイナリ）。
        let png = dir.write("fake.css", &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0xFF]);
        let err = match read_source_css(&png) {
            Ok(_) => panic!("非 UTF-8 を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::UnsupportedFileType);
    }

    #[test]
    fn path_errors_expose_the_file_name_but_never_the_full_path() {
        let dir = TempDir::new();
        let txt = dir.write("secret-folder-name.txt", b"x");
        let err = match validate_source_path(&txt.to_string_lossy()) {
            Ok(_) => panic!(".txt を通した"),
            Err(e) => e,
        };
        let json = serde_json::to_string(&err).unwrap_or_default();
        assert!(
            json.contains("secret-folder-name.txt"),
            "ファイル名は details に出す想定: {json}"
        );
        assert!(
            !json.contains(&dir.path().to_string_lossy().to_string()),
            "フルパスが露出している: {json}"
        );
    }

    // --- 取り込み・取り出し・削除 -----------------------------------------------------------------

    #[test]
    fn importing_writes_exactly_one_uuid_named_file_and_registers_it() {
        let dir = TempDir::new();
        let conn = conn();
        let source = dir.write(
            "user-theme.css",
            b"@import url(\"https://evil.example/a.css\");\n.sd-comment{color:red}\n",
        );
        // ⚠ 保存先はソースと同じ一時ディレクトリにせず、専用の管理ディレクトリを掘る。
        let managed = TempDir::new();

        let result = match import_from_path(
            managed.path(),
            &conn,
            &source.to_string_lossy(),
            "  配信用テーマ  ",
        ) {
            Ok(result) => result,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };

        assert_eq!(result.theme.name, "配信用テーマ");
        assert_eq!(result.theme.origin, OverlayThemeOrigin::Local);
        assert_eq!(result.theme.stripped_count, 1);
        assert_eq!(
            result.stripped_import_urls,
            vec!["https://evil.example/a.css".to_string()]
        );

        // ⚠ 実ファイル名に元ファイル名もテーマ名も現れない（§5）。
        let entries = managed.entries();
        assert_eq!(entries.len(), 1, "作られたファイルが 1 つでない: {entries:?}");
        assert_eq!(entries[0], format!("{}.css", result.theme.id));
        assert!(!entries[0].contains("user-theme"));
        assert!(!entries[0].contains("配信用"));

        // 保存された内容は除去済み。
        let css = read_css(managed.path(), &conn, &result.theme.id).unwrap_or_default();
        assert_eq!(css, "\n.sd-comment{color:red}\n");
        assert!(!css.contains("@import"));

        // 一覧にも出る。
        let listed = list(&conn).unwrap_or_default();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, result.theme.id);
    }

    /// 060e: 貼り付け経路でも、ファイル経路と**同じ担保がそのまま効く**ことを固定する。
    ///
    /// ⚠ ここが緑であることの意味は「貼り付け版が独自の検証を持っている」ではなく、
    /// 「**共通コア（`store_sanitized_css`）へ委譲しているので検証が 1 セットしかない**」である
    /// （`exactly_one_place_sanitizes_and_exactly_one_place_writes` が構造側を固定している）。
    #[test]
    fn pasted_text_is_stored_exactly_like_a_file_import() {
        let dir = TempDir::new();
        let conn = conn();

        let result = import_pasted_text(
            dir.path(),
            &conn,
            "@import url(\"https://evil.example/a.css\");\n.sd-comment{color:red}",
            "貼り付けたデザイン",
        )
        .expect("貼り付けた CSS は取り込めるはず");

        // ①ファイル名は **id 由来**（貼り付けにはそもそも元ファイル名が無い）。
        assert_eq!(dir.entries(), vec![format!("{}.css", result.theme.id)]);
        // ②外部参照は**保存されない**（ファイル版と同じサニタイザを通っている）。
        let saved = std::fs::read_to_string(dir.path().join(format!("{}.css", result.theme.id)))
            .expect("保存したファイルを読めるはず");
        // ⚠ 除去するのは**文そのものだけ**で、周りの空白は動かさない（ファイル版と同じ・
        // `css_without_any_reference_is_returned_byte_for_byte` と同じ「原文を保つ」方針）。
        assert_eq!(saved, "\n.sd-comment{color:red}");
        assert!(!saved.contains("evil.example"));
        assert_eq!(result.theme.stripped_count, 1);
        assert_eq!(
            result.stripped_import_urls,
            vec!["https://evil.example/a.css".to_string()]
        );
        // ③出自は Local（端末外へ出ていないので Snapshot ではない）。
        assert_eq!(result.theme.origin, OverlayThemeOrigin::Local);
        // ④DB にも 1 行だけ入る。
        assert_eq!(list(&conn).expect("一覧を取れるはず").len(), 1);
    }

    /// ⚠ 上限・検証は**貼り付け経路でも同じ**。ここが落ちたら委譲が外れている。
    #[test]
    fn pasted_text_is_bounded_and_validated_like_a_file_import() {
        let dir = TempDir::new();
        let conn = conn();

        // 名前: 空・81 文字・制御文字はファイル版と同じく拒否。
        for bad_name in ["", "   ", "a\u{7}b"] {
            let err = import_pasted_text(dir.path(), &conn, ".a{color:red}", bad_name)
                .expect_err("不正な名前は拒否されるはず");
            assert_eq!(err.code, ErrorCode::ValidationError);
        }
        let too_long: String = "あ".repeat(MAX_NAME_CHARS + 1);
        assert!(import_pasted_text(dir.path(), &conn, ".a{color:red}", &too_long).is_err());

        // 本文: 256KB 超は拒否（⚠ **バイト長**で見る＝ frontend も TextEncoder で数えること）。
        let too_big = format!(
            ".a{{content:\"{}\"}}",
            "x".repeat(MAX_CSS_BYTES as usize)
        );
        let err = import_pasted_text(dir.path(), &conn, &too_big, "でかい")
            .expect_err("256KB 超は拒否されるはず");
        assert_eq!(err.code, ErrorCode::ValidationError);

        // 本文: 取り除けない参照を含むプレリュードは fail-closed（ファイル版と同じ文言）。
        assert!(import_pasted_text(
            dir.path(),
            &conn,
            "@media (min-width: calc(1px + url(https://evil.example/x))){.a{color:red}}",
            "だめ",
        )
        .is_err());

        // ⚠ 拒否されたものは**ファイルも DB 行も残さない**。
        assert!(dir.entries().is_empty());
        assert_eq!(list(&conn).expect("一覧を取れるはず").len(), 0);
    }

    /// ⚠ エラーに **CSS 本文を載せない**（§9）。貼り付けは本文が丸ごと frontend にある経路なので、
    /// 「返ってきたエラーをそのまま画面に出す」実装と組み合わさると本文が露出しうる。
    #[test]
    fn pasted_text_errors_never_carry_the_css_body_back_to_the_caller() {
        let dir = TempDir::new();
        let conn = conn();
        let secret = "SECRET-MARKER-9f2b";
        let css = format!(
            "@media (min-width: calc(1px + url(https://evil.example/{secret}))){{.a{{color:red}}}}"
        );

        let err = import_pasted_text(dir.path(), &conn, &css, "だめ")
            .expect_err("取り除けない参照は拒否されるはず");
        assert!(!err.message.contains(secret));
        assert!(!format!("{err:?}").contains(secret));
    }

    /// ⚠ 件数上限（200 件）も貼り付け経路で効く＝**無制限にディスクが増える経路にならない**。
    /// アプリ定義コマンドは ACL 対象外＝全 4 窓から呼べるので、この歯止めは構造側で要る。
    #[test]
    fn pasted_text_respects_the_theme_count_cap() {
        let dir = TempDir::new();
        let conn = conn();
        for i in 0..MAX_THEMES {
            import_pasted_text(dir.path(), &conn, ".a{color:red}", &format!("t{i}"))
                .expect("上限までは取り込めるはず");
        }
        let err = import_pasted_text(dir.path(), &conn, ".a{color:red}", "over")
            .expect_err("上限を超えたら拒否されるはず");
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert_eq!(dir.entries().len(), MAX_THEMES as usize);
    }

    #[test]
    fn a_traversal_shaped_name_never_escapes_the_managed_directory() {
        // ⚠ 実機確認③に対応するユニットテスト。`name` は**ファイル名に使われない**ので、
        // 何を入れても管理ディレクトリの外にファイルは出ない。
        let source_dir = TempDir::new();
        let managed = TempDir::new();
        let conn = conn();
        let source = source_dir.write("t.css", b".sd-comment{color:red}");

        for evil in [
            "../evil",
            "../../evil",
            "/tmp/evil",
            "..\\..\\evil",
            "evil/../..",
        ] {
            let result = match import_from_path(
                managed.path(),
                &conn,
                &source.to_string_lossy(),
                evil,
            ) {
                Ok(result) => result,
                Err(e) => panic!("{evil:?} の取り込みが失敗した: {e}"),
            };
            // 名前はそのまま保存されるが、ファイル名は id 由来。
            assert_eq!(result.theme.name, evil);
            let expected = format!("{}.css", result.theme.id);
            assert!(
                managed.entries().contains(&expected),
                "{evil:?}: 期待するファイルが無い"
            );
        }
        // 管理ディレクトリ配下は id 由来のファイルだけ（親へ漏れていない）。
        for entry in managed.entries() {
            assert!(
                is_managed_file_name(&entry),
                "管理ディレクトリに想定外のファイルがある: {entry}"
            );
        }
        assert!(!source_dir.entries().iter().any(|e| e.contains("evil")));
    }

    #[test]
    fn deleting_removes_both_the_row_and_the_file_and_repeats_safely() {
        let source_dir = TempDir::new();
        let managed = TempDir::new();
        let conn = conn();
        let source = source_dir.write("t.css", b".sd-comment{color:red}");
        let result = match import_from_path(managed.path(), &conn, &source.to_string_lossy(), "T") {
            Ok(result) => result,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        assert_eq!(managed.entries().len(), 1);

        assert!(delete(managed.path(), &conn, &result.theme.id).is_ok());
        assert!(managed.entries().is_empty(), "ファイル実体が消えていない");
        assert!(list(&conn).unwrap_or_default().is_empty());

        // 二重削除は NotFound（落ちない）。
        let err = match delete(managed.path(), &conn, &result.theme.id) {
            Ok(()) => panic!("二重削除が成功した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn deleting_succeeds_even_when_the_file_is_already_gone() {
        let source_dir = TempDir::new();
        let managed = TempDir::new();
        let conn = conn();
        let source = source_dir.write("t.css", b".sd-comment{color:red}");
        let result = match import_from_path(managed.path(), &conn, &source.to_string_lossy(), "T") {
            Ok(result) => result,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        // ユーザーが手で消した状況。
        assert!(std::fs::remove_file(managed.path().join(format!("{}.css", result.theme.id))).is_ok());
        assert!(delete(managed.path(), &conn, &result.theme.id).is_ok());
    }

    #[test]
    fn a_tampered_file_name_in_the_database_never_escapes_the_managed_directory() {
        // ⚠⚠ §5 の多層防御を**出口側**（読み・削除）で表明する。
        // `a_traversal_shaped_name_never_escapes_the_managed_directory` は**入口側**（取り込み時に
        // ユーザーの `name` がファイル名に使われないこと）の担保で、`managed_path` そのものは踏んでいない。
        // 保存するファイル名は id 由来なので通常この状態にはならないが、`managed_path` は
        // 「DB から来た値をパスへ結合する直前」に立っている最後の砦なので、**それが実際に効くこと**を固定する。
        //
        // ⚠ 絶対パスを入れるのが最も強い検査: Rust の `Path::join` は**絶対パスを渡すと元のパスを捨てる**ので、
        // `managed_path` の検証を外すと `dir.join("/外部/victim.css")` が丸ごと外部パスになる（＝任意ファイル読み取り）。
        let managed = TempDir::new();
        let outside = TempDir::new();
        let victim = outside.write("victim.css", b".victim{color:red}");
        let conn = conn();

        for (index, evil_file_name) in [
            victim.to_string_lossy().to_string(), // 絶対パス（join が元パスを捨てる）
            "../victim.css".to_string(),
            "..".to_string(),
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301.css/../../victim.css".to_string(),
        ]
        .into_iter()
        .enumerate()
        {
            let id = format!("3f2504e0-4f89-41d3-9a0c-0305e82c33{index:02}");
            let now = now_rfc3339();
            let theme = OverlayThemeRecord {
                id: id.clone(),
                name: "汚染された行".to_string(),
                origin: OverlayThemeOrigin::Local,
                stripped_count: 0,
                created_at: now.clone(),
                updated_at: now,
            };
            assert!(
                repository::insert(&conn, &theme, &evil_file_name).is_ok(),
                "テスト用の汚染行を入れられない"
            );

            // 読めない（中身が返らない。⚠ 返ると任意ファイル読み取りになる）。
            let err = match read_css(managed.path(), &conn, &id) {
                Ok(css) => panic!("管理ディレクトリ外を読んだ: {evil_file_name:?} -> {css:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::NotFound, "{evil_file_name:?}");

            // 削除しても外部ファイルは消えない（DB 行だけが消える）。
            assert!(
                delete(managed.path(), &conn, &id).is_ok(),
                "汚染行の削除は成功する（行は消してよい）: {evil_file_name:?}"
            );
            assert!(
                victim.exists(),
                "管理ディレクトリ外のファイルを削除した: {evil_file_name:?}"
            );
        }

        // 管理ディレクトリには何も作られていない。
        assert!(managed.entries().is_empty(), "{:?}", managed.entries());
        assert!(list(&conn).unwrap_or_default().is_empty(), "汚染行が残っている");
    }

    #[test]
    fn a_bom_is_stripped_before_sanitizing_so_the_import_target_is_still_reported() {
        // ⚠ `validate_css_body`（BOM 剥がし）→ `sanitize_css` の**順序**が仕様。
        // 逆順にすると、先頭の `@import` は「アットルール」として認識されない
        //（`scan_unit` はアットキーワードを**文の先頭でしか**読まないので、BOM が挟まると外れる）。
        // ⚠ **除去自体は url() 経由で起きるので出力だけ見ても気づけない**——気づけるのは
        // `stripped_import_urls` が空になること＝ **060c の同意ダイアログに宛先が出なくなる**という形。
        let managed = TempDir::new();
        let conn = conn();
        let result = match store_sanitized_css(
            managed.path(),
            &conn,
            "\u{FEFF}@import url(\"https://ruri.info/a.css\");\n.sd-comment{color:red}\n",
            "T",
            OverlayThemeOrigin::Local,
        ) {
            Ok(result) => result,
            Err(e) => panic!("BOM 付き CSS の保存に失敗: {e}"),
        };
        assert_eq!(
            result.stripped_import_urls,
            vec!["https://ruri.info/a.css".to_string()],
            "BOM が先に剥がれていないので @import として認識できていない"
        );
        assert_eq!(result.theme.stripped_count, 1);
        // 保存された本文には BOM も @import も残っていない。
        let css = read_css(managed.path(), &conn, &result.theme.id).unwrap_or_default();
        assert_eq!(css, "\n.sd-comment{color:red}\n");
    }

    #[test]
    fn a_style_end_tag_survives_the_round_trip_because_060d_must_inject_via_text_content() {
        // ⚠⚠ security.md「CSP方針」060b 節の「060d への条件」。`content:"</style>"` は正当な CSS なので
        // **除去しない**。ここが「安全のため」落とすように変わると、060d 側の
        // 「注入は `<style>` の `textContent` で行う（`innerHTML` は禁止）」という不変条件が
        // **不要になったと誤解される**——実際には除去してもエスケープ経路が残るので、守るべきは注入側。
        let managed = TempDir::new();
        let conn = conn();
        let body = r#".sd-comment::after{content:"</style><script>x</script>"}"#;
        let result = match store_sanitized_css(
            managed.path(),
            &conn,
            body,
            "T",
            OverlayThemeOrigin::Local,
        ) {
            Ok(result) => result,
            Err(e) => panic!("保存に失敗: {e}"),
        };
        assert_eq!(result.theme.stripped_count, 0);
        // 060d が読むのは `get_overlay_theme_css` ＝ この経路。バイト単位で同じであること。
        let css = read_css(managed.path(), &conn, &result.theme.id).unwrap_or_default();
        assert_eq!(css, body, "`</style>` を含む CSS が書き換えられた");
    }

    #[test]
    fn unknown_or_malformed_ids_are_not_found_rather_than_touching_the_disk() {
        let managed = TempDir::new();
        let conn = conn();
        for id in [
            "",
            "..",
            "../../etc/passwd",
            "3f2504e0-4f89-41d3-9a0c-0305e82c3301", // 形は正しいが未登録
            "not-a-uuid",
        ] {
            assert_eq!(
                read_css(managed.path(), &conn, id).err().map(|e| e.code),
                Some(ErrorCode::NotFound),
                "id={id:?}"
            );
            assert_eq!(
                delete(managed.path(), &conn, id).err().map(|e| e.code),
                Some(ErrorCode::NotFound),
                "id={id:?}"
            );
            assert_eq!(
                rename(&conn, id, "X").err().map(|e| e.code),
                Some(ErrorCode::NotFound),
                "id={id:?}"
            );
        }
    }

    #[test]
    fn renaming_validates_the_new_name_and_keeps_the_file_untouched() {
        let source_dir = TempDir::new();
        let managed = TempDir::new();
        let conn = conn();
        let source = source_dir.write("t.css", b".sd-comment{color:red}");
        let result = match import_from_path(managed.path(), &conn, &source.to_string_lossy(), "旧") {
            Ok(result) => result,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };

        assert!(rename(&conn, &result.theme.id, "  新  ").is_ok());
        let listed = list(&conn).unwrap_or_default();
        assert_eq!(listed.first().map(|t| t.name.clone()), Some("新".to_string()));
        // 名前を変えてもファイル名は動かない。
        assert_eq!(managed.entries(), vec![format!("{}.css", result.theme.id)]);

        assert_eq!(
            rename(&conn, &result.theme.id, "  ").err().map(|e| e.code),
            Some(ErrorCode::ValidationError)
        );
    }

    #[test]
    fn the_theme_count_is_capped() {
        let managed = TempDir::new();
        let conn = conn();
        for index in 0..MAX_THEMES {
            let stored = store_sanitized_css(
                managed.path(),
                &conn,
                ".sd-comment{color:red}",
                &format!("T{index}"),
                OverlayThemeOrigin::Local,
            );
            assert!(stored.is_ok(), "{index} 件目の保存に失敗");
        }
        let err = match store_sanitized_css(
            managed.path(),
            &conn,
            ".sd-comment{color:red}",
            "over",
            OverlayThemeOrigin::Local,
        ) {
            Ok(_) => panic!("上限を超えて保存できた"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
        // ⚠ 上限で弾いたときに孤児ファイルを作っていないこと。
        assert_eq!(managed.entries().len(), MAX_THEMES as usize);
    }

    #[test]
    fn a_refused_css_leaves_no_file_and_no_row_behind() {
        // fail-closed 経路（@media のプレリュードに url）で、途中まで作ったものが残らないこと。
        let managed = TempDir::new();
        let conn = conn();
        let err = match store_sanitized_css(
            managed.path(),
            &conn,
            "@media (background:url(https://evil.example/x)){.a{color:red}}",
            "T",
            OverlayThemeOrigin::Local,
        ) {
            Ok(_) => panic!("拒否されるべき CSS が保存された"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert!(managed.entries().is_empty(), "孤児ファイルが残った");
        assert!(list(&conn).unwrap_or_default().is_empty(), "孤児レコードが残った");
    }

    #[test]
    fn a_failed_insert_takes_the_file_it_wrote_with_it() {
        // ⚠ 「書き込み → INSERT」の順にした以上、INSERT が落ちたときに**孤児ファイルを残さない**ことが
        // その順序を選んだ理由そのもの。ミューテーション（掃除を外す）が生存したので常設した。
        // INSERT だけを確実に失敗させるため、SELECT は通るまま INSERT を拒否するトリガーを張る。
        let managed = TempDir::new();
        let conn = conn();
        let trigger = conn.execute_batch(
            "CREATE TRIGGER refuse_insert BEFORE INSERT ON overlay_themes
             BEGIN SELECT RAISE(ABORT, 'refused by test'); END;",
        );
        assert!(trigger.is_ok());

        let err = match store_sanitized_css(
            managed.path(),
            &conn,
            ".sd-comment{color:red}",
            "T",
            OverlayThemeOrigin::Local,
        ) {
            Ok(_) => panic!("INSERT が失敗するはずが成功した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::StorageFailed);
        assert!(
            managed.entries().is_empty(),
            "INSERT 失敗後に孤児ファイルが残った: {:?}",
            managed.entries()
        );
    }

    #[test]
    fn store_errors_never_carry_the_css_body_back_to_the_caller() {
        // §9: ログにも frontend にも CSS 本文・URL を出さない。
        let managed = TempDir::new();
        let conn = conn();
        let marker = "evil-marker-9f3a";
        let css = format!("@media (background:url(https://{marker}.example/x)){{.a{{color:red}}}}");
        let err = match store_sanitized_css(
            managed.path(),
            &conn,
            &css,
            "T",
            OverlayThemeOrigin::Local,
        ) {
            Ok(_) => panic!("拒否されるべき CSS が保存された"),
            Err(e) => e,
        };
        let json = serde_json::to_string(&err).unwrap_or_default();
        assert!(!json.contains(marker), "エラーが CSS 本文を持ち帰っている: {json}");
    }

    // --- 契約テスト（ソース文字列で不変条件を固定する）---------------------------------------------

    const MOD_RS: &str = include_str!("mod.rs");
    const MODEL_RS: &str = include_str!("model.rs");
    const SANITIZE_RS: &str = include_str!("sanitize.rs");
    const SERVICE_RS: &str = include_str!("service.rs");
    const REPOSITORY_RS: &str = include_str!("repository.rs");
    const COMMANDS_RS: &str = include_str!("commands.rs");

    /// `overlay_theme` モジュールの**本番コード**（コメントとテスト自身を除いたもの）。
    ///
    /// ⚠ この 2 段の除去が無いと契約テストは原理的に無意味になる（`audio::service` の教訓）:
    /// - `include_str!` は自分自身も読むので、**禁止語をこのテストに書いた時点で自己ヒットする**
    ///   → `#[cfg(test)]` 以降を切り落とし、needle は `format!` で実行時に組む。
    /// - 禁止 API は「使わない理由」を doc コメントで説明したい → 行コメントを剥がしてから照合する。
    ///
    /// ⚠ `overlay_theme/` にファイルを足したら、ここの一覧にも足すこと
    /// （足し忘れは `the_contract_covers_every_file_in_the_module` が検出する）。
    fn production_sources() -> Vec<(&'static str, String)> {
        let test_marker = format!("#[cfg({})]", "test");
        [
            ("mod.rs", MOD_RS),
            ("model.rs", MODEL_RS),
            ("sanitize.rs", SANITIZE_RS),
            ("service.rs", SERVICE_RS),
            ("repository.rs", REPOSITORY_RS),
            ("commands.rs", COMMANDS_RS),
        ]
        .into_iter()
        .map(|(name, raw)| {
            let head = raw.split(&test_marker).next().unwrap_or(raw);
            let code = head
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            (name, code)
        })
        .collect()
    }

    fn production_source(file: &str) -> String {
        production_sources()
            .into_iter()
            .find(|(name, _)| *name == file)
            .map(|(_, code)| code)
            .unwrap_or_else(|| panic!("overlay_theme/{file} が production_sources() の一覧に無い"))
    }

    fn assert_absent(needle: &str, why: &str) {
        for (name, code) in production_sources() {
            assert!(
                !code.contains(needle),
                "overlay_theme/{name} に {needle:?} が現れた。{why}"
            );
        }
    }

    /// ⚠ **needle は呼び出し側の「引数の変数名」まで含む**（`validate_theme_name(raw_name)` 等）。
    /// 定義側（`fn validate_theme_name(raw: &str)`）と区別して**呼ばれていること**を固定するために
    /// 必要だが、代償として**引数名を変えるだけのリファクタでもここが落ちる**。
    /// そのとき下の理由文だけを読むと「検証が外された」と誤診断するので、
    /// **メッセージ側に「引数名を変えただけならテストの needle を直す」と明記してある**
    ///（レビュー Q-2。060a レビュー (5-b)「正しいコードで fail する検査」への対処）。
    fn assert_present_in(file: &str, needle: &str, why: &str) {
        assert!(
            production_source(file).contains(needle),
            "overlay_theme/{file} から {needle:?} が消えた。{why}\n\
             ⚠ 呼び出し自体は残っていて**引数の変数名を変えただけ**なら、\
             検証は外れていない——このテストの needle を新しい変数名に合わせること。"
        );
    }

    #[test]
    fn the_contract_covers_every_file_in_the_module() {
        // ⚠ `production_sources()` は `include_str!` の手書き一覧なので、ファイルを足しても
        // 自動では検査対象に入らない。数を固定して、足した瞬間にここが落ちるようにする。
        // **落ちたら一覧にそのファイルを足すこと**（数だけ直して通してはいけない）。
        assert_eq!(
            production_sources().len(),
            6,
            "overlay_theme/ のファイル構成が変わった。production_sources() の一覧を確認すること"
        );
    }

    #[test]
    fn exposes_exactly_seven_single_purpose_commands() {
        // §3: 汎用の読み書きコマンドを作らない。⚠ アプリ定義コマンドは ACL 対象外＝**全 4 窓から呼べる**。
        // ⚠ 060e で 6 本目（`import_overlay_theme_text`）、**060c で 7 本目
        // （`import_overlay_theme_snapshot`）**を意図的に足したので、関数名も 5 → 6 → 7 へ改名している
        // （security-review②・品質 #7。テスト名は git の追跡単位ではないので改名コストは無く、
        // **名前と assert が食い違うテスト**のほうが「どちらが正か」を毎回確かめさせる負債になる）。
        // 守っているのは数そのものではなく「**単一目的のコマンドしか無い・増やすときは必ずここが落ちる**」。
        let code = production_source("commands.rs");
        assert_eq!(
            code.matches(&format!("#[tauri::{}]", "command")).count(),
            7,
            "overlay_theme のコマンド数が 7 でない（増やすなら §3 の再評価と security-review が要る）"
        );
        // ⚠ ユーザーが選ぶファイルはネットワークボリューム上にありうる。同期コマンドはメインスレッドで
        // 走るので、取り込みだけは非同期にして UI を止めない（`audio` の同型の判断）。
        // 他の 4 本は DB 操作か app_data_dir（常にローカル）配下の小さな読み書きだけなので同期のまま。
        assert_eq!(
            code.matches(&format!("pub {} fn", "async")).count(),
            1,
            "取り込みコマンドが同期に戻された（遅い I/O でメインスレッドが止まる）"
        );
    }

    #[test]
    fn takes_no_arbitrary_path_or_content_from_the_frontend() {
        // §3 の禁止例（`write_file(path, content)` 型）を機械的に止める。
        let code = production_source("commands.rs");
        assert_eq!(
            code.matches(&format!("{}: String", "path")).count(),
            1,
            "パスを受け取るコマンドは import 1 本だけであること"
        );
        // ⚠⚠ **060e で `css: String` を 1 本だけ解禁し、060c で 2 本目を解禁した。**
        // 禁止を消さず**出現回数の固定へ変えている**のが要点——3 本目が増えた瞬間にここが落ちる。
        // 解禁してよい理由は「本文を渡せても**書ける場所が変わらない**」こと:
        // 保存先は `app_data_dir/themes/<uuid v4>.css` の固定形だけで、その組み立てにユーザー入力は
        // 1 バイトも入らない（すぐ下の `the_storage_path_is_built_only_from_the_app_data_dir` が固定）。
        // ＝ §3 が禁じている `write_file(path, content)` 型（**書ける場所を呼び出し側が決める**）には当たらない。
        // ⚠ `content` / `bytes` / `data` は**引き続き全面禁止**（「汎用の書き込み」に見える命名を残さない）。
        //
        // ⚠⚠ **060c での再評価の記録（数字だけ書き換えて通していない）**:
        // このテストは「2 本目が増えたら落ちる」ことで §3 の再評価と security-review を呼ぶ仕掛けだった。
        // 実際に落ちたので、`docs/security.md` §5 の 060b 例外節へ「③ Snapshot 経路」の軸を追記し、
        // **増えるもの／増えないもの**を分けて書いたうえで 2 へ上げている:
        // - 増えない: 保存先の組み立て・サニタイズ・上限（256KB / 200 件）は **`store_sanitized_css` の
        //   1 セットだけ**。`path` も取らないので UNC 経由の egress も任意ファイル読み取りの合成も増えない。
        // - 増える: **本文の出所がネットワーク由来になる**（他 2 本はローカル由来）。ただし 3 本とも
        //   サニタイズ前の本文を信頼していないので扱いは同じで、取得できる形は sidecar 側の
        //   `assertAllowedThemeImportUrl` で極端に狭めてある（`https:` / 443 / `.css` / SSRF 拒否 /
        //   リダイレクト禁止 / `text/css` / サイズ・時間上限 / 毎回の明示同意 / チケット認証）。
        assert_eq!(
            code.matches(&format!("{}: String", "css")).count(),
            2,
            "CSS 本文を受け取るコマンドは貼り付け取り込みとスナップショットの 2 本だけであること\
             （3 本目を足すなら §3 の再評価と security-review が要る）"
        );
        // ⚠ 上の「2」は**どのコマンドか**までは固定しないので、名前でも押さえる（片方を汎用名の
        // 別コマンドへ差し替える変異が数字だけでは生き残るため）。
        for expected in ["import_overlay_theme_text", "import_overlay_theme_snapshot"] {
            assert!(
                code.contains(expected),
                "commands.rs から {expected} が消えた。`css: String` を取ってよいのはこの 2 本だけである"
            );
        }
        for banned in ["content", "bytes", "data"] {
            assert!(
                !code.contains(&format!("{banned}: String")),
                "commands.rs が {banned}: String を受け取っている（汎用の書き込み経路になる）"
            );
        }
        assert_absent(
            &format!("Path{}", "Buf::from(raw"),
            "生の frontend 入力から直接パスを組み立てないこと（validate_source_path を通す）。",
        );
    }

    #[test]
    fn the_storage_path_is_built_only_from_the_app_data_dir() {
        // §5: 保存先の組み立てにユーザー入力が結合されていないことを構造で固定する。
        let code = production_source("service.rs");
        assert_eq!(
            code.matches(&format!("app_data{}()", "_dir")).count(),
            1,
            "app_data_dir() を呼ぶ場所は themes_dir() の 1 か所だけであること"
        );
        assert_eq!(
            code.matches(&format!("{}(THEMES_DIR)", "join")).count(),
            1,
            "THEMES_DIR を結合する場所は themes_dir() の 1 か所だけであること"
        );
        assert_eq!(
            code.matches(&format!("dir.{}(file_name)", "join")).count(),
            1,
            "ファイル名を結合する場所は managed_path() の 1 か所だけであること"
        );
        assert_absent(
            &format!("{}(&name)", "join"),
            "§5: テーマ名をパスへ結合しない（ファイル名は id 由来）。",
        );
    }

    #[test]
    fn the_import_reads_its_file_before_taking_the_db_lock() {
        // ⚠ security-review 指摘。ユーザーが選ぶファイルはネットワークボリューム上にありうるので、
        // DB ロックの内側で読むと**アプリ全体の DB コマンドが止まる**。読み込みをロックの外に置く、
        // という順序は目で見ないと分からないので、ソース上の出現順で固定する。
        let code = production_source("commands.rs");
        let read_at = code.find(&format!("{}(&path", "service::read_import_source"));
        let lock_at = code.find(&format!("db.{}()", "lock"));
        match (read_at, lock_at) {
            (Some(read_at), Some(lock_at)) => assert!(
                read_at < lock_at,
                "取り込みのファイル読み込みが DB ロックの内側に入った（遅い I/O が全 DB コマンドを止める）"
            ),
            _ => panic!("commands.rs から read_import_source / db.lock の呼び出しが見つからない"),
        }
    }

    #[test]
    fn every_validation_is_actually_wired_in() {
        // ⚠ 「禁止 API の不在」だけでは検証を**削除する**方向の退行を検出できない（audio レビューの教訓）。
        // 守りたい不変条件のうち「在ること」で表すものをここで固定する。
        assert_present_in(
            "service.rs",
            &format!("{}(file_name)", "is_managed_file_name"),
            "管理ディレクトリ外へ出ないための検証が外された。",
        );
        assert_present_in(
            "service.rs",
            &format!("sanitize::{}(&css)", "sanitize_css"),
            "⚠⚠ 保存経路がサニタイザを通らなくなった（外部参照がそのまま保存される）。",
        );
        assert_present_in(
            "service.rs",
            &format!("{}(raw_name)", "validate_theme_name"),
            "テーマ名の検証が外された（§8）。",
        );
        assert_present_in(
            "service.rs",
            &format!("{}(raw_path)", "validate_source_path"),
            "パスの検証が外された（§7 / §8）。",
        );
        assert_present_in(
            "service.rs",
            &format!("{}(raw_css)", "validate_css_body"),
            "CSS 本文の検証（サイズ・制御文字・BOM）が外された（§8）。",
        );
        assert_present_in(
            "sanitize.rs",
            &format!("{}(&residual)", "find_residual_violation"),
            "⚠ 残留検証が外された（「数えたのに消していない」型のバグが素通しになる）。",
        );
    }

    #[test]
    fn the_theme_origin_is_never_settable_from_the_frontend() {
        // ⚠ `model.rs` / security.md / task-board が揃って「`origin` はコマンド引数に一切現れない
        // （frontend から `snapshot` を騙れない）」と主張しているが、**それを守る仕組みが無かった**。
        // 060c が text 版コマンドを足すときに `origin: String` を生やすのが最も自然な間違いなので、
        // ここで機械的に止める（060c は `store_sanitized_css` に `OverlayThemeOrigin::Snapshot` を
        // **Rust 側の定数として**渡すこと）。
        let code = production_source("commands.rs");
        assert!(
            !code.contains("origin"),
            "commands.rs に origin が現れた。出自は Rust 側の呼び出し経路だけが決めること\
             （frontend から snapshot を騙れるようになる）"
        );
    }

    #[test]
    fn exactly_one_place_sanitizes_and_exactly_one_place_writes() {
        // ⚠⚠ 060c への申し送りの核心＝「検証を別実装に分けると、片方だけ緩んだときに気づけない」。
        // `every_validation_is_actually_wired_in` は「呼ばれていること」を見るが、
        // **2 本目の保存経路が増えたこと**は検出できない（1 本目が残っていれば通ってしまう）。
        // ⚠ needle を呼び出し形にせず**出現回数**で見るので、引数名のリファクタでは動かない（Q-2 の対策）。
        let code = production_source("service.rs");
        assert_eq!(
            code.matches(&format!("sanitize::{}(", "sanitize_css")).count(),
            1,
            "サニタイズの呼び出しが 1 か所でない。保存経路が 2 本になると片方だけ緩んでも気づけない"
        );
        assert_eq!(
            code.matches(&format!("std::fs::{}(", "write")).count(),
            1,
            "ファイル書き込みが 1 か所でない（§5: 書けるのは store_sanitized_css だけであること）"
        );
    }

    #[test]
    fn never_reimplements_the_selector_rewrite_or_reaches_the_network() {
        // 060a の変換表は TypeScript 側にあり、変換は注入時に frontend が毎回行う（060b の決定）。
        // Rust で再実装すると 2 実装に分裂して片方だけ古くなる。
        for banned in ["cssCompat", "rewriteSelector", "sd-comment-text"] {
            assert_absent(
                banned,
                "060a のセレクタ変換をここで再実装・参照しないこと（保存するのは変換前の CSS）。",
            );
        }
        // §1: 本モジュールは外部参照を**除去する側**。取得は 060c（sidecar）の領分。
        for banned in ["reqwest", "ureq", "TcpStream", "hyper::"] {
            assert_absent(banned, "§1: overlay_theme から外部通信を行わない（取得は 060c の sidecar）。");
        }
    }

    #[test]
    fn has_no_panicking_paths_outside_the_shared_db_lock_idiom() {
        // ⚠ `commands.rs` の `db.lock().expect("db mutex poisoned")` は**リポジトリ全体の標準イディオム**で
        // （`lib.rs` の WINDOW_OPEN_LOCK の注記が「データ持ちの Mutex は poison=expect を維持する」と
        // 明示している）、ここだけ別の書き方にする理由が無い。そこで
        // **本番ロジックの 4 ファイルは panic 経路ゼロ**、`commands.rs` はそのイディオムだけを許して
        // 出現数を固定する、という 2 段の形にしてある。
        let why = "overlay_theme の本番ロジックは panic 経路を持たない（全経路を AppResult に落とす）。";
        for file in ["mod.rs", "model.rs", "sanitize.rs", "service.rs", "repository.rs"] {
            let code = production_source(file);
            for needle in [
                format!("unwrap{}", "()"),
                format!(".{}(", "expect"),
                format!("{}!(", "panic"),
                format!("{}!(", "unreachable"),
                format!("{}!(", "todo"),
            ] {
                assert!(
                    !code.contains(needle.as_str()),
                    "overlay_theme/{file} に {needle:?} が現れた。{why}"
                );
            }
        }
        // ⚠ 出現数を定数 5 で固定していたが、それだと**DB ロックを取らないコマンドを 1 本足しただけで
        // 偽陽性で落ちる**（コマンド数はすぐ上の `exposes_exactly_seven_single_purpose_commands` が
        // 別に固定している）。ここで守りたいのは「**このイディオム以外の panic 経路が無い**」ことなので、
        // ①全 `expect` が db mutex のものと一致 ②その数はコマンド数を超えない、の 2 点にする（レビュー Q-8）。
        let commands = production_source("commands.rs");
        let expects = commands.matches(&format!(".{}(", "expect")).count();
        let db_lock_expects = commands
            .matches(&format!(".{}(\"db mutex poisoned\")", "expect"))
            .count();
        assert_eq!(
            expects, db_lock_expects,
            "commands.rs に DbState の標準イディオム以外の expect が現れた。{why}"
        );
        let command_count = commands.matches(&format!("#[tauri::{}]", "command")).count();
        assert!(
            db_lock_expects <= command_count,
            "commands.rs の expect がコマンド数を超えた（1 コマンドで複数回ロックを取っていないか）"
        );
        assert_eq!(
            commands.matches(&format!("unwrap{}", "()")).count(),
            0,
            "commands.rs に unwrap() が現れた"
        );
    }
}
