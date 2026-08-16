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
// ⚠ 065a: `is_network_path` / `with_filename_detail` はここから消えたが、**規則が消えたのではない**
//   ——`CSS_IMPORT_SPEC` 経由で `util::validate_import_path` が引き続き両方を使う（そちらが唯一の定義）。
use crate::util::{now_rfc3339, reject_control_chars, require_non_empty};

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

/// 060h: **フォント資産**（`@font-face` だけの CSS）の上限（5MiB）。
///
/// ⚠⚠ **意匠の [`MAX_CSS_BYTES`] を上げていないのが要点。** 256KB は 060a の実測に紐づく
/// **注入経路の予算**で、`rewriteSelectors` は 060d が注入のたびに毎回走らせる。
/// フォント資産は **`rewriteSelectors` も `scopeSelectors` も `withDecorationReset` も通らない**
/// （`@font-face` はセレクタを持たないので変換する対象が無い）＝注入時のコストは
/// 「ブラウザが CSS を 1 回パースする」だけなので、256KB の根拠がそもそも及ばない。
///
/// 値の根拠: 060h の取得側予算は **生 woff2 で 3MiB**（base64 で 4MiB）。
/// それに `@font-face` の記述（1 ブロック約 200 バイト × 256 件 ≒ 50KB）と余裕を足して 5MiB。
/// ⚠ **ディスクの天井が上がる**（従来 256KB×200 件 ≒ 50MB → 最大 (256KB+5MiB)×200 件 ≒ 1GB）。
/// 200 件上限（[`MAX_THEMES`]）は**据え置く**。再修正トリガーは `docs/security.md` §5 の 060b 例外節④。
const MAX_FONT_CSS_BYTES: u64 = 5 * 1024 * 1024;

/// 060h: テーマが持つ**管理下の資産**の種別。
///
/// ⚠⚠ **違うのは本文の上限だけ**である。保存先の組み立て（`app_data_dir/themes/<uuid v4>.css`）・
/// サニタイズ・書き込みは [`write_sanitized_asset`] の**1 セット**を共有する。
/// ＝ `is_managed_file_name()` は書き換えていない（**書けるファイル名の集合は 1 バイトも広がっていない**）。
///
/// ⚠ この型に「`@font-face` だけか」の規則を持たせていないのは意図（060h review S-10）。
/// あれは**資産の性質**ではなく **`attach_theme_fonts` という 1 つの入口の受け入れ条件**なので、
/// 検査はそちらに置いてある（`SanitizeOutcome::top_level_non_font_face` を見る）。
/// ここへ持ち込むと `validate_css_body` が資産種別ごとに分岐を増やす形になり、
/// 「**上限だけが違う**」という読みやすさが崩れる。
/// ⚠ 再修正トリガー＝ 3 つ目の資産種別が増えて、種別ごとに違う本文規則が 2 つ以上になったとき。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ThemeAsset {
    /// 意匠 CSS（従来の `<theme id>.css`）。注入のたびに `rewriteSelectors` が走る。
    Design,
    /// 060h: フォント CSS（`@font-face` ＋ `data:` の woff2 だけ）。変換を一切通さない別 `<style>` に載る。
    Fonts,
}

impl ThemeAsset {
    fn max_bytes(self) -> u64 {
        match self {
            ThemeAsset::Design => MAX_CSS_BYTES,
            ThemeAsset::Fonts => MAX_FONT_CSS_BYTES,
        }
    }

    /// エラー文言に出す上限の表記（⚠ ユーザー入力は 1 バイトも補間しない・§9）。
    fn limit_label(self) -> &'static str {
        match self {
            ThemeAsset::Design => "256KB",
            ThemeAsset::Fonts => "5MB",
        }
    }
}

/// テーマ名の長さ上限（文字数。バイト数ではない）。一覧の 1 行に収まる長さ。
const MAX_NAME_CHARS: usize = 80;

/// 登録できるテーマの件数上限。
///
/// ⚠ **無制限にディスクが増える経路を作らないため**。取り込みコマンドはアプリ定義コマンドなので
/// **全 5 窓から呼べる**（ACL 対象外）＝上限は構造側に持たせる。
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
///
/// ⚠⚠ 060h: **`asset` で変わるのは上限だけ**（意匠 256KB／フォント 5MiB）。制御文字の規則も BOM の扱いも
/// 共通である＝「フォントだけ検査がゆるい」という形を作らない。理由は [`ThemeAsset`] の注記。
fn validate_css_body(raw: &str, asset: ThemeAsset) -> AppResult<String> {
    // CSS 仕様上、スタイルシートは BOM で始まってよい。剥がさないと先頭の規則が壊れる。
    // ⚠ 途中の U+FEFF は制御文字ではない（ゼロ幅スペース）ので触らない。
    let css = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    if css.len() as u64 > asset.max_bytes() {
        // ⚠ 補間するのはコンパイル時定数だけ（ユーザー入力は 1 バイトも載せない・§9）。
        return Err(AppError::validation(format!(
            "CSS が大きすぎます。{} 以内にしてください。",
            asset.limit_label()
        )));
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
/// 060b がテーマ CSS を取り込むときの受け入れ規則（拡張子・上限・文言）。
///
/// ⚠⚠ **065a で検証の実体を [`util::validate_import_path`] / [`util::read_import_text`] へ寄せた。**
/// この定数が持つのは「`.css` であること」「**256KB**（[`MAX_CSS_BYTES`]）であること」「文言」だけで、
/// **検証の 6 段とその順序は util 側の 1 か所にしかない**。
/// 移した理由＝065a が `.csv` で 2 本目の取り込み経路を作ったから。順序ごと複製すると、
/// とくに「**UNC 判定を拡張子より前に置く**」（security-review S-4）が片方だけ崩れても
/// **コンパイルもテストも通ってしまう**（`is_network_path` を共有ヘルパへ出した 061c S-1 と同じ判断）。
/// ⚠ **挙動・文言・エラーコードは 1 バイトも変えていない**（下のテスト群がそのまま緑であることが担保）。
const CSS_IMPORT_SPEC: crate::util::ImportFileSpec = crate::util::ImportFileSpec {
    extension: "css",
    max_bytes: MAX_CSS_BYTES,
    msg_missing: "CSS ファイルが選択されていません",
    msg_control: "ファイルパスに制御文字は使用できません",
    msg_network: "ネットワーク上のファイルは取り込めません。ローカルにコピーしてから選んでください。",
    msg_extension: "CSS ファイル（.css）を選んでください。",
    msg_not_found: "指定された CSS ファイルが見つかりません。",
    // ⚠ **`msg_not_found` と別文言なのは 060b の挙動を 1 バイトも変えないため**（共有化の初版はここを
    //   1 つにまとめてしまい、`read_source_css` の文言が静かに変わっていた）。この 2 つを揃えないこと。
    msg_read_failed: "CSS ファイルを読み取れませんでした。",
    msg_not_a_file: "ファイルを選んでください。",
    msg_too_large: "CSS ファイルが大きすぎます。256KB 以内にしてください。",
    msg_not_utf8: "この CSS ファイルは UTF-8 として読み取れません。テキストファイルか確認してください。",
};

/// dialog 由来の生パスを検証する（§7 / §8）。**規則の実体は [`util::validate_import_path`]**。
///
/// ⚠ **この薄いラッパを消さないこと。** `read_import_source` からの呼び出し名を
/// `validate_source_path(raw_path)` のまま保つことで、下の契約テストと
/// `network_paths_are_refused_before_the_filesystem_is_touched` が**そのまま効き続ける**
/// ——つまり「UNC が拡張子より前」を **060b 側からも** 直接テストできる状態を維持している。
fn validate_source_path(raw: &str) -> AppResult<PathBuf> {
    crate::util::validate_import_path(raw, &CSS_IMPORT_SPEC)
}

/// 検証済みパスから CSS を読む（TOCTOU の実バイト再チェック込み・実体は [`util::read_import_text`]）。
///
/// ⚠ BOM はここでは剥がさない（従来どおり [`validate_css_body`] の仕事）。
fn read_source_css(path: &Path) -> AppResult<String> {
    crate::util::read_import_text(path, &CSS_IMPORT_SPEC)
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
    if repository::count(conn)? >= MAX_THEMES {
        return Err(AppError::validation(
            "登録できるテーマの上限に達しています。不要なテーマを削除してください。",
        ));
    }

    // ファイル名は**アプリが採番した id 由来**。元ファイル名も name も使わない（§5）。
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{id}.css");
    let (path, outcome) = write_sanitized_asset(dir, raw_css, &file_name, ThemeAsset::Design)?;

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
        stripped_font_faces: outcome.stripped_font_faces,
        truncated_to_eof: outcome.truncated_to_eof,
    })
}

/// **検証・サニタイズ・ファイル書き込みの共通コア**（060h で切り出した私有ヘルパ）。
///
/// ⚠⚠ **`sanitize::sanitize_css(` と `std::fs::write(` が現れるのはこの関数の中だけ**である。
/// 契約テスト `exactly_one_place_sanitizes_and_exactly_one_place_writes` が出現回数 1 で固定しており、
/// **060h でフォント資産という 2 本目の保存経路ができても、それは緩めずに済んだ**——
/// [`store_sanitized_css`]（意匠）と [`attach_theme_fonts`]（フォント）は
/// **どちらもここへ委譲するだけ**なので、「保存経路が 2 本に分かれて片方だけ緩む」形が構造的に作れない。
/// ⚠ **数字合わせで契約テストを通したのではない**（`docs/security.md` §5 の 060b 例外節④が再評価の記録）。
///
/// ⚠ `file_name` は**呼び出し側がアプリ採番の uuid v4 から組む**（ユーザー入力は 1 バイトも入らない）。
/// パスへ結合する直前に [`managed_path`] が `<uuid v4>.css` 完全一致を検査する（多層防御）。
fn write_sanitized_asset(
    dir: &Path,
    raw_css: &str,
    file_name: &str,
    asset: ThemeAsset,
) -> AppResult<(PathBuf, sanitize::SanitizeOutcome)> {
    let css = validate_css_body(raw_css, asset)?;
    // ⚠ ここが 060b の核心。取り除ききれない形は Err で返る（fail-closed）。
    let outcome = sanitize::sanitize_css(&css)?;
    let path = managed_path(dir, file_name)?;

    std::fs::create_dir_all(dir)
        .map_err(|_| AppError::storage("テーマの保存先を用意できませんでした。"))?;
    std::fs::write(&path, outcome.css.as_bytes())
        .map_err(|_| AppError::storage("テーマを保存できませんでした。"))?;
    Ok((path, outcome))
}

/// 060h: 取得した Web フォントを **`@font-face` だけの CSS** としてテーマへ添える。
///
/// ⚠⚠ **意匠 CSS とは別ファイル・別 `<style>`** にするのが要件（060h 問題④）。
/// 同じ文字列に混ぜると、テーマを切り替えるたびに `rewriteSelectors` が数 MB を走査することになる。
/// フォント CSS はセレクタを持たないので**変換も走査も要らない**。
///
/// ⚠ **ファイル名は資産ごとに別の uuid v4**（`<uuid v4>.css`）。テーマ id とは独立させてあるので、
/// [`is_managed_file_name`] の完全一致を**1 文字も緩めずに**2 つ目のファイルを持てる。
///
/// ⚠ 既にフォント資産があるテーマに対して呼ぶと**差し替える**（古いファイルは best-effort 削除）。
/// 取り込みは「撮ったら固定」なので通常は 1 回だけだが、`@import` のラウンドが増えたときに
/// 同じテーマへ 2 回書く経路が理屈の上では作れるため、冪等に倒しておく。
pub fn attach_theme_fonts(
    dir: &Path,
    conn: &Connection,
    id: &str,
    raw_css: &str,
) -> AppResult<()> {
    if !is_theme_id(id) {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    // ⚠ 実在しないテーマへ書かない（孤児ファイルを作らない）。
    if repository::file_name_of(conn, id)?.is_none() {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    let previous = repository::font_file_name_of(conn, id)?;

    let asset_id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{asset_id}.css");
    let (path, outcome) = write_sanitized_asset(dir, raw_css, &file_name, ThemeAsset::Fonts)?;

    // ⚠⚠ 060h review S-10: **フォント資産は `@font-face` だけであること**を Rust 側で確かめる。
    // この資産は注入時に `rewriteSelectors` / `scopeSelectors` / `withDecorationReset` を
    // **1 つも通らない**（`@font-face` はセレクタを持たないから変換が要らない、という前提で
    // 別 `<style>` に載せている）。その前提を守っているのが frontend の `buildFontFaceCss` の
    // 作法だけだと、「変換を通さない注入口へ任意の CSS を流す」形が将来の 1 行で作れてしまう。
    // ここで拒否すれば、**注入経路の性質と保存できる中身が構造的に一致する**。
    // ⚠ 書いた後に検査しているのはサニタイズ済みの本文を見たいため。落ちたら必ず掃除する。
    if outcome.top_level_non_font_face {
        let _ = std::fs::remove_file(&path);
        return Err(AppError::validation(
            "書体の取り込みに失敗しました。書体以外の指定が含まれています。",
        ));
    }

    // ⚠ **書き込み → UPDATE の順**（意匠と同じ理由）。UPDATE に失敗したら書いたファイルを掃除する。
    // ⚠ 060h review S-11: **更新行数も見る**。存在確認と UPDATE の間にテーマが消えると
    // `Ok(0)` が返り、書いたファイルが `delete` からも辿れない永久孤児になる。
    match repository::set_font_file_name(conn, id, &file_name, &now_rfc3339()) {
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            return Err(AppError::from(e));
        }
        Ok(0) => {
            let _ = std::fs::remove_file(&path);
            return Err(AppError::not_found("テーマが見つかりません。"));
        }
        Ok(_) => {}
    }
    // 旧資産は best-effort で消す（残っても不可視の孤児ファイル＝無害）。
    if let Some(previous) = previous {
        if previous != file_name {
            if let Ok(old) = managed_path(dir, &previous) {
                let _ = std::fs::remove_file(old);
            }
        }
    }
    Ok(())
}

/// 060h: テーマのフォント CSS を返す（無ければ空文字）。
///
/// ⚠ 意匠と同じく **frontend からパスを受け取らない**。`id` で DB を引き、DB の `font_file_name` を
/// [`managed_path`] に通してから読む。
/// ⚠ **「フォントが無い」と「読めない」を分けない**（どちらも空文字）——注入側は
/// 「空なら `<style>` を作らない」だけなので、ユーザーが取る行動が変わらない。
pub fn read_font_css(dir: &Path, conn: &Connection, id: &str) -> AppResult<String> {
    if !is_theme_id(id) {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    let Some(file_name) = repository::font_file_name_of(conn, id)? else {
        return Ok(String::new());
    };
    let path = managed_path(dir, &file_name)?;
    let Ok(bytes) = std::fs::read(&path) else {
        return Ok(String::new());
    };
    match String::from_utf8(bytes) {
        Ok(css) => Ok(css),
        // ⚠ 自分で書いた UTF-8 なので通常は起きない。壊れていたら「フォント無し」へ倒す（配信を止めない）。
        Err(_) => Ok(String::new()),
    }
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
    // ⚠ 060h: テーマは**最大 2 ファイル**を持つ（意匠 ＋ フォント）。取り出すのは行を消す**前**。
    let font_file_name = repository::font_file_name_of(conn, id)?;
    if repository::delete(conn, id)? == 0 {
        return Err(AppError::not_found("テーマが見つかりません。"));
    }
    // ⚠ **どちらも消す**。片方だけ消すと不可視の孤児ファイルが残り続ける（無害だが増える一方になる）。
    for name in [file_name, font_file_name].into_iter().flatten() {
        if let Ok(path) = managed_path(dir, &name) {
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
    //! `lib.rs::overlay_window_contract` の先例と同型で、
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
        assert!(validate_css_body(".a{\n\tcolor:red;\r\n}\u{0C}", ThemeAsset::Design).is_ok());

        for bad in [".a{\u{0}}", ".a{\u{1}}", ".a{\u{7F}}", ".a{\u{1B}}"] {
            let err = match validate_css_body(bad, ThemeAsset::Design) {
                Ok(_) => panic!("制御文字入りの CSS を通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::UnsupportedFileType);
        }
    }

    #[test]
    fn a_leading_bom_is_stripped_so_the_first_rule_still_parses() {
        let body = validate_css_body("\u{FEFF}.a{color:red}", ThemeAsset::Design).ok();
        assert_eq!(body, Some(".a{color:red}".to_string()));
        // 途中の U+FEFF は制御文字ではないので触らない。
        assert_eq!(
            validate_css_body(".a{content:\"\u{FEFF}\"}", ThemeAsset::Design).ok(),
            Some(".a{content:\"\u{FEFF}\"}".to_string())
        );
    }

    #[test]
    fn the_size_limit_is_enforced_on_the_body_at_its_exact_boundary() {
        let at_limit = "a".repeat(MAX_CSS_BYTES as usize);
        assert!(validate_css_body(&at_limit, ThemeAsset::Design).is_ok());
        let over_limit = "a".repeat(MAX_CSS_BYTES as usize + 1);
        let err = match validate_css_body(&over_limit, ThemeAsset::Design) {
            Ok(_) => panic!("上限超えの CSS を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    // --- 060h: フォント資産（2 つ目の管理ファイル）-------------------------------------------------

    #[test]
    fn the_font_asset_has_its_own_byte_limit_and_the_design_limit_is_unchanged() {
        // ⚠⚠ **意匠の 256KB は動かしていない**（060a の実測に紐づく注入経路の予算）。
        let over_design = "a".repeat(MAX_CSS_BYTES as usize + 1);
        assert!(validate_css_body(&over_design, ThemeAsset::Design).is_err());
        // フォント資産は同じ本文でも通る（上限だけが違う）。
        assert!(validate_css_body(&over_design, ThemeAsset::Fonts).is_ok());
        // フォント側にも上限はある（無制限ではない）。
        let over_fonts = "a".repeat(MAX_FONT_CSS_BYTES as usize + 1);
        let err = match validate_css_body(&over_fonts, ThemeAsset::Fonts) {
            Ok(_) => panic!("上限超えのフォント CSS を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
        // ⚠ 制御文字の規則は資産種別で変わらない（「フォントだけ検査がゆるい」を作らない）。
        assert!(validate_css_body(".a{\u{0}}", ThemeAsset::Fonts).is_err());
    }

    #[test]
    fn attaching_fonts_writes_a_second_managed_file_and_reads_back() {
        let dir = TempDir::new();
        let conn = conn();
        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        // 取り込み直後はフォント資産を持たない＝空文字（「無い」と「読めない」を分けない）。
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(String::new())
        );

        let fonts = "@font-face{font-family:X;src:url(data:font/woff2;base64,d09GMg==) format(\"woff2\")}";
        if let Err(e) = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, fonts) {
            panic!("フォント資産を添えられない: {e}");
        }
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(fonts.to_string()),
            "⚠ 生成したフォント CSS がサニタイザに書き換えられている（data: は許可形のはず）"
        );

        // ⚠⚠ **ファイルは 2 つ**、どちらも `<uuid v4>.css` 形（`is_managed_file_name` を緩めていない）。
        let entries = dir.entries();
        assert_eq!(entries.len(), 2, "管理ファイルが 2 つでない: {entries:?}");
        for name in &entries {
            assert!(
                is_managed_file_name(name),
                "管理外のファイル名で保存された: {name}"
            );
        }
    }

    #[test]
    fn attaching_fonts_twice_replaces_the_previous_asset() {
        let dir = TempDir::new();
        let conn = conn();
        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        let first = "@font-face{font-family:A;src:url(data:font/woff2;base64,AA==)}";
        let second = "@font-face{font-family:B;src:url(data:font/woff2;base64,BB==)}";
        let _ = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, first);
        let _ = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, second);
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(second.to_string())
        );
        // 旧資産は掃除される（不可視の孤児を溜めない）。
        assert_eq!(dir.entries().len(), 2, "古いフォント資産が残っている");
    }

    #[test]
    fn the_generated_font_css_survives_the_sanitizer_byte_for_byte() {
        // ⚠⚠ **frontend の `buildFontFaceCss` が実際に作る形**をそのまま通す言語跨ぎの契約テスト。
        //   ここが崩れると「同意も帯域も使ったのに保存で拒否される／書き換えられる」になり、
        //   原因がユーザーからまったく見えない。⚠ 060h review Q-1 で引用符を付けたので、
        //   **引用符付きファミリ・数字始まりのトークン（`M PLUS 1p`）・カンマ入り unicode-range・
        //   複数ブロックの `\n` 連結**という実物の形を固定しておく。
        let dir = TempDir::new();
        let conn = conn();
        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        let generated = concat!(
            "@font-face{font-family:\"M PLUS 1p\";font-weight:700;font-style:italic;",
            "unicode-range:U+3000-30FF, U+FF00-FFEF;",
            "src:url(data:font/woff2;base64,d09GMgABAAAAAA==) format(\"woff2\")}\n",
            "@font-face{font-family:\"Zen Kaku Gothic Antique\";",
            "src:url(data:application/font-woff;base64,d09GRg==) format(\"woff\")}",
        );
        if let Err(e) = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, generated) {
            panic!("生成したフォント CSS が保存できない: {e}");
        }
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(generated.to_string()),
            "⚠ 生成したフォント CSS がサニタイザに書き換えられた（1 バイトも動いてはいけない）"
        );
    }

    #[test]
    fn a_database_created_before_060h_gains_the_font_column() {
        // ⚠⚠ マイグレーション基盤が無いので冪等 ADD COLUMN で足している。
        //   **060c までに作られた既存 DB**（`font_file_name` を持たないテーブル）でも効くこと。
        let dir = TempDir::new();
        let conn = match Connection::open_in_memory() {
            Ok(c) => c,
            Err(e) => panic!("in-memory SQLite を開けない: {e}"),
        };
        // 060h 以前のスキーマを手で作る（`font_file_name` が無い）。
        if let Err(e) = conn.execute_batch(
            "CREATE TABLE overlay_themes (
                id             TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                origin         TEXT NOT NULL,
                file_name      TEXT NOT NULL,
                stripped_count INTEGER NOT NULL,
                created_at     TEXT NOT NULL,
                updated_at     TEXT NOT NULL
            );",
        ) {
            panic!("旧スキーマを作れない: {e}");
        }
        if let Err(e) = repository::init(&conn) {
            panic!("既存 DB に対する init が失敗した: {e}");
        }
        // ⚠ 2 回呼んでも壊れない（起動のたびに走るため）。
        if let Err(e) = repository::init(&conn) {
            panic!("init が冪等でない: {e}");
        }

        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("既存 DB へ取り込めない: {e}"),
        };
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(String::new()),
            "⚠ 追加カラムが NULL のときは空文字（＝フォント無し）でなければならない"
        );
        let fonts = "@font-face{font-family:\"X\";src:url(data:font/woff2;base64,AA==)}";
        if let Err(e) = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, fonts) {
            panic!("既存 DB でフォント資産を添えられない: {e}");
        }
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(fonts.to_string())
        );
    }

    #[test]
    fn an_unreadable_font_asset_degrades_to_no_font() {
        // ⚠ 「無い」と「読めない」を分けない（注入側は「空なら `<style>` を作らない」だけなので、
        //   ユーザーが取る行動が変わらない）。⚠ **配信を止めないことが要件**。
        let dir = TempDir::new();
        let conn = conn();
        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        let fonts = "@font-face{font-family:\"X\";src:url(data:font/woff2;base64,AA==)}";
        if let Err(e) = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, fonts) {
            panic!("フォント資産を添えられない: {e}");
        }

        // ファイルだけ消える（外部要因での破損・手動削除）。
        for name in dir.entries() {
            if name != format!("{}.css", imported.theme.id) {
                let _ = std::fs::remove_file(dir.path().join(&name));
            }
        }
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(String::new()),
            "⚠ 読めないフォント資産で Err を返すと、意匠まで巻き添えで出せなくなる"
        );

        // 不正な UTF-8 が入っていても同じ（自分で書いた UTF-8 なので通常は起きないが fail-safe）。
        let broken = dir.write("d0f4e6b8-8e0f-4f4a-9a3a-6a5b4c3d2e1f.css", &[0xff, 0xfe]);
        let name = broken
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if let Err(e) = repository::set_font_file_name(&conn, &imported.theme.id, &name, "now") {
            panic!("差し替えに失敗: {e}");
        }
        assert_eq!(
            read_font_css(dir.path(), &conn, &imported.theme.id).ok(),
            Some(String::new())
        );
    }

    #[test]
    fn attaching_fonts_rejects_anything_that_is_not_a_font_face() {
        // ⚠⚠ 060h review S-10。フォント資産は注入時に `rewriteSelectors` / `scopeSelectors` /
        //   `withDecorationReset` を**1 つも通らない**ので、ここへセレクタ付きの CSS が入ると
        //   「変換を通さない注入口」ができる。frontend の作法だけに任せず Rust で閉じる。
        let dir = TempDir::new();
        let conn = conn();
        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        for bad in [
            ".sd-comment{color:red}",
            "@font-face{font-family:X;src:url(data:font/woff2;base64,AA==)}\nbody{display:none}",
            "@keyframes k{from{opacity:0}}",
        ] {
            let err = match attach_theme_fonts(dir.path(), &conn, &imported.theme.id, bad) {
                Ok(()) => panic!("書体以外を含む CSS をフォント資産として保存した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::ValidationError);
        }
        // ⚠ 拒否したときは孤児ファイルを残さない（意匠 1 つだけが残る）。
        assert_eq!(dir.entries().len(), 1, "孤児ファイルが残った: {:?}", dir.entries());
        // ⚠ `@font-face` だけなら通る（生成物の実際の形＝ `\n` 連結）。
        let good = "@font-face{font-family:X;src:url(data:font/woff2;base64,AA==)}\n@font-face{font-family:Y;src:url(data:font/woff2;base64,BB==)}";
        if let Err(e) = attach_theme_fonts(dir.path(), &conn, &imported.theme.id, good) {
            panic!("`@font-face` だけの CSS を拒否した: {e}");
        }
    }

    #[test]
    fn attaching_fonts_to_a_missing_theme_writes_nothing() {
        let dir = TempDir::new();
        let conn = conn();
        let err = match attach_theme_fonts(
            dir.path(),
            &conn,
            "00000000-0000-4000-8000-000000000000",
            "@font-face{src:url(data:font/woff2;base64,AA==)}",
        ) {
            Ok(()) => panic!("存在しないテーマへフォントを添えられてしまった"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(dir.entries().is_empty(), "孤児ファイルが残った");
        // ⚠ id の形が壊れていても同じ（パスへ結合する前に落ちる）。
        assert!(attach_theme_fonts(dir.path(), &conn, "../evil", "x").is_err());
    }

    #[test]
    fn deleting_a_theme_removes_both_assets() {
        let dir = TempDir::new();
        let conn = conn();
        let imported = match import_pasted_text(dir.path(), &conn, ".sd-comment{color:red}", "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        let _ = attach_theme_fonts(
            dir.path(),
            &conn,
            &imported.theme.id,
            "@font-face{src:url(data:font/woff2;base64,AA==)}",
        );
        assert_eq!(dir.entries().len(), 2);
        if let Err(e) = delete(dir.path(), &conn, &imported.theme.id) {
            panic!("削除に失敗: {e}");
        }
        assert!(
            dir.entries().is_empty(),
            "⚠ フォント資産が消し残された（不可視の孤児が増え続ける）: {:?}",
            dir.entries()
        );
    }

    #[test]
    fn font_urls_reach_the_import_result() {
        // ⚠ 取得候補は **Rust のサニタイザだけ**が作る。ここが戻り値まで通っていないと
        // frontend は URL を得る手段が無い（＝ frontend が CSS を自前で解析する誘惑が生まれる）。
        let dir = TempDir::new();
        let conn = conn();
        let css = concat!(
            "@font-face{font-family:X;src:url(https://fonts.example/a.woff2)}",
            ".sd-comment{background-image:url(https://tracker.example/x.png)}",
        );
        let result = match import_pasted_text(dir.path(), &conn, css, "t") {
            Ok(r) => r,
            Err(e) => panic!("取り込みに失敗: {e}"),
        };
        assert_eq!(result.stripped_font_faces.len(), 1);
        assert_eq!(
            result.stripped_font_faces[0].urls,
            vec!["https://fonts.example/a.woff2".to_string()]
        );
        // ⚠ 選別に要る記述子も**同じ 1 か所**から届く（frontend が CSS を解析しないための前提）。
        assert_eq!(result.stripped_font_faces[0].family, "X");
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
        // ⚠⚠ security-review S-4。`import_overlay_theme` は ACL 対象外＝全 5 窓から任意文字列で呼べる。
        // Windows で UNC を渡されると `fs::metadata` の時点で SMB 接続が起き、既定設定では NTLM で
        // 資格情報ハッシュが飛ぶ（ユーザー操作ゼロの egress）。**拡張子より前に**弾くこと。
        for bad in [
            r"\\evil.example\share\x.css",
            r"\\evil.example\share\x.txt", // 拡張子チェックより前に落ちる
            r"\\?\UNC\evil.example\share\x.css",
            "//evil.example/share/x.css",
            // ⚠⚠ 061c security-review S-1: Windows は `/` と `\` を等価な区切りとして扱うので、
            // 混在形も UNC として解決される（`starts_with` 2 本の旧実装では素通りしていた）。
            r"\/evil.example\share\x.css",
            r"/\evil.example/share/x.css",
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

    // ⚠⚠ **065a で検証の実体を `util` へ寄せたときに、060b のユーザー向け文言が退行していないこと。**
    //   エラーコードは共有化の前後で変わらないので、**文言だけが静かに変わっても既存テストは全部緑**である
    //   （実際、共有化の初版は `read_source_css` の失敗文言を `msg_not_found` と同じものに変えてしまい、
    //    レビューで初めて気づいた）。⇒ ここで 060b が出す 9 文言をリテラルで固定する。
    //   ⚠ **この 9 本は「060b が変わっていないこと」の担保なので、util 側の都合で書き換えないこと。**
    #[test]
    fn the_shared_import_core_did_not_change_any_060b_wording() {
        assert_eq!(CSS_IMPORT_SPEC.extension, "css");
        assert_eq!(CSS_IMPORT_SPEC.max_bytes, MAX_CSS_BYTES);
        assert_eq!(CSS_IMPORT_SPEC.msg_missing, "CSS ファイルが選択されていません");
        assert_eq!(CSS_IMPORT_SPEC.msg_control, "ファイルパスに制御文字は使用できません");
        assert_eq!(
            CSS_IMPORT_SPEC.msg_network,
            "ネットワーク上のファイルは取り込めません。ローカルにコピーしてから選んでください。"
        );
        assert_eq!(CSS_IMPORT_SPEC.msg_extension, "CSS ファイル（.css）を選んでください。");
        assert_eq!(CSS_IMPORT_SPEC.msg_not_found, "指定された CSS ファイルが見つかりません。");
        // ⚠⚠ 「読む前に見つからない」と「読む段階で失敗した」は**別の文言**である（退行はここで起きた）。
        assert_eq!(CSS_IMPORT_SPEC.msg_read_failed, "CSS ファイルを読み取れませんでした。");
        assert_ne!(
            CSS_IMPORT_SPEC.msg_read_failed, CSS_IMPORT_SPEC.msg_not_found,
            "⚠ 2 つを同じ文言にすると permission denied を「見つかりません」と誤って断定する"
        );
        assert_eq!(CSS_IMPORT_SPEC.msg_not_a_file, "ファイルを選んでください。");
        assert_eq!(
            CSS_IMPORT_SPEC.msg_too_large,
            "CSS ファイルが大きすぎます。256KB 以内にしてください。"
        );
        assert_eq!(
            CSS_IMPORT_SPEC.msg_not_utf8,
            "この CSS ファイルは UTF-8 として読み取れません。テキストファイルか確認してください。"
        );
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
    /// アプリ定義コマンドは ACL 対象外＝全 5 窓から呼べるので、この歯止めは構造側で要る。
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
    fn exposes_exactly_nine_single_purpose_commands() {
        // §3: 汎用の読み書きコマンドを作らない。⚠ アプリ定義コマンドは ACL 対象外＝**全 5 窓から呼べる**。
        // ⚠ 060e で 6 本目（`import_overlay_theme_text`）、060c で 7 本目
        // （`import_overlay_theme_snapshot`）、**060h で 8・9 本目（`attach_overlay_theme_fonts` /
        // `get_overlay_theme_font_css`）**を意図的に足したので、関数名も 5 → 6 → 7 → 9 へ改名している
        // （security-review②・品質 #7。テスト名は git の追跡単位ではないので改名コストは無く、
        // **名前と assert が食い違うテスト**のほうが「どちらが正か」を毎回確かめさせる負債になる）。
        // 守っているのは数そのものではなく「**単一目的のコマンドしか無い・増やすときは必ずここが落ちる**」。
        // ⚠⚠ 060h の 2 本を足してよい根拠は `docs/security.md` §5 の 060b 例外節④が正
        // （**書ける場所も書けるファイル名の集合も 1 バイトも動いていない**）。
        let code = production_source("commands.rs");
        assert_eq!(
            code.matches(&format!("#[tauri::{}]", "command")).count(),
            9,
            "overlay_theme のコマンド数が 9 でない（増やすなら §3 の再評価と security-review が要る）"
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
        //
        // ⚠⚠ **060h での再評価の記録（ここでも数字だけ書き換えて通していない）**:
        // フォント資産（`attach_overlay_theme_fonts`）で 3 本目が増えた。`docs/security.md` §5 の
        // 060b 例外節へ「④ フォント資産の再評価」を書き足したうえで 3 へ上げている。要点は
        // - 増えない: 保存先の組み立て・`is_managed_file_name` の完全一致（フォント資産も `<uuid v4>.css`）・
        //   **サニタイズ 1 か所・書き込み 1 か所**（`write_sanitized_asset` へ委譲するだけなので、
        //   すぐ下の `exactly_one_place_sanitizes_and_exactly_one_place_writes` は**緑のまま**）。
        // - 増える: 1 テーマの管理ファイルが最大 2 つ／本文の上限が資産種別で 2 値
        //   （意匠 256KB・**据え置き** / フォント 5MiB）。
        assert_eq!(
            code.matches(&format!("{}: String", "css")).count(),
            3,
            "CSS 本文を受け取るコマンドは貼り付け・スナップショット・フォント資産の 3 本だけであること\
             （4 本目を足すなら §3 の再評価と security-review が要る）"
        );
        // ⚠ 上の「3」は**どのコマンドか**までは固定しないので、名前でも押さえる（片方を汎用名の
        // 別コマンドへ差し替える変異が数字だけでは生き残るため）。
        for expected in [
            "import_overlay_theme_text",
            "import_overlay_theme_snapshot",
            "attach_overlay_theme_fonts",
        ] {
            assert!(
                code.contains(expected),
                "commands.rs から {expected} が消えた。`css: String` を取ってよいのはこの 3 本だけである"
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
        // ⚠ 060h: 引数に `asset` が増えた（**上限だけ**が資産種別で変わる）。needle も合わせて具体化し、
        // 「資産種別を渡さずに呼ぶ＝どちらかの上限が効かない」形が入ったら落ちるようにする。
        assert_present_in(
            "service.rs",
            &format!("{}(raw_css, asset)", "validate_css_body"),
            "CSS 本文の検証（サイズ・制御文字・BOM）が外された（§8）。",
        );
        // ⚠⚠ 060h: **保存経路は 2 本になったが、検証と書き込みの実体は 1 か所のまま**であることを固定する
        // （`store_sanitized_css` と `attach_theme_fonts` がどちらもここへ委譲していること）。
        assert_eq!(
            production_source("service.rs")
                .matches(&format!("{}(dir, raw_css", "write_sanitized_asset"))
                .count(),
            2,
            "⚠ 保存経路が共通コア（write_sanitized_asset）を通らなくなった／本数が変わった"
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
