//! 065a: 取り込み元コメントビューアーの公式 CSV エクスポートのパースと 1 行ごとの検証。
//!
//! ## 立ち位置
//!
//! ここは **`viewers` に書ける形へ変換するところまで**で、DB には一切触らない（純関数）。
//! 書き込みは [`super::repository::upsert_imported_viewer`]、経路の組み立ては [`super::service`]。
//!
//! ## ⚠⚠ CSV は信頼できない入力である（docs/security.md §8）
//!
//! ユーザーが選ぶファイルであって、取り込み元が書き出したファイルである保証は無い（アプリ定義コマンドは
//! ACL 対象外＝全窓から任意パスで呼べる）。したがって:
//!
//! - 全文字列列を trim ＋ `reject_control_chars` に通す。
//! - **数値のパース失敗を 0 で代替しない**——その行ごとスキップして件数に数える。0 を入れると
//!   「引き継いだのに 0 だった」と「引き継げなかった」が区別できなくなる。
//! - **必須列が欠けていたら 1 行も取り込まない**（fail-closed）。
//! - **サイズと行数の両方に上限**を課す（片方だけでは足りない。理由は各定数の doc）。
//!
//! ## ⚠⚠ 列位置で読まないこと
//!
//! 実測（2026-08-16・同一環境で 2 回エクスポート）で、**列名も列数〔22〕も同じまま順序だけが変わった**
//! （`screenName` が 6 列目 → 19 列目へ移動し、間の 13 列がすべて 1 つずつズレた）。
//! ⇒ **必ずヘッダ名で引く**。`the_column_order_does_not_change_the_result` がこれを固定している。
//!
//! ## ⚠ 未知の列は無視し、必須列の欠落は拒否する（非対称なのは意図）
//!
//! §8 の 061c 節は `deny_unknown_fields` で未知フィールドを**拒否**せよと書いているが、向きが逆である。
//! あちらは「第三者が書いた manifest の書き間違いを黙殺しない」ため。こちらは
//! **同じ製品が版ごとに列を増減させ、順序すら動く**ことが実測で分かっているためで、未知列を拒否すると
//! 取り込み元が 1 列足しただけで取り込めなくなる。**守るべきは「必要なものが在ること」**であって
//! 「余計なものが無いこと」ではない。

use chrono::{DateTime, Duration, SecondsFormat};

use crate::error::{AppError, AppResult};
use crate::util::reject_control_chars;

/// 取り込める CSV のバイト上限（8MiB）。
///
/// 根拠: 実測は **61 行 / 14.6KB ＝ 約 245 バイト/行**。[`MAX_CSV_ROWS`]（20,000 行）に
/// 1 行 400 バイト（`memo` / `nameHistory` が伸びた場合の余裕）を掛けて約 8MB。
/// ⚠ **読む前に `metadata` で落とす**ので、上限超えのファイルはメモリに載らない
/// （`util::validate_import_path` の④）。読んだ後にも実バイト長で取り直す（TOCTOU）。
///
/// ⚠⚠ **行数上限と両方が要る。** サイズだけだと 1 行が短い CSV で行数が青天井になり（`viewers` の
/// 行数＝一覧の描画コスト）、行数だけだと 1 行が巨大な CSV でメモリが伸びる。
pub const MAX_CSV_BYTES: u64 = 8 * 1024 * 1024;

/// 取り込める行数の上限（20,000 行）。実測 61 行の **328 倍**。
///
/// 根拠: 毎日 10 人の新規リスナーが 5 年続いても 18,250 人で収まる。
/// ⚠ **超えたら切り詰めずにファイルごと拒否する**（黙って上位 N 件だけ入れると、ユーザーには
/// 「全部取り込めた」ようにしか見えない）。
pub const MAX_CSV_ROWS: usize = 20_000;

/// `nameHistory`（生 JSON 文字列）の保管上限。
///
/// ⚠ 表示しない列なので、超過は**行のスキップではなく空文字**に倒す（1 行が肥大化して DB を
/// 膨らませるのは防ぎたいが、そのために引き継ぎ自体を落とすのは割に合わない）。
const MAX_NAME_HISTORY_BYTES: usize = 4 * 1024;

/// ⚠⚠ **引き継ぐ回数系の上限（1 億）。security-review で見つけた欠陥への対処。**
///
/// `ViewerRecord` は `total_comments` / `gift_count` / `stream_count` / `active_days` を **`u32`** で
/// 読む。上限が無いと `tc = 4294967296`（`u32::MAX` 超え）の 1 行で列に入ってしまい、以後
/// **`list_viewers` と `get_viewer` が両方とも `StorageFailed` で落ちる**——つまり
/// **視聴者一覧が丸ごと開けなくなり、UI からその行を消すこともできない**（実測で再現済み）。
/// 取り込み自体は成功扱いで返るので、ユーザーには原因がまったく見えない。
///
/// 1 億にした根拠: 毎秒 1 コメントを 3 年続けても約 9,500 万で収まる＝実データが到達しない値でありながら、
/// `u32::MAX`（約 42.9 億）の 1/42 なので**実測分を足しても溢れない**
/// （集計は `COUNT(*) + imported_*` なので、上限を `u32::MAX` ぎりぎりに置くと加算で溢れる）。
/// ⚠ 超過は切り詰めずに **`skipped_invalid`**（数値を勝手に丸めない＝「0 で代替しない」と同じ規律）。
const MAX_IMPORTED_COUNT: i64 = 100_000_000;

/// ⚠⚠ **自由入力列の文字数上限（security-review で見つけた欠陥への対処）。**
///
/// ファイルサイズ上限（8MiB）しか無いと、**1 行の `memo` に数 MB** を入れた CSV が作れる。
/// それは `viewers.note` にそのまま入り、065b の一覧が 1 行を描くたびに数 MB の文字列を扱うことになる
/// （060b が `MAX_CSS_BYTES` を置いた理由「上限が無いと巨大ファイルで webview が固まる」と同じ形）。
/// ⚠ **切り詰めない**——ユーザーのメモを黙って削るくらいなら、その行を `skipped_invalid` にして
/// 「取り込めなかった」と伝えるほうが正しい（`nameHistory` だけは表示しない保管列なので例外）。
/// 値の根拠: `note` は文章になりうるので 1,000 文字、`name` / `nickname` / `label` / ID は
/// 一覧の 1 セルに収まる長さで 200 文字（060b のテーマ名 80 文字・062b の配信タイトル 100 文字と同系列）。
/// ⚠ **文字数（`chars().count()`）で数える。バイト数ではない**（062b の `title` と同じ）。
const MAX_NOTE_CHARS: usize = 1_000;
const MAX_SHORT_TEXT_CHARS: usize = 200;

/// ヘッダに必ず存在しなければならない列。**1 つでも欠けたら 1 行も取り込まない**（fail-closed）。
///
/// ⚠ 親 065 / 065a が挙げていたのは `id` / `service` / `lcts` の 3 つだが、**9 つに広げてある**。
/// 理由: 数値 5 列と `interval` がヘッダごと無いと、全行が「値が空欄」として `skipped_invalid` に
/// 落ち、ユーザーには `{0, 0, 0, 61}` としか伝わらない（**原因が分からない**）。
/// ヘッダで落とせば「取り込み元の版が違う」と言える。⚠ **厳しくする方向**なので線引きは変えていない。
/// ⚠ ここに列を足すときは「その列が無いと機能が成立しないか」で判断すること
/// （例: `memo` / `nickname` / `label` は無くても引き継ぎは成立するので**入れない**）。
const REQUIRED_COLUMNS: [&str; 9] = [
    "id", "service", "lcts", "tc", "tgc", "amount", "atdDays", "atdLives", "interval",
];

/// 取り込み元 CSV の `id` プレフィックスと StreamDock の provider の対応。
///
/// ⚠⚠ **`tw-` は未検証の推定**（親 065。実データで確認できたのは `yt-` だけ）。だからこそ
/// **プレフィックスと `service` 列の両方が一致すること**を要求し、片方でも合わなければ取り込まない。
/// ⚠ 未対応サービス（ニコ生・ツイキャス等）もここに無いので自動的にスキップされる。
const PROVIDER_PREFIXES: [(&str, &str); 2] = [("yt-", "youtube"), ("tw-", "twitch")];

/// CSV の 1 行を `viewers` へ書ける形にしたもの（DB には触らない）。
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedViewer {
    /// `viewers.id`（`provider:providerUserId`）。
    pub id: String,
    pub provider: String,
    pub provider_user_id: String,
    /// CSV の `username` 列。⚠ **`@handle` であって表示名ではない**ので、既存の `name` が
    /// 非空なら上書きしない（非破壊マージ）。判断は repository 側。
    pub name: String,
    pub nickname: String,
    /// CSV の `memo` 列 → `viewers.note`。
    pub note: String,
    pub label: String,
    /// CSV の `lcts` 列（ISO8601・そのまま使う）。
    pub last_comment_at: String,
    /// `lcts − interval`（ミリ秒）。⚠ **仮説を含む値**（親 065・(3)）。
    pub imported_first_seen_at: String,
    /// CSV の `nameHistory` 列の生 JSON 文字列（**パースしない**）。
    pub imported_name_history: String,
    pub imported_comments: i64,
    pub imported_gifts: i64,
    pub imported_gift_amount: f64,
    pub imported_active_days: i64,
    pub imported_stream_count: i64,
}

/// パース結果（取り込める行と、落とした行の件数）。
///
/// ⚠ **視聴者名・メモ・ID を件数側に持たない**（§9。戻り値は最終的に件数だけになる）。
#[derive(Debug, Default)]
pub struct ParsedCsv {
    pub viewers: Vec<ImportedViewer>,
    /// 未対応サービス／未知プレフィックス／`service` とプレフィックスの不一致。
    pub skipped_unsupported: u32,
    /// 必須値の欠落・検証失敗・数値のパース失敗・行の形が壊れている。
    pub skipped_invalid: u32,
}

/// 1 行の判定結果（`skipped_*` のどちらに数えるかを型で分ける）。
enum RowOutcome {
    Take(Box<ImportedViewer>),
    Unsupported,
    Invalid,
}

/// ヘッダ名 → 列位置。⚠ **同名の列が 2 つあるときは最初のものを採る**
/// （取り込み元が同名列を出すことは実測では無いが、決めておかないと挙動が不定になる）。
///
/// 【意図・レビュー指摘 Q-6・修正不要】名前は `Index` だが**索引（`HashMap`）は作っておらず**、
/// [`Self::position`] は呼ばれるたびにヘッダを線形走査する。**それで足りるから**である——
/// 1 行あたり約 12 回 × 22 列 ＝ 上限 20,000 行でも数百万回の `&str` 比較で、実測 61 行では
/// 計測できない差にしかならない。`HashMap` を作ると**借用の寿命が 1 本増える**（`&'h StringRecord` の
/// 中身を指すキーを持つことになる）ぶん、読む側のコストのほうが高い。
/// 【再修正トリガ】`MAX_CSV_ROWS` を桁で増やす／列数が桁で増える／取り込みが体感で遅いと言われたら、
/// ここで 1 回だけ `HashMap<&str, usize>` を組む（呼び出し側の形は変えずに済む）。
struct ColumnIndex<'h> {
    headers: &'h csv::StringRecord,
}

impl<'h> ColumnIndex<'h> {
    fn new(headers: &'h csv::StringRecord) -> Self {
        Self { headers }
    }

    /// ⚠ ヘッダ名は **trim してから**突き合わせる（`"id, username, ..."` のように区切りの後ろへ
    /// 空白が入った CSV でも列を引けるように）。`the_header_names_are_matched_after_trimming` が固定する。
    fn position(&self, name: &str) -> Option<usize> {
        self.headers.iter().position(|h| h.trim() == name)
    }

    /// 列の生値（列が無い／その行に値が無いときは空文字）。
    fn raw<'r>(&self, record: &'r csv::StringRecord, name: &str) -> &'r str {
        self.position(name)
            .and_then(|i| record.get(i))
            .unwrap_or("")
    }
}

/// 取り込み元 CSV の全文をパースする。
///
/// ⚠ **`raw` の BOM はここで剥がす**（Excel を経由すると付く経路がある。実測ファイルには無い）。
/// 共有の [`crate::util::read_import_text`] で剥がしていないのは、060b の CSS 経路の既存挙動
/// （本文検証側で剥がす）を静かに変えないため。
pub fn parse(raw: &str) -> AppResult<ParsedCsv> {
    let text = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(text.as_bytes());

    // ヘッダを読めない＝そもそも CSV ではない（空ファイルを含む）。
    let headers = reader
        .headers()
        .map_err(|_| AppError::unsupported_file_type(
            "この CSV のヘッダを読み取れませんでした。コメントビューアーが書き出した視聴者データか確認してください。",
        ))?
        .clone();
    let index = ColumnIndex::new(&headers);

    // ⚠⚠ fail-closed。必須列が 1 つでも欠けていたら**1 行も取り込まない**。
    //   取り込み元の版の差で列が消えたときに、黙って壊れたデータを入れないため。
    //   ⚠ 欠けた列名はエラーに載せない（第三者データではないが、ここだけ具体的にしても
    //     ユーザーの取れる行動〔取り込み元を更新する / 出力し直す〕は変わらない・§9 の構えを崩さない）。
    if REQUIRED_COLUMNS.iter().any(|c| index.position(c).is_none()) {
        return Err(AppError::unsupported_file_type(
            "この CSV には必要な列がありません。コメントビューアーが書き出した視聴者データのファイルを選んでください。",
        ));
    }

    let mut parsed = ParsedCsv::default();
    let mut rows = 0usize;
    for record in reader.records() {
        rows += 1;
        // ⚠ 上限を超えたら切り詰めずに拒否する（黙って上位 N 件だけ入れない）。
        if rows > MAX_CSV_ROWS {
            return Err(AppError::validation(
                "この CSV は行数が多すぎます。20,000 行以内にしてください。",
            ));
        }
        // 行の形が壊れている（列数不一致・引用の閉じ忘れ等）は 1 行ぶんの失敗として数える。
        let Ok(record) = record else {
            parsed.skipped_invalid += 1;
            continue;
        };
        match convert_row(&index, &record) {
            RowOutcome::Take(viewer) => parsed.viewers.push(*viewer),
            RowOutcome::Unsupported => parsed.skipped_unsupported += 1,
            RowOutcome::Invalid => parsed.skipped_invalid += 1,
        }
    }
    Ok(parsed)
}

/// CSV 1 行を [`ImportedViewer`] へ変換する（すべての検証はここを通る）。
fn convert_row(index: &ColumnIndex<'_>, record: &csv::StringRecord) -> RowOutcome {
    // --- サービスと ID（突合キー）---------------------------------------------------------------
    let Some(raw_id) = clean_text(index.raw(record, "id"), MAX_SHORT_TEXT_CHARS) else {
        return RowOutcome::Invalid;
    };
    let Some(service) = clean_text(index.raw(record, "service"), MAX_SHORT_TEXT_CHARS) else {
        return RowOutcome::Invalid;
    };
    if raw_id.is_empty() || service.is_empty() {
        return RowOutcome::Invalid;
    }
    // ⚠⚠ プレフィックスと `service` 列の**両方**が一致することを要求する（`tw-` は未検証の推定なので、
    //   片方だけで信じない）。未知プレフィックス・未対応サービスはここで `Unsupported` に落ちる。
    let Some((prefix, provider)) = PROVIDER_PREFIXES
        .iter()
        .find(|(prefix, _)| raw_id.starts_with(prefix))
    else {
        return RowOutcome::Unsupported;
    };
    if !service.eq_ignore_ascii_case(provider) {
        return RowOutcome::Unsupported;
    }
    let provider_user_id = raw_id[prefix.len()..].to_string();
    if provider_user_id.is_empty() {
        return RowOutcome::Invalid;
    }

    // --- 時刻（`lcts` と `interval` から `imported_first_seen_at` を作る）------------------------
    let Some(lcts) = clean_text(index.raw(record, "lcts"), MAX_SHORT_TEXT_CHARS) else {
        return RowOutcome::Invalid;
    };
    // ⚠ パースを必須にするのは、下の減算と 038c の `is_long_absence` がパースに依存するため
    //   （文字列として持つだけなら通してしまえるが、そのぶん壊れた値が DB に入る）。
    let Ok(last_comment_at) = DateTime::parse_from_rfc3339(&lcts) else {
        return RowOutcome::Invalid;
    };
    // ⚠ `interval` だけ**空欄を 0 として扱う**。0 は「初回コメント＝最終コメント」という**正当な値**で
    //   （実測 61 行中 46 行が 0）、`tc` 等の「値が無い＝引き継げない」とは意味が違う。
    let Some(interval_ms) = parse_optional_non_negative_i64(index.raw(record, "interval")) else {
        return RowOutcome::Invalid;
    };
    let Some(first_seen) = last_comment_at.checked_sub_signed(Duration::milliseconds(interval_ms))
    else {
        return RowOutcome::Invalid;
    };

    // --- 数値（⚠ パース失敗を 0 で代替せず、行ごとスキップする）---------------------------------
    let (Some(imported_comments), Some(imported_gifts), Some(imported_active_days), Some(imported_stream_count)) = (
        parse_non_negative_i64(index.raw(record, "tc")),
        parse_non_negative_i64(index.raw(record, "tgc")),
        parse_non_negative_i64(index.raw(record, "atdDays")),
        parse_non_negative_i64(index.raw(record, "atdLives")),
    ) else {
        return RowOutcome::Invalid;
    };
    let Some(imported_gift_amount) = parse_non_negative_f64(index.raw(record, "amount")) else {
        return RowOutcome::Invalid;
    };

    // --- 自由入力の文字列（trim ＋ 制御文字拒否）------------------------------------------------
    // ⚠ `memo` だけ上限が広い（文章になりうる）。他は一覧の 1 セルに収まる長さ。
    let (Some(name), Some(nickname), Some(note), Some(label)) = (
        clean_text(index.raw(record, "username"), MAX_SHORT_TEXT_CHARS),
        clean_text(index.raw(record, "nickname"), MAX_SHORT_TEXT_CHARS),
        clean_text(index.raw(record, "memo"), MAX_NOTE_CHARS),
        clean_text(index.raw(record, "label"), MAX_SHORT_TEXT_CHARS),
    ) else {
        return RowOutcome::Invalid;
    };

    RowOutcome::Take(Box::new(ImportedViewer {
        id: format!("{provider}:{provider_user_id}"),
        provider: provider.to_string(),
        provider_user_id,
        name,
        nickname,
        note,
        label,
        // ⚠ `lcts` の生文字列ではなく**パースして書き戻した形**を使う（オフセット付きが混ざったときに
        //   DB 内の表記が揺れないように正規化する）。UTC なら `Z` 形式のまま出る。
        last_comment_at: last_comment_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        imported_first_seen_at: first_seen.to_rfc3339_opts(SecondsFormat::Millis, true),
        imported_name_history: clamp_name_history(index.raw(record, "nameHistory")),
        imported_comments,
        imported_gifts,
        imported_gift_amount,
        imported_active_days,
        imported_stream_count,
    }))
}

/// trim して「制御文字を含まない」「文字数上限を超えない」ことを確かめる（違反すれば `None`＝行スキップ）。
///
/// ⚠ 上限は**文字数**で数える（バイト数ではない）。⚠ **切り詰めない**（理由は [`MAX_NOTE_CHARS`]）。
///
/// 【意図・レビュー指摘 Q-7・修正不要】`reject_control_chars` へ渡す文言が空なのは、
/// **戻り値を `Option` に落とすので `AppError` の中身を誰も見ないから**である（行を落とすかどうかだけが
/// 必要で、どの列が何文字目で落ちたかは §9 の都合で外へ出さない）。`chars().any(char::is_control)` を
/// ここへ直書きしないのは、**制御文字の定義を 2 か所に持たない**ため（`util` の 1 実装を全モジュールで共有する）。
/// 【再修正トリガ】どの列で落ちたかをユーザーへ伝えたくなったら、`Option` ではなく `AppResult` を返す形へ
/// 変えたうえで文言を入れること。**空文字のまま `AppError` を作って捨てる形を真似して増やさない。**
fn clean_text(raw: &str, max_chars: usize) -> Option<String> {
    let trimmed = raw.trim();
    reject_control_chars(trimmed, "").ok()?;
    (trimmed.chars().count() <= max_chars).then(|| trimmed.to_string())
}

/// `nameHistory` を保管できる形に丸める。
///
/// ⚠ **行はスキップしない**——表示しない保管専用の列のために引き継ぎ全体を落とすのは割に合わない。
/// 制御文字（JSON に改行が入りうる）や上限超過は**空文字**に倒す。
fn clamp_name_history(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() > MAX_NAME_HISTORY_BYTES || trimmed.chars().any(char::is_control) {
        return String::new();
    }
    trimmed.to_string()
}

/// 引き継ぐ回数として読む。
///
/// ⚠ **空欄・負値・パース失敗はすべて `None`**（0 で代替しない）。
/// ⚠⚠ **[`MAX_IMPORTED_COUNT`] 超えも `None`**——上限が無いと `u32` の DTO で読めない値が
/// 列に入り、視聴者一覧が丸ごと開けなくなる（同定数の doc が理由）。
fn parse_non_negative_i64(raw: &str) -> Option<i64> {
    let value = raw.trim().parse::<i64>().ok()?;
    (0..=MAX_IMPORTED_COUNT).contains(&value).then_some(value)
}

/// `interval`（ミリ秒）専用。
///
/// ⚠ **空欄だけは 0** として通す（0 は正当な値・呼び出し側の注記が理由）。
/// ⚠⚠ **[`MAX_IMPORTED_COUNT`] を当ててはいけない。** これは回数ではなく**経過時間**で、
/// 何年も通っている視聴者なら 1e11 ミリ秒（約 3 年）に達しうる。1 億（約 27.7 時間）で切ると
/// **常連さんほど取り込めなくなる**。上限の代わりに、下の `checked_sub_signed` が
/// 日時の表現範囲を超えたときに `None` を返して行を落とす（＝溢れは日時側で塞ぐ）。
fn parse_optional_non_negative_i64(raw: &str) -> Option<i64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Some(0);
    }
    let value = trimmed.parse::<i64>().ok()?;
    (value >= 0).then_some(value)
}

/// 非負の有限小数として読む。⚠ `NaN` / `inf` / 負値 / 空欄はすべて `None`
/// （`REAL` 列へ NaN を入れると以後の比較・並び替えが静かに壊れる）。
fn parse_non_negative_f64(raw: &str) -> Option<f64> {
    let value = raw.trim().parse::<f64>().ok()?;
    (value.is_finite() && value >= 0.0).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ⚠⚠ **フィクスチャはすべて合成データである**（docs/security.md §9）。実物の取り込み元 CSV には
    //   第三者の視聴者 ID・表示名・メモが入っているので、**リポジトリに置かない**
    //   （`tests/fixtures/` にも置かない＝「実物を置く場所」を作らないため、ここに定数で持つ）。
    //   ID は明らかに架空の値にしてある。

    /// 親 065 の実測パターン①（`screenName` が 6 列目）。
    const LAYOUT_A: &str = concat!(
        "id,username,icon,badges,nickname,screenName,lang,service,memo,nameHistory,allowIcon,",
        "interval,lcts,tc,tgc,amount,lst,anonymity,label,atdDays,atdLives,lstLive\n",
        "yt-UCtest0000000000000001,@alpha,https://example.invalid/a.png,[],アルファ,,[],youtube,",
        "ひとこと,[],,0,2026-08-15T23:29:04.288Z,3,1,160,#,,😀,2,1,vid0001\n",
    );

    /// 親 065 の実測パターン②（**同じ列名・同じ 22 列のまま `screenName` が 19 列目へ移動**）。
    const LAYOUT_B: &str = concat!(
        "id,username,icon,badges,nickname,lang,service,memo,nameHistory,allowIcon,",
        "interval,lcts,tc,tgc,amount,lst,anonymity,label,screenName,atdDays,atdLives,lstLive\n",
        "yt-UCtest0000000000000001,@alpha,https://example.invalid/a.png,[],アルファ,[],youtube,",
        "ひとこと,[],,0,2026-08-15T23:29:04.288Z,3,1,160,#,,😀,,2,1,vid0001\n",
    );

    fn header() -> String {
        "id,username,nickname,service,memo,nameHistory,interval,lcts,tc,tgc,amount,label,atdDays,atdLives\n"
            .to_string()
    }

    /// ヘッダ ＋ 1 行を組み立てる（14 列・必須 9 列を含む最小形）。
    fn one_row(row: &str) -> String {
        format!("{}{row}\n", header())
    }

    fn only(csv: &str) -> ImportedViewer {
        let parsed = parse(csv).expect("パースできるはず");
        assert_eq!(parsed.viewers.len(), 1, "1 行だけ取り込まれるはず: {parsed:?}");
        parsed.viewers[0].clone()
    }

    // ⚠⚠ **列位置で読む実装への回帰を構造的に塞ぐ**（親 065 の実測を合成で再現）。
    //   変異「ヘッダ索引を位置固定へ戻す」はここで落ちる。
    #[test]
    fn the_column_order_does_not_change_the_result() {
        let a = parse(LAYOUT_A).expect("列順①");
        let b = parse(LAYOUT_B).expect("列順②");
        assert_eq!(a.viewers, b.viewers, "列順が違うだけで結果が変わってはいけない");
        assert_eq!(a.viewers.len(), 1);
        let v = &a.viewers[0];
        assert_eq!(v.id, "youtube:UCtest0000000000000001");
        assert_eq!(v.nickname, "アルファ");
        assert_eq!(v.note, "ひとこと");
        assert_eq!(v.label, "😀");
        assert_eq!(v.imported_comments, 3);
        assert_eq!(v.imported_gifts, 1);
        assert_eq!(v.imported_gift_amount, 160.0);
        assert_eq!(v.imported_active_days, 2);
        assert_eq!(v.imported_stream_count, 1);
        // ⚠ 捨てる列（icon / badges / lang / screenName / lst / anonymity / lstLive）はどこにも現れない。
        let dumped = format!("{v:?}");
        for dropped in ["example.invalid", "vid0001", "#"] {
            assert!(!dumped.contains(dropped), "捨てるはずの列が残っている: {dropped}");
        }
    }

    // ID 変換（`yt-` → `youtube:`）。⚠ `author.id` は `UC...` そのものなので前置きを剥がすだけ。
    #[test]
    fn the_provider_prefix_is_translated() {
        let v = only(&one_row(
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
        ));
        assert_eq!(v.id, "youtube:UCtest0000000000000001");
        assert_eq!(v.provider, "youtube");
        assert_eq!(v.provider_user_id, "UCtest0000000000000001");
    }

    // ⚠ 未知プレフィックスは `skipped_unsupported`（fail-closed・0 として取り込まない）。
    #[test]
    fn unknown_prefixes_are_skipped_as_unsupported() {
        let parsed = parse(&one_row(
            "nico-lv0000001,@a,,niconico,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
        ))
        .expect("ファイル自体は妥当");
        assert!(parsed.viewers.is_empty());
        assert_eq!(parsed.skipped_unsupported, 1);
        assert_eq!(parsed.skipped_invalid, 0);
    }

    // ⚠⚠ プレフィックスと `service` 列が食い違う行もスキップする（`tw-` が未検証の推定だから、
    //   片方だけで信じない）。
    #[test]
    fn a_prefix_that_disagrees_with_the_service_column_is_skipped() {
        let parsed = parse(&one_row(
            "yt-UCtest0000000000000001,@a,,twitch,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
        ))
        .expect("ファイル自体は妥当");
        assert!(parsed.viewers.is_empty());
        assert_eq!(parsed.skipped_unsupported, 1);
    }

    // `tw-` も（推定どおりなら）変換される。⚠ 実データ未確認であることは PROVIDER_PREFIXES の doc が正。
    #[test]
    fn the_twitch_prefix_is_translated_too() {
        let v = only(&one_row(
            "tw-123456,@a,,twitch,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
        ));
        assert_eq!(v.id, "twitch:123456");
    }

    // ⚠⚠ 必須列が欠けたら **1 行も取り込まずエラー**（fail-closed）。
    #[test]
    fn a_missing_required_column_rejects_the_whole_file() {
        let full = header();
        let all: Vec<&str> = full.trim_end().split(',').collect();
        for missing in REQUIRED_COLUMNS {
            let headers: Vec<&str> = all.iter().copied().filter(|h| *h != missing).collect();
            let csv = format!(
                "{}\n{}\n",
                headers.join(","),
                vec!["x"; headers.len()].join(",")
            );
            assert!(
                parse(&csv).is_err(),
                "必須列 {missing} が無いのに取り込もうとした"
            );
        }
        // 対照: 必須でない列（memo）が無くても通る。
        let headers: Vec<&str> = all.iter().copied().filter(|h| *h != "memo").collect();
        let row = "yt-UCtest0000000000000001,@a,,youtube,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1";
        let csv = format!("{}\n{row}\n", headers.join(","));
        assert_eq!(parse(&csv).expect("memo が無くても通るはず").viewers.len(), 1);
    }

    // ⚠ 数値の壊れた行は **0 として取り込まず**その行ごとスキップする。
    #[test]
    fn broken_numbers_skip_the_row_instead_of_defaulting_to_zero() {
        for bad_row in [
            // tc が空欄
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,,0,0,,1,1",
            // tc が数値でない
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,abc,0,0,,1,1",
            // tgc が負
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,-1,0,,1,1",
            // amount が NaN
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,NaN,,1,1",
            // atdDays が空欄
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,,1",
            // interval が負
            "yt-UCtest0000000000000001,@a,,youtube,,,-5,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
            // lcts がパースできない
            "yt-UCtest0000000000000001,@a,,youtube,,,0,bogus,1,0,0,,1,1",
        ] {
            let parsed = parse(&one_row(bad_row)).expect("ファイル自体は妥当");
            assert!(parsed.viewers.is_empty(), "壊れた行を取り込んだ: {bad_row}");
            assert_eq!(parsed.skipped_invalid, 1, "{bad_row}");
            assert_eq!(parsed.skipped_unsupported, 0, "{bad_row}");
        }
    }

    // ⚠⚠ **security-review で見つけた欠陥の回帰テスト。**
    //   `ViewerRecord` は集計 4 列を `u32` で読むので、`u32::MAX` を超える値を列に入れると
    //   **`list_viewers` / `get_viewer` が両方とも落ちて視聴者一覧が丸ごと開けなくなる**
    //   （UI からその行を消すこともできなくなる）。取り込み側で落とすのが唯一の防波堤である。
    #[test]
    fn counts_beyond_the_supported_range_are_rejected_not_stored() {
        for over in [
            MAX_IMPORTED_COUNT + 1,
            u32::MAX as i64,     // ⚠ u32 に収まるが、実測分を足すと溢れる領域
            u32::MAX as i64 + 1, // ⚠ ここが「一覧が開けなくなる」実測ケース
            i64::MAX,
        ] {
            let parsed = parse(&one_row(&format!(
                "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,{over},0,0,,1,1"
            )))
            .expect("ファイル自体は妥当");
            assert!(parsed.viewers.is_empty(), "tc = {over} を取り込んでしまった");
            assert_eq!(parsed.skipped_invalid, 1, "tc = {over}");
        }
        // 上限ちょうどは通る（過剰に弾いていないこと）。
        let v = only(&one_row(&format!(
            "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,{MAX_IMPORTED_COUNT},0,0,,1,1"
        )));
        assert_eq!(v.imported_comments, MAX_IMPORTED_COUNT);
    }

    // ⚠ 上限は 4 つの回数列すべてに効く（1 列だけ外す変異を検知する）。
    #[test]
    fn the_count_limit_applies_to_every_counter_column() {
        let over = MAX_IMPORTED_COUNT + 1;
        for (label, row) in [
            ("tc", format!("yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,{over},0,0,,1,1")),
            ("tgc", format!("yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,{over},0,,1,1")),
            ("atdDays", format!("yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,{over},1")),
            ("atdLives", format!("yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,{over}")),
        ] {
            let parsed = parse(&one_row(&row)).expect("ファイル自体は妥当");
            assert!(parsed.viewers.is_empty(), "{label} の上限が効いていない");
        }
    }

    // ⚠⚠ **security-review で見つけた欠陥の回帰テスト（その 2）。**
    //   ファイルサイズ上限（8MiB）だけだと、1 行の `memo` に数 MB を入れた CSV が作れてしまい、
    //   それが `viewers.note` に入って 065b の一覧描画を止める。⚠ **切り詰めずに行を落とす**。
    #[test]
    fn over_long_free_text_skips_the_row_instead_of_being_truncated() {
        let long_note = "あ".repeat(MAX_NOTE_CHARS + 1);
        let parsed = parse(&one_row(&format!(
            "yt-UCtest0000000000000001,@a,,youtube,{long_note},,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1"
        )))
        .expect("ファイル自体は妥当");
        assert!(parsed.viewers.is_empty(), "⚠ 長すぎる memo を取り込んだ（切り詰めていないか）");
        assert_eq!(parsed.skipped_invalid, 1);

        // 短い列（nickname）はもっと厳しい上限。
        let long_nickname = "い".repeat(MAX_SHORT_TEXT_CHARS + 1);
        let parsed = parse(&one_row(&format!(
            "yt-UCtest0000000000000001,@a,{long_nickname},youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1"
        )))
        .expect("ファイル自体は妥当");
        assert!(parsed.viewers.is_empty(), "⚠ 長すぎる nickname を取り込んだ");

        // ⚠ 上限ちょうどは通る（過剰に弾いていないこと）＝ 文字数で数えている（バイト数ではない）。
        let at_limit = "あ".repeat(MAX_NOTE_CHARS);
        let v = only(&one_row(&format!(
            "yt-UCtest0000000000000001,@a,,youtube,{at_limit},,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1"
        )));
        assert_eq!(v.note.chars().count(), MAX_NOTE_CHARS, "マルチバイトでも文字数で数える");
    }

    // ⚠ `interval` は**回数ではなく経過時間**なので、回数の上限を当ててはいけない
    //   （何年も通っている常連さんの `interval` は 1e11 ミリ秒＝約 3 年に達しうる）。
    #[test]
    fn a_multi_year_interval_is_still_accepted() {
        let three_years_ms: i64 = 3 * 365 * 24 * 60 * 60 * 1000; // ≒ 9.46e10（回数上限の 946 倍）
        assert!(three_years_ms > MAX_IMPORTED_COUNT, "前提: 回数上限より大きいこと");
        let v = only(&one_row(&format!(
            "yt-UCtest0000000000000001,@a,,youtube,,,{three_years_ms},2026-08-15T23:29:04.288Z,3,0,0,,1,1"
        )));
        // ⚠ 1095 日ぶん遡るので、2024 年のうるう日を跨いで 2023-08-16 に着地する（3 暦年ではない）。
        assert_eq!(
            v.imported_first_seen_at, "2023-08-16T23:29:04.288Z",
            "⚠ 3 年前へ遡れること（回数の上限を interval にも当てると常連さんほど落ちる）"
        );
    }

    // ⚠ `interval` の**空欄だけ**は 0 として通す（0 は正当な値＝初回コメント＝最終コメント）。
    #[test]
    fn an_empty_interval_means_zero_not_a_broken_row() {
        let v = only(&one_row(
            "yt-UCtest0000000000000001,@a,,youtube,,,,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
        ));
        assert_eq!(v.imported_first_seen_at, "2026-08-15T23:29:04.288Z", "interval 0＝lcts と同値");
    }

    // `imported_first_seen_at = lcts − interval`（ミリ秒）。
    #[test]
    fn the_imported_first_seen_at_subtracts_the_interval() {
        let v = only(&one_row(
            "yt-UCtest0000000000000001,@a,,youtube,,,75000,2026-08-15T23:29:04.288Z,3,0,0,,1,1",
        ));
        assert_eq!(v.imported_first_seen_at, "2026-08-15T23:27:49.288Z", "75 秒前");
        assert_eq!(v.last_comment_at, "2026-08-15T23:29:04.288Z", "lcts は動かさない");
    }

    // 制御文字入りの文字列列はその行を落とす（§8）。
    #[test]
    fn control_characters_in_free_text_skip_the_row() {
        let parsed = parse(&format!(
            "{}yt-UCtest0000000000000001,@a,,youtube,\"改行\nあり\",,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1\n",
            header()
        ))
        .expect("ファイル自体は妥当");
        assert!(parsed.viewers.is_empty());
        assert_eq!(parsed.skipped_invalid, 1);
    }

    // ⚠⚠ RFC4180 のクォート（カンマ・改行・二重引用符）が正しく読める＝手書きパーサにしない理由。
    #[test]
    fn quoted_fields_with_commas_and_escaped_quotes_are_parsed() {
        let v = only(&format!(
            "{}yt-UCtest0000000000000001,@a,,youtube,\"あ、い、う \"\"引用\"\" \",\"[{{\"\"n\"\":1}}]\",0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
            header()
        ));
        assert_eq!(v.note, "あ、い、う \"引用\"", "カンマと二重引用符が復元される");
        assert_eq!(v.imported_name_history, "[{\"n\":1}]", "生 JSON のまま保管する");
    }

    // BOM 付き（Excel を経由すると付く経路がある）。
    #[test]
    fn a_leading_bom_is_stripped() {
        let v = only(&format!(
            "\u{FEFF}{}yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
            header()
        ));
        assert_eq!(v.id, "youtube:UCtest0000000000000001", "BOM で最初の列名が壊れない");
    }

    // `nameHistory` は壊れていても**行を落とさず**空文字へ倒す（表示しない保管専用の列のため）。
    // ⚠ **上限超過と制御文字の 2 条件を別々に踏ませる**（レビューで「制御文字側だけ外す変異が生き残る」
    //   ことが実測された。表示しない列とはいえ、生の第三者データを素通しさせない規律は §8 の一部である）。
    #[test]
    fn a_broken_name_history_empties_the_column_without_dropping_the_row() {
        let long = "x".repeat(MAX_NAME_HISTORY_BYTES + 1);
        let v = only(&format!(
            "{}yt-UCtest0000000000000001,@a,,youtube,,{long},0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
            header()
        ));
        assert_eq!(v.imported_name_history, "", "上限超過は空文字");
        assert_eq!(v.imported_comments, 1, "行そのものは取り込まれる");

        // ⚠ 制御文字（引用フィールド内の改行）でも空文字へ倒す。**行は落とさない。**
        let v = only(&format!(
            "{}yt-UCtest0000000000000001,@a,,youtube,,\"[{{\"\"n\"\":\n1}}]\",0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
            header()
        ));
        assert_eq!(v.imported_name_history, "", "制御文字入りの生 JSON を素通ししない");
        assert_eq!(v.imported_comments, 1, "⚠ 行は落とさない（memo 等とは扱いが違う）");

        // 対照: 正常な `nameHistory` は生のまま残る（過剰に空へ倒していないこと）。
        let v = only(&format!(
            "{}yt-UCtest0000000000000001,@a,,youtube,,\"[{{\"\"n\"\":1}}]\",0,2026-08-15T23:29:04.288Z,1,0,0,,1,1",
            header()
        ));
        assert_eq!(v.imported_name_history, "[{\"n\":1}]");
    }

    // ⚠ ヘッダ名は trim してから突き合わせる（区切りの後ろに空白がある CSV でも列を引けること）。
    #[test]
    fn the_header_names_are_matched_after_trimming() {
        let padded = "id, username, nickname, service, memo, nameHistory, interval, lcts, tc, tgc, amount, label, atdDays, atdLives\n";
        let v = only(&format!(
            "{padded}yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,7,0,0,,1,1\n"
        ));
        assert_eq!(v.id, "youtube:UCtest0000000000000001");
        assert_eq!(v.imported_comments, 7, "空白付きヘッダでも必須列を引けている");
    }

    // 行数上限は**切り詰めずに拒否**する（黙って上位 N 件だけ入れない）。
    #[test]
    fn too_many_rows_rejects_the_file_instead_of_truncating() {
        let row = "yt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1\n";
        let csv = format!("{}{}", header(), row.repeat(MAX_CSV_ROWS + 1));
        assert!(parse(&csv).is_err(), "行数上限を超えたファイルを受け入れた");
        let ok = format!("{}{}", header(), row.repeat(MAX_CSV_ROWS));
        assert_eq!(parse(&ok).expect("上限ちょうどは通る").viewers.len(), MAX_CSV_ROWS);
    }

    // ⚠ 未知の列が増えても壊れない（取り込み元の版が上がって列が足されるケース）。
    #[test]
    fn unknown_columns_are_ignored() {
        let csv = format!(
            "{},brandNewColumn\nyt-UCtest0000000000000001,@a,,youtube,,,0,2026-08-15T23:29:04.288Z,1,0,0,,1,1,なにか\n",
            header().trim_end()
        );
        assert_eq!(parse(&csv).expect("未知列があっても通る").viewers.len(), 1);
    }

    // ⚠ 空ファイル／ヘッダだけは「0 件」であってエラーではない（必須列が無いのでエラーになる空ファイルと、
    //   ヘッダはあるが行が無いファイルを分けて確認する）。
    #[test]
    fn an_empty_file_is_rejected_but_a_header_only_file_imports_nothing() {
        assert!(parse("").is_err(), "空ファイルは必須列が無いので拒否");
        let parsed = parse(&header()).expect("ヘッダだけなら妥当な CSV");
        assert!(parsed.viewers.is_empty());
        assert_eq!(parsed.skipped_invalid, 0);
        assert_eq!(parsed.skipped_unsupported, 0);
    }
}
