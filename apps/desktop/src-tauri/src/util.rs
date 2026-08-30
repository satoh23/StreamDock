//! 各モジュール（tools / presets / preset_items / process / app_logs）で重複していた
//! 下位イディオムを集約する薄い共通ヘルパ。
//!
//! 012 Rust Common Helper Refactor で新設。挙動・検証ルール・メッセージ文言は一切変えず、
//! 「定義が1箇所にない」状態のみを解消する純リファクタ。過剰な抽象化（trait 化・ジェネリクス
//! 多用）はせず、返り値・エラー型は既存 `AppError` / `AppResult` をそのまま使う。

use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// 現在時刻を RFC3339 文字列で返す（`chrono::Utc::now().to_rfc3339()` の単一定義）。
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 任意フィールド（`Option<String>`）を trim 正規化する。`None` は空文字列にする。
pub fn normalize_optional(value: &Option<String>) -> String {
    value.as_deref().unwrap_or("").trim().to_string()
}

/// trim 後に空なら Validation エラーを返す（必須・空チェック）。
pub fn require_non_empty(value: &str, message: impl Into<String>) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::validation(message));
    }
    Ok(())
}

/// 制御文字（改行・NUL 等）を含むなら Validation エラーを返す。
pub fn reject_control_chars(value: &str, message: impl Into<String>) -> AppResult<()> {
    if value.chars().any(char::is_control) {
        return Err(AppError::validation(message));
    }
    Ok(())
}

/// 063h: RFC3339 としてパースできなければ Validation エラーを返す（**値は捨てて真偽だけを見る**）。
///
/// ⚠⚠ **frontend が作った時刻文字列を受けるときに使う**（docs/security.md §8＝生値を信用しない）。
/// `gacha_draws.drawn_at` が唯一の消費者で、**抽選した瞬間の時刻**を frontend が作る理由は
/// §9 追補（063h）が正（Rust の保存時刻で代用すると、セッション未確定でバッファに貯まった抽選が
/// 「流した時刻」で記録され、配信サマリーの並びが実際の抽選順と食い違う）。
///
/// ⚠ **正規化して返さない**（`String` ではなく `()` を返す）——呼び出し側が受け取った文字列を
/// そのまま保存することで、「保存された値」と「検証した値」が食い違う余地を作らない。
/// ⚠⚠ **`published_at`（`record_comment`）をこれに通さないこと**——あちらは配信サービスが作った値で、
/// **形式が provider ごとに揺れる**（`Z` とオフセットが混ざる）。既存は `require_non_empty` だけで
/// 通しており、ここで締めると**既存のコメント記録が落ちる**。
pub fn require_rfc3339(value: &str, message: impl Into<String>) -> AppResult<()> {
    if chrono::DateTime::parse_from_rfc3339(value).is_err() {
        return Err(AppError::validation(message));
    }
    Ok(())
}

/// 023: URL を http/https スキーム限定で検証し、trim 済みの安全な URL 文字列を返す。
///
/// 保存時（`tools::service`）と起動時（`process::service::open_url`）の両方で使う多層防御。
/// frontend の生値を信用せず Rust 側で必ず検証する（docs/security.md §4/§8）。`javascript:` /
/// `file:` / `data:` / 独自スキーム等は `http://` / `https://` プレフィックスに一致しないため拒否される。
pub fn validate_http_url(raw: &str) -> AppResult<String> {
    let url = raw.trim();
    require_non_empty(url, "URL が未設定です")?;
    reject_control_chars(url, "URL に制御文字は使用できません")?;
    // スキームは大文字小文字を無視して比較する（ホスト・パスの大小は保持したいので元文字列を返す）。
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::validation(
            "URL は http:// または https:// で始まる必要があります",
        ));
    }
    Ok(url.to_string())
}

/// UNC / ネットワークパス（`\\server\share` / `//server/share`）か。
///
/// ⚠⚠ **`fs::metadata` を叩く「前」に通すこと。** Windows で UNC を触ると、その時点で
/// OS が相手ホストへ SMB 接続し、既定設定では NTLM でユーザー/マシンの資格情報ハッシュが飛ぶ
/// ——ユーザー操作ゼロ・ダイアログ非経由で、docs/security.md §1 の趣旨に直接反する。
/// 取り込み系コマンドはアプリ定義コマンド＝**ACL 対象外で全 5 窓から呼べる**ので、
/// 引数が dialog 由来である保証は Rust 側には無い。
///
/// ⚠⚠ **先頭 2 文字を `\` へ正規化してから見る。** Windows は `/` と `\` を**等価な区切り**として
/// 扱うため、`\\` `//` だけを見ると `\/server\share` / `/\server/share` という混在形が素通りする
/// （061c security-review S-1。それ以前は両方の呼び出し側が `starts_with` 2 本で判定していた）。
///
/// ⚠ macOS の `/Volumes/...`（マウント済み共有）は対象外——ユーザーが既にマウントした先だけが
/// 見えるので、**新しい宛先を作らない**。POSIX の `//foo` と Windows の `\\?\C:\`（ローカルの
/// 拡張長パス）も巻き添えで落ちるが、ファイル選択ダイアログはどちらの形も返さない。
pub fn is_network_path(value: &str) -> bool {
    let mut head = value
        .trim()
        .chars()
        .take(2)
        .map(|c| if c == '/' { '\\' } else { c });
    head.next() == Some('\\') && head.next() == Some('\\')
}

/// 065a: **取り込み元ファイルの受け入れ規則**（拡張子・バイト上限・エラー文言）。
///
/// ⚠⚠ **文言はすべて `&'static str`＝コンパイル時定数**である。ユーザー入力を 1 バイトも
/// 補間できない形にしてあるのは §9（エラーにパス・第三者データを載せない）のため。
/// パスの手掛かりを出したいときは呼び出し側ではなく [`validate_import_path`] が
/// [`with_filename_detail`] で**ファイル名だけ**を付ける。
pub struct ImportFileSpec {
    /// 受け入れる拡張子（ドットを含めない・ASCII 大小無視で比較する）。
    pub extension: &'static str,
    /// バイト上限。**読む前（metadata）と読んだ後（実バイト長）の両方**で使う。
    pub max_bytes: u64,
    /// パスが空 / 空白のみ。
    pub msg_missing: &'static str,
    /// パスに制御文字が含まれる。
    pub msg_control: &'static str,
    /// UNC / ネットワークパス。
    pub msg_network: &'static str,
    /// 拡張子が違う。
    pub msg_extension: &'static str,
    /// ファイルが見つからない（`metadata` に失敗した＝**読む前**）。
    pub msg_not_found: &'static str,
    /// ⚠ **読む段階**で失敗した（`metadata` は通ったのに `read` が失敗＝権限変更・削除・レース）。
    ///
    /// ⚠⚠ **[`msg_not_found`](Self::msg_not_found) と分けてあるのは 060b の文言を 1 バイトも変えないため。**
    /// 共有化の初版はこの 2 つを 1 つにまとめており、060b の `read_source_css` の文言が
    /// 「CSS ファイルを読み取れませんでした。」→「指定された CSS ファイルが見つかりません。」へ
    /// **静かに変わっていた**（エラーコードは同じなのでテストは緑のまま＝レビューでしか捕まらない）。
    /// ⚠ 経路を足すときも「読む前」と「読む段階」で別の文言を持たせること
    /// ——「見つかりません」は permission denied のときに原因を誤って断定する。
    pub msg_read_failed: &'static str,
    /// ディレクトリ等（通常ファイルではない）。
    pub msg_not_a_file: &'static str,
    /// 上限超過。
    pub msg_too_large: &'static str,
    /// UTF-8 として読めない。
    pub msg_not_utf8: &'static str,
}

/// 065a: dialog 由来の生パスを検証する（§5 / §7 / §8）。**検証の順序を持つ唯一の場所**。
///
/// ⚠⚠ **順序そのものが要件である**——①UNC 拒否 → ②拡張子 → ③`is_file` → ④サイズ上限（読む前）。
/// とくに **①が②より前**は 060b security-review S-4 の要件で、入れ替えても**コンパイルもテストも
/// 通ってしまう**（＝レビューでしか捕まらない）。だからこの 1 か所に閉じ込めてある。
/// 取り込み経路ごとに書き写すと、片方だけ順序が崩れても誰も気づかない
/// （[`is_network_path`] を共有ヘルパへ出した 061c security-review S-1 と同じ判断）。
///
/// ⚠⚠ **なぜ UNC を「触る前に」弾くのか**: 取り込みコマンドはアプリ定義コマンド＝**ACL 対象外で
/// 全窓から任意文字列で呼べる**ので、`path` が dialog 由来である保証は Rust 側に無い。Windows で
/// `\\evil.example\share\x.csv` を渡されると、下の `fs::metadata` の時点で **OS が攻撃者ホストへ
/// SMB 接続し、既定設定では NTLM でユーザー/マシンの資格情報ハッシュが飛ぶ**——ユーザー操作ゼロ・
/// ダイアログ非経由の egress で、docs/security.md §1 の趣旨に直接反する。
/// ⚠ **拡張子より前**でなければ意味が無い（`.csv` 以外を渡されても接続は起きてしまうため）。
///
/// ⚠ `canonicalize` もシンボリックリンク拒否も**意図的に行わない**。canonicalize に意味があるのは
/// 「元パスが保存先の組み立てに影響するとき」だが、本ヘルパを使う経路はどちらも**元パスを保存先に
/// 一切使わない**。リンク越しに読めるのはユーザーが元々読めるファイルだけ＝**特権境界を跨がない**ので、
/// 拒否しても防げるものが無く、正当な構成（Dropbox / iCloud のリンク）を壊すだけになる。
///
/// ⚠ trim するのは `tools::service` の `executable_path` に揃えるため。帰結として**前後に空白を含む
/// ファイル名は取り込めない**（macOS では正当な名前）が、既存のパス検証と挙動を分けるほうの害が大きい。
pub fn validate_import_path(raw: &str, spec: &ImportFileSpec) -> AppResult<std::path::PathBuf> {
    let trimmed = raw.trim();
    require_non_empty(trimmed, spec.msg_missing)?;
    reject_control_chars(trimmed, spec.msg_control)?;

    // ① ⚠⚠ ディスクにもネットワークにも触る前に落とす（上の doc が理由）。
    if is_network_path(trimmed) {
        return Err(AppError::validation(spec.msg_network));
    }

    // ② 拡張子（ASCII 大小無視）。
    let path = std::path::PathBuf::from(trimmed);
    let matches_extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(spec.extension));
    if !matches_extension {
        return Err(with_filename_detail(
            AppError::unsupported_file_type(spec.msg_extension),
            &path,
        ));
    }

    // ③ 実体があり、通常ファイルであること。
    let metadata = std::fs::metadata(&path).map_err(|_| {
        with_filename_detail(AppError::path_not_found(spec.msg_not_found), &path)
    })?;
    if !metadata.is_file() {
        return Err(with_filename_detail(
            AppError::validation(spec.msg_not_a_file),
            &path,
        ));
    }

    // ④ **読む前に**上限で落とす（巨大ファイルをメモリへ載せない）。
    if metadata.len() > spec.max_bytes {
        return Err(with_filename_detail(
            AppError::validation(spec.msg_too_large),
            &path,
        ));
    }
    Ok(path)
}

/// 065a: [`validate_import_path`] を通したパスから UTF-8 テキストを読む。
///
/// ⚠ **TOCTOU**: `metadata` を見てから read するまでにファイルは伸びうるので、**実バイト長で取り直す**。
/// ⚠ **BOM は剥がさない**（呼び出し側の責務）。CSS は本文検証で、CSV はパーサの手前で扱う——
/// ここで剥がすと 060b の既存挙動（`validate_css_body` が剥がす）を静かに変えてしまう。
/// ⚠ 読み取り失敗は [`ImportFileSpec::msg_read_failed`]（**`msg_not_found` ではない**。同定数の doc が理由）。
pub fn read_import_text(path: &std::path::Path, spec: &ImportFileSpec) -> AppResult<String> {
    let bytes = std::fs::read(path)
        .map_err(|_| with_filename_detail(AppError::path_not_found(spec.msg_read_failed), path))?;
    if bytes.len() as u64 > spec.max_bytes {
        return Err(with_filename_detail(
            AppError::validation(spec.msg_too_large),
            path,
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| with_filename_detail(AppError::unsupported_file_type(spec.msg_not_utf8), path))
}

/// `AppError` に「ファイル名のみ」の `details` を付与する（フルパスは frontend / log に露出しない）。
///
/// `path_not_found` / `duplicate_path` で共通していた「`file_name` を取り出して
/// `ファイル名: {name}` を `with_details` する」定型を集約する。付与元の `AppError`（＝どの
/// エラーコード・message か）は呼び出し側がそのまま渡すため、各サイト固有の安全文言は維持される。
pub fn with_filename_detail(err: AppError, path: &Path) -> AppError {
    match path.file_name().and_then(|n| n.to_str()) {
        Some(name) if !name.is_empty() => err.with_details(format!("ファイル名: {name}")),
        _ => err,
    }
}

/// テーブルに指定カラムが無ければ `ALTER TABLE ... ADD COLUMN` で追加する冪等マイグレーション。
///
/// マイグレーション基盤が無い（各 repository の `init()` が冪等 DDL）ため、既存 DB へ後付けカラムを
/// 安全に足すための最小ヘルパ。`pragma_table_info` で現在のカラムを確認し、未存在時のみ追加する。
/// 018 で新設し、以降のスキーマ追加（019 等）でも共用する。
///
/// 注意: SQLite は識別子（テーブル名・カラム名）をプレースホルダにバインドできないため ADD COLUMN の
/// SQL は `format!` で組み立てる。`table` / `column` / `decl` は**呼び出し側のコンパイル時定数のみ**を
/// 渡すこと（ユーザー入力を渡さない）。存在確認の `table` は table-valued function にバインドする。
pub fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> rusqlite::Result<()> {
    let exists = {
        let mut stmt = conn.prepare("SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2")?;
        stmt.exists(rusqlite::params![table, column])?
    };
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {decl};"
        ))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 063h: `drawn_at` の検証（frontend の生値を信用しない＝§8）。
    ///
    /// ⚠ **`toISOString()` が出す `…Z` が通ること**を必ず含める（frontend の唯一の生成手段）。
    #[test]
    fn rfc3339_accepts_the_shapes_the_frontend_actually_produces() {
        for ok in [
            "2026-08-30T12:34:56.789Z", // ⚠ JS の `new Date().toISOString()` の実出力
            "2026-08-30T12:34:56Z",
            "2026-08-30T21:34:56+09:00",
            "2026-08-30T12:34:56.789012+00:00",
        ] {
            assert!(
                require_rfc3339(ok, "不正").is_ok(),
                "正当な RFC3339 を弾いた: {ok:?}"
            );
        }
    }

    #[test]
    fn rfc3339_rejects_values_that_are_not_timestamps() {
        // ⚠ 空・和暦風・タイムゾーンなし・SQL 断片（§8 の意図）はすべて落ちること。
        for bad in [
            "",
            "2026-08-30",
            "2026-08-30 12:34:56", // ⚠ タイムゾーンも `T` も無い（SQLite の DATETIME 形式）
            "2026/08/30 12:34:56",
            "'); DROP TABLE gacha_draws; --",
            "not-a-date",
        ] {
            assert_eq!(
                require_rfc3339(bad, "不正").unwrap_err().code,
                crate::error::ErrorCode::ValidationError,
                "不正な時刻を通した: {bad:?}"
            );
        }
    }

    #[test]
    fn network_paths_are_detected_including_mixed_separators() {
        // ⚠⚠ 061c security-review S-1。Windows は `/` と `\` を等価な区切りとして扱うので、
        // `\\` / `//` だけを見ると混在形（`\/` / `/\`）が素通りする。
        for bad in [
            r"\\evil.example\share",
            "//evil.example/share",
            r"\/evil.example\share",
            r"/\evil.example/share",
            r"\\?\UNC\evil.example\share",
            r"  \\evil.example\share", // 呼び出し側が trim する前でも落ちること
        ] {
            assert!(is_network_path(bad), "ネットワークパスを見逃した: {bad:?}");
        }
        // ⚠ 過剰に弾かないこと（ローカルの絶対パス・相対パス・`/Volumes` のマウント済み共有）。
        for ok in [
            "/Users/me/templates",
            "/Volumes/share/templates",
            r"C:\Users\me\templates",
            "templates",
            "/",
            "",
        ] {
            assert!(!is_network_path(ok), "ローカルパスを弾いた: {ok:?}");
        }
    }

    // ---- 065a: 取り込み元ファイルの共有検証（060b の `.css` と 065a の `.csv` が通る唯一の実装）----

    use crate::error::ErrorCode;
    use std::path::PathBuf;

    /// テスト専用の一時ディレクトリ（`Drop` で片付ける）。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join("stream-dock-util-import-test")
                .join(uuid::Uuid::new_v4().to_string());
            if let Err(e) = std::fs::create_dir_all(&path) {
                panic!("一時ディレクトリを作れない: {e}");
            }
            TempDir(path)
        }
        fn write(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            if let Err(e) = std::fs::write(&path, contents) {
                panic!("テスト用ファイルを書けない: {e}");
            }
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 文言はすべてコンパイル時定数（ユーザー入力を 1 バイトも補間しない・§9）。
    const TEST_SPEC: ImportFileSpec = ImportFileSpec {
        extension: "csv",
        max_bytes: 32,
        msg_missing: "ファイルが選択されていません",
        msg_control: "ファイルパスに制御文字は使用できません",
        msg_network: "ネットワーク上のファイルは取り込めません。",
        msg_extension: "CSV ファイル（.csv）を選んでください。",
        msg_not_found: "ファイルが見つかりません。",
        msg_read_failed: "ファイルを読み取れませんでした。",
        msg_not_a_file: "ファイルを選んでください。",
        msg_too_large: "ファイルが大きすぎます。",
        msg_not_utf8: "UTF-8 として読み取れません。",
    };

    // ⚠⚠ **UNC / ネットワークパスは拡張子チェックより前に落ちる**（060b security-review S-4）。
    //   `\\evil.example\share\x.txt`（拡張子が違う）でも **UNC として** 落ちることが、順序の実証になる
    //   ——拡張子が先だと `.txt` で弾かれ、UNC 判定が後ろにあっても同じ結果に見えてしまう。
    //   ⚠ この順序は入れ替えても**コンパイルもテストも通ってしまう**種類の要件なので、
    //     ここと `overlay_theme::service` の 060b 側の 2 か所から同じ関数を直接叩いて固定する。
    #[test]
    fn network_paths_are_refused_before_the_extension_is_even_checked() {
        for bad in [
            r"\\evil.example\share\x.csv",
            r"\\evil.example\share\x.txt", // ⚠ 拡張子が違っても「UNC で」落ちること
            r"\\evil.example\share\noextension",
            r"\\?\UNC\evil.example\share\x.csv",
            "//evil.example/share/x.csv",
            // 061c security-review S-1: Windows は `/` と `\` を等価な区切りとして扱う。
            r"\/evil.example\share\x.csv",
            r"/\evil.example/share/x.csv",
        ] {
            let err = match validate_import_path(bad, &TEST_SPEC) {
                Ok(_) => panic!("ネットワークパスを通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(
                err.code,
                ErrorCode::ValidationError,
                "⚠ UNC は ValidationError で落ちるはず（UnsupportedFileType なら拡張子判定が先に来ている）: {bad:?}"
            );
            // ⚠ ディスクにもネットワークにも触っていないので、details にファイル名すら出ない。
            let json = serde_json::to_string(&err).unwrap_or_default();
            assert!(!json.contains("evil.example"), "入力を持ち帰っている: {json}");
        }
    }

    #[test]
    fn the_extension_size_and_file_kind_are_enforced() {
        let dir = TempDir::new();
        let ok = dir.write("list.csv", b"id\n");
        assert!(validate_import_path(&ok.to_string_lossy(), &TEST_SPEC).is_ok());
        // 拡張子は ASCII 大小無視。
        let upper = dir.write("LIST.CSV", b"id\n");
        assert!(validate_import_path(&upper.to_string_lossy(), &TEST_SPEC).is_ok());

        // 拡張子違い・拡張子なし。
        let txt = dir.write("list.txt", b"id\n");
        let err = match validate_import_path(&txt.to_string_lossy(), &TEST_SPEC) {
            Ok(_) => panic!(".txt を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::UnsupportedFileType);
        assert!(validate_import_path(&dir.write("noext", b"x").to_string_lossy(), &TEST_SPEC).is_err());

        // 空・不在・ディレクトリ。
        assert!(validate_import_path("   ", &TEST_SPEC).is_err());
        assert!(validate_import_path(&dir.0.join("missing.csv").to_string_lossy(), &TEST_SPEC).is_err());
        let sub = dir.0.join("dir.csv");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(validate_import_path(&sub.to_string_lossy(), &TEST_SPEC).is_err());

        // ⚠ 読む前に上限で落とす（境界も見る）。
        let at_limit = dir.write("fit.csv", &vec![b'a'; TEST_SPEC.max_bytes as usize]);
        assert!(validate_import_path(&at_limit.to_string_lossy(), &TEST_SPEC).is_ok());
        let over = dir.write("big.csv", &vec![b'a'; TEST_SPEC.max_bytes as usize + 1]);
        let err = match validate_import_path(&over.to_string_lossy(), &TEST_SPEC) {
            Ok(_) => panic!("上限超えを通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    // ⚠ **TOCTOU**: `metadata` を見た後にファイルが伸びうるので、読んだ実バイト長でも上限を見る。
    //   ここでは検証を通ったパスを直接読ませて、読み取り側にも上限があることを固定する。
    #[test]
    fn the_size_limit_is_re_checked_on_the_bytes_actually_read() {
        let dir = TempDir::new();
        let path = dir.write("grown.csv", &vec![b'a'; TEST_SPEC.max_bytes as usize + 1]);
        let err = match read_import_text(&path, &TEST_SPEC) {
            Ok(_) => panic!("読み取り側の上限が効いていない（TOCTOU で素通り）"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    #[test]
    fn non_utf8_files_are_refused_and_errors_expose_only_the_file_name() {
        let dir = TempDir::new();
        // PNG のシグネチャ（`.csv` にリネームしたバイナリ）。
        let png = dir.write("secret-folder-name.csv", &[0x89, b'P', b'N', b'G', 0xFF, 0xFE]);
        let err = match read_import_text(&png, &TEST_SPEC) {
            Ok(_) => panic!("非 UTF-8 を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::UnsupportedFileType);
        // ⚠ §9: ファイル名は details に出すが、フルパス（＝フォルダ構成）は出さない。
        let json = serde_json::to_string(&err).unwrap_or_default();
        assert!(json.contains("secret-folder-name.csv"), "ファイル名は出す想定: {json}");
        assert!(
            !json.contains(&dir.0.to_string_lossy().to_string()),
            "フルパスが露出している: {json}"
        );
    }
}
