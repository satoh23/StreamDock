use rusqlite::{Connection, OptionalExtension};

use super::model::{Tool, ToolKind};

/// SELECT で取得する tools テーブルの全カラム（複数クエリで共有）。
const TOOL_COLUMNS: &str =
    "id, name, executable_path, description, icon_label, icon_png, kind, url, created_at, updated_at";

/// tools テーブルを作成する（存在すれば何もしない）。
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    // インデックスはここでは作らない。`kind` 列を後付け（ensure_column）してからでないと
    // 部分ユニークインデックス（WHERE kind = 'executable'）を張れないため、下で作成する。
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tools (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            executable_path TEXT NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            icon_label      TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );",
    )?;
    // 018: 既存 DB にも `icon_png`（nullable）を冪等に追加する。マイグレーション基盤が無いため
    // pragma で存在確認してから ADD COLUMN する共通ヘルパを使う（既存インストールでも落ちない）。
    crate::util::ensure_column(conn, "tools", "icon_png", "TEXT")?;
    // 023: 種別カラム。既存行は 'executable' 既定で埋まる（NOT NULL ＋ 定数 DEFAULT は SQLite で許容）。
    crate::util::ensure_column(conn, "tools", "kind", "TEXT NOT NULL DEFAULT 'executable'")?;
    // 023: url 種別用の URL（nullable。executable 種別では NULL）。
    crate::util::ensure_column(conn, "tools", "url", "TEXT")?;
    // 023: executable_path の重複防止を維持しつつ、url 種別（executable_path 空文字）の衝突を避けるため
    // 旧・全行 UNIQUE インデックスを撤去し、`kind = 'executable'` の部分ユニークインデックスへ移行する。
    // DROP IF EXISTS + CREATE IF NOT EXISTS で冪等（新規/既存/再起動いずれも最終状態は部分 index のみ）。
    conn.execute_batch(
        "DROP INDEX IF EXISTS idx_tools_executable_path;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_executable_path_executable
            ON tools(executable_path) WHERE kind = 'executable';",
    )?;
    // 032c-a: 内蔵コメントビューアを固定 id で冪等 seed する（既存なら何もしない＝毎起動安全）。
    // kind='internal'・executable_path 空・url NULL。部分ユニーク index（WHERE kind='executable'）の
    // 対象外なので executable_path 空でも衝突しない。id は PRIMARY KEY のため `INSERT OR IGNORE` が
    // `ON CONFLICT(id) DO NOTHING` 相当になる（name などをユーザーが後から変えても再 seed で上書きしない）。
    let now = crate::util::now_rfc3339();
    let icon = builtin_comment_viewer_icon();
    conn.execute(
        "INSERT OR IGNORE INTO tools
            (id, name, executable_path, description, icon_label, icon_png, kind, url, created_at, updated_at)
         VALUES ('builtin-comment-viewer', ?1, '', ?2, '', ?3, 'internal', NULL, ?4, ?4)",
        rusqlite::params![
            BUILTIN_COMMENT_VIEWER_NAME,
            BUILTIN_COMMENT_VIEWER_DESCRIPTION,
            icon,
            now
        ],
    )?;
    // 053: 既存インストールへの反映。**seed だけでは足りない**——`INSERT OR IGNORE` は既存行を一切
    // 触らないため、名前・説明・アイコンを後から足しても**すでに DB を持っているユーザーには永久に
    // 届かない**（このリポジトリにはマイグレーション基盤が無く、`ensure_column` と同じく「毎起動流す
    // 冪等な UPDATE」が唯一の手段）。
    //
    // 上書き方針を 2 本に分けているのは、**同じ行でも列によって「誰のもの」かが違う**ため:
    // - name / icon_png は**アプリのもの**。内蔵ツールは UI 上「表示名・種別は変更できません」と明示され
    //   入力欄も readOnly（`AddToolScreen.tsx`）なので、実装側が固定値で揃えるのが仕様どおり。
    // - description は**ユーザーのもの**。内蔵ツールでも編集可のまま残す既存判断があり
    //   （`AddToolScreen.tsx` の「説明だけは通常ツールと同様に編集可のまま」の注記）、毎起動上書きすると
    //   ユーザーが書き換えた説明が再起動のたびに消える。だから**空のときだけ**埋める。
    conn.execute(
        "UPDATE tools SET name = ?1, icon_png = ?2 WHERE id = 'builtin-comment-viewer'",
        rusqlite::params![BUILTIN_COMMENT_VIEWER_NAME, icon],
    )?;
    conn.execute(
        "UPDATE tools SET description = ?1
         WHERE id = 'builtin-comment-viewer' AND description = ''",
        rusqlite::params![BUILTIN_COMMENT_VIEWER_DESCRIPTION],
    )?;
    Ok(())
}

/// 053: 内蔵コメントビューアの表示名（StreamDock のサブブランド）。
///
/// ⚠ **機能名を先頭に置くこと**（`StreamDock 〜` の語順にしない）。サイドバーのツール行で名前に使える幅は
/// **約 82px しかない**——300px の列から `.sidebar` の左右 padding 48px・行の border/padding 22px・
/// アイコン 30px・「内蔵」バッジ約 36px・**編集/削除ボタン 52px（`opacity: 0` でも場所は占有する）**・
/// gap 30px を引いた残り。13px フォントなので**全角 6 文字強**で `text-overflow: ellipsis` に当たる。
/// つまり `StreamDock 〜` だと「StreamDo…」しか出ず何のツールか分からなくなる（実機で報告された）。
/// この語順なら「コメントビュ…」まで出て用が足りる。
///
/// フルネームが読めるのは ①ツール管理の行（`.info h4` は折り返し無しの `1fr` 列で全部出る）
/// ②サイドバーのホバー（`title={tool.name}`）③ツール追加ピッカー／プリセット作成／プレビューカード。
///
/// ⚠ ユーザーに見える同じ名前が **`lib.rs` の `open_comment_viewer_window` の `.title(...)`**（窓の
/// タイトルバー＝033a で窓内の `<h1>` を消して以来、窓に出る唯一の文言）と
/// `screens/add-tool/AddToolScreen.tsx`（内蔵ツール編集画面のフォールバック・説明文）にもあるので、
/// 変えるときは 3 箇所を揃えること。
/// なお `lib.rs` の**エラーメッセージ**（開けなかった/閉じられなかった）だけは「コメントビューア」のまま
/// にしている——あれは製品ではなく「窓」を指す文で、製品名を入れると
/// 「…for StreamDockを開けませんでした」と助詞が直結して読めなくなるため。
const BUILTIN_COMMENT_VIEWER_NAME: &str = "コメントビューア for StreamDock";

/// 053: ツール一覧の「説明」に出る紹介文。
///
/// 入力欄が `<input>`（1 行・改行不可・箇条書き不可）なので**1 行に収まる長さ**にする。表示側は
/// ツール一覧が全角 45〜55 文字/行、プレビューカードが 20〜25 文字/行で素直に折り返す。
/// 既存ツールの説明は体言止めの短句（「順番なしで並行起動」等）だが、ここは**依頼者の指定で
/// 意図的にキャッチコピー体**にしている（対応サイトと主要機能を一目で伝えるため）。
const BUILTIN_COMMENT_VIEWER_DESCRIPTION: &str =
    "YouTube & Twitch 同時配信対応。読み上げ・OBS表示・投げ銭管理・視聴者管理、すべてワンクリックで";

/// 053: 内蔵コメントビューアの一覧アイコン（`data:` 無しの base64 PNG）。
///
/// **外部ツールのアイコンとまったく同じ経路**（`tools.icon_png` → `iconDataUri` → `IconTile` の
/// `imageSrc`）に載せる。こうすると一覧・サイドバー・ツール追加ピッカー・プリセット作成 2 画面・
/// プレビューカードの**6 面すべてに frontend 無改変で反映される**（内蔵ツール専用の分岐や
/// アセット参照経路を新設しない）。未設定なら `toIconLetter` が name の先頭 1 文字を出す既存挙動。
///
/// 画像は 128px 角の PNG を同梱する（`tools/icon.rs` の `MAX_ICON_PX = 128` ＝抽出アイコンの上限と同値。
/// 一覧のタイルは実寸 28〜44px なので十分で、DB へ載る base64 も小さく保てる）。
/// `include_bytes!` でビルド時に焼き込むため、実行時のファイル読み込みも配布物への同梱も要らない。
/// `bundle.icon` は明示的なファイル配列なので、このファイルがアプリのバンドルアイコンに混ざることもない。
fn builtin_comment_viewer_icon() -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .encode(include_bytes!("../../icons/tool-comment-viewer.png"))
}

fn row_to_tool(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tool> {
    let kind: String = row.get("kind")?;
    Ok(Tool {
        id: row.get("id")?,
        name: row.get("name")?,
        executable_path: row.get("executable_path")?,
        description: row.get("description")?,
        icon_label: row.get("icon_label")?,
        icon_png: row.get("icon_png")?,
        // 未知値（前方互換）は executable に丸める。
        kind: ToolKind::from_str_lenient(&kind),
        url: row.get("url")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn insert(conn: &Connection, tool: &Tool) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO tools
            (id, name, executable_path, description, icon_label, icon_png, kind, url, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            tool.id,
            tool.name,
            tool.executable_path,
            tool.description,
            tool.icon_label,
            tool.icon_png,
            tool.kind.as_str(),
            tool.url,
            tool.created_at,
            tool.updated_at,
        ],
    )?;
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Tool>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TOOL_COLUMNS} FROM tools ORDER BY created_at ASC"
    ))?;
    let rows = stmt.query_map([], row_to_tool)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: &str) -> rusqlite::Result<Option<Tool>> {
    conn.query_row(
        &format!("SELECT {TOOL_COLUMNS} FROM tools WHERE id = ?1"),
        rusqlite::params![id],
        row_to_tool,
    )
    .optional()
}

/// executable_path が一致するツールを返す（重複チェック用）。
pub fn find_by_executable_path(
    conn: &Connection,
    executable_path: &str,
) -> rusqlite::Result<Option<Tool>> {
    conn.query_row(
        &format!("SELECT {TOOL_COLUMNS} FROM tools WHERE executable_path = ?1"),
        rusqlite::params![executable_path],
        row_to_tool,
    )
    .optional()
}

/// url が一致する url 種別ツールを返す（023 url 種別の重複チェック用）。
pub fn find_by_url(conn: &Connection, url: &str) -> rusqlite::Result<Option<Tool>> {
    conn.query_row(
        &format!("SELECT {TOOL_COLUMNS} FROM tools WHERE kind = 'url' AND url = ?1"),
        rusqlite::params![url],
        row_to_tool,
    )
    .optional()
}

pub fn update(conn: &Connection, tool: &Tool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tools SET
            name = ?2,
            executable_path = ?3,
            description = ?4,
            icon_label = ?5,
            icon_png = ?6,
            kind = ?7,
            url = ?8,
            updated_at = ?9
         WHERE id = ?1",
        rusqlite::params![
            tool.id,
            tool.name,
            tool.executable_path,
            tool.description,
            tool.icon_label,
            tool.icon_png,
            tool.kind.as_str(),
            tool.url,
            tool.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> rusqlite::Result<usize> {
    let affected = conn.execute("DELETE FROM tools WHERE id = ?1", rusqlite::params![id])?;
    Ok(affected)
}
