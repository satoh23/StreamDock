use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// 更新チェック 1 回あたりの上限時間。
///
/// ⚠ **これが無いとハングする**。`check()` の実体は reqwest の HTTP GET で、**reqwest は既定で
/// タイムアウトを持たない**。ネットワークが「切断」ではなく「繋がるが応答しない」状態
/// （キャプティブポータル・パケット落ち・SYN が落ちる）では `check()` が返らず、055c の UI が
/// 「確認中」から永久に戻らない——**panic を全部潰しても同じ事故になる**（invoke の Promise が
/// 永久未解決になるのと症状が同じ）。機内モードは即 fail するのでこの経路では再現しない。
///
/// 値の根拠: 取得対象は `latest.json` 1 本（1KB 前後）で、302 リダイレクト 1 回を含めても 15 秒は
/// 十分に緩い。チェックは起動時に自動で走るだけなので、遅い回線で稀に空振りしても実害が無い側に倒せる。
///
/// ⚠ **055d への申し送り（レビュー指摘で訂正・当初の記述は事実と逆だった）**: この値は
/// **`download()` には伝播しない**。`tauri-plugin-updater` 2.10.1 の `Updater::check()` は戻り値を
/// `Update { timeout: None, .. }` と**ハードコード**して組み立て（`updater.rs` の `Update` 構築部）、
/// `Update::download()` はその `self.timeout`（＝`None`）を見る。＝**DL 側は既定で無期限**。
/// したがって 055d の課題は「15 秒を引き継がせないこと」ではなく、**DL に別途上限を張ること**。
/// ただし `Update.timeout` は reqwest の**総**リクエスト時間なのでサイズ依存で値を決められない。
/// reqwest 自身が「サイズが事前に分からない場合は `read_timeout`（各 read でリセット）が適切」と
/// 明記しているので、055d は `configure_client` で `connect_timeout` + `read_timeout` を張る形を採ること
/// （`configure_client` は `Update` に**持ち越される**ので `download()` にも効く）。
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);

/// `check_app_update` の戻り値。JSON は camelCase。
///
/// ⚠ **`latest_version` / `notes` / `pub_date` は minisign 署名の対象外**。署名が守るのは
/// ダウンロードした実体（`.app.tar.gz` / `.exe`）のバイト列だけで、`latest.json` そのものは
/// 署名されていない。＝**表示側（055c / 055e）はこれらを HTML として解釈してはいけない**
/// （055e が `dangerouslySetInnerHTML` を使わず自前の最小マークダウンレンダラを書く決定はここで意味を持つ）。
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/features/app-update/bindings/")]
pub struct AppUpdateStatus {
    /// いま動いているバージョン（`tauri.conf.json` の `version`＝updater が実際に比較する値）。
    pub current_version: String,
    /// 更新があるか。**055c のバッジの出し分けはこれだけで決まる**。
    ///
    /// ⚠ `false` は「確認できて、更新が無かった」を意味する。「確認できなかった」は `Err(AppError)`
    /// （`code: UPDATE_CHECK_FAILED`）で返るので、055c はこの 2 つを別表示にできる。
    pub available: bool,
    /// 更新がある場合の新バージョン。
    #[ts(optional)]
    pub latest_version: Option<String>,
    /// `latest.json` の `notes`（＝`docs/release-notes/vX.Y.Z.md` の内容そのまま・マークダウン原文）。
    #[ts(optional)]
    pub notes: Option<String>,
    /// 公開日時（`latest.json` の `pub_date`・RFC3339 文字列のまま）。
    #[ts(optional)]
    pub pub_date: Option<String>,
}

/// `latest.json` の `pub_date` を **RFC3339 文字列のまま**取り出す。
///
/// `Update.date`（`time::OffsetDateTime`）を使うと `time` を直接依存に足すことになるので、
/// plugin がサーバ応答をそのまま持っている `raw_json` から抜く（§10・詳細は呼び出し側の注記）。
///
/// **キーが無い / 文字列でない / そもそもオブジェクトでない場合は `None` に劣化する**（panic しない）。
/// ⚠ この劣化は**静かに起きる**——`latest.json` のキー名が変わっても表示から日付が消えるだけで、
/// エラーにならない。実サーバとのキー名一致は publish 後の実機確認でしか検証できない
///（再修正トリガー＝実機で `pubDate` が `undefined` なら 055a の `make-latest-json.mjs` と突き合わせる）。
fn pub_date_from_raw(raw: &serde_json::Value) -> Option<String> {
    raw.get("pub_date")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
}

/// 055b: 公開リリースの `latest.json` を見て「更新があるか」だけを判定する読み取り専用コマンド。
///
/// **リポジトリ初の真の `async fn` コマンド**。既存の `#[tauri::command(async)]`（窓生成コマンド）は
/// 「同期 fn を tokio worker で走らせる」だけで本体は同期だったが、updater の Rust API は `.await` 必須で、
/// Tauri の async runtime 内なので `block_on` の逃げ道が無い。`#[tauri::command]` + `async fn` は Tauri が
/// `async_runtime::spawn` へ載せるため、返す Future は `Send` でなければならない。
///
/// **await をまたいで非 Send な値を持たない**: このコマンドは DB State（`Mutex<Connection>`）を取らないので
/// `MutexGuard` を `.await` 跨ぎで保持する余地が構造的に無い。引数は `AppHandle` のみ＝最小権限
/// （`extract_app_icon` と同じ思想）で、**frontend から URL もバージョンも受け取らない**（§3/§8）。
///
/// ⚠ **panic すると invoke の Promise が永久未解決になる**（`lib.rs` の `WINDOW_OPEN_LOCK` 周辺コメントが
/// 同じ罠を記録済み）。`unwrap` / `expect` を使わず、**ネットワーク到達不可 / エンドポイント 404
/// （＝まだ publish していない draft のとき）/ `latest.json` の JSON 破損 / 署名検証失敗**をすべて
/// `Err(AppError)` に落とす。**`available: false` に潰さない**（「更新なし」と「確認できなかった」は
/// 055c で別表示にするため区別が要る）。
///
/// ⚠ 生エラーを `AppError.message` に載せない（§9）。updater / reqwest のエラー文字列は
/// **エンドポイント URL を含む**ため、`map_err(|_| …)` でエラー値を束縛せずに捨てる
/// （詳細は `AppError::update_check_failed` の注記。この形は下の契約テストで機械的に固定している）。
#[tauri::command]
pub async fn check_app_update(app: AppHandle) -> AppResult<AppUpdateStatus> {
    // updater が比較するのと同じ源（`tauri.conf.json` の version）を返す。診断画面が表示する
    // アプリバージョンは `env!("CARGO_PKG_VERSION")`（＝Cargo.toml）で出どころが違うが、
    // 055a の `check-version-sync.mjs` が 5 箇所の一致を強制しているので実運用ではズレない。
    let current_version = app.package_info().version.to_string();

    // ⚠ `endpoints` / `pubkey` は `updater_builder()` が `tauri.conf.json` から読んだものをそのまま使う。
    // **`UpdaterBuilder::endpoints()` は呼ばない**（宛先はコンパイル時定数の 1 本だけ＝親 055 の egress 定義）。
    // 足すのはハング対策のタイムアウトだけ。
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|_| AppError::update_check_failed())?;

    let update = updater
        .check()
        .await
        .map_err(|_| AppError::update_check_failed())?;

    let Some(update) = update else {
        // `Ok(None)` ＝「確認できて、更新は無かった」。エラーに落とさない。
        return Ok(AppUpdateStatus {
            current_version,
            available: false,
            latest_version: None,
            notes: None,
            pub_date: None,
        });
    };

    // `Update.date` は `time::OffsetDateTime` で、文字列化するには `time` を**直接依存**に足す必要がある
    // （現在は plugin の推移依存なので `use time::…` は書けない）。`raw_json` は plugin が
    // `res.json::<serde_json::Value>()` した**サーバ応答そのもの**（`RemoteRelease` へのデシリアライズ前の値）
    // なので、そこから RFC3339 文字列のまま取り出して直接依存を増やさない（§10）。
    //
    // ⚠ 劣化は静かに起きる（キー名・型が違うとフィールドごと消える）。詳細は `pub_date_from_raw` の注記。
    let pub_date = pub_date_from_raw(&update.raw_json);

    Ok(AppUpdateStatus {
        current_version,
        available: true,
        latest_version: Some(update.version),
        notes: update.body,
        pub_date,
    })
}

#[cfg(test)]
mod check_command_contract {
    //! security-review が見る 4 つの不変条件を、**このファイルのソース自身**を読んで機械的に固定する。
    //!
    //! `lib.rs` の `pinned_overlay_contract` と同じ手口（`include_str!` でソースを文字列として読み、
    //! リテラルの有無を照合する）。`check_app_update` 本体は実ネットワークに出るため単体テスト不可で、
    //! updater をモックするには**テストのためだけに本番コードへ trait 抽象を足す**ことになるので採らない。
    //! 実挙動の担保は devtools 実測（404 / available:false / available:true / 応答しないネットワーク）に置き、
    //! ここでは「後から静かに壊せる」3 点だけを止める。
    //!
    //! ⚠ **自己ヒット対策を 2 段でかける**。`include_str!` は**このテストモジュール自身のソースも含む**ため、
    //! 素朴に書くと検索文字列が自分自身にヒットして判定が骨抜きになる（`pinned_overlay_contract` が
    //! 実際に踏んだ罠）。
    //! 1. **行コメントを除いてから照合する**（`code_only()`）。この検査を説明するコメントに needle を
    //!    書いても影響しない＝**コメントを書くことでガードが壊れる**という最悪の性質を消す。
    //! 2. needle は**実行時に `format!` で組む**（assert メッセージ等、コード行の文字列リテラルに
    //!    needle が現れるのを防ぐ二重の保険）。
    //!
    //! ⚠ **限界**: これは文字列検査であって型検査ではない。網羅性は無く、たとえば `AppError` を別経路で
    //! 組み立てて生エラーを載せる書き方までは止められない。再修正トリガー＝この検査をすり抜ける
    //! 事故が実際に起きたら、そのパターンをここへ足す（あるいは lint へ移す）。
    //!
    //! ⚠ **レビュー指摘で 4 点補強した**（いずれも「本体を削除する変異」では殺せていたが、
    //! **別の壊し方には無力**だったもの。補強前後で実際にミューテーションを回して確認済み）:
    //! - **行コメントを除いて照合するようにした**（上記 1.）。補強前は、この検査を説明するコメントに
    //!   needle を書いた瞬間にそのテストが**常に通るようになる**状態だった——実際、レビュー対応で
    //!   説明コメントを足したところ 3 つのガードが同時に骨抜きになり、ミューテーションで発覚した。
    //! - `keeps_the_hang_guard` の needle を `.timeout(` から**実引数まで含めた形**に変えた
    //!   （値だけ 1 時間などに書き換える変異を殺すため）。
    //! - `never_binds_the_raw_updater_error` の等値照合は `map_err` を全廃すると `0 == 0` で**空虚に通る**
    //!   （`match` で `Err(e) =>` と書く形）。下限本数の assert を足して塞いだ。
    //! - `has_no_panicking_unwrap_or_expect` はテスト名が「panic しない」を約束しているのに
    //!   unwrap / expect の 2 語しか見ていなかったので、panic 系マクロ 4 語を足した。
    //!   なお添字アクセス・整数除算までは見ていない（そこは lint の領分）。

    const SRC: &str = include_str!("commands.rs");

    /// `SRC` から**行コメントを除いた**もの。全テストはこちらを照合する。
    ///
    /// `include_str!` は自ファイル＝**この検査を説明するコメントそのもの**を含むため、素の `SRC` を
    /// 使うと「コメントを丁寧に書くほどガードが緩む」という逆立ちした性質を持つ。行頭が `//` の行を
    /// 落とすだけで、doc コメント（`///` / `//!`）も通常コメントもまとめて除ける。
    /// ブロックコメント（`/* */`）と行末コメントは対象外だが、このファイルでは使っていない。
    fn code_only() -> String {
        SRC.lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn does_not_override_endpoints_at_runtime() {
        // 宛先は `tauri.conf.json` の `plugins.updater.endpoints`（コンパイル時定数）だけを正とする。
        // 実行時に上書きできる経路を作らない＝フロントから宛先を差し替える余地をゼロに保つ（親 055 の egress 定義）。
        let needle = format!(".{}(", "endpoints");
        assert!(
            !code_only().contains(needle.as_str()),
            "UpdaterBuilder::endpoints() を呼んでいる（宛先は tauri.conf.json だけを正とすること）"
        );
    }

    #[test]
    fn has_no_panicking_unwrap_or_expect() {
        // `#[tauri::command] async fn` 内の panic は tokio タスクに握られ、**invoke の Promise が
        // 永久未解決**になる（055c の UI が「確認中」から戻らなくなる）。全経路を AppResult に落とす。
        let src = code_only();
        let unwrap = format!("{}()", "unwrap");
        let expect = format!(".{}(", "expect");
        assert!(!src.contains(unwrap.as_str()), "unwrap が混入している");
        assert!(!src.contains(expect.as_str()), "expect が混入している");
        // panic 系マクロも同じ結果（Promise 永久未解決）を招くので、テスト名の約束どおりまとめて止める。
        for name in ["panic", "todo", "unimplemented", "unreachable"] {
            let needle = format!("{name}{}", "!");
            assert!(
                !src.contains(needle.as_str()),
                "panic 系マクロが混入している: {name}"
            );
        }
    }

    #[test]
    fn keeps_the_hang_guard() {
        // reqwest は既定で無期限。タイムアウトが消えると「繋がるが応答しない」ネットワークで
        // panic ゼロのまま UI が固まる（CHECK_TIMEOUT の注記）。
        // ⚠ needle に**実引数まで**含めるのは、`.timeout(` だけだと「定数を残したまま値を 1 時間に
        // 書き換える」変異を素通しするため（消されるだけでなく、緩められることも防ぐ）。
        let needle = format!(".{}({})", "timeout", "CHECK_TIMEOUT");
        assert!(
            code_only().contains(needle.as_str()),
            "タイムアウト設定が消えている（応答しないネットワークで無限に待つ）"
        );
    }

    #[test]
    fn never_binds_the_raw_updater_error() {
        // updater / reqwest のエラー文字列は**エンドポイント URL を含む**（§9）。エラー値を束縛しなければ
        // そもそも文字列化して `AppError.message` へ載せようがない。すべての `map_err` が `|_|` であることを
        // 数で照合する（`|e|` が 1 つでも増えると本数がズレて落ちる）。
        let src = code_only();
        let all = format!("map_{}(", "err");
        let discarding = format!("map_{}(|_|", "err");
        let discarding_count = src.matches(discarding.as_str()).count();
        assert_eq!(
            src.matches(all.as_str()).count(),
            discarding_count,
            "エラー値を束縛している変換がある（生エラーには URL が含まれる・§9）"
        );
        // ⚠ 上の等値照合だけだと **全廃すると `0 == 0` で空虚に通る**
        //（`match … { Err(e) => return Err(AppError::internal(e.to_string())) }` の形）。
        // 現在の実呼び出しは 2 本（`build()` と `check()`）。055d で増えることはあっても減ることはない。
        assert!(
            discarding_count >= 2,
            "エラーを捨てる形が失われている（別経路で生エラーを文字列化していないか確認すること・§9）"
        );
    }
}

#[cfg(test)]
mod tests {
    //! 055b の**振る舞い**の仕様テスト（`check_command_contract` はソース文字列の契約、こちらは実挙動）。
    //!
    //! `check_app_update` 本体は実ネットワークに出るため単体テスト不可（updater をモックするには
    //! 本番コードに trait 抽象を足すことになるので採らない）。ネットワークに依存しない 2 つ——
    //! **frontend へ渡る JSON の形**と **`pub_date` の劣化**——だけをここで固定する。
    //!
    //! あるべき挙動（docs/tasks/055b / 055c 申し送り / docs/security.md §1・§9）:
    //! - JSON は camelCase。**省略可フィールドは `undefined` ではなく `null` で届く**
    //!   （`skip_serializing_if` を付けない＝リポジトリ全体の既存作法）。055c はここを truthy 判定で読む。
    //! - 「更新なし」は `available: false` で**返る**（エラーにしない）。
    //! - 応答にエンドポイント URL を一切含めない（§9。フィールド設計上そもそも入らないことの表明）。
    //! - `pub_date` はキー欠落・型違い・非オブジェクトのいずれでも **`None` に劣化**して壊れない。
    use super::*;

    fn to_json(status: &AppUpdateStatus) -> String {
        serde_json::to_string(status).unwrap_or_default()
    }

    fn no_update() -> AppUpdateStatus {
        AppUpdateStatus {
            current_version: "0.1.0".to_string(),
            available: false,
            latest_version: None,
            notes: None,
            pub_date: None,
        }
    }

    #[test]
    fn absent_fields_are_sent_as_null_not_omitted() {
        // ⚠ TS 型は `latestVersion?: string` だが、実際に届くのは `null`。
        // 055c が `!== undefined` で分岐すると「新バージョン: null」と表示される（レビュー Q-4）。
        let json = to_json(&no_update());
        assert!(json.contains("\"latestVersion\":null"), "実際の JSON: {json}");
        assert!(json.contains("\"notes\":null"), "実際の JSON: {json}");
        assert!(json.contains("\"pubDate\":null"), "実際の JSON: {json}");
    }

    #[test]
    fn no_update_is_a_normal_value_not_an_error() {
        // 「確認できて、更新が無かった」は available:false で返す（reject に潰さない）。
        let json = to_json(&no_update());
        assert!(json.contains("\"available\":false"));
        assert!(json.contains("\"currentVersion\":\"0.1.0\""));
    }

    #[test]
    fn update_available_carries_the_release_fields_in_camel_case() {
        let json = to_json(&AppUpdateStatus {
            current_version: "0.0.9".to_string(),
            available: true,
            latest_version: Some("0.1.0".to_string()),
            notes: Some("## 0.1.0".to_string()),
            pub_date: Some("2026-08-01T00:00:00Z".to_string()),
        });
        assert!(json.contains("\"available\":true"));
        assert!(json.contains("\"latestVersion\":\"0.1.0\""));
        assert!(json.contains("\"notes\":\"## 0.1.0\""));
        assert!(json.contains("\"pubDate\":\"2026-08-01T00:00:00Z\""));
        // snake_case が漏れていない（bindings と frontend が camelCase 前提）。
        assert!(!json.contains("latest_version"));
        assert!(!json.contains("pub_date"));
    }

    #[test]
    fn response_never_carries_the_endpoint() {
        // §9: 宛先は frontend に出さない。サーバ由来の文字列（notes）に URL が入っていても、
        // それは notes の中身であって、応答の構造が endpoint を運ぶことはない。
        let json = to_json(&no_update());
        for leak in ["http", "github", "latest.json", "://"] {
            assert!(!json.contains(leak), "応答に {leak:?} が含まれている: {json}");
        }
    }

    #[test]
    fn pub_date_is_taken_from_the_server_response_as_a_string() {
        let raw = serde_json::json!({ "version": "0.1.0", "pub_date": "2026-08-01T12:34:56Z" });
        assert_eq!(
            pub_date_from_raw(&raw),
            Some("2026-08-01T12:34:56Z".to_string())
        );
    }

    #[test]
    fn pub_date_degrades_to_none_when_the_server_shape_differs() {
        // キー欠落（`latest.json` の生成側がキー名を変えた等）。
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "version": "0.1.0" })), None);
        // 型が文字列でない（数値 / null / オブジェクト / 配列）。
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": 20260801 })), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": null })), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": { "a": 1 } })), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!({ "pub_date": ["x"] })), None);
        // そもそもオブジェクトでない応答。
        assert_eq!(pub_date_from_raw(&serde_json::json!("just a string")), None);
        assert_eq!(pub_date_from_raw(&serde_json::json!([1, 2, 3])), None);
        assert_eq!(pub_date_from_raw(&serde_json::Value::Null), None);
    }

    #[test]
    fn pub_date_keeps_the_server_string_verbatim() {
        // RFC3339 として妥当かの検証はしない（`time` を足さないため）。整形もしない＝原文のまま通す。
        let raw = serde_json::json!({ "pub_date": "not-a-date" });
        assert_eq!(pub_date_from_raw(&raw), Some("not-a-date".to_string()));
    }
}
