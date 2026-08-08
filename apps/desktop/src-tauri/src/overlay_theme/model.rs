//! 060b: オーバーレイテーマの DTO。
//!
//! frontend へ返すのは [`OverlayThemeRecord`]（`overlay_themes` の 1 行）と、取り込み結果の
//! [`OverlayThemeImportResult`]。ts-rs で `src/features/comment-viewer/bindings/` へ出力する。
//!
//! ⚠ **出力先を新ディレクトリにしない理由**: `package.json` の `check:bindings` は対象ディレクトリを
//! **ハードコードで列挙**しており、新しい出力先を作ると列挙から漏れて**ドリフトを検出できない**
//! （実際 `src/features/rakuraku/bindings/` が既に漏れている）。060d の API ラッパも
//! `features/comment-viewer/overlayThemeApi.ts` に置く設計なので、`audio` / `obs_config` の DTO と
//! 同じ場所に出すのが構成上も正しい。
//!
//! ⚠⚠ **`check:bindings` にはもう 1 つ、ディレクトリを既存にしても消えない穴がある**
//! （security-review S-8）: 実体は `gen:bindings` ＋ `git diff --exit-code -- <dirs>` で、
//! **`git diff` は未追跡ファイルを見ない**。つまり**新規に生成した binding は初回コミットまで
//! 検査対象にならない**（この 3 本がまさにそれで、緑は空振りだった）。
//! 直すには `git status --porcelain -- <dirs>` も見るか `git add -N` を挟む必要があり、
//! **`package.json` を触る＝ 060b の「差分ゼロ」要件と衝突する**ので別タスクへ送る。
//! ⚠ 060d 以降で binding を足すときは、**初回コミット後にもう一度 `check:bindings` を回すこと。**

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// テーマの出自。DB には小文字文字列（`"local"` / `"snapshot"`）で入る。
///
/// ⚠ **コマンドの引数には一切現れない**。値を決めるのは Rust 側の呼び出し経路だけで、
/// frontend から `snapshot` を騙ることはできない（060c が sidecar 経由で取得したものだけが
/// `Snapshot` になる）。
///
/// `Deserialize` は repository が DB 文字列から復元するために要る（`app_logs` の
/// `enum_from_db` と同じイディオム。未知の文字列は `Local` へ劣化させる＝前方互換）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub enum OverlayThemeOrigin {
    /// ローカルの `.css` をそのまま取り込んだもの（060b）。
    Local,
    /// 外部 `@import` を取得してインライン化したもの（060c）。**060b は生成しない。**
    Snapshot,
}

/// `overlay_themes` テーブル 1 行の frontend 表現。JSON は camelCase。
///
/// ⚠ **`file_name` 列は含めない**。frontend が実ファイル名を知る必要はなく、
/// 知らせないことで「frontend がパスを組み立てる」経路そのものを作らない（§3 / §5）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct OverlayThemeRecord {
    /// uuid v4（`tools` / `presets` と同じ採番）。実ファイル名 `<id>.css` の由来でもある。
    pub id: String,
    /// ユーザーが付ける名前。⚠ **UNIQUE ではない**（理由は `repository::init` の注記）。
    pub name: String,
    pub origin: OverlayThemeOrigin,
    /// 取り込み時に除去した参照の総数（UI 表示用）。
    ///
    /// ⚠ **「外部参照の数」ではなく「取り込めなかった参照の総数」**。相対 URL（`url(/x.png)`）や
    /// `url(#frag)` のように**そもそも外部通信にならないもの**も allow-list により除去され、ここに数えられる
    /// （理由は `sanitize` の注記）。060d の文言はこの事実に合わせること。
    ///
    /// ⚠⚠ **この数字だけでは「どれだけ失われたか」が分からない**（060d レビュー Q-3）。
    /// CSS に対応の取れていない `(` が 1 つあると、そこから EOF までが 1 つの宣言として扱われ
    /// （ブラウザの `calc(` 等の simple block 消費と同じ挙動なので**意味論としては正しい**）、
    /// その範囲に参照が 1 つでもあれば**ファイルの残り全部が消えて `stripped_count` は 1** になる。
    /// 実測: `.a{width:calc(100% - 10px;}` ＋ 以降 → 出力 `.a{` ／ `stripped_count = 1`。
    ///
    /// ⚠⚠ **訂正（060c・2026-08-09）**: ここには当初「060d は**取り込み前後のサイズ比**を見て警告すること
    /// （取り込み前のファイルサイズは 060d 側が知っている＝ Rust に足す必要はない）」と書かれていたが、
    /// **これは事実誤認だった**。`@tauri-apps/plugin-dialog` の `open()` は**パス文字列しか返さず**、
    /// `plugin-fs` も asset protocol も無いので、**frontend は取り込み前のファイルを 1 バイトも読めない**
    /// （実測・`docs/progress.md` の 060d 節）。060d は Rust 差分ゼロを守るためコメントを誤ったまま残し、
    /// 「060c で `overlay_theme` を触るときに訂正する」を再修正トリガーにしていた。
    ///
    /// **サイズ比の代わりに、欠損は次の 2 本で検知する**（どちらも別の失敗モードを見ているので両方要る）:
    /// 1. [`OverlayThemeImportResult::truncated_to_eof`]（060c で追加）… 除去がファイル末尾まで達したか。
    ///    壊れた `(` が**トップレベル**（`@import` のプレリュード等）にあるケースを拾う。
    /// 2. frontend の `unclosedBlockDepth()`（`cssScope.ts`）… 壊れた `(` が**ブロックの中**にあり、
    ///    囲んでいた `}` ごと消えたケースを拾う。
    pub stripped_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// `import_overlay_theme` の戻り値。
///
/// ⚠ **永続する値（`theme`）と一過性の値（`stripped_import_urls`）を意図的に分けている。**
/// 除去した URL は **DB に持たない**——060c の設計が「取り込み時に 1 回だけ・毎回の明示同意」なので
/// 後から蒸し返すための永続化が要らず、第三者コンテンツ由来の URL を新たに永続化しないほうが §9 的にも軽い。
/// 帰結＝**取り込み時に取得を断ると、入れ直さない限り後から取得できない**
/// （060c の「スナップショットは撮ったら固定」と整合）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/comment-viewer/bindings/")]
pub struct OverlayThemeImportResult {
    pub theme: OverlayThemeRecord,
    /// 除去した `@import` の宛先（060c の同意ダイアログが**完全な URL** を出すために使う）。
    ///
    /// ⚠ **clamp 済み**（件数・1 件の長さとも `sanitize` の定数で上限を切ってある）。ユーザー CSS 由来の
    /// 未署名文字列で、素のままだと件数も長さも入力次第で無制限になる（060a レビュー S-1 と同型）。
    /// ⚠ **載るのは「取得できて・偽装できない形」だけ**（`sanitize::Scanner::record_import_url` が正）:
    /// CSS エスケープを含む宛先／相対 URL・`data:`・`javascript:`・`file:`／**bidi・format 文字**
    /// （U+202E 等。`char::is_control` では弾けず**別ホストに見える表示**を作れる）を含むものは**載らない**。
    /// いずれも除去と計数はされているので `stripped_count >= stripped_import_urls.len()` が常に成り立つ。
    /// ⚠ **userinfo 付き URL（`https://a.example@b.example/x`）は正当なので載る。**
    /// 060c の同意ダイアログは**ホストを別行で強調して出すこと**（URL を素で出すと先頭を信じられる）。
    /// ⚠ **ログにも `AppError` にも出さないこと**（§9）。
    pub stripped_import_urls: Vec<String>,
    /// 060c: 取り込みが**ファイル末尾まで巻き込んで欠損した疑い**があるか。
    ///
    /// 詳細と実測例は [`super::sanitize::SanitizeOutcome::truncated_to_eof`]。
    /// ⚠ frontend は **`truncatedToEof || unclosedBlockDepth(css) > 0`** で警告すること
    /// （2 つは別々の失敗モードを見ており、互いに相手を含まない）。
    pub truncated_to_eof: bool,
}
