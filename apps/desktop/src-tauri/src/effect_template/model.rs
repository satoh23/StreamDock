//! 061c: エフェクトテンプレートの DTO と、`manifest.json` を受ける serde 型。
//!
//! ts-rs で `src/features/obs-effects/bindings/` へ出力する。
//!
//! ⚠ **出力先を新ディレクトリにした理由**（060b は `features/comment-viewer/bindings/` へ出した）:
//! `package.json` の `check:bindings` は対象ディレクトリを**ハードコードで列挙**しているので、
//! 新しい出力先を作ると列挙から漏れてドリフトを検出できない（`src/features/rakuraku/bindings/` が
//! 実際に漏れている）。**そこで列挙にも 1 パス足してある**——061d の API ラッパは
//! `features/obs-effects/effectTemplateApi.ts` に置く設計なので、
//! 型をコメビュ配下へ出すほうが構成としては破綻する。
//!
//! ⚠⚠ **`check:bindings` の実体は `git diff --exit-code` なので、未追跡ファイルを見ない**
//! （060b security-review S-8 の既知の穴）。**新規に生成した binding は初回コミットまで検査対象にならない**ので、
//! 生成直後に回した緑は空振りである。回避策は `git add -N <dir>` を挟んでから実行すること。
//! ⚠ 恒久対処（`git status --porcelain` も見る）は `package.json` の書き換えを伴うので別タスクのまま。
//!
//! ## frontend へ**渡さない**もの
//!
//! ⚠⚠ **実ファイル名（`dir_name` / `media` / `sound`）は 1 つも DTO に載せない。**
//! 060b が `file_name` 列を `OverlayThemeRecord` に載せなかったのと同じ理由で、
//! **frontend が実ファイル名を知らなければ「frontend がパスを組み立てる」経路そのものが作れない**（§3 / §5）。
//! 音の有無だけは 061d が再生の要否を判断するのに要るので [`EffectTemplateRecord::has_sound`] で渡す。
//! 実体は `get_effect_template_media`（data URI）でしか出ない。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// レイアウトの基準位置。**9 値の固定 union**（自由な文字列を受けない・§8）。
///
/// ⚠ JSON は kebab-case（`"top-left"` 等）。未知の値は serde が拒否するので、
/// 「知らない anchor が来たら中央にフォールバック」のような**fail-open な既定値を作らない**。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/features/obs-effects/bindings/")]
pub enum EffectAnchor {
    TopLeft,
    Top,
    TopRight,
    Left,
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
}

/// メディアの配置（`manifest.layout`）。
///
/// ⚠ `offsetX` / `offsetY` は**省略できる**（既定 0）。`anchor` / `width` / `height` は必須。
/// 省略可にしているのは「原点に置くだけ」のテンプレートを書くときに 2 行を強制しないため。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/features/obs-effects/bindings/")]
pub struct EffectLayout {
    pub anchor: EffectAnchor,
    #[serde(default)]
    pub offset_x: i32,
    #[serde(default)]
    pub offset_y: i32,
    pub width: u32,
    pub height: u32,
}

/// 差し込みテキスト（`manifest.text`）。任意。
///
/// ⚠⚠ **`template` と `templateWithoutAmount` の 2 本ある理由**（061c の設計判断）:
/// 061b の `EffectRequest` は `amountText: string | null` で、**金額を持たない種別**
/// （サブスク / メンシプ / ギフト）では null になる。1 本しか無いと
/// `"{name} さんが {amount}"` が「テスト さんが 」になってしまう——これは課金イベントの
/// 大半で起きる（金額を持つのは superchat / bits / donation / jewels だけ）。
/// - `template` … `amountText` が**あるとき**に使う（必須）
/// - `template_without_amount` … `amountText` が **null のとき**に使う（省略時は `"{message}"`）
///
/// ⚠ **`amountText` と `message` は同時に null になりうる**（例: donation で金額情報が欠けた場合）。
/// そのとき `{amount}` も `{message}` も空文字へ落ちるので、**061d は空になった行を描かないこと**
/// （061b の組み込み描画が `message ?? "{name}さん"` へ落としているのと同じ配慮が要る）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/features/obs-effects/bindings/")]
pub struct EffectText {
    /// 金額があるときの文面。使える変数は `{name}` / `{amount}` / `{event}` / `{message}` **だけ**。
    pub template: String,
    /// 金額が無いときの文面。省略時は `"{message}"`。変数の規則は `template` と同じ。
    #[serde(default = "default_template_without_amount")]
    pub template_without_amount: String,
    pub anchor: EffectAnchor,
    pub font_size: u32,
}

fn default_template_without_amount() -> String {
    "{message}".to_string()
}

/// `manifest.json` をそのまま受ける型（**frontend へは出さない**）。
///
/// ⚠⚠ **`deny_unknown_fields` を全 struct に付けている。**
/// 「`schemaVersion` があるのに deny だと前方互換が効かない」という指摘は事実だが、
/// **未知フィールドの黙殺は前方互換の手段として成立しない**——v2 で `layout.scale` が増えたときに
/// v1 が黙って無視すると「**意図と違う大きさで配信に出る**」という静かな誤動作になる。
/// deny なら「このテンプレートは新しい形式です」と**言える**。加えて `sound` を `sounds` と
/// 書き間違えたテンプレートを取り込み時に落とせる（黙って無音にならない）。
/// ＝ **前方互換は `schemaVersion` の明示的な非互換エラーで担保し、黙殺では担保しない。**
///
/// ⚠ `media` / `sound` は**保存時に管理下の名前へ書き換える**（`media.<拡張子>` / `sound.<拡張子>`）。
/// 元のファイル名は DB にも frontend にも 1 バイトも残らない（§5 / §9）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectManifest {
    pub schema_version: u32,
    pub name: String,
    pub media: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<String>,
    pub duration_ms: u32,
    pub layout: EffectLayout,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<EffectText>,
}

/// `effect_templates` テーブル 1 行の frontend 表現。JSON は camelCase。
///
/// ⚠⚠ **`dir_name` も `media` も `sound` も載せない**（モジュール doc の理由）。
/// 音の有無は [`Self::has_sound`] だけで伝える。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/obs-effects/bindings/")]
pub struct EffectTemplateRecord {
    /// uuid v4（`overlay_theme` / `tools` / `presets` と同じ採番）。管理ディレクトリ名の由来でもある。
    pub id: String,
    /// `manifest.name`。⚠ **第三者が書いた文字列**だが、制御文字と長さは Rust 側で検証済み。
    pub name: String,
    pub duration_ms: u32,
    pub layout: EffectLayout,
    pub text: Option<EffectText>,
    /// `manifest.sound` を持つか。⚠ **061d が「音を鳴らすか」を判断するためだけ**の値で、
    /// ファイル名は含まない。
    pub has_sound: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// `get_effect_template_media` の戻り値。**完全な data URI**（`data:image/png;base64,…`）。
///
/// ⚠⚠ **`tools::icon` の `encode_png_base64`（`data:` を付けない生 base64）と、あえて形を違える。**
/// frontend が `data:${mime};base64,${b64}` を自分で組み立てる形にすると、
/// 描画シンクのガード（036a の `avatarDataUri` と同型）が**自分で作った文字列を検査するだけ**になり
/// 無意味になる。Rust が組み立てて frontend が検査する向きにして初めて、
/// ガードが **IPC 境界を越えてきた値**を見る最終防波堤として機能する。
///
/// ⚠ MIME は**拡張子の許可リストから決まる定数**（`service::AssetKind::from_extension` で引いた
/// `AssetKind` の `mime()` が返す `&'static str`）で、ユーザー入力を 1 バイトも載せない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/obs-effects/bindings/")]
pub struct EffectTemplateMedia {
    pub media: String,
    pub sound: Option<String>,
}
