//! 038a: 視聴者メモリの検証・整形層。
//!
//! frontend の生値を信用せず、Rust 側で trim / 制御文字拒否を通してから repository に渡す
//! （docs/security.md §8）。エラーは既存 `AppError` 経由で DB パス等を露出しない。

use rusqlite::Connection;

use crate::comment_viewer::model::CommentViewDto;
use crate::error::{AppError, AppResult};
use crate::util::{now_rfc3339, reject_control_chars, require_non_empty};

use super::csv_import;
use super::model::{
    ListViewersInput, NewViewerComment, RecordResult, ViewerDetail, ViewerImportResult,
    ViewerRecord, ViewerSort,
};
use super::repository;

/// 1 件のコメントで受け取れる金額の上限（1 億）。**負値・`NaN` / `inf`・これを超える値はコメントごと弾く。**
///
/// ⚠⚠ **security-review S-1 への対処。** 上限が無いと `amount` が `viewer_comments.amount`（REAL）へ
/// そのまま入り、`currency = 'BITS'` の行の合計が `bits_amount`（**`ViewerRecord` では `u32`**）で
/// 読めなくなる ⇒ `list_viewers` / `get_viewer` が両方落ち、**視聴者一覧が丸ごと開けなくなる**。
///
/// 1 億にした根拠: 実データが到達しない値でありながら `u32::MAX`（約 42.9 億）の 1/42 なので、
/// 現実的な件数を足しても溢れない（065a の [`csv_import::MAX_IMPORTED_COUNT`] と同じ立て方）。
/// 実在する最大値との差も十分に大きい——YouTube のスパチャは 1 回 500 USD 相当が上限
/// （弱い通貨〔VND / IDR〕でも 1,300 万程度）、Twitch の 1 回のチアも 100 万 bits 程度である。
/// ⚠ **`superchat_amount`（`f64`）にとっても意味がある**——`NaN` / `inf` を弾くことで、
/// `serde_json` が非有限の `f64` を `null` に落として「型は `number` なのに値は `null`」になる事故も防ぐ。
///
/// ⚠⚠ **これは 2 層のうちの 1 層目でしかない。** `bits_amount` は SUM なので、1 件あたりが上限内でも
/// 件数が増えれば合計は溢れうる。2 層目＝`repository::row_to_viewer` の防御的な読み出し。
/// 【再修正トリガ】実在の配信で正当な金額が弾かれたら（＝ログに `record_comment` の失敗が並んだら）
/// この値を上げる。⚠ **`u32::MAX` に近づけないこと**（合計で溢れる）。
const MAX_COMMENT_AMOUNT: f64 = 100_000_000.0;

/// 受信済みコメントを 1 件記録する（視聴者 upsert＋集計＋過去コメント追加）。戻り値は 038c 判定（初見／久しぶり）。
///
/// `comment` は loopback WS で frontend が受信済みの値を Tauri コマンド経由で渡すだけ（新規の外部通信は
/// 発生しない）。同一コメント id の二重記録は repository 側の `INSERT OR IGNORE` で冪等に無視され、判定も
/// 肯定を返さない（`RecordResult{false,false}`）。
pub fn record_comment(
    conn: &Connection,
    comment: CommentViewDto,
    session_id: String,
) -> AppResult<RecordResult> {
    // session_id: 必須・制御文字拒否。
    let session_id = session_id.trim().to_string();
    require_non_empty(&session_id, "セッションIDは必須です")?;
    reject_control_chars(&session_id, "セッションIDに制御文字は使用できません")?;

    // コメント id / 投稿者 id: 安定キーとして必須・制御文字拒否。
    require_non_empty(&comment.id, "コメントIDは必須です")?;
    reject_control_chars(&comment.id, "コメントIDに制御文字は使用できません")?;
    let provider_user_id = comment.author.id.trim().to_string();
    require_non_empty(&provider_user_id, "投稿者IDは必須です")?;
    reject_control_chars(&provider_user_id, "投稿者IDに制御文字は使用できません")?;

    // 表示名・本文: trim のうえ制御文字を拒否（改行・NUL 等）。名前は空でも許容（provider 依存）。
    let name = comment.author.name.trim().to_string();
    reject_control_chars(&name, "投稿者名に制御文字は使用できません")?;
    // 【意図】§8 準拠で本文にも制御文字を拒否（単一行前提）。【修正不要理由】共有 util の reject_control_chars
    //   を全モジュールで統一／本文は SQL バインド・非ログ・React エスケープで実害小・MVP は単一行前提。
    // 【副作用】改行入りの正当コメント（複数行 YouTube スパチャ等）は記録から落ちる（表示は済み・集計のみ欠落）。
    // 【再修正トリガ】複数行の集計欠落が問題化したら text だけ「拒否」→「制御文字の除去(strip)」へ切替（Q2）。
    //
    // 【063e・穴 R の評価（レビュー S-3・2026-08-29）】チャンネルポイントの `user_input`（視聴者が
    //   報酬に添えたテキスト）もここを通るが、**チャンネルポイント固有の悪化は無い**と判断した。
    //   ①Twitch の報酬テキスト入力は単一行のテキストフィールド（200 文字上限）で、改行を入れる正規の
    //     導線が無い。②仮に落ちても、**ガチャの発火は frontend の effectTrigger 経路**なので回るし、
    //     コメント一覧にも出る——失われるのは視聴者メモリ／配信サマリーの集計行だけである。
    //   ⚠ したがって上の Q2（strip への切替）と同じ扱いで、**063e としては別タスク**とする。
    //   【再修正トリガ】改行入りの `user_input` が実際に届くと分かったら、Q2 を優先度付きで起票すること。
    let text = comment.text.trim().to_string();
    reject_control_chars(&text, "コメント本文に制御文字は使用できません")?;

    // published_at: 必須（集計の first/last・038c 判定に使う）。
    require_non_empty(&comment.published_at, "投稿日時が空です")?;

    let source = comment.source.as_str().to_string();
    let event_type = comment.event_type.as_str().to_string();
    let viewer_id = format!("{source}:{provider_user_id}");
    // ⚠⚠ **金額は範囲を検証する（レビュー指摘 S-1・多層防御の 1 層目）。**
    //   検証が無いと `m.amount` が f64 のまま `viewer_comments.amount` へ入り、`currency = 'BITS'` の
    //   行は `bits_amount`（**`ViewerRecord` では `u32`**）へ合計される。⇒ `u32` に収まらない値や
    //   **負値**が 1 件でも入ると `list_viewers` / `get_viewer` が両方 `StorageFailed` で落ち、
    //   **視聴者一覧が丸ごと開けなくなる**（実測: `amount = -1, currency = "BITS"` の 1 件で再現した）。
    //   記録側は成功扱いで返るので原因が見えず、一覧が開けないので UI からその行を消すこともできない。
    // ⚠ **`record_comment` はアプリ定義コマンド＝ACL 対象外**なので、値が sidecar 由来である保証は無い。
    // ⚠⚠ **この 1 層だけでは足りない**——`bits_amount` は SUM なので、上限内の値でも件数が増えれば
    //   合計は溢れうる。2 層目は `repository::row_to_viewer` の防御的な読み出しで、そちらが
    //   「**既に壊れた値が入っている DB を開けなくしない**」を担保する（片方だけにしないこと）。
    // ⚠ 0 で代替せず**コメントごと弾く**のは、065a の CSV 経路（数値のパース失敗は行ごとスキップ）と
    //   同じ規律である。金額を勝手に丸めると「投げてもらった額」が静かに嘘になる。
    let (amount, currency) = match &comment.monetary {
        Some(m) => {
            if !m.amount.is_finite() || m.amount < 0.0 || m.amount > MAX_COMMENT_AMOUNT {
                return Err(AppError::validation("金額の値が不正です"));
            }
            (Some(m.amount), Some(m.currency.clone()))
        }
        None => (None, None),
    };

    let new = NewViewerComment {
        comment_id: comment.id,
        viewer_id,
        session_id,
        provider: source.clone(),
        provider_user_id,
        name,
        source,
        text,
        event_type,
        amount,
        currency,
        monetary_amount: comment.monetary_amount,
        // 062a: レイド人数はそのまま通す（検証不要の整数・raid 以外は None）。⚠ ここを落とすと
        //   レイド行は保存されるのに人数だけ NULL になる（sidecar 側の中継 2 段と同じ性質の落とし穴）。
        raid_viewer_count: comment.raid_viewer_count,
        published_at: comment.published_at,
    };

    Ok(repository::record_comment(conn, &new)?)
}

/// 視聴者一覧を返す（検索・並び替えは任意）。
pub fn list(conn: &Connection, input: Option<ListViewersInput>) -> AppResult<Vec<ViewerRecord>> {
    let input = input.unwrap_or_default();
    // 検索語は trim し、空なら「絞り込みなし」に落とす。
    let search = input
        .search
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let sort = input.sort.unwrap_or(ViewerSort::LastComment);
    Ok(repository::list(conn, search.as_deref(), sort)?)
}

/// 視聴者の詳細（本人＋過去コメント）を返す。
pub fn get(conn: &Connection, id: &str) -> AppResult<ViewerDetail> {
    let viewer = repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("視聴者が見つかりません: {id}")))?;
    let comments = repository::list_comments(conn, id)?;
    Ok(ViewerDetail { viewer, comments })
}

/// 配信者メモを更新して更新後の視聴者を返す。
///
/// 【レビュー指摘 Q-9・本タスクでは修正しない】⚠ **ここには長さ上限が無い**。065a は CSV 経路にだけ
/// `MAX_NOTE_CHARS`（1,000 文字）を入れたので、**規律が経路間で非対称**になっている。
/// 非対称でよいと判断した理由: CSV は「ユーザーが選んだが中身を一切認識していないファイル」で 1 回の
/// 操作に最大 20,000 行が乗るのに対し、こちらは**1 件ずつ手で打つ値**なので入力の量と自覚が違う。
/// ⚠⚠ **ただし「手入力だから安全」ではない。** 本コマンドもアプリ定義コマンド＝ACL 対象外なので、
/// 窓の中のコードから数 MB の note を書き込めば **CSV 経路と同じ結末（一覧の描画が止まる）を作れる**。
/// 正確には「**同じ穴が 2 か所にあり、065a は自分が新設した側だけを塞いだ**」である。
/// 【再修正トリガ】038 側の既存課題として起票済み（task-board 065 節の「他タスクへ起票」）。着手時は
/// CSV 経路と**同じ上限値・同じ「切り詰めない」規律**に揃えること。⚠ 既に長い note が入っている DB の扱いも決める。
pub fn update_note(conn: &Connection, id: &str, note: String) -> AppResult<ViewerRecord> {
    // メモは trim ＋制御文字拒否（MVP は単一行想定。改行を許すなら別途方針を決める）。
    let note = note.trim().to_string();
    reject_control_chars(&note, "メモに制御文字は使用できません")?;
    let affected = repository::update_note(conn, id, &note, &now_rfc3339())?;
    if affected == 0 {
        return Err(AppError::not_found(format!("視聴者が見つかりません: {id}")));
    }
    repository::get(conn, id)?
        .ok_or_else(|| AppError::not_found(format!("視聴者が見つかりません: {id}")))
}

/// 視聴者を削除する（当該コメントも FK CASCADE で削除）。
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = repository::delete(conn, id)?;
    if affected == 0 {
        return Err(AppError::not_found(format!("視聴者が見つかりません: {id}")));
    }
    Ok(())
}

/// 全視聴者を削除する（プライバシー手段の全消去）。
pub fn clear(conn: &Connection) -> AppResult<()> {
    repository::clear(conn)?;
    Ok(())
}

// ---- 065a: 取り込み元コメントビューアーの公式 CSV からの引き継ぎ ----

/// 065a: 取り込み元 CSS ならぬ CSV の受け入れ規則（拡張子・上限・文言）。
///
/// ⚠⚠ **検証の 6 段とその順序は [`crate::util::validate_import_path`] の 1 か所にしかない**
/// （060b の `CSS_IMPORT_SPEC` と同じヘルパを通る）。とくに「**UNC 判定を拡張子より前に置く**」は
/// 060b security-review S-4 の要件で、順序が入れ替わっても**コンパイルもテストも通ってしまう**ため、
/// 経路ごとに書き写さない。
/// ⚠ 文言はすべてコンパイル時定数（パスも第三者データも 1 バイトも補間しない・§9）。
const CSV_IMPORT_SPEC: crate::util::ImportFileSpec = crate::util::ImportFileSpec {
    extension: "csv",
    max_bytes: csv_import::MAX_CSV_BYTES,
    msg_missing: "CSV ファイルが選択されていません",
    msg_control: "ファイルパスに制御文字は使用できません",
    msg_network: "ネットワーク上のファイルは取り込めません。ローカルにコピーしてから選んでください。",
    msg_extension: "CSV ファイル（.csv）を選んでください。",
    msg_not_found: "指定された CSV ファイルが見つかりません。",
    // ⚠ 「読む前に見つからない」と「読む段階で失敗した」を分ける（後者は権限変更・レース。
    //   「見つかりません」と言い切ると原因を誤って断定する）。理由は `ImportFileSpec::msg_read_failed`。
    msg_read_failed: "CSV ファイルを読み取れませんでした。",
    msg_not_a_file: "ファイルを選んでください。",
    msg_too_large: "CSV ファイルが大きすぎます。8MB 以内にしてください。",
    msg_not_utf8: "この CSV ファイルは UTF-8 として読み取れません。コメントビューアーが書き出したファイルか確認してください。",
};

/// 検証済みの取り込み元（読み終えた CSV の本文）。
pub struct CsvImportSource {
    text: String,
}

/// 取り込み元の `.csv` を検証して読む。
///
/// ⚠⚠ **DB ロックを取る前に呼ぶこと**（060b と同じ。security.md §5 の 060b 例外節が根拠）。
/// `path` はユーザーが dialog で選んだ場所＝**応答の遅いボリューム上にありうる**。ここを
/// `db.lock()` の内側で行うと、掴んだまま止まったときに**アプリ全体の DB コマンド（コメント記録・
/// プリセット起動・ログ）がまとめて止まる**。読み込みだけロックの外へ出せば、詰まるのはこの 1 本で済む。
///
/// ⚠ **読んだ内容は返さない**（返るのは検証済みの本文を持つ不透明な型で、コマンドは件数しか返さない）。
///
/// ⚠⚠ **「ロックの外で呼ぶ」はテストで守れない性質である。** 呼び出し順は
/// [`super::commands::import_viewer_memory_csv`] にしかなく、そこは `#[tauri::command]` なので単体テストが
/// 無い（`db.lock()` の内側へ移す変異はテストが 1 本もレッドにならない・060b も同じ状態）。
/// ⇒ **この doc コメントと、コマンド側の注記が唯一の防波堤**である。順序を動かすときは必ずここを読むこと。
pub fn read_import_csv(raw_path: &str) -> AppResult<CsvImportSource> {
    let path = crate::util::validate_import_path(raw_path, &CSV_IMPORT_SPEC)?;
    let text = crate::util::read_import_text(&path, &CSV_IMPORT_SPEC)?;
    Ok(CsvImportSource { text })
}

/// 読み終えた CSV を `viewers` へ取り込む（**DB ロックを取ってから**呼ぶ）。
///
/// ⚠ **全行を 1 トランザクションで処理する**（途中で失敗したら何も入らない）。
/// `unchecked_transaction` は `record_comment` と同じ作法で、本モジュールの全 command が単一
/// `Mutex<Connection>` で直列化されるため安全。
/// ⚠ この境界を踏むテストは `a_failure_on_a_later_row_rolls_back_the_rows_already_written` の**1 本だけ**
/// である（行数上限・必須列エラーはどちらもパース段階で落ちるので、トランザクションを開きすらしない）。
///
/// 【意図・レビュー指摘 S-3・修正不要】**最大 20,000 行の upsert ＋ 再計算を DB ロックを保持したまま
/// 行う**ので、その間はコメント記録・プリセット起動・ログがすべて止まる。それでも分割しないのは、
/// ①途中まで入った状態を残さない（引き継ぎは「全部入ったか、何も入らないか」であるべき）
/// ②1 トランザクション＝行ごとの fsync が無いので、実測 61 行では体感できない
/// ③行数に上限（[`csv_import::MAX_CSV_ROWS`]）があるので青天井にならない、の 3 点による。
/// ⚠ ただし**上限があるのは「行数」だけで、1 視聴者あたりのコメント数は青天井**である
/// （再計算は 1 人につき相関サブクエリ 12 本を走らせる）。⇒ 最悪ケースは「行数 × その人のコメント数」で伸びる。
/// 【再修正トリガ】実機で取り込み中に UI が固まると言われたら、**分割ではなく**
/// 「取り込み中フラグを立てて他コマンドへ即座に『取り込み中』を返す」を先に検討すること
/// （分割するとロールバック単位が壊れ、①が成立しなくなる）。
///
/// ⚠ **取り込み元のアプリへは一切接続しない。** ここがやるのは「既にディスク上にあるファイルを読んだ文字列」の
/// パースと upsert だけである（docs/security.md §5 の 065a 追補・⑪）。
pub fn import_csv(conn: &Connection, source: &CsvImportSource) -> AppResult<ViewerImportResult> {
    // ⚠ パースは DB を触る前に済ませる（必須列が無ければ 1 行も入れずにここで落ちる＝fail-closed）。
    let parsed = csv_import::parse(&source.text)?;
    let now = now_rfc3339();

    let tx = conn.unchecked_transaction()?;
    let mut result = ViewerImportResult {
        skipped_unsupported: parsed.skipped_unsupported,
        skipped_invalid: parsed.skipped_invalid,
        ..ViewerImportResult::default()
    };
    for viewer in &parsed.viewers {
        if repository::upsert_imported_viewer(&tx, viewer, &now)? {
            result.imported += 1;
        } else {
            result.updated += 1;
        }
    }
    tx.commit()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comment_viewer::model::{
        CommentAuthor, CommentEventType, CommentMonetaryDto, CommentSource, CommentViewDto,
    };
    use crate::error::ErrorCode;
    use rusqlite::Connection;

    /// テスト用 in-memory 接続（本番同様に foreign_keys=ON）。
    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        repository::init(&conn).unwrap();
        conn
    }

    /// 最小の受信 DTO（twitch / 通常チャット / 金額なし）。
    fn dto() -> CommentViewDto {
        CommentViewDto {
            id: "c1".to_string(),
            source: CommentSource::Twitch,
            author: CommentAuthor {
                id: "u1".to_string(),
                name: "Alice".to_string(),
                avatar: None,
            },
            text: "hello".to_string(),
            published_at: "2026-01-01T00:00:00Z".to_string(),
            event_type: CommentEventType::Chat,
            monetary_amount: None,
            monetary: None,
            month_count: None,
            gift_count: None,
            tier: None,
            combo_count: None,
            raid_viewer_count: None,
            // 063e 段 3: 報酬名（⚠ **Rust は 1 か所も読まない**——frontend の型を生成するために
            //   struct に居るだけである。`comment_viewer/model.rs` の注記が正）。
            reward_title: None,
        }
    }

    // 正常系: viewer_id を `source:providerUserId` で合成し、session_id を付けて記録する。
    #[test]
    fn records_and_composes_viewer_id() {
        let conn = test_conn();
        record_comment(&conn, dto(), "sess-1".to_string()).unwrap();
        let detail = get(&conn, "twitch:u1").unwrap();
        assert_eq!(detail.viewer.id, "twitch:u1");
        assert_eq!(detail.viewer.provider, "twitch");
        assert_eq!(detail.viewer.provider_user_id, "u1");
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].session_id, "sess-1");
    }

    // P6/P13: monetary から amount/currency を取り出し集計に反映する。
    #[test]
    fn extracts_monetary_into_superchat_aggregate() {
        let conn = test_conn();
        let mut d = dto();
        d.event_type = CommentEventType::Superchat;
        d.monetary = Some(CommentMonetaryDto { amount: 500.0, currency: "JPY".to_string() });
        d.monetary_amount = Some("500 JPY".to_string());
        record_comment(&conn, d, "s".to_string()).unwrap();
        let v = get(&conn, "twitch:u1").unwrap().viewer;
        assert_eq!(v.superchat_count, 1);
        assert_eq!(v.superchat_amount, 500.0);
        assert_eq!(v.superchat_currency.as_deref(), Some("JPY"));
    }

    // ⚠⚠ **security-review S-1 の回帰テスト（入口＝1 層目）。**
    //   範囲外の金額を通すと `bits_amount`（`u32`）が読めなくなり、**視聴者一覧が丸ごと開けなくなる**。
    //   ⚠ 記録側は成功扱いで返るので原因が見えず、一覧が開けないので UI から消すこともできない
    //     ——だから「記録の時点で弾く」のが唯一の入口側の防波堤である。
    #[test]
    fn an_out_of_range_amount_is_rejected_instead_of_breaking_the_viewer_list() {
        for bad in [
            -1.0,                        // ⚠ 実測で一覧を壊した最小ケース（1 件で成立する）
            5_000_000_000.0,             // u32::MAX 超え
            MAX_COMMENT_AMOUNT + 1.0,    // 上限のすぐ外
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ] {
            let conn = test_conn();
            let mut d = dto();
            d.event_type = CommentEventType::Superchat;
            d.monetary = Some(CommentMonetaryDto { amount: bad, currency: "BITS".to_string() });
            assert_eq!(
                record_comment(&conn, d, "s".to_string()).unwrap_err().code,
                ErrorCode::ValidationError,
                "金額 {bad} を通した"
            );
            // ⚠ 弾いたので行そのものが無く、一覧は当然開ける（0 件）。
            assert_eq!(list(&conn, None).expect("一覧が開けない").len(), 0, "金額 {bad}");
        }

        // 上限ちょうどは通る（過剰に弾いていないこと）＝一覧も開ける。
        let conn = test_conn();
        let mut d = dto();
        d.event_type = CommentEventType::Superchat;
        d.monetary = Some(CommentMonetaryDto {
            amount: MAX_COMMENT_AMOUNT,
            currency: "BITS".to_string(),
        });
        record_comment(&conn, d, "s".to_string()).expect("上限ちょうどは通るはず");
        let v = &list(&conn, None).expect("一覧が開けない")[0];
        assert_eq!(v.bits_amount, MAX_COMMENT_AMOUNT as u32);
    }

    // ⚠⚠ **security-review S-1 の回帰テスト（出口＝2 層目・「壊れた DB を救う」ほう）。**
    //   入口の検証が入る前に記録された DB や、上限内の値が積み上がって SUM が溢れた DB でも、
    //   **視聴者一覧が開けること**を固定する（開けないとユーザーはその行を消すことすらできない）。
    //   ⚠ ここは `record_comment` を通さず、壊れた値を直接書いて「既存 DB」を模す。
    #[test]
    fn an_already_broken_bits_amount_still_lets_the_viewer_list_open() {
        for broken in ["-1", "5000000000", "9223372036854775807"] {
            let conn = test_conn();
            record_comment(&conn, dto(), "s".to_string()).unwrap();
            conn.execute(
                &format!("UPDATE viewers SET bits_amount = {broken} WHERE id = 'twitch:u1'"),
                [],
            )
            .unwrap();

            // ⚠⚠ ここが `StorageFailed` になると、UI は一覧を出せず削除もできない。
            let viewers = list(&conn, None).unwrap_or_else(|e| {
                panic!("bits_amount = {broken} で一覧が開けない（{:?}）", e.code)
            });
            assert_eq!(viewers.len(), 1);
            let detail = get(&conn, "twitch:u1")
                .unwrap_or_else(|e| panic!("bits_amount = {broken} で詳細が開けない（{:?}）", e.code));
            // 丸めた値が入る（表示は不正確だが、開けて消せることを優先している）。
            let expected: u32 = if broken == "-1" { 0 } else { u32::MAX };
            assert_eq!(detail.viewer.bits_amount, expected);

            // ⚠ 一覧が開けるので、既存の削除手段でその行を消せる（復旧経路が生きていること）。
            delete(&conn, "twitch:u1").expect("壊れた行を削除できない");
        }
    }

    // P7: 空・空白のみの session_id は Validation で弾く（記録されない）。
    #[test]
    fn rejects_blank_session_id() {
        let conn = test_conn();
        let err = record_comment(&conn, dto(), "   ".to_string()).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert!(get(&conn, "twitch:u1").is_err());
    }

    // P7: 空の投稿者 ID は Validation で弾く。
    #[test]
    fn rejects_empty_author_id() {
        let conn = test_conn();
        let mut d = dto();
        d.author.id = "  ".to_string();
        assert_eq!(
            record_comment(&conn, d, "s".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // P7: 空の投稿日時は Validation で弾く。
    #[test]
    fn rejects_empty_published_at() {
        let conn = test_conn();
        let mut d = dto();
        d.published_at = "".to_string();
        assert_eq!(
            record_comment(&conn, d, "s".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // P7: 本文の制御文字（改行）は Validation で弾き、視聴者行も作られない。
    #[test]
    fn rejects_control_chars_in_text() {
        let conn = test_conn();
        let mut d = dto();
        d.text = "line1\nline2".to_string();
        assert_eq!(
            record_comment(&conn, d, "s".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
        assert!(get(&conn, "twitch:u1").is_err()); // not_found（未記録）
    }

    // P9: メモは trim して更新し、更新後 viewer を返す。
    #[test]
    fn update_note_trims_and_returns_updated() {
        let conn = test_conn();
        record_comment(&conn, dto(), "s".to_string()).unwrap();
        let v = update_note(&conn, "twitch:u1", "  常連さん  ".to_string()).unwrap();
        assert_eq!(v.note, "常連さん");
    }

    // P9: メモの制御文字（改行）は Validation で弾く（MVP 単一行前提）。
    #[test]
    fn update_note_rejects_newline() {
        let conn = test_conn();
        record_comment(&conn, dto(), "s".to_string()).unwrap();
        assert_eq!(
            update_note(&conn, "twitch:u1", "a\nb".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );
    }

    // ---- 062a: レイドを service 経由で通したときの仕様 ----

    // 062a: `CommentEventType::Raid` は `as_str()` で "raid"（serde の lowercase と一致＝wire の値と同じ）に
    //   なり、`raidViewerCount` が `viewer_comments.raid_viewer_count` まで届く。
    //   ⚠ ここが落ちるのは「Rust の語彙が wire とずれた」か「service が人数を渡し忘れた」ときだけ。
    #[test]
    fn raid_passes_through_service_with_viewer_count() {
        let conn = test_conn();
        let mut d = dto();
        d.id = "r1".to_string();
        d.author = CommentAuthor {
            // レイドの author は**レイド元の配信者**（mapper が raid.user_* を採る）。
            id: "raider".to_string(),
            name: "RaiderChannel".to_string(),
            avatar: None,
        };
        d.text = String::new();
        d.event_type = CommentEventType::Raid;
        d.raid_viewer_count = Some(42);
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        let detail = get(&conn, "twitch:raider").unwrap();
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].event_type, "raid", "wire と同じ綴りで保存される");
        assert_eq!(detail.comments[0].raid_viewer_count, Some(42));
        assert_eq!(detail.comments[0].amount, None, "レイドは金額を持たない");
        assert_eq!(detail.viewer.subscription_count, 0, "サブスク集計に混ざらない");
        assert!(!detail.viewer.is_member);
    }

    // 062a(§9): レイド元のアバター URL・system_message は wire にも DTO にも無いので、保存行のどこにも
    //   現れない。`CommentViewDto` に avatar は存在するが**視聴者メモリには元から保存しない**（038a）ため、
    //   仮に sidecar 側の判断が緩んで avatar が載っても DB へは漏れないことを併せて固定する。
    #[test]
    fn raid_row_carries_no_avatar_or_system_message() {
        let conn = test_conn();
        let mut d = dto();
        d.id = "r1".to_string();
        d.author = CommentAuthor {
            id: "raider".to_string(),
            name: "RaiderChannel".to_string(),
            // ⚠ わざと入れる（sidecar 側が緩んだ場合の多層防御を見る）。
            avatar: Some("https://static-cdn.jtvnw.net/raider.png".to_string()),
        };
        d.text = String::new();
        d.event_type = CommentEventType::Raid;
        d.raid_viewer_count = Some(42);
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        let saved = format!("{:?}", get(&conn, "twitch:raider").unwrap());
        assert!(!saved.contains("jtvnw"), "アバター取得元 URL は保存されない（§9）");
        assert!(!saved.contains("http"), "URL そのものが保存行に現れない");
    }

    // ---- 063e: チャンネルポイントを service 経由で通したときの仕様 ----

    // 063e: `CommentEventType::Channelpoint` は `as_str()` で "channelpoint"（serde の lowercase と一致＝
    //   wire の値と同じ）になり、**視聴者が添えたテキストが本文として保存される**。
    //   ⚠ ここが落ちるのは「Rust の語彙が wire とずれた」ときだけ。
    #[test]
    fn channel_point_redemption_passes_through_service_with_its_text() {
        let conn = test_conn();
        let mut d = dto();
        d.id = "cp1".to_string();
        d.author = CommentAuthor {
            // ⚠ チャンネルポイントの author は**引き換えた視聴者**（レイドと違い chatter 相当）。
            id: "u1".to_string(),
            name: "Alice".to_string(),
            avatar: None,
        };
        d.text = "がんばれー！".to_string();
        d.event_type = CommentEventType::Channelpoint;
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        let detail = get(&conn, "twitch:u1").unwrap();
        assert_eq!(detail.comments.len(), 1);
        assert_eq!(detail.comments[0].event_type, "channelpoint", "wire と同じ綴りで保存される");
        assert_eq!(detail.comments[0].text, "がんばれー！", "user_input が本文として残る");
        assert_eq!(detail.comments[0].amount, None, "チャンネルポイントは金額を持たない");
        assert_eq!(detail.viewer.subscription_count, 0, "サブスク集計に混ざらない");
        assert!(!detail.viewer.is_member);
    }

    // 063e: テキスト入力を求めない報酬は本文が空のまま保存される（空文字でも行は作る）。
    //   ⚠ 「配信画面に出さない」のは frontend（`CommentList.tsx`）の責務で、**記録は落とさない**。
    #[test]
    fn a_channel_point_redemption_without_user_input_is_still_recorded() {
        let conn = test_conn();
        let mut d = dto();
        d.id = "cp2".to_string();
        d.text = String::new();
        d.event_type = CommentEventType::Channelpoint;
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        let detail = get(&conn, "twitch:u1").unwrap();
        assert_eq!(detail.comments.len(), 1, "本文が空でも記録は残る");
        assert_eq!(detail.comments[0].text, "");
    }

    // ---- 043e: combo 更新を service 経由で通したときの仕様（§8 検証・非保存・削除手段の非退行）----

    /// 043e: Jewels コメント 1 件の受信 DTO（`combo_count` 付き）。
    fn jewels_dto(amount: f64, combo: Option<u32>) -> CommentViewDto {
        let mut d = dto();
        d.id = "g1".to_string();
        d.source = CommentSource::Youtube;
        d.event_type = CommentEventType::Jewels;
        d.text = "".to_string();
        d.monetary = Some(CommentMonetaryDto { amount, currency: "JEWELS".to_string() });
        d.monetary_amount = Some(format!("{amount} JEWELS"));
        d.combo_count = combo;
        d
    }

    // 043e: combo 更新は service 層（trim / 制御文字拒否）を通っても成立し、金額が置き換わる。
    //   行は増えず、combo_count は**端末に保存されない**（monthCount/giftCount/tier と同じ扱い＝§9）。
    #[test]
    fn jewels_combo_update_passes_through_service_and_does_not_persist_combo_count() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();
        let r = record_comment(&conn, jewels_dto(90.0, Some(3)), "sess-1".to_string()).unwrap();
        assert!(!r.first_time, "combo 更新で初見を再点灯させない");
        assert!(!r.long_absence);

        let detail = get(&conn, "youtube:u1").unwrap();
        assert_eq!(detail.comments.len(), 1, "combo は論理的に 1 ギフト＝1 行");
        assert_eq!(detail.comments[0].amount, Some(90.0), "最新の jewels 額へ置き換わる");
        assert_eq!(detail.comments[0].monetary_amount.as_deref(), Some("90 JEWELS"));
        assert_eq!(detail.viewer.total_comments, 1);
        // combo_count を保存する列は存在しない（保存項目を増やさない＝§9 の保存範囲は不変）。
        // 保存済み行の全列を文字列化しても combo の値（3）はどこにも現れない。
        let saved = format!("{:?}", detail.comments[0]);
        assert!(
            !saved.contains("combo"),
            "combo_count は端末保存しない（保存行に combo 由来の列が無いこと）"
        );
    }

    // 043e(§8): combo 更新の本文に制御文字が入っていたら service が弾き、**既存行は 1 バイトも変わらない**。
    //   frontend 由来の値が検証をすり抜けて既存レコードを壊さないことの担保（更新経路でも §8 が効く）。
    #[test]
    fn jewels_combo_update_with_control_chars_is_rejected_and_leaves_row_intact() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();

        let mut bad = jewels_dto(90.0, Some(3));
        bad.text = "combo!\nsecond line".to_string();
        assert_eq!(
            record_comment(&conn, bad, "sess-1".to_string()).unwrap_err().code,
            ErrorCode::ValidationError
        );

        let detail = get(&conn, "youtube:u1").unwrap();
        assert_eq!(detail.comments[0].amount, Some(30.0), "拒否された更新は金額も反映しない");
        assert_eq!(detail.comments[0].text, "", "本文も元のまま");
    }

    // 043e: combo 更新の本文は trim される（挿入経路と同じ整形が更新経路にも効く）。
    #[test]
    fn jewels_combo_update_trims_text() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();
        let mut d = jewels_dto(90.0, Some(3));
        d.text = "  combo!  ".to_string();
        record_comment(&conn, d, "sess-1".to_string()).unwrap();
        assert_eq!(get(&conn, "youtube:u1").unwrap().comments[0].text, "combo!");
    }

    // 043e: プライバシー手段の非退行。combo 更新を経た jewels 行も delete（FK CASCADE）で取り残しなく消える
    //   （security.md「削除手段は新テーブル・新列ゼロのため取り残しゼロで有効」の担保）。
    #[test]
    fn deleting_viewer_removes_combo_updated_jewels_comment() {
        let conn = test_conn();
        record_comment(&conn, jewels_dto(30.0, None), "sess-1".to_string()).unwrap();
        record_comment(&conn, jewels_dto(90.0, Some(3)), "sess-1".to_string()).unwrap();
        delete(&conn, "youtube:u1").unwrap();

        assert_eq!(get(&conn, "youtube:u1").unwrap_err().code, ErrorCode::NotFound);
        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM viewer_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0, "combo 更新済みのコメントも CASCADE で消える");
    }

    // ---- 065a: 取り込み元 CSV の取り込み（経路の通し）----
    //
    // ⚠⚠ **フィクスチャはすべて合成データ**（docs/security.md §9）。実物の CSV には第三者の
    //   視聴者 ID・表示名・メモが入るので**リポジトリに置かない**（`tests/fixtures/` にも置かない）。

    const CSV_HEADER: &str =
        "id,username,nickname,service,memo,nameHistory,interval,lcts,tc,tgc,amount,label,atdDays,atdLives\n";

    /// 引き継ぎ 1 人ぶんの CSV（`lcts` は既定で「昨日」相当の実測値の形）。
    fn csv_for(id: &str, name: &str, memo: &str, tc: u32, lcts: &str) -> String {
        format!(
            "{CSV_HEADER}{id},{name},,youtube,{memo},[],0,{lcts},{tc},2,160,,3,1\n"
        )
    }

    fn source(text: &str) -> CsvImportSource {
        CsvImportSource { text: text.to_string() }
    }

    fn import(conn: &Connection, text: &str) -> ViewerImportResult {
        import_csv(conn, &source(text)).expect("取り込めるはず")
    }

    // 新規に 1 人作れる。集計列には引き継ぎ値がそのまま入る（この視聴者は再計算が一度も走っていない）。
    #[test]
    fn imports_a_new_viewer_with_its_baseline_totals() {
        let conn = test_conn();
        let r = import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "ひとこと", 42, "2026-08-15T23:29:04.288Z"),
        );
        assert_eq!(r.imported, 1);
        assert_eq!(r.updated, 0);
        assert_eq!(r.skipped_unsupported, 0);
        assert_eq!(r.skipped_invalid, 0);

        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.total_comments, 42, "実測 0 ＋ 引き継ぎ 42");
        assert_eq!(v.gift_count, 2);
        assert_eq!(v.stream_count, 1);
        assert_eq!(v.active_days, 3);
        assert_eq!(v.imported_gift_amount, 160.0);
        assert_eq!(v.note, "ひとこと");
        assert_eq!(v.last_comment_at, "2026-08-15T23:29:04.288Z");
        assert_eq!(v.imported_at.as_deref().is_some(), true, "引き継ぎ由来だと判別できる");
        // ⚠ `viewer_comments` の行は 1 件も作らない（コメントを捏造しない）。
        let comments: i64 = conn
            .query_row("SELECT COUNT(*) FROM viewer_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(comments, 0);
    }

    // ⚠⚠ **冪等**。同じ CSV を 2 回取り込んでも `imported_*` は二重加算されない（上書きだから）。
    #[test]
    fn importing_the_same_csv_twice_does_not_double_count() {
        let conn = test_conn();
        let csv = csv_for("yt-UCtest0000000000000001", "@alpha", "", 42, "2026-08-15T23:29:04.288Z");
        assert_eq!(import(&conn, &csv).imported, 1);
        let second = import(&conn, &csv);
        assert_eq!(second.imported, 0, "2 回目は新規ではない");
        assert_eq!(second.updated, 1);

        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.imported_comments, 42, "84 になったら加算してしまっている");
        assert_eq!(v.total_comments, 42);
        assert_eq!(v.gift_count, 2);
        assert_eq!(v.active_days, 3);
    }

    // ⚠⚠ **本タスクの中心を経路の端から端まで通す**: 取り込み → コメント 1 件 → 累積が残る。
    #[test]
    fn imported_totals_survive_a_later_comment() {
        let conn = test_conn();
        import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "", 42, "2026-08-15T23:29:04.288Z"),
        );
        let mut d = dto();
        d.source = CommentSource::Youtube;
        d.author.id = "UCtest0000000000000001".to_string();
        d.author.name = "アルファ".to_string();
        d.published_at = "2026-08-16T10:00:00Z".to_string();
        let r = record_comment(&conn, d, "sess-1".to_string()).unwrap();
        assert!(!r.first_time, "⚠⚠ 引き継いだ常連さんに初見バッジを出さない（親 065 の主目的）");

        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.total_comments, 43, "42 ＋ 実測 1（0 や 1 に戻ったら加算が効いていない）");
        assert_eq!(v.name, "アルファ", "受信した表示名が @handle を置き換える");
    }

    // ⚠⚠ 実測コメントを持つ視聴者への再取り込みでも、集計が「実測 ＋ 引き継ぎ」で数え直される。
    //   ⚠ ここは `RECOMPUTE_VIEWER_AGGREGATES_SQL` を通る唯一の取り込み経路である（穴 J の分岐の片側）。
    #[test]
    fn re_importing_over_an_existing_viewer_recomputes_measured_plus_baseline() {
        let conn = test_conn();
        let mut d = dto();
        d.source = CommentSource::Youtube;
        d.author.id = "UCtest0000000000000001".to_string();
        d.published_at = "2026-08-16T10:00:00Z".to_string();
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "", 42, "2026-08-15T23:29:04.288Z"),
        );
        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.total_comments, 43, "実測 1 ＋ 引き継ぎ 42");
        assert_eq!(v.stream_count, 2, "実測 1 セッション ＋ 引き継ぎ 1");
        assert_eq!(
            v.last_comment_at, "2026-08-16T10:00:00Z",
            "⚠ 実測のほうが新しいので lcts では上書きしない（Rust が時刻を比較する）"
        );
    }

    // ⚠ `lcts` のほうが新しければ `last_comment_at` は前へ進む（取り込み元だけが観測した回のぶん）。
    #[test]
    fn a_newer_lcts_moves_the_last_comment_at_forward() {
        let conn = test_conn();
        let mut d = dto();
        d.source = CommentSource::Youtube;
        d.author.id = "UCtest0000000000000001".to_string();
        d.published_at = "2026-08-10T10:00:00Z".to_string();
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "", 42, "2026-08-15T23:29:04.288Z"),
        );
        assert_eq!(
            get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer.last_comment_at,
            "2026-08-15T23:29:04.288Z",
            "⚠ 再計算の MAX(published_at) で潰されたままになっていない"
        );
    }

    // ⚠⚠ **穴 D の教訓を新規コードで踏まないことの実証**（本タスクで最も見落としやすい退行）。
    //   `last_comment_at` はプラットフォーム由来で**オフセット付きが混ざりうる**のに対し、`lcts` は
    //   常に `Z` 形式である。SQL の `MAX()` や文字列比較で「新しいほう」を選ぶと**古いほうを選ぶ**。
    //   ここでは実測 `2026-08-15T20:00:00-08:00`（＝ 08-16 04:00 UTC・**lcts より新しい**）と
    //   lcts `2026-08-15T23:29:04.288Z` を突き合わせる。**辞書順だと lcts のほうが大きい**ので、
    //   比較を文字列に戻した瞬間にこのテストが落ちる。
    #[test]
    fn the_newer_timestamp_is_decided_by_parsing_not_by_string_comparison() {
        let conn = test_conn();
        let mut d = dto();
        d.source = CommentSource::Youtube;
        d.author.id = "UCtest0000000000000001".to_string();
        d.published_at = "2026-08-15T20:00:00-08:00".to_string(); // ＝ 2026-08-16T04:00:00Z
        record_comment(&conn, d, "sess-1".to_string()).unwrap();

        import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "", 42, "2026-08-15T23:29:04.288Z"),
        );
        assert_eq!(
            get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer.last_comment_at,
            "2026-08-15T20:00:00-08:00",
            "⚠⚠ 実測（08-16 04:00 UTC）のほうが新しいのに lcts で上書きした＝比較が辞書順に戻っている"
        );
    }

    // ⚠⚠ **非破壊マージ**。StreamDock 側で書いたメモも、受信で得た表示名も、CSV の空値で潰されない。
    #[test]
    fn the_merge_never_overwrites_what_the_streamer_already_has() {
        let conn = test_conn();
        let mut d = dto();
        d.source = CommentSource::Youtube;
        d.author.id = "UCtest0000000000000001".to_string();
        d.author.name = "アルファ".to_string(); // ← 受信で得た表示名
        record_comment(&conn, d, "sess-1".to_string()).unwrap();
        update_note(&conn, "youtube:UCtest0000000000000001", "常連さん".to_string()).unwrap();

        // CSV 側は memo が空で、username は `@handle`。
        import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "", 42, "2026-08-15T23:29:04.288Z"),
        );
        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.note, "常連さん", "⚠ 空の memo でメモを消してはいけない");
        assert_eq!(v.name, "アルファ", "⚠ 表示名を @handle へ退化させてはいけない");

        // 逆向き: StreamDock 側が空なら CSV の値が入る。
        import(
            &conn,
            &csv_for("yt-UCtest0000000000000002", "@beta", "CSV のメモ", 1, "2026-08-15T23:29:04.288Z"),
        );
        let fresh = get(&conn, "youtube:UCtest0000000000000002").unwrap().viewer;
        assert_eq!(fresh.note, "CSV のメモ");
        assert_eq!(fresh.name, "@beta", "StreamDock 側が空なら CSV の値で埋める");
    }

    /// `nickname` / `label` まで指定できる 1 行（上の `csv_for` は両方とも空にしてしまう）。
    fn csv_with_nickname_and_label(nickname: &str, label: &str, interval_ms: i64) -> String {
        format!(
            "{CSV_HEADER}yt-UCtest0000000000000001,@alpha,{nickname},youtube,,[],{interval_ms},\
             2026-08-15T23:29:04.288Z,42,2,160,{label},3,1\n"
        )
    }

    // ⚠⚠ **非破壊マージの残り 2 列（`nickname` / `label`）。**
    //   `the_merge_never_overwrites_what_the_streamer_already_has` は `name` / `note` しか見ておらず、
    //   ヘルパが両列を常に空文字で出していたため、**無条件上書きへ変える変異が生き残っていた**
    //   （レビューで実測）。065a の時点では書ける経路が取り込みしか無いので実害は無いが、
    //   065b が編集を足した瞬間に「テストは緑のまま規則が壊れている」状態になる。
    #[test]
    fn the_merge_protects_the_nickname_and_label_too() {
        let conn = test_conn();
        // 1 回目: StreamDock 側が空なので CSV の値が入る。
        import(&conn, &csv_with_nickname_and_label("アルファ", "😀", 0));
        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.nickname, "アルファ", "空なら CSV の値で埋める");
        assert_eq!(v.label, "😀");

        // 2 回目: 既に値があるので**別の CSV でも上書きしない**（無条件上書きならここで落ちる）。
        import(&conn, &csv_with_nickname_and_label("別のニック", "🔧", 0));
        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.nickname, "アルファ", "⚠ 既存の nickname を CSV で潰してはいけない");
        assert_eq!(v.label, "😀", "⚠ 既存の label を CSV で潰してはいけない");

        // 空の CSV 値でも消さない（非破壊マージのもう一方向）。
        import(&conn, &csv_with_nickname_and_label("", "", 0));
        let v = get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer;
        assert_eq!(v.nickname, "アルファ", "⚠ 空の CSV 値で消してはいけない");
        assert_eq!(v.label, "😀");
    }

    // ⚠ `imported_*` 7 列は**常に上書き**（冪等）。`importing_the_same_csv_twice_does_not_double_count` は
    //   `imported_comments` しか見ておらず、`imported_first_seen_at` を DO UPDATE から外す変異が
    //   生き残っていた（レビューで実測）。⇒ 取り込み直しで**推定初回来訪日が更新される**ことを固定する。
    #[test]
    fn re_importing_refreshes_the_estimated_first_seen_at() {
        let conn = test_conn();
        import(&conn, &csv_with_nickname_and_label("", "", 0));
        assert_eq!(
            get(&conn, "youtube:UCtest0000000000000001")
                .unwrap()
                .viewer
                .imported_first_seen_at
                .as_deref(),
            Some("2026-08-15T23:29:04.288Z"),
            "interval 0＝lcts と同値"
        );

        // 同じ人の CSV を interval 付きで取り直したら、推定値も追随する。
        import(&conn, &csv_with_nickname_and_label("", "", 75_000));
        assert_eq!(
            get(&conn, "youtube:UCtest0000000000000001")
                .unwrap()
                .viewer
                .imported_first_seen_at
                .as_deref(),
            Some("2026-08-15T23:27:49.288Z"),
            "⚠ imported_* は常に上書き（DO UPDATE から外れていると 1 回目の値が残る）"
        );
    }

    // ⚠ 必須列が欠けた CSV は **1 行も取り込まずエラー**（fail-closed）。
    #[test]
    fn a_csv_without_the_required_columns_imports_nothing() {
        let conn = test_conn();
        let broken = "id,username,service\nyt-UCtest0000000000000001,@alpha,youtube\n";
        assert!(import_csv(&conn, &source(broken)).is_err());
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM viewers", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0, "エラーなのに行が入っている");
    }

    // ⚠ 未対応サービス・壊れた行は件数で返り、**取り込まれない**（0 として入らない）。
    #[test]
    fn unsupported_and_invalid_rows_are_counted_not_imported() {
        let conn = test_conn();
        let csv = format!(
            "{CSV_HEADER}\
             yt-UCtest0000000000000001,@alpha,,youtube,,[],0,2026-08-15T23:29:04.288Z,42,2,160,,3,1\n\
             nico-lv0000001,@gamma,,niconico,,[],0,2026-08-15T23:29:04.288Z,5,0,0,,1,1\n\
             yt-UCtest0000000000000003,@delta,,youtube,,[],0,2026-08-15T23:29:04.288Z,,0,0,,1,1\n"
        );
        let r = import(&conn, &csv);
        assert_eq!(r.imported, 1);
        assert_eq!(r.skipped_unsupported, 1, "ニコ生は未対応");
        assert_eq!(r.skipped_invalid, 1, "tc が空欄の行");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM viewers", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1, "⚠ 壊れた行を 0 として取り込んでいない");
    }

    // ⚠⚠ **§9 の担保**: 戻り値に視聴者名・メモ・ID が 1 文字も含まれない。
    #[test]
    fn the_import_result_never_carries_viewer_identity() {
        let conn = test_conn();
        let r = import(
            &conn,
            &csv_for("yt-UCsecret000000000001", "@秘密のハンドル", "秘密のメモ", 42, "2026-08-15T23:29:04.288Z"),
        );
        let dumped = format!("{r:?}");
        for secret in ["UCsecret", "秘密のハンドル", "秘密のメモ", "youtube:"] {
            assert!(!dumped.contains(secret), "戻り値に個人データが載っている: {secret} / {dumped}");
        }
        // JSON にしても同じ（frontend へ渡る形で確認する）。
        let json = serde_json::to_string(&r).unwrap_or_default();
        for secret in ["UCsecret", "秘密のハンドル", "秘密のメモ"] {
            assert!(!json.contains(secret), "IPC に載る JSON へ個人データが漏れている: {json}");
        }
    }

    // ⚠ 取り込んだ視聴者も既存の削除手段でそのまま消える（§9・⑪。`viewers` の列だから取り残しゼロ）。
    #[test]
    fn imported_viewers_are_removed_by_the_existing_delete_paths() {
        let conn = test_conn();
        import(
            &conn,
            &csv_for("yt-UCtest0000000000000001", "@alpha", "ひとこと", 42, "2026-08-15T23:29:04.288Z"),
        );
        delete(&conn, "youtube:UCtest0000000000000001").unwrap();
        assert_eq!(
            get(&conn, "youtube:UCtest0000000000000001").unwrap_err().code,
            ErrorCode::NotFound
        );

        import(
            &conn,
            &csv_for("yt-UCtest0000000000000002", "@beta", "", 7, "2026-08-15T23:29:04.288Z"),
        );
        clear(&conn).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM viewers", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    // ⚠ 行数上限は**ファイル全体を拒否する**（切り詰めない）。
    //   ⚠⚠ **これはトランザクション境界のテストではない。** 行数上限は `csv_import::parse` の中で
    //     落ちるので、必須列エラーと同じく**そもそもトランザクションを開く前**に終わる
    //     （当初このコメントは「途中の行で落ちたら何も入らないことを確認する」と書いていたが誤りで、
    //      DB へ到達しない 2 本目の経路にすぎない）。本物の境界は次のテストが踏む。
    #[test]
    fn a_file_over_the_row_limit_imports_nothing() {
        let conn = test_conn();
        let row = "yt-UCtest0000000000000001,@a,,youtube,,[],0,2026-08-15T23:29:04.288Z,1,0,0,,1,1\n";
        let csv = format!("{CSV_HEADER}{}", row.repeat(csv_import::MAX_CSV_ROWS + 1));
        assert!(import_csv(&conn, &source(&csv)).is_err());
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM viewers", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    // ⚠⚠ **トランザクション境界の本体**: 2 行目の upsert が失敗したら、**1 行目も入らない**。
    //   `import_csv` から `unchecked_transaction` を外す（`&tx` を `conn` にする）変異は、
    //   ここだけがレッドになる——他のテストはすべてパース段階で落ちるため検知できない。
    //   ⚠ 失敗はテスト用トリガーで起こす（本番コードに失敗経路を作らずに境界だけを踏むため）。
    #[test]
    fn a_failure_on_a_later_row_rolls_back_the_rows_already_written() {
        let conn = test_conn();
        conn.execute_batch(
            "CREATE TRIGGER t_reject_second BEFORE INSERT ON viewers
             WHEN NEW.id = 'youtube:UCtest0000000000000002'
             BEGIN SELECT RAISE(ABORT, 'テスト用の失敗'); END;",
        )
        .expect("テスト用トリガーを作れない");

        let csv = format!(
            "{CSV_HEADER}\
             yt-UCtest0000000000000001,@alpha,,youtube,,[],0,2026-08-15T23:29:04.288Z,42,2,160,,3,1\n\
             yt-UCtest0000000000000002,@beta,,youtube,,[],0,2026-08-15T23:29:04.288Z,7,0,0,,1,1\n"
        );
        assert!(import_csv(&conn, &source(&csv)).is_err(), "2 行目で失敗するはず");

        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM viewers", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0, "⚠⚠ 1 行目だけ残っている＝トランザクションが効いていない");
    }

    // 経路の端まで（実ファイル → 検証 → 読み → 取り込み）。⚠ 合成データを一時ファイルへ書いて使う。
    #[test]
    fn reads_and_imports_a_real_file_end_to_end() {
        let dir = std::env::temp_dir()
            .join("stream-dock-viewer-csv-test")
            .join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).expect("一時ディレクトリを作れない");
        let path = dir.join("listeners.csv");
        std::fs::write(
            &path,
            csv_for("yt-UCtest0000000000000001", "@alpha", "ひとこと", 42, "2026-08-15T23:29:04.288Z"),
        )
        .expect("テスト用 CSV を書けない");

        let conn = test_conn();
        let source = read_import_csv(&path.to_string_lossy()).expect("読めるはず");
        let r = import_csv(&conn, &source).expect("取り込めるはず");
        assert_eq!(r.imported, 1);
        assert_eq!(
            get(&conn, "youtube:UCtest0000000000000001").unwrap().viewer.total_comments,
            42
        );

        // ⚠ 拡張子違いは読む前に拒否される（共有ヘルパが効いていること）。
        let txt = dir.join("listeners.txt");
        std::fs::write(&txt, "id\n").unwrap();
        assert!(read_import_csv(&txt.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // P8d/P9: 不在 id は get / update_note / delete いずれも not_found。
    #[test]
    fn absent_id_is_not_found() {
        let conn = test_conn();
        assert_eq!(get(&conn, "nope").unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(
            update_note(&conn, "nope", "x".to_string()).unwrap_err().code,
            ErrorCode::NotFound
        );
        assert_eq!(delete(&conn, "nope").unwrap_err().code, ErrorCode::NotFound);
    }
}
