//! 061c: `manifest.json` の**純粋なスキーマ検証**（I/O をまったく行わない層）。
//!
//! ここが受け取るのは「第三者が書いた JSON テキスト」で、通ってよいのは
//! **形も範囲も語彙も既知のものだけ**である（§8・fail-closed）。
//!
//! ## この層が防いでいるもの
//!
//! - **未知フィールドの黙殺**（`deny_unknown_fields`）——`sound` を `sounds` と書き間違えたテンプレートが
//!   「黙って無音で取り込まれる」形を作らない。
//! - **未知スキーマ版の誤動作**——`schemaVersion` を先に見て、対応していない版は**専用の文言**で断る
//!   （`deny_unknown_fields` に先に落とされると「内容が仕様と一致しません」としか言えない）。
//! - **範囲外の値**——`fontSize` / `width` / `height` に上限が無いと、**テンプレート 1 つで配信画面全体を覆える**。
//! - ⚠⚠ **未知の差し込み変数**——`{text}`（コメント本文）や `{avatar}` を書いたテンプレートを
//!   取り込み時に落とす。⚠ **型でも二重に守られている**（061b の `EffectRequest` に `text` も
//!   `avatar` もフィールドとして存在しないので、変数を足しても渡すものが無い）。
//!
//! ## ⚠ エラーにユーザー入力を 1 バイトも載せない（§9）
//!
//! `serde_json::Error` の Display は**入力の断片を含む**（`unknown field \`xyz\`` / 行番号つきの抜粋）。
//! したがって **serde のエラーは必ず握り潰して固定文言へ差し替える**。
//! 区別してよいのは「JSON として読めない」か「内容が仕様と合わない」かまでで、これは入力を含まない。

use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::util::{reject_control_chars, require_non_empty};

use super::model::{EffectLayout, EffectManifest, EffectText};

/// 対応する `manifest.json` の版。**完全一致のみ受け入れる。**
pub const SCHEMA_VERSION: u32 = 1;

/// テンプレート名の長さ上限（文字数）。`overlay_theme::validate_theme_name` と同じ値に揃えてある。
const MAX_NAME_CHARS: usize = 80;

/// 差し込み文面の長さ上限（文字数）。
///
/// 960×360 の窓に収まる文の長さ。⚠ 上限が無いと、巨大な文字列を `fontSize` の上限いっぱいで
/// 描かせて配信画面を潰せる（`width` / `height` の上限と同じ趣旨）。
const MAX_TEMPLATE_CHARS: usize = 200;

const MIN_DURATION_MS: u32 = 500;
const MAX_DURATION_MS: u32 = 15_000;
const MIN_SIZE_PX: u32 = 16;
const MAX_WIDTH_PX: u32 = 1920;
const MAX_HEIGHT_PX: u32 = 1080;
/// オフセットの絶対値の上限。**窓の大きさには紐づけない**（061a の窓サイズは Rust の定数で、
/// そこへ結合すると窓を広げるたびに既存テンプレートの可否が変わる）。窓の外に置いても
/// 「見えないだけ」なので、ここは暴走値を止める衛生上限である。
const MAX_OFFSET_PX: u32 = 4096;
const MIN_FONT_SIZE_PX: u32 = 8;
const MAX_FONT_SIZE_PX: u32 = 128;

/// 差し込み文面に書ける変数。**この 4 つだけ。**
///
/// ⚠⚠ **`{message}` を含めてよい根拠（§9 の再評価・061c の設計判断）**:
/// `{message}` の値は 061b の `EffectRequest::message`＝ frontend の `composeEventMessage` が組む文で、
/// その入力は `eventType` / `source` / `author.name` / `monthCount` / `giftCount` / `tier` **だけ**である。
/// **そこに含まれる第三者の自由入力は `author.name` ただ 1 つ**で、それは**既に `{name}` として露出済み**。
/// 残りはプラットフォームが振る列挙値と数値で、文そのものは**アプリが書いた定型文**。
/// ＝ **新しい第三者データ面を 1 バイトも増やしていない。**
///
/// ⚠ **本文（`text`）とアバターは、変数を足しても渡せない**——061b の `EffectRequest` に
/// フィールドとして存在しないため（型による担保）。ここの allow-list はその二重目である。
/// ⚠ **変数を増やすときは §9 の観点で再評価すること**（docs/security.md §8 の 061c 節）。
pub const ALLOWED_TEMPLATE_VARS: [&str; 4] = ["name", "amount", "event", "message"];

/// `manifest.json` のテキストを検証済みの [`EffectManifest`] にする。
///
/// ⚠ **`media` / `sound` のファイル名検証はここでは行わない**——拡張子の許可リストと
/// マジックバイト検査が一体なので、`service` 側にまとめてある（規則が 2 か所に割れないようにするため）。
pub fn parse_manifest(raw: &str) -> AppResult<EffectManifest> {
    // ⚠ BOM で始まる JSON は serde_json が読めない。テキストエディタが付けうるので剥がす
    //   （`overlay_theme::validate_css_body` が CSS の BOM を剥がしているのと同じ配慮）。
    let text = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);

    // ⚠⚠ **先に `schemaVersion` だけを見る 2 段構え。** 直接 `EffectManifest` へ落とすと、
    // 将来の版で増えたフィールドが `deny_unknown_fields` に先に落とされ、
    // 「内容が仕様と一致しません」としか言えない（＝「アプリを更新してください」と案内できない）。
    let value: Value = serde_json::from_str(text).map_err(|_| {
        // ⚠ serde のエラー文字列は入力の断片を含むので**載せない**（§9）。
        AppError::unsupported_file_type(
            "manifest.json を JSON として読み取れません。ファイルが壊れていないか確認してください。",
        )
    })?;
    match value.get("schemaVersion").and_then(Value::as_u64) {
        Some(v) if v == u64::from(SCHEMA_VERSION) => {}
        // ⚠ **新しい版だけ**「更新してください」と案内する。0 / 欠落 / 文字列 / 負数 / 小数は
        //   `as_u64()` が `None` を返すか 1 未満になるので、下の「不正な形式」へ落ちる
        //   （どちらも同じ文言にすると、ユーザーが取るべき行動が分からなくなる）。
        Some(v) if v > u64::from(SCHEMA_VERSION) => {
            return Err(AppError::unsupported_file_type(
                "このテンプレートは新しい形式です。StreamDock を更新してください。",
            ))
        }
        _ => {
            return Err(AppError::validation(
                "manifest.json の schemaVersion が正しくありません。",
            ))
        }
    }

    let mut manifest: EffectManifest = serde_json::from_value(value).map_err(|_| {
        // ⚠ ここも同じ理由で握り潰す。未知フィールド・型違い・必須欠落がすべてここへ合流する。
        AppError::validation(
            "manifest.json の内容が仕様と一致しません。項目名と値の種類を確認してください。",
        )
    })?;

    manifest.name = validate_name(&manifest.name)?;
    validate_duration(manifest.duration_ms)?;
    validate_layout(&manifest.layout)?;
    if let Some(text) = &manifest.text {
        validate_text(text)?;
    }
    Ok(manifest)
}

/// テンプレート名を検証して trim 済みの値を返す。
///
/// ⚠ 規則は `overlay_theme::validate_theme_name` と同じ（trim・空拒否・制御文字拒否・80 文字）。
/// ⚠ **bidi / format 文字（U+202E 等）は拒否していない。** 060b が `stripped_import_urls` で
/// それらを弾いたのは、あの文字列が**同意ダイアログ＝ユーザーの安全判断の材料**に出るからで、
/// テンプレート名は一覧に並ぶだけ（判断の材料にならない）。
/// **再修正トリガー＝テンプレート名が同意ダイアログのような安全判断の画面に出るようになったとき。**
fn validate_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    require_non_empty(
        name,
        "テンプレート名が空です。manifest.json の name を確認してください。",
    )?;
    reject_control_chars(
        name,
        "テンプレート名に制御文字は使用できません。manifest.json の name を確認してください。",
    )?;
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::validation(
            "テンプレート名が長すぎます。80 文字以内にしてください。",
        ));
    }
    Ok(name.to_string())
}

fn validate_duration(duration_ms: u32) -> AppResult<()> {
    if !(MIN_DURATION_MS..=MAX_DURATION_MS).contains(&duration_ms) {
        return Err(AppError::validation(
            "durationMs は 500〜15000 の範囲で指定してください。",
        ));
    }
    Ok(())
}

fn validate_layout(layout: &EffectLayout) -> AppResult<()> {
    if !(MIN_SIZE_PX..=MAX_WIDTH_PX).contains(&layout.width) {
        return Err(AppError::validation(
            "layout.width は 16〜1920 の範囲で指定してください。",
        ));
    }
    if !(MIN_SIZE_PX..=MAX_HEIGHT_PX).contains(&layout.height) {
        return Err(AppError::validation(
            "layout.height は 16〜1080 の範囲で指定してください。",
        ));
    }
    // ⚠ **`i32::abs` を使わない。** `i32::MIN.abs()` は debug ビルドでパニックする＝
    //   `"offsetX": -2147483648` と書いた manifest 1 つでアプリを落とせる（本モジュールは
    //   全経路を `AppResult` に落とす方針なので、パニック経路を作らない）。
    if layout.offset_x.unsigned_abs() > MAX_OFFSET_PX || layout.offset_y.unsigned_abs() > MAX_OFFSET_PX
    {
        return Err(AppError::validation(
            "layout.offsetX / offsetY は -4096〜4096 の範囲で指定してください。",
        ));
    }
    Ok(())
}

fn validate_text(text: &EffectText) -> AppResult<()> {
    if !(MIN_FONT_SIZE_PX..=MAX_FONT_SIZE_PX).contains(&text.font_size) {
        return Err(AppError::validation(
            "text.fontSize は 8〜128 の範囲で指定してください。",
        ));
    }
    validate_template_string(&text.template)?;
    validate_template_string(&text.template_without_amount)?;
    Ok(())
}

/// 差し込み文面 1 本を検証する（`text.template` と `text.templateWithoutAmount` の**両方**を通す）。
///
/// 規則:
/// - trim 後に空でない・200 文字以内・制御文字を含まない
/// - ⚠⚠ **`{` は必ず「既知の変数名 ＋ `}`」で閉じること。** `{` を見つけたら次の `}` までを読み、
///   その中身が [`ALLOWED_TEMPLATE_VARS`] のいずれかと**完全一致**でなければ拒否する。
///   帰結として `{{name}}` は拒否される（`{` の次の `}` までが `{name` になるため）。
/// - ⚠ 対応する `{` の無い `}` は**通す**（プレースホルダを開始するのは `{` だけなので、
///   ただの文字として扱って問題が無い）。
pub fn validate_template_string(raw: &str) -> AppResult<()> {
    let template = raw.trim();
    require_non_empty(template, "差し込み文面（text）が空です。")?;
    reject_control_chars(template, "差し込み文面（text）に制御文字は使用できません。")?;
    if template.chars().count() > MAX_TEMPLATE_CHARS {
        return Err(AppError::validation(
            "差し込み文面（text）が長すぎます。200 文字以内にしてください。",
        ));
    }

    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('}') else {
            return Err(AppError::validation(
                "差し込み文面（text）の { が閉じられていません。",
            ));
        };
        let name = &after[..close];
        if !ALLOWED_TEMPLATE_VARS.contains(&name) {
            // ⚠ **変数名を文言に載せない**（§9。第三者が書いた文字列をそのまま持ち帰らない）。
            return Err(AppError::validation(
                "差し込み文面（text）に使えない変数が含まれています。\
                 使えるのは {name} / {amount} / {event} / {message} だけです。",
            ));
        }
        rest = &after[close + 1..];
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! ⚠ この層は I/O をまったく持たないので、テストも**文字列 → 結果**だけで完結する。

    use super::*;
    use crate::effect_template::model::EffectAnchor;
    use crate::error::ErrorCode;

    /// 最小構成の正常な manifest（各テストはここから 1 か所だけ壊す）。
    fn valid_json() -> String {
        r#"{
            "schemaVersion": 1,
            "name": "きらきら",
            "media": "main.webm",
            "sound": "sound.wav",
            "durationMs": 5000,
            "layout": { "anchor": "center", "offsetX": 0, "offsetY": 0, "width": 640, "height": 360 },
            "text": { "template": "{name} さんが {amount}", "anchor": "bottom", "fontSize": 32 }
        }"#
        .to_string()
    }

    /// `valid_json()` の一部を 1 回だけ差し替える（差し替え対象が無ければテストの前提が壊れている）。
    fn tweak(from: &str, to: &str) -> String {
        let json = valid_json();
        assert!(json.contains(from), "テスト fixture に {from:?} が無い");
        json.replacen(from, to, 1)
    }

    #[test]
    fn a_valid_manifest_round_trips_every_field() {
        let manifest = match parse_manifest(&valid_json()) {
            Ok(m) => m,
            Err(e) => panic!("正常な manifest を拒否した: {e}"),
        };
        assert_eq!(manifest.schema_version, SCHEMA_VERSION);
        assert_eq!(manifest.name, "きらきら");
        assert_eq!(manifest.media, "main.webm");
        assert_eq!(manifest.sound.as_deref(), Some("sound.wav"));
        assert_eq!(manifest.duration_ms, 5000);
        assert_eq!(manifest.layout.anchor, EffectAnchor::Center);
        assert_eq!(manifest.layout.width, 640);
        let text = match &manifest.text {
            Some(t) => t,
            None => panic!("text が落ちている"),
        };
        assert_eq!(text.template, "{name} さんが {amount}");
        // ⚠ 省略時の既定が入ること（金額なし種別でも文が出る）。
        assert_eq!(text.template_without_amount, "{message}");
        assert_eq!(text.font_size, 32);
    }

    #[test]
    fn the_optional_fields_can_all_be_omitted() {
        let json = r#"{
            "schemaVersion": 1,
            "name": "最小",
            "media": "a.png",
            "durationMs": 1000,
            "layout": { "anchor": "top", "width": 100, "height": 100 }
        }"#;
        let manifest = match parse_manifest(json) {
            Ok(m) => m,
            Err(e) => panic!("最小構成を拒否した: {e}"),
        };
        assert_eq!(manifest.sound, None);
        assert_eq!(manifest.text, None);
        // offsetX / offsetY は省略できる（既定 0）。
        assert_eq!(manifest.layout.offset_x, 0);
        assert_eq!(manifest.layout.offset_y, 0);
    }

    #[test]
    fn a_leading_bom_does_not_break_the_parse() {
        // テキストエディタが付けうる。剥がさないと serde_json がそもそも読めない。
        let json = format!("\u{FEFF}{}", valid_json());
        assert!(parse_manifest(&json).is_ok());
    }

    // --- deny_unknown_fields ---------------------------------------------------------------------

    #[test]
    fn unknown_fields_are_refused_at_every_level() {
        // ⚠ 「タイポが黙って効かない」を防ぐのが目的。⚠ `sounds` は実害の具体例
        //   （黙殺すると「音が鳴らない原因が分からない」になる）。
        for bad in [
            r#""url": "https://evil.example/x.png","#,
            r#""sounds": "s.wav","#,
            r#""script": "alert(1)","#,
        ] {
            let json = tweak(
                r#""schemaVersion": 1,"#,
                &format!(r#""schemaVersion": 1,{bad}"#),
            );
            let err = match parse_manifest(&json) {
                Ok(_) => panic!("未知フィールドを通した: {bad}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::ValidationError, "{bad}");
        }
        // 入れ子（layout / text）でも同じこと。
        let json = tweak(r#""anchor": "center","#, r#""anchor": "center", "scale": 2,"#);
        assert!(parse_manifest(&json).is_err(), "layout の未知フィールドを通した");
        let json = tweak(
            r#""anchor": "bottom","#,
            r#""anchor": "bottom", "color": "white","#,
        );
        assert!(parse_manifest(&json).is_err(), "text の未知フィールドを通した");
    }

    #[test]
    fn errors_never_carry_the_manifest_contents_back_to_the_caller() {
        // ⚠ §9。serde_json の Display は `unknown field \`xyz\`` のように**入力を含む**ので、
        //   握り潰せていないとここで露見する。
        let marker = "SECRET-MARKER-9f2b";
        let json = tweak(
            r#""schemaVersion": 1,"#,
            &format!(r#""schemaVersion": 1, "{marker}": 1,"#),
        );
        let err = match parse_manifest(&json) {
            Ok(_) => panic!("未知フィールドを通した"),
            Err(e) => e,
        };
        let serialized = serde_json::to_string(&err).unwrap_or_default();
        assert!(
            !serialized.contains(marker),
            "エラーが入力を持ち帰っている: {serialized}"
        );
        assert!(!format!("{err:?}").contains(marker));
    }

    // --- schemaVersion ---------------------------------------------------------------------------

    #[test]
    fn only_the_known_schema_version_is_accepted_and_newer_ones_say_so() {
        assert!(parse_manifest(&valid_json()).is_ok());

        // ⚠⚠ 新しい版は**専用の文言**で断る（deny_unknown_fields に先に落とされていないこと）。
        //   未知フィールドを同時に混ぜても、schemaVersion の判定が先に立つ。
        let newer = tweak(
            r#""schemaVersion": 1,"#,
            r#""schemaVersion": 2, "scale": 2,"#,
        );
        let err = match parse_manifest(&newer) {
            Ok(_) => panic!("未知の schemaVersion を通した"),
            Err(e) => e,
        };
        assert_eq!(err.code, ErrorCode::UnsupportedFileType);
        assert!(
            err.message.contains("更新"),
            "新しい形式であることが案内されていない: {}",
            err.message
        );

        // 0 / 欠落 / 文字列 / 負数 / 小数は「不正な形式」。
        for bad in [
            r#""schemaVersion": 0,"#,
            r#""schemaVersion": "1","#,
            r#""schemaVersion": -1,"#,
            r#""schemaVersion": 1.5,"#,
            "",
        ] {
            let json = tweak(r#""schemaVersion": 1,"#, bad);
            let err = match parse_manifest(&json) {
                Ok(_) => panic!("不正な schemaVersion を通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::ValidationError, "{bad:?}");
        }
    }

    #[test]
    fn broken_json_is_reported_as_an_unreadable_file() {
        for bad in ["", "   ", "{", "not json", "[]", "null"] {
            assert!(parse_manifest(bad).is_err(), "壊れた JSON を通した: {bad:?}");
        }
    }

    // --- 範囲 ------------------------------------------------------------------------------------

    #[test]
    fn the_numeric_ranges_are_enforced_at_their_exact_boundaries() {
        // durationMs: 500 と 15000 は通り、499 と 15001 は落ちる。
        for (value, ok) in [(499u32, false), (500, true), (15_000, true), (15_001, false)] {
            let json = tweak(r#""durationMs": 5000,"#, &format!(r#""durationMs": {value},"#));
            assert_eq!(parse_manifest(&json).is_ok(), ok, "durationMs={value}");
        }
        // width: 16 と 1920 は通り、15 と 1921 は落ちる。
        for (value, ok) in [(15u32, false), (16, true), (1920, true), (1921, false)] {
            let json = tweak(r#""width": 640,"#, &format!(r#""width": {value},"#));
            assert_eq!(parse_manifest(&json).is_ok(), ok, "width={value}");
        }
        // height: 16 と 1080 は通り、15 と 1081 は落ちる。
        for (value, ok) in [(15u32, false), (16, true), (1080, true), (1081, false)] {
            let json = tweak(r#""height": 360 }"#, &format!(r#""height": {value} }}"#));
            assert_eq!(parse_manifest(&json).is_ok(), ok, "height={value}");
        }
        // offsetX: ±4096 は通り、±4097 は落ちる。
        // ⚠ i32::MIN は `abs()` がパニックする値なので必ず含める（`unsigned_abs` を使う理由）。
        for (value, ok) in [
            (i32::MIN, false),
            (-4097, false),
            (-4096, true),
            (4096, true),
            (4097, false),
        ] {
            let json = tweak(r#""offsetX": 0,"#, &format!(r#""offsetX": {value},"#));
            assert_eq!(parse_manifest(&json).is_ok(), ok, "offsetX={value}");
            let json = tweak(r#""offsetY": 0,"#, &format!(r#""offsetY": {value},"#));
            assert_eq!(parse_manifest(&json).is_ok(), ok, "offsetY={value}");
        }
        // fontSize: 8 と 128 は通り、7 と 129 は落ちる。
        for (value, ok) in [(7u32, false), (8, true), (128, true), (129, false)] {
            let json = tweak(r#""fontSize": 32"#, &format!(r#""fontSize": {value}"#));
            assert_eq!(parse_manifest(&json).is_ok(), ok, "fontSize={value}");
        }
    }

    #[test]
    fn the_anchor_is_a_closed_union_with_no_fallback() {
        for good in [
            "top-left",
            "top",
            "top-right",
            "left",
            "center",
            "right",
            "bottom-left",
            "bottom",
            "bottom-right",
        ] {
            let json = tweak(r#""anchor": "center","#, &format!(r#""anchor": "{good}","#));
            assert!(parse_manifest(&json).is_ok(), "正当な anchor を拒否した: {good}");
        }
        // ⚠ 未知の値を「中央へフォールバック」しない（fail-open な既定値を作らない）。
        for bad in ["middle", "TOP", "top_left", "", "centre"] {
            let json = tweak(r#""anchor": "center","#, &format!(r#""anchor": "{bad}","#));
            assert!(parse_manifest(&json).is_err(), "未知の anchor を通した: {bad:?}");
        }
    }

    // --- 名前 ------------------------------------------------------------------------------------

    #[test]
    fn template_names_are_trimmed_and_bounded() {
        let json = tweak(r#""name": "きらきら","#, r#""name": "  余白  ","#);
        assert_eq!(
            parse_manifest(&json).ok().map(|m| m.name),
            Some("余白".to_string())
        );

        let at_limit = "あ".repeat(MAX_NAME_CHARS);
        let json = tweak(r#""name": "きらきら","#, &format!(r#""name": "{at_limit}","#));
        assert!(parse_manifest(&json).is_ok(), "80 文字ちょうどを拒否した");

        let over = "あ".repeat(MAX_NAME_CHARS + 1);
        let json = tweak(r#""name": "きらきら","#, &format!(r#""name": "{over}","#));
        assert!(parse_manifest(&json).is_err(), "81 文字を通した");

        // 空・空白のみ・制御文字（JSON のエスケープで入れる）。
        // ⚠ U+0085 は JS の /[\x00-\x1F\x7F]/ では通るが `char::is_control` は弾く（Rust のほうが広い）。
        // ⚠ JSON のエスケープ列は**実行時に組む**。ソースへ実制御文字を直書きすると、
        //   JSON の構文エラーで落ちてしまい「制御文字を拒否した」の検査にならない。
        let with_control = |code: &str| format!("a{}u{code}b", "\\");
        for bad in [
            String::new(),
            "   ".to_string(),
            with_control("000A"), // 改行
            with_control("0000"), // NUL
            with_control("0085"), // ⚠ JS の /[\x00-\x1F\x7F]/ では通るが char::is_control は弾く
            with_control("007F"), // DEL
        ] {
            let json = tweak(r#""name": "きらきら","#, &format!(r#""name": "{bad}","#));
            assert!(parse_manifest(&json).is_err(), "不正な名前を通した: {bad:?}");
        }
    }

    // --- 差し込み変数 ------------------------------------------------------------------------------

    #[test]
    fn only_the_four_allowed_variables_can_appear_in_a_template() {
        for good in [
            "{name} さんが {amount}",
            "{event}: {name}",
            "{message}",
            "変数なしの固定文",
            "}閉じ括弧だけは文字として通る",
            "{name}{amount}{event}{message}",
        ] {
            assert!(
                validate_template_string(good).is_ok(),
                "正当な文面を拒否した: {good:?}"
            );
        }

        // ⚠⚠ **本文とアバターを狙う変数は必ず落ちる**（型でも渡せないが、ここでも落とす）。
        for bad in [
            "{text}", "{avatar}", "{ipaddr}", "{NAME}", "{ name }", "{name", "{{name}}", "{}",
        ] {
            let err = match validate_template_string(bad) {
                Ok(()) => panic!("使えない変数を通した: {bad:?}"),
                Err(e) => e,
            };
            assert_eq!(err.code, ErrorCode::ValidationError, "{bad:?}");
            // ⚠ 変数名を持ち帰らない（§9）。
            assert!(!err.message.contains("ipaddr"));
        }
    }

    #[test]
    fn both_template_slots_go_through_the_same_variable_check() {
        // ⚠ `templateWithoutAmount` だけ検査が抜ける形を作らない。
        let json = tweak(
            r#""template": "{name} さんが {amount}","#,
            r#""template": "{name}", "templateWithoutAmount": "{text}","#,
        );
        assert!(
            parse_manifest(&json).is_err(),
            "templateWithoutAmount の変数検査が効いていない"
        );
    }

    #[test]
    fn templates_are_bounded_and_reject_control_characters() {
        let at_limit = "あ".repeat(MAX_TEMPLATE_CHARS);
        assert!(
            validate_template_string(&at_limit).is_ok(),
            "200 文字ちょうどを拒否した"
        );
        assert!(validate_template_string(&"あ".repeat(MAX_TEMPLATE_CHARS + 1)).is_err());
        assert!(validate_template_string("").is_err());
        assert!(validate_template_string("   ").is_err());
        assert!(validate_template_string("a\u{0}b").is_err());
        assert!(validate_template_string("a\nb").is_err());
    }
}
