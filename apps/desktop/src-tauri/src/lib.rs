mod app_logs;
mod comment_sidecar;
mod comment_viewer;
mod error;
mod preset_items;
mod presets;
mod process;
mod rakuraku;
mod tools;
mod util;

use std::collections::HashMap;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{
    AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

use comment_sidecar::CommentSidecarState;
use error::{AppError, AppResult};
use process::registry::{ManagedProcess, ProcessRegistry};
use rakuraku::model::LaunchResult;
use tools::commands::DbState;

/// 窓生成コマンド（viewer/overlay）の直列化ガード。窓生成コマンドの `(async)` 化（Windows の
/// 白画面デッドロック回避・`open_comment_viewer_window` の注記参照）でメインスレッドによる
/// 直列実行が失われるため、連打・並行呼び出しでの「同一 label 窓の二重生成試行 → 2 回目が
/// エラー表示」を防ぐ。label は別でも窓生成は稀な操作のため viewer/overlay で 1 本を共有する。
///
/// poison は `expect` せず `PoisonError::into_inner` で回復する（既存慣習「poison=expect panic」の
/// 意図的な例外）: `Mutex<()>` は保護すべきデータを持たず poison 継承に守る不変条件が無い一方、
/// `(async)` コマンド内の panic は tokio タスク内で握られ invoke Promise が永久未解決になるため、
/// poison を伝播すると以後の窓オープンが全て無応答化する。データ持ちの Mutex（db/registry/sidecar）は
/// 従来どおり poison=`expect` を維持する。
static WINDOW_OPEN_LOCK: Mutex<()> = Mutex::new(());

/// 021: カスタムタイトルバーの出し分け（macOS=信号機回避の左余白 / Windows=自作制御ボタン）に使う
/// ホスト OS 名。ユーザー入力を取らず固定文字列（"macos"/"windows"/"linux" 等）を返すのみ。
#[tauri::command]
fn host_os() -> &'static str {
    std::env::consts::OS
}

/// 032c-a: 内蔵コメントビューアを別ウィンドウ（label `comment-viewer`）で開く。単一目的コマンド（§3）で、
/// ウィンドウ生成の汎用権限を frontend に露出しない。単一インスタンスガード＝既に開いていれば前面化し、
/// 無ければ生成する。内蔵ツール（`ToolKind::Internal`）の launch dispatch（両経路）からも呼ぶ。
/// shell/spawn/ファイル操作を伴わず、アプリ内ウィンドウを開くのみ（§2/§3）。capability は
/// `capabilities/comment-viewer.json`（最小権限・`main` 不変）に閉じる。
///
/// `(async)`: 同期コマンドはメインスレッドで実行されるが、Windows では窓生成（WebView2 の生成）の
/// 完了通知がメインスレッドのメッセージループ経由で届くため、ループを止めたまま完了を待つ相互待ち＝
/// デッドロックになる（白画面・応答なし。wry#583・`WebviewWindowBuilder` doc の Known issues）。
/// `(async)` で tauri async runtime（`async_runtime::spawn`・tokio worker）上の実行に逃がし、
/// メインスレッドのループを止めない。専用ブロッキングプール（`spawn_blocking`）ではなく core worker を
/// 窓生成完了まで同期ブロックするが、窓生成は稀・短時間のため許容する（worker 数は既定で CPU コア数）。
#[tauri::command(async)]
fn open_comment_viewer_window(app: AppHandle) -> AppResult<()> {
    // (async) 化でメインスレッド直列実行による自然な直列化が失われるため、連打・並行呼び出しでの
    // 同一 label 窓の二重生成試行（2 回目がエラー表示になる）をガードで防ぐ（overlay と共有）。
    // poison 回復の理由は WINDOW_OPEN_LOCK の注記を参照。
    //
    // ガード保持は ensure_started（keychain 読取を含む・未署名 dev ビルドの macOS は確認ダイアログ待ちが
    // あり得る）と build()（メインスレッドへの dispatch 完了待ち）を跨ぐが、従来は同じ待ちがメイン
    // スレッド上で起き UI 全体が固まっていたため退行ではない（main は応答維持・後続の窓オープンが
    // ロック待ちになるだけ）。再修正トリガー: 署名済み配布でもロック待ちの長時間化が問題になったら
    // keychain 読取（token_vault::load）をガード外へ出すことを検討する。
    let _guard = WINDOW_OPEN_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    // 032c-b: コメントビューアを開くとき、Twitch コメント取得 sidecar を起動する（多重起動しない）。
    // インターネットは sidecar 内に封じ込め、main ウィンドウは no-internet を維持する。
    comment_sidecar::ensure_started(&app)?;

    // 既に開いていれば多重生成せず前面化して再利用する。
    if let Some(window) = app.get_webview_window("comment-viewer") {
        // show() の戻り値は意図的に破棄する（`let _`）: 直後の set_focus() が失敗時にエラーを返すため
        // 前面化の可否はそちらで担保でき、show() 単体の失敗（既に可視・最小化復帰失敗等）は実害が小さい。
        // 再検討条件: 最小化からの復帰失敗をユーザーへ明示する必要が出た場合は show() の結果もハンドルする。
        let _ = window.show();
        window
            .set_focus()
            .map_err(|_| AppError::launch_failed("コメントビューアを前面に表示できませんでした"))?;
        return Ok(());
    }
    // 同一 Vite バンドルを読み込み、frontend 側は `getCurrentWindow().label` で描画を分岐する。
    let window =
        WebviewWindowBuilder::new(&app, "comment-viewer", WebviewUrl::App("index.html".into()))
            .title("コメントビューア")
            .inner_size(960.0, 720.0)
            .min_inner_size(560.0, 520.0)
            .build()
            .map_err(|_| AppError::launch_failed("コメントビューアを開けませんでした"))?;

    // 032c-b: no-orphan 3 段 kill の①。viewer 窓が閉じたら sidecar を停止する（idempotent）。
    let app_for_event = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            comment_sidecar::shutdown(&app_for_event);
        }
        _ => {}
    });
    Ok(())
}

/// 033f: コメント一覧を OBS へ載せるための**背景透過オーバーレイ窓**（label `comment-overlay`）を開く。
/// 単一目的コマンド（§3）で、任意ラベル・任意オプションの窓生成は露出しない。単一インスタンスガード＝
/// 既に開いていれば再利用し、無ければ透過・フレームレス・**最背面**で生成する。
///
/// **配信者の画面に前面表示しない**（033f 追修正）: `.always_on_bottom(true)` で常に他ウィンドウの後ろへ置き、
/// `.focused(false)` で開くときに前面フォーカスを奪わない。OBS の「ウィンドウキャプチャ」は背後に隠れた
/// （occluded）窓もライブ取り込みできるため、最前面に浮かせなくてもコメントは OBS に反映される（macOS で
/// 最小化・別 Space・完全画面外にするとキャプチャが凍結しやすいため、最背面に留めるのが堅実）。
///
/// **表示専用**: `open_comment_viewer_window` と異なり sidecar には一切触れない
/// （`comment_sidecar::ensure_started` を呼ばない／窓イベントで `comment_sidecar::shutdown` を登録しない）。
/// sidecar の起動・停止契機はコメビュ窓の既存イベントに集約したまま＝no-orphan 3 段 kill を壊さない
/// （オーバーレイの close で sidecar を落とさない）。sidecar 未起動時はオーバーレイの loopback WS が接続待ちに
/// なりコメント 0 件表示になるだけで副作用は無い。capability は `capabilities/comment-overlay.json`
/// （最小権限・`main`/`comment-viewer` 不変）に閉じる。macOS の透過描画には tauri.conf の `macOSPrivateApi` と
/// Cargo の `tauri/macos-private-api` feature が要る（`.transparent()` は macOS でこの feature でのみコンパイルされる）。
///
/// `(async)`: 窓生成を伴うため viewer と同じ理由で必須（Windows の白画面デッドロック回避。
/// 詳細は `open_comment_viewer_window` の注記）。
#[tauri::command(async)]
fn open_comment_overlay_window(app: AppHandle) -> AppResult<()> {
    // 二重生成試行ガード（viewer と共有）。poison 回復の理由は WINDOW_OPEN_LOCK の注記、
    // 保持範囲の考え方は `open_comment_viewer_window` の注記を参照。
    let _guard = WINDOW_OPEN_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    // 既に開いていれば多重生成せず再利用する。最背面窓を前面へ引き上げてちらつかせないよう、
    // set_focus はせず show のみ（既に可視なら実質 no-op）。
    if let Some(window) = app.get_webview_window("comment-overlay") {
        let _ = window.show();
        return Ok(());
    }
    // 同一 Vite バンドルを読み込み、frontend は `getCurrentWindow().label` で OverlayApp を描画する。
    // 透過・装飾なし・最背面・非フォーカス・影なし（配信者の画面に前面表示せず OBS 取り込みだけに使うため）。
    //
    // 033f 追修正②: 最背面・非フォーカスだと webview が「非アクティブ」扱いになり、WKWebView の既定
    // inactive scheduling ポリシー（＝タスクを完全 suspend）が効いて「初回描画が接続まで出ない／コメント反映が
    // 大幅に遅れる」不具合が出る。`background_throttling(Disabled)` で非アクティブ窓でも throttle/suspend させず、
    // 即描画＋リアルタイム反映にする（wry は macOS 14+/iOS 17+ で `inactiveSchedulingPolicy` に反映・本機は 14.6）。
    let _window =
        WebviewWindowBuilder::new(&app, "comment-overlay", WebviewUrl::App("index.html".into()))
            .title("StreamDock コメントオーバーレイ")
            .transparent(true)
            .decorations(false)
            .always_on_bottom(true)
            .focused(false)
            .shadow(false)
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .position(24.0, 48.0)
            .inner_size(400.0, 720.0)
            .min_inner_size(240.0, 320.0)
            .build()
            .map_err(|_| AppError::launch_failed("オーバーレイを開けませんでした"))?;
    // 意図的に window イベントを登録しない: オーバーレイは sidecar を起動/停止しないため、
    // close 時の shutdown 連動（open_comment_viewer_window の 64-71）は付けない。
    Ok(())
}

/// 033f 追修正: OBS 用の背景透過オーバーレイ窓（label `comment-overlay`）を閉じる。コメビュ本体の「閉じる」用。
/// 最背面・非フォーカスで開くため Cmd+W で掴みにくく、コメビュ本体から明示的に閉じられるよう用意する。
/// 単一目的コマンド（§3）で、任意ラベルの窓操作は露出しない。窓が無ければ no-op（冪等）。オーバーレイは
/// sidecar を起動していないため `.close()` に shutdown 連動は無く、PID kill・プロセス名 kill も行わず自アプリの
/// ウィンドウを閉じるのみ（§6 の PID kill はそもそも発生せず・no-orphan kill 契機は不変）。
#[tauri::command]
fn close_comment_overlay_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("comment-overlay") {
        window
            .close()
            .map_err(|_| AppError::launch_failed("オーバーレイを閉じられませんでした"))?;
    }
    Ok(())
}

/// 033e: 内蔵コメントビューア窓（label `comment-viewer`）を閉じる。ツール管理の「停止」ボタン用。
/// 単一目的コマンド（§3）で、任意ラベルの窓操作は露出しない。窓が無ければ no-op（冪等）。
/// `.close()` は既存の `CloseRequested | Destroyed` イベント経由で sidecar shutdown も連動する
/// （`open_comment_viewer_window` の 64-71・032c-b）。PID kill・プロセス名 kill は一切行わず、
/// 自アプリのウィンドウを閉じるのみ（§6 の PID kill はそもそも発生しない）。
#[tauri::command]
fn close_comment_viewer_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("comment-viewer") {
        window
            .close()
            .map_err(|_| AppError::launch_failed("コメントビューアを閉じられませんでした"))?;
    }
    Ok(())
}

/// 033e: 内蔵コメントビューア窓が開いているかを返す読み取り専用コマンド（§3・単一目的）。
/// ツール管理（`MainScreen` の reconcile）が窓の開閉から internal 行の起動状態を導出するために使う。
/// PID registry には載せず、窓の存在（`get_webview_window("comment-viewer").is_some()`）だけを見る。
#[tauri::command]
fn is_comment_viewer_open(app: AppHandle) -> bool {
    app.get_webview_window("comment-viewer").is_some()
}

/// 034d: OBS オーバーレイ窓が開いているかを返す読み取り専用コマンド（`is_comment_viewer_open` を手本）。
/// 設定ビューの開閉トグルが初期同期・外部close後の再同期に使う。窓の存在だけを見る（副作用なし）。
#[tauri::command]
fn is_comment_overlay_open(app: AppHandle) -> bool {
    app.get_webview_window("comment-overlay").is_some()
}

/// 032c-b: viewer が接続する Twitch コメント WS の実ポートを返す読み取り専用コマンド（§3・単一目的）。
/// sidecar が bind した実ポート（既定 17331・使用中なら空きポート）を返す。未確定なら `None`。
/// frontend からは raw なパス/ポート/コマンドを受け取らない（ポートは Rust が sidecar の stdout から受領）。
#[tauri::command]
fn get_comment_stream_port(app: AppHandle) -> Option<u16> {
    comment_sidecar::port(&app)
}

/// 032c-c: コメントビューアの VOICEVOX 読み上げ用に、**ツール管理に登録済みの VOICEVOX** を
/// 管理付き spawn（resolve→spawn→register）で起動する薄いコマンド。`rakuraku_launch_component` と
/// 同経路で、frontend は raw なパス/ポートを渡さず、登録済みツールを exe 名一致で解決する
/// （OS 別: macOS=`VOICEVOX.app` / Windows=`VOICEVOX.exe`）。未登録なら `launched=false` で登録を案内する
/// （誘導のみ・絶対パス直起動しない）。起動プロセスは PID registry に登録され停止/監視の対象になる（§6）。
/// ENGINE への合成 HTTP（127.0.0.1:50021）は viewer webview の fetch が担い、本コマンドは起動のみを行う。
#[tauri::command]
fn launch_voicevox_engine(
    db: State<'_, DbState>,
    registry: State<'_, ProcessRegistry>,
) -> AppResult<LaunchResult> {
    // 登録済みツールを list で取得する（DB ロックは list 取得だけで解放）。
    let tools = {
        let conn = db.lock().expect("db mutex poisoned");
        tools::service::list(&conn)?
    };
    // 期待 exe 名は OS 別に解決する（mac は .app バンドル・Windows は .exe）。
    let expected_exe = if cfg!(target_os = "macos") {
        "VOICEVOX.app"
    } else {
        "VOICEVOX.exe"
    };
    let Some(tool) = rakuraku::service::resolve_tool_for_component(&tools, expected_exe) else {
        return Ok(LaunchResult {
            supported: true,
            launched: false,
            message: "VOICEVOX ENGINE をツール管理に登録してください。".to_string(),
        });
    };
    // 管理付き spawn（検証＋起動）＋ registry 登録（launch_tool / rakuraku_launch_component と同経路）。
    let handle = process::service::spawn(tool)?;
    let _launch_id =
        process::service::register(&registry, tool, None, None, handle, util::now_rfc3339());
    Ok(LaunchResult {
        supported: true,
        launched: true,
        message: "VOICEVOX ENGINE を起動しました。".to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 019: ログイン項目登録。macOS は LaunchAgent 方式。OS がログイン時に起動する際
        // `--autostart` を渡し、起動時フックで手動起動と区別する。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // 032c-b: Twitch コメント取得 sidecar を Rust から起動/停止するためのプラグイン。
        // capability に `shell:*` を付与しないため frontend から shell 実行はできない（Rust 専用）。
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // アプリデータディレクトリに SQLite を開き、State として共有する
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("stream-dock.db");
            let conn = Connection::open(&db_path)?;
            // 外部キー制約を有効化する（接続ごとに必要）。
            // preset_items → presets / tools のカスケード削除を効かせ、孤児行を防ぐ。
            conn.execute("PRAGMA foreign_keys = ON", [])?;
            tools::repository::init(&conn)?;
            presets::repository::init(&conn)?;
            preset_items::repository::init(&conn)?;
            app_logs::repository::init(&conn)?;
            app.manage(Mutex::new(conn));
            // stream-dock がこのセッション中に起動したプロセスを保持する runtime process registry。
            // 009 の停止は raw PID ではなくここに保持した Child ハンドル経由で行う。
            app.manage(Mutex::new(HashMap::<String, ManagedProcess>::new()));
            // 032c-b: Twitch コメント取得 sidecar の singleton state（None = 未起動）。
            app.manage::<CommentSidecarState>(Mutex::new(None));

            // 019: 起動時フック。`--autostart`（OS がログイン時に起動）かどうかで挙動を分ける。
            // 任意のローカルプロセスが本バイナリを `--autostart` 付きで起動して無人一括起動を誘発しうるが、
            // 起動対象は resolve_preset_targets→launch_preset_targets→validate_executable 経由の
            // 登録済み・検証済みツールに限定され、権限昇格にはならないため受容する（019 security-review）。
            let is_autostart = std::env::args().any(|a| a == "--autostart");

            // 起動時 reconcile: 前回セッションで全フラグ解除された場合にログイン項目を是正する。
            {
                let db = app.state::<tools::commands::DbState>();
                let conn = db.lock().expect("db mutex poisoned");
                presets::commands::reconcile_autostart(app.handle(), &conn);
            }

            // ウィンドウ制御: config はデフォルト(visible:true)。手動起動・自動起動とも通常表示にする
            //（自動起動時も、立ち上がったツールを管理しやすいよう最小化しない — ユーザー確認済み 019）。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                // 021: カスタムタイトルバー。macOS は config の titleBarStyle="Overlay" で
                // ネイティブ信号機を残す。Windows は static config の decorations 衝突を避けるため、
                // ここで実行時にフレームレス化し、フロントの自作 min/max/close で操作する。
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_decorations(false);
                }
            }

            // `--autostart` のときのみ、フラグ付きプリセットのツールを別スレッドで自動一括起動する。
            // ウィンドウ生成をブロックしないよう別スレッド化し、既存 resolve/launch を再利用する
            //（新規 spawn 経路を作らない）。手動起動では発火させない。
            if is_autostart {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    boot_launch_presets(handle);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_os,
            open_comment_viewer_window,
            open_comment_overlay_window,
            close_comment_overlay_window,
            close_comment_viewer_window,
            is_comment_viewer_open,
            is_comment_overlay_open,
            get_comment_stream_port,
            launch_voicevox_engine,
            tools::commands::create_tool,
            tools::commands::list_tools,
            tools::commands::get_tool,
            tools::commands::update_tool,
            tools::commands::delete_tool,
            tools::commands::extract_app_icon,
            process::commands::launch_tool,
            process::commands::focus_process,
            process::commands::launch_preset,
            process::commands::stop_process,
            process::commands::stop_preset_processes,
            process::commands::list_runtime_processes,
            process::commands::list_preset_runtime_processes,
            presets::commands::create_preset,
            presets::commands::list_presets,
            presets::commands::get_preset,
            presets::commands::update_preset,
            presets::commands::delete_preset,
            preset_items::commands::add_tool_to_preset,
            preset_items::commands::list_preset_items,
            preset_items::commands::list_all_preset_items,
            preset_items::commands::remove_tool_from_preset,
            preset_items::commands::update_preset_item,
            preset_items::commands::reorder_preset_items,
            app_logs::commands::list_app_logs,
            app_logs::commands::get_diagnostic_summary,
            app_logs::commands::clear_app_logs,
            rakuraku::commands::rakuraku_scan_integration,
            rakuraku::commands::rakuraku_launch_component,
            rakuraku::commands::rakuraku_open_official_page,
        ])
        // 032c-b: RunEvent::Exit フックを追加するため .run() を .build()+.run(closure) に分割した
        //（従来は lib.rs に exit フックが無かった）。no-orphan 3 段 kill の②。
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // アプリ終了時に Twitch コメント取得 sidecar を確実に停止する（孤児を残さない）。
                comment_sidecar::shutdown(app_handle);
            }
        });
}

/// 019: `--autostart` 起動時に、auto_launch_on_boot フラグ付きプリセットのツールを
/// 既存の一括起動ロジック（`resolve_preset_targets` / `launch_preset_targets`）で自動起動する。
/// ブロッキングを避けるため setup から別スレッドで呼ばれる。best-effort（失敗は app_logs に記録）。
fn boot_launch_presets(handle: tauri::AppHandle) {
    use app_logs::model::{LogCategory, LogLevel, NewLog};
    use app_logs::service::record;
    use error::ErrorCode;

    let db = handle.state::<tools::commands::DbState>();
    let registry = handle.state::<process::registry::ProcessRegistry>();

    // フラグ付きプリセット一覧を取得（DB ロックは最小限で解放する）。
    let presets = {
        let conn = db.lock().expect("db mutex poisoned");
        presets::repository::list_auto_launch_on_boot(&conn).unwrap_or_default()
    };

    for preset in presets {
        // 開始ログ。
        {
            let conn = db.lock().expect("db mutex poisoned");
            record(
                &conn,
                NewLog::new(
                    LogLevel::Info,
                    LogCategory::BulkLaunch,
                    "autostart_launch_preset",
                    "自動起動: 一括起動を開始しました",
                )
                .preset_id(preset.id.clone()),
            );
        }

        // 起動対象を解決（DB ロックを取り、spawn 前に解放する）。
        let targets = {
            let conn = db.lock().expect("db mutex poisoned");
            match process::service::resolve_preset_targets(&conn, &preset.id) {
                Ok(targets) => targets,
                Err(e) => {
                    record(
                        &conn,
                        NewLog::new(
                            LogLevel::Error,
                            LogCategory::BulkLaunch,
                            "autostart_launch_preset",
                            e.code.log_message(),
                        )
                        .error_code(e.code)
                        .preset_id(preset.id.clone()),
                    );
                    continue;
                }
            }
        };

        // 既存の DB 非依存ランチャで best-effort 起動（新規 spawn 経路を作らない）。
        // 023: url 種別ツールは launch_preset_targets 内で既定ブラウザに開く（handle を渡す）。
        let result =
            process::service::launch_preset_targets(&handle, &preset.id, targets, &registry);

        // 完了ログ（launch_preset command と同じ分岐）。
        // 成功/一部失敗/全失敗の分岐は launch_preset command と重複するが、operation 名
        // ("autostart_launch_preset") とスレッド文脈が異なるため共通化せず意図的に踏襲する。
        let entry = if result.failure_count == 0 {
            NewLog::new(
                LogLevel::Info,
                LogCategory::BulkLaunch,
                "autostart_launch_preset",
                format!(
                    "自動起動: 一括起動が完了しました（成功 {} 件）",
                    result.success_count
                ),
            )
        } else if result.success_count == 0 {
            NewLog::new(
                LogLevel::Error,
                LogCategory::BulkLaunch,
                "autostart_launch_preset",
                format!(
                    "自動起動: 一括起動に失敗しました（{} 件すべて失敗）",
                    result.failure_count
                ),
            )
            .error_code(ErrorCode::BulkLaunchFailed)
        } else {
            NewLog::new(
                LogLevel::Warn,
                LogCategory::BulkLaunch,
                "autostart_launch_preset",
                format!(
                    "自動起動: 一部のツールを起動できませんでした（成功 {} / 失敗 {}）",
                    result.success_count, result.failure_count
                ),
            )
            .error_code(ErrorCode::BulkLaunchPartialFailed)
        };
        let conn = db.lock().expect("db mutex poisoned");
        record(&conn, entry.preset_id(preset.id.clone()));
    }
}
