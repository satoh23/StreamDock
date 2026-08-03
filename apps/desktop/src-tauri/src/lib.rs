mod app_logs;
mod app_update;
mod audio;
mod comment_sidecar;
mod comment_viewer;
mod error;
mod obs_config;
mod preset_items;
mod presets;
mod process;
mod rakuraku;
mod tools;
mod util;
mod viewer_memory;

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

/// 033f 追修正③（回帰修正）: **全 WebView2 窓で共有する** additional_browser_args。
///
/// Windows の WebView2 は「1 つの user data folder（UDF）＝1 つのブラウザプロセス」で、その起動引数は
/// **最初に生成された窓**（本アプリでは tauri.conf.json 由来の `main`）が確定する。UDF を共有する後続窓が
/// **異なる** 引数で生成しようとすると WebView2 環境生成が `ERROR_INVALID_STATE`(`HRESULT 0x8007139F`) で失敗し、
/// `.build()` が Err → その窓が開けなくなる（tauri-utils config.rs の `data_directory` 注記
/// 「WebViews with different values for settings like `additionalBrowserArgs` … must have different data
/// directories」／ tauri#11144）。当初の追修正③は overlay 窓にだけ独自引数を付けたため、既定引数で先に起動した
/// `main` と不一致になり **Windows で overlay が一切開かない回帰** を生んでいた。
///
/// 対策として、UDF を分けず（＝設定同期の localStorage を共有したまま。overlaySettings.ts）**3 窓すべてで
/// この同一文字列に揃える**。`main`（最初に生成）にこの引数を効かせることで、共有ブラウザプロセスで
/// `CalculateNativeWinOcclusion`（完全に隠れた窓の描画停止最適化）が無効になり、最背面(`always_on_bottom`)の
/// overlay も描画継続 → OBS ウィンドウキャプチャが黒くならない（追修正③ 本来の目的）。
///
/// 内訳: wry 0.55.1 の Windows 既定を**完全に**保持したうえで occlusion 無効化だけを足す。
/// - `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`（ミニメニュー/PDF UI/SmartScreen 無効化。
///   SmartScreen 無効化は tauri#1345 由来のプライバシー配慮で §1 の no-external-comms とも整合）。
/// - `--autoplay-policy=no-user-gesture-required`（wry は `autoplay=true`〈= Tauri/wry の既定。tauri-runtime-wry は
///   autoplay を上書きしない〉のとき既定でこれも付与する。`webview2/mod.rs` の既定生成クロージャは
///   `additional_browser_args` を指定すると走らず**この 1 個も一緒に落ちる**ため明示保持する。落とすと Windows で
///   comment-viewer の VOICEVOX 読み上げ〈Web Audio の AudioContext〉がユーザー操作前に鳴らなくなり得る＝
///   従来〈wry 既定〉挙動の非退行のために残す）。
/// - ここへ `CalculateNativeWinOcclusion`（完全に隠れた窓の描画停止最適化。占有解除＝黒回避に必須）だけを
///   `--disable-features` に追加する。`main` の実 UI のハイコントラスト自動追従を損なわないよう
///   `msWebView2AutoDetectHighContrast` は入れない。
/// WebView2 専用引数のため macOS/Linux では無視（非退行）。occlusion 無効化は `main` 含む全窓に効くが、隠れた
/// main の描画スキップ最適化が効かなくなる微小な GPU/CPU コスト増のみで実害はなく許容する。
///
/// **同期注意**: JSON はコメント不可のため、[`tauri.conf.json`] の `app.windows[0].additionalBrowserArgs` と
/// この文字列は**バイト単位で一致**させること（片方だけ変更すると再び窓生成失敗を招く）。
/// 実機で黒が残る場合の次手は `--disable-backgrounding-occluded-windows` の併用。
const SHARED_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --autoplay-policy=no-user-gesture-required";

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
            // 053: **窓のタイトルバーに出る唯一の文言**（033a で窓の中の `<h1>` は OS タイトルと重複するため
            // 削除済み＝ここが消えると窓が無名になる）。ツール一覧の表示名
            // （`tools/repository.rs` の `BUILTIN_COMMENT_VIEWER_NAME`）と同じ文字列に揃える。
            // ⚠ **この窓のタイトルには OBS 自動追加の文字列契約は無い**（044a の対象はオーバーレイ 2 窓のみで、
            // 下の `#[cfg(test)]` が assert しているのもその 2 本）。オーバーレイ 2 窓のタイトルとは
            // 相互に部分文字列にならないので、sidecar の `includes` 一致が取り違えることもない。
            .title("コメントビューア for StreamDock")
            // 033f 追修正③（回帰修正）: Windows では UDF 共有窓の additional_browser_args を全窓一致させないと
            // WebView2 生成が失敗する。main / overlay と同一の SHARED_BROWSER_ARGS に揃える（定数の注記参照）。
            .additional_browser_args(SHARED_BROWSER_ARGS)
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
/// **Windows 追修正③**: 最背面(=常時 occluded)だと WebView2(Chromium) が occlusion 最適化で描画を止め、
/// OBS ウィンドウキャプチャが真っ黒になる。共有ブラウザプロセスで `CalculateNativeWinOcclusion` を無効化して
/// 隠れていても描画を続けさせる（macOS の `background_throttling(Disabled)` に相当する Windows 版対策）。
/// Windows は UDF 共有窓の `additional_browser_args` を**全窓一致**させないと WebView2 生成が失敗するため、
/// main / comment-viewer / overlay で同一の `SHARED_BROWSER_ARGS` を渡す（不一致だった当初実装は Windows で
/// overlay が開けない回帰を招いた。経緯・根拠は `SHARED_BROWSER_ARGS` の注記）。
/// なお Windows の OBS は「ウィンドウキャプチャ＝Windows 10(WGC)・透過を許可」でないと GPU/透過窓を取り込めない
/// （BitBlt では黒くなる）ため、設定側の案内を SettingsView の OBS カードに Windows 限定で出す。
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
            // 033f 追修正③（回帰修正）: 最背面(=常時 occluded)だと WebView2(Chromium) が occlusion 最適化で
            // 描画を止め、OBS ウィンドウキャプチャが真っ黒になる（上の background_throttling(Disabled) は
            // macOS の WKWebView 専用で Windows/WebView2 には効かないため別途必要）。共有ブラウザプロセスで
            // `CalculateNativeWinOcclusion` を無効化して隠れていても描画を続けさせる。
            // 当初は overlay 窓だけに独自引数を付けたが、Windows では UDF 共有窓の additional_browser_args を
            // 全窓一致させないと WebView2 生成が `ERROR_INVALID_STATE` で失敗し、この overlay が開けなくなる回帰を
            // 招いた。main / comment-viewer と同一の SHARED_BROWSER_ARGS に揃える（詳細は定数の注記参照）。
            .additional_browser_args(SHARED_BROWSER_ARGS)
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

/// 046b: 046a の**固定コメント（ピン留め）専用**の背景透過オーバーレイ窓（label `pinned-overlay`）を開く。
/// 既存 `open_comment_overlay_window`（コメント一覧用・label `comment-overlay`）と**同型の単一目的コマンド**で
/// （§3・任意ラベル/任意オプションの窓生成は露出しない）、両者は**独立した別窓**として OBS の別ソースに取り込める。
///
/// **表示専用・通信面ゼロ**: この窓の frontend（`PinnedOverlayApp`）は **WS へ接続しない**。046a が
/// localStorage（`stream-dock.comment-viewer.pinned-comments`）へ書いた固定コメントを read-on-mount ＋
/// `storage` 購読で読むだけで、新規の外部通信・Rust emit・依存を持たない（親 046 の設計判断）。
/// `open_comment_viewer_window` と異なり sidecar には一切触れない（`ensure_started` を呼ばない／窓イベントで
/// `shutdown` を登録しない）＝**閉じても sidecar は落ちない**（no-orphan 3 段 kill の契機はコメビュ窓に集約のまま・
/// §6 の PID kill はそもそも発生しない）。capability は `capabilities/pinned-overlay.json`（最小権限・
/// `main`/`comment-viewer`/`comment-overlay` 不変）に閉じる。
///
/// **既存 overlay と別のタイトル/位置/サイズにする理由**:
/// - タイトル `StreamDock 固定コメント` は、044a（OBS 自動ソース追加）が
///   `itemName.includes("StreamDock コメントオーバーレイ")` で窓を探す（`obs/obs-client.ts`）ため、
///   **部分一致で紛れない名前**にする必要がある。「固定コメント」はこの文字列を含まない。
///   ⚠ **046d で本窓も 044a の自動追加の対象になった**（046b 時点の「対象外＝手動キャプチャ前提・sidecar 側は
///   不変」という記述は失効）。したがってこのタイトルは表示用の文字列ではなく、
///   sidecar の `OBS_OVERLAYS.pinned.windowTitle` と**バイト一致していなければ機能が壊れる契約**である
///   （下の `#[cfg(test)] mod pinned_overlay_contract` で固定した）。
/// - 位置は既存 overlay（x=24〜424）の右隣に置いて**重ねない**＝デスクトップでも OBS の窓一覧でも取り違えない。
/// - 幅 480 は「640 は広すぎ → 400 へ差し戻し・次に試すなら 480〜520」の実測教訓（progress.md）の下限。
/// - **高さ 560 は実測見積りに基づく（046c で 320 から引き上げ）**。480px 幅では横クロームが 133px
///   （`ol` padding 24 ＋ `li` padding 8 ＋ アイコン 44 ＋ gap 28 ＋ 吹き出し padding 24 ＋ border 5）で
///   本文幅 ≈347px、19px フォントで ≈18 字/行。**290 字**（＝YouTube 赤スパ本文上限・dev-mock の長文）は
///   ≈17 行 ≈484px ＋ 縦クローム ≈70px ＝ **≈554px** 必要になる。
///   当初の 320 はこの見積りを誤った値で、046b の E2E で長文が約 57% で見切れた（046c で修正）。
///   `decorations(false)` では手動リサイズが実質できずサイズは永続化されない＝**既定値がすべて**。
///   ⚠ **ここを下げると、frontend 側の自動縮小フィット（`PinnedOverlayApp` / `overlayFit.ts`）が
///   常時発動して文字が小さくなる**。フィットはあくまで想定外の長文に対する保険で、既定サイズが主役。
///
/// その他（透過・装飾なし・最背面・非フォーカス・影なし・`background_throttling(Disabled)`・
/// `SHARED_BROWSER_ARGS`・`WINDOW_OPEN_LOCK`）は既存 overlay を**完全踏襲**する。とくに
/// `SHARED_BROWSER_ARGS` は Windows で UDF 共有窓の引数が**全窓一致**でないと WebView2 生成が
/// `ERROR_INVALID_STATE` で失敗し、この窓が開けない回帰になる（定数の注記・033f 追修正③の経緯）。
///
/// `(async)`: 窓生成を伴うため viewer/overlay と同じ理由で必須（Windows の白画面デッドロック回避。
/// 詳細は `open_comment_viewer_window` の注記）。
///
/// 046d レビュー（対応済み）: この窓に関する不変条件のうち、**窓タイトル契約**（下記①）は 046d で
/// 「壊れると OBS 自動追加が静かに失敗する」機能要件へ格上げされたため、`#[cfg(test)]` でテスト化した
/// （`pinned_overlay_contract`）。とくに悪質な失敗モードは、sidecar 側 `ensureOverlaySource` の M2 フォールバック
/// により **既存ソースがある状態で窓名不一致になると `"reused"`＝成功として返る**（UI は成功表示・OBS の
/// ソースは真っ黒）ため、grep 頼みでは配信中に切り分けられない。
/// ① 2 つの窓タイトルが sidecar の `OBS_OVERLAYS` とバイト一致し、かつ互いに部分文字列でないこと → テスト済み。
/// ② `SHARED_BROWSER_ARGS` が全 4 窓（`main` は `tauri.conf.json`）でバイト一致していること → テスト済み。
#[tauri::command(async)]
fn open_pinned_overlay_window(app: AppHandle) -> AppResult<()> {
    // 二重生成試行ガード（viewer / comment-overlay と共有）。poison 回復の理由は WINDOW_OPEN_LOCK の注記、
    // 保持範囲の考え方は `open_comment_viewer_window` の注記を参照。
    let _guard = WINDOW_OPEN_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    // 既に開いていれば多重生成せず再利用する。最背面窓を前面へ引き上げてちらつかせないよう、
    // set_focus はせず show のみ（既に可視なら実質 no-op）。
    if let Some(window) = app.get_webview_window("pinned-overlay") {
        let _ = window.show();
        return Ok(());
    }
    // 同一 Vite バンドルを読み込み、frontend は `getCurrentWindow().label` で PinnedOverlayApp を描画する。
    let _window =
        WebviewWindowBuilder::new(&app, "pinned-overlay", WebviewUrl::App("index.html".into()))
            .title("StreamDock 固定コメント")
            .transparent(true)
            .decorations(false)
            .always_on_bottom(true)
            .focused(false)
            .shadow(false)
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .additional_browser_args(SHARED_BROWSER_ARGS)
            .position(456.0, 48.0)
            .inner_size(480.0, 560.0)
            .min_inner_size(280.0, 160.0)
            .build()
            .map_err(|_| AppError::launch_failed("固定コメントのオーバーレイを開けませんでした"))?;
    // 意図的に window イベントを登録しない: この窓は sidecar を起動/停止しないため、
    // close 時の shutdown 連動（open_comment_viewer_window）は付けない（comment-overlay と同じ）。
    Ok(())
}

/// 046b: 固定コメント専用オーバーレイ窓（label `pinned-overlay`）を閉じる。設定ビューのトグル OFF 用。
/// `close_comment_overlay_window` と同型の単一目的コマンド（§3）で、任意ラベルの窓操作は露出しない。
/// 窓が無ければ no-op（冪等）。この窓は sidecar を起動していないため `.close()` に shutdown 連動は無く、
/// PID kill・プロセス名 kill も行わず自アプリのウィンドウを閉じるのみ（§6 の PID kill はそもそも発生せず・
/// no-orphan kill 契機は不変）。
#[tauri::command]
fn close_pinned_overlay_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("pinned-overlay") {
        window.close().map_err(|_| {
            AppError::launch_failed("固定コメントのオーバーレイを閉じられませんでした")
        })?;
    }
    Ok(())
}

/// 046b: 固定コメント専用オーバーレイ窓が開いているかを返す読み取り専用コマンド（`is_comment_overlay_open` を手本）。
/// 設定ビューのトグルが、マウント時に「設定 ON なのに窓が無い」場合だけ開き直すために使う（副作用なし）。
///
/// レビュー指摘（修正不要・コマンドを 1 つ増やすコストの正当化）: `open_pinned_overlay_window` は Rust 側で
/// 冪等（既存なら `show()` して return）なので、これを挟まなくても動作は同じ。それでも置くのは
/// ①read-only・引数ゼロ・副作用なしで増える攻撃面が実質ゼロ（自窓の存在有無の bool のみ・§3）
/// ②`is_comment_viewer_open` / `is_comment_overlay_open` と揃えて窓ごとの API 形を一貫させる（034d の前例）
/// ③「開いているなら触らない」が仕様としてテストで固定できる（`CommentViewerApp.toolbar.test.tsx`）ため。
/// 「最背面窓への余計な `show()` を避ける」は副次的な理由に留める（実測していない）。
/// 再修正トリガー＝単一目的コマンドの総数を削る方針になったら、真っ先にこれを畳んでよい（呼び出し側は
/// `if (loadPinnedOverlayEnabled()) open()` の 1 行になる）。
#[tauri::command]
fn is_pinned_overlay_open(app: AppHandle) -> bool {
    app.get_webview_window("pinned-overlay").is_some()
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

/// 044a: OBS WebSocket パスワードを設定する（OBS 側で認証が有効なときのみ必要）。
/// §8: trim/制御文字拒否で検証してから、keychain 保存＋稼働中 sidecar へ **stdin private pipe** で渡す
/// （loopback WS には載せない・非ログ・§9）。frontend は生パスワードをこのコマンドにのみ渡し、
/// WS/localStorage には保存しない。
#[tauri::command]
fn set_obs_websocket_password(app: AppHandle, password: String) -> AppResult<()> {
    let pw = password.trim();
    util::require_non_empty(pw, "OBS のパスワードが未設定です")?;
    util::reject_control_chars(pw, "OBS のパスワードに制御文字は使用できません")?;
    comment_sidecar::set_obs_password(&app, pw);
    Ok(())
}

/// 044a: OBS WebSocket パスワードを破棄する（keychain 削除＋sidecar の in-memory 消去）。idempotent。
#[tauri::command]
fn clear_obs_websocket_password(app: AppHandle) -> AppResult<()> {
    comment_sidecar::clear_obs_password(&app);
    Ok(())
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
        // 055b: アプリ自己アップデート（更新チェック・DL・インストール）のためのプラグイン。
        // capability に `updater:*` を付与しないため frontend から updater は呼べない（Rust 専用）。
        // JS 側 `@tauri-apps/plugin-updater` も入れておらず、露出するのは単一目的のアプリ定義コマンド
        // `check_app_update` だけ（アプリ定義コマンドは ACL を通らない）。宛先は `tauri.conf.json` の
        // `plugins.updater.endpoints` だけを正とし、実行時に `UpdaterBuilder::endpoints()` で上書きしない。
        // ⚠ この登録が無いと `app.updater_builder()` の `state::<UpdaterState>()` が panic する
        //（＝invoke の Promise が永久未解決になる）ので、コマンドとセットで外さないこと。
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            // 038a: 視聴者メモリ（viewers / viewer_comments）。保存は端末内 SQLite のみ。
            viewer_memory::repository::init(&conn)?;
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

                // 034f（回帰修正）: 「main＝本体」を閉じたらアプリごと終了させる。Tauri v2 の既定は
                // 「全ウィンドウが閉じたときのみ終了」で、main を閉じても子窓（comment-viewer /
                // comment-overlay）が残るとアプリが生存し続け、RunEvent::Exit（下の .run() で sidecar を停止）
                // にも到達しなかった（＝子窓と sidecar が孤児化）。main の CloseRequested で app.exit(0) を呼び、
                // 全窓破棄＋RunEvent::Exit 経由の comment_sidecar::shutdown まで連動させる（macOS の「窓を閉じても
                // 常駐」慣習より、本体停止で全部落とすユーザー要望を優先）。main の close ボタンは
                // getCurrentWindow().close()（Header.tsx）で CloseRequested を出し、main は JS の
                // onCloseRequested 購読を持たないため prevent_close されずここに届く。
                // 034f（レビュー: app.exit(0) 強制終了のデータ安全性 / 修正不要）: exit は既存 RunEvent::Exit を
                // 同期経由してから終了し、comment_sidecar::shutdown は guard.take() で idempotent（二重呼び出し無害）。
                // 別スレッドで DB command が実行中でも SQLite のロールバックジャーナルで破損は起きず、失われ得るのは
                // 未コミットの write のみ（あらゆるアプリ終了に内在。ユーザー主導の本体終了として受容）。
                // 再修正トリガー＝終了前の永続化保証が要るなら、exit 前に in-flight write の完了待ち（flush）を挟む。
                let exit_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { .. } = event {
                        exit_handle.exit(0);
                    }
                });
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
            open_pinned_overlay_window,
            close_pinned_overlay_window,
            is_pinned_overlay_open,
            get_comment_stream_port,
            launch_voicevox_engine,
            obs_config::detect_obs_websocket_config,
            set_obs_websocket_password,
            clear_obs_websocket_password,
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
            viewer_memory::commands::record_comment,
            viewer_memory::commands::list_viewers,
            viewer_memory::commands::get_viewer,
            viewer_memory::commands::update_viewer_note,
            viewer_memory::commands::delete_viewer,
            viewer_memory::commands::clear_viewers,
            app_update::commands::check_app_update,
            app_update::commands::install_app_update,
            app_update::commands::restart_app,
            audio::commands::list_audio_output_devices,
            audio::commands::play_notification_sound,
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

#[cfg(test)]
mod pinned_overlay_contract {
    //! 046d レビュー: 透過オーバーレイ 2 窓のタイトルと `SHARED_BROWSER_ARGS` の**言語をまたぐ契約**を固定する。
    //!
    //! なぜテストが必要か（046d で重大度が上がった）:
    //! - 046d 以前、窓タイトルの誤りは `SettingsView` の注記文言にしか影響しなかった（手動キャプチャ前提）。
    //! - 046d 以後、タイトルは sidecar `obs/obs-client.ts` の `OBS_OVERLAYS[kind].windowTitle` と
    //!   **バイト一致**していないと OBS 自動追加が対象窓を見つけられない。しかも `ensureOverlaySource` の
    //!   M2 フォールバックにより、**既存ソースがある状態での不一致は `"reused"`＝成功として返る**ため
    //!   UI は成功表示・OBS のソースは真っ黒、という切り分け困難な壊れ方をする。
    //! - 候補一致は `includes` なので、**2 つのタイトルが互いに部分文字列であってはいけない**
    //!   （片方を含むと、もう片方のソースが誤った窓を掴む）。
    //!
    //! sidecar 側は TS なので Rust から型では参照できない。`include_str!` で**ソースを文字列として読み**、
    //! リテラルの存在を照合する（新規依存ゼロ・`#[cfg(test)]` のみ＝`cargo check` の通常ビルドには入らない）。
    //! 逆方向（TS→Rust）を静的に検証する手段が他に無いための折衷。
    //! 再修正トリガー＝窓名を Rust/TS の共有定義（ビルド時生成の JSON 等）へ寄せたら、このテストは不要になる。

    /// この窓のタイトル（`open_pinned_overlay_window` の `.title` と一致させる）。
    const PINNED_TITLE: &str = "StreamDock 固定コメント";
    /// 既存コメント一覧オーバーレイのタイトル（`open_comment_overlay_window` の `.title` と一致させる）。
    const COMMENTS_TITLE: &str = "StreamDock コメントオーバーレイ";

    const LIB_RS: &str = include_str!("lib.rs");
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");
    const OBS_CLIENT_TS: &str =
        include_str!("../../../comment-sidecar/src/obs/obs-client.ts");

    #[test]
    fn titles_do_not_contain_each_other() {
        // どちらかが他方の部分文字列になると、sidecar の `includes` 一致が窓を取り違える。
        assert!(!PINNED_TITLE.contains(COMMENTS_TITLE));
        assert!(!COMMENTS_TITLE.contains(PINNED_TITLE));
    }

    #[test]
    fn titles_are_used_by_the_window_builders() {
        // 実際の `.title(...)` 呼び出しに、このモジュールが契約とみなしている文字列が使われていること。
        assert!(LIB_RS.contains(&format!(".title(\"{PINNED_TITLE}\")")));
        assert!(LIB_RS.contains(&format!(".title(\"{COMMENTS_TITLE}\")")));
    }

    #[test]
    fn titles_match_sidecar_obs_overlays_table() {
        // sidecar の OBS_OVERLAYS が同じ窓名を持っていること（バイト一致・046d の機能要件）。
        assert!(
            OBS_CLIENT_TS.contains(&format!("windowTitle: \"{PINNED_TITLE}\"")),
            "sidecar の OBS_OVERLAYS.pinned.windowTitle が Rust の窓タイトルと一致していない"
        );
        assert!(
            OBS_CLIENT_TS.contains(&format!("windowTitle: \"{COMMENTS_TITLE}\"")),
            "sidecar の OBS_OVERLAYS.comments.windowTitle が Rust の窓タイトルと一致していない"
        );
    }

    #[test]
    fn shared_browser_args_match_all_four_windows() {
        // Windows では UDF 共有窓の additional_browser_args が全窓一致でないと WebView2 生成が失敗する
        //（033f 追修正③の回帰）。main は tauri.conf.json 側なので、こちらも突き合わせる。
        assert!(
            TAURI_CONF.contains(super::SHARED_BROWSER_ARGS),
            "tauri.conf.json の additionalBrowserArgs が SHARED_BROWSER_ARGS と一致していない"
        );
        // Rust 側の 3 窓（viewer / comment-overlay / pinned-overlay）すべてが定数を参照していること
        //（リテラル直書きへの退行を防ぐ）。
        // ⚠ needle を実行時に組むのは、`include_str!("lib.rs")` が**このテスト自身のソースも含む**ため。
        // 検索文字列をここに直書きすると自分自身がヒットして数が 1 つ増える（実際に踏んだ）。
        let needle = format!(".additional_browser_args({})", "SHARED_BROWSER_ARGS");
        assert_eq!(
            LIB_RS.matches(needle.as_str()).count(),
            3,
            "SHARED_BROWSER_ARGS を参照する窓が 3 つでない（窓を増減したらこの数も更新すること）"
        );
    }

    #[test]
    fn updater_plugin_stays_registered() {
        // 055b レビュー S-1: updater plugin の `.plugin(...)` 登録を消しても
        // **コンパイルは通り、実行時に `state::<UpdaterState>()` が panic する**
        //（`UpdaterExt::updater_builder()` が無条件に state を引くため）。
        // ＝`check_app_update` の invoke の Promise が永久未解決になり、055b が塞いだはずの事故が復活する。
        // `app_update/commands.rs` の契約テストは自ファイルしか見ないので、ここでしか止められない。
        //
        // このモジュールに同居させる理由: `LIB_RS`（`include_str!("lib.rs")`）が既にあり、
        // 「言語/ファイルをまたぐ暗黙の契約を文字列で固定する」という趣旨も同じだから。
        //
        // ⚠ **行コメントを除いてから照合する**。`include_str!` はこの説明コメント自身も読むため、
        // 素の `LIB_RS` を使うと**この直上に needle を書いた瞬間にテストが常に通るようになる**
        //（実際にそれで一度骨抜きになり、ミューテーションで発覚した）。needle を実行時に組むのは二重の保険。
        let code_only: String = LIB_RS
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        let needle = format!("{}::Builder::new().build()", "tauri_plugin_updater");
        assert!(
            code_only.contains(needle.as_str()),
            "updater plugin の登録が消えている（check_app_update が実行時 panic する）"
        );
    }
}
