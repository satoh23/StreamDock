mod app_logs;
mod app_update;
mod audio;
mod comment_sidecar;
mod comment_viewer;
mod error;
mod obs_config;
mod overlay_theme;
mod preset_items;
mod presets;
mod process;
mod rakuraku;
mod stream_session;
mod stream_summary;
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

/// 061b: **コメント取得 sidecar を使っている窓のラベル**。このどれか 1 つでも生きている間は sidecar を止めない。
///
/// ⚠⚠ **061b でここが 1 窓から 2 窓へ広がった**（それ以前は「コメビュ窓 1 点」に集約されていた）。
/// エフェクト窓（`effect-overlay`）が `OverlayApp` と同じく loopback WS を直接張るようになり、
/// **コメビュ窓を閉じてもエフェクトが出続ける**ことが 061b の目的そのものだから。
///
/// ⚠⚠ **061k でさらに 1 窓増えて 3 窓になった**（`stage-overlay`＝エフェクトの全画面側の出力窓）。
/// あの窓も `effect-overlay` と同じく自前で loopback WS を張り、第三者のコメントを受けて配信画面へ出すので、
/// 「ステージ窓だけ開いてコメビュ窓を閉じる」で sidecar が落ちると**演出が黙って止まる**（061b と同じ問題）。
///
/// ⚠ `comment-overlay` / `pinned-overlay` は**入れない**。前者は WS を張るが表示専用で、
/// 「コメントオーバーレイだけ開いたまま sidecar を生かす」意味が無い（コメビュ窓からしか開けない）。
/// 後者はそもそも WS を張らない。**ここへラベルを足すのは「その窓が閉じるまで sidecar を生かす」
/// と決めたときだけ**で、足すと停止条件が緩む方向（＝孤児が残る方向）に効くので必ずレビューすること。
/// ⚠⚠ **足してよい条件は `docs/security.md` §1「取得の停止条件」の 3 点基準が正**
/// （①その窓自身が第三者のコメントを受けて配信画面へ出す ②sidecar を起動しない
/// ③開閉と現在の状態が §1 の導線 2 か所に反映される）。**表示専用の窓をここへ足さないこと。**
///
/// ⚠ **起動契機はここに含まれない。** sidecar を起動するのは `open_comment_viewer_window` の
/// `ensure_started` **1 箇所のまま**で、エフェクトの出力窓は sidecar を起動しない
/// （起動しても `start-session` の導線がコメビュ窓にしか無いためコメントは 1 件も来ず、
/// アプリ起動時の窓復元経路で keychain 復元だけが走る形になるため。詳細は `open_effect_overlay_window` の注記）。
const SIDECAR_CONSUMER_LABELS: [&str; 2] = ["comment-viewer", "stage-overlay"];

/// 061b: **閉じようとしている窓を除いて**、sidecar を使う窓が 1 つも残っていなければ `true`。
///
/// ⚠⚠ **`closing_label` をラベルで除外するのが要点。** Tauri v2（tauri-runtime-wry）の実装では
/// 窓イベントの発火順が **`CloseRequested` と `Destroyed` で逆**になっている:
///
/// - **`CloseRequested`**: per-window ハンドラ → `RunEvent::WindowEvent` → 実際の窓破棄、の順。
///   ＝**ハンドラが走る時点で自窓はまだ `get_webview_window` に居る**（`Some` が返る）。
/// - **`Destroyed`**: `RunEvent::WindowEvent`（この中で `AppManager::on_window_close` が窓を
///   マネージャの map から削除する）→ per-window ハンドラ、の順。
///   ＝**ハンドラが走る時点で自窓はもう居ない**（`None` が返る）。
///
/// 自窓を除外せずに「生きている窓があるか」を数えると、`CloseRequested` で**必ず自分自身が引っかかり**、
/// **どの窓を閉じても sidecar が落ちなくなる**（＝孤児が残る）。逆に自窓を除外しておけば
/// `Destroyed`（既に居ない）でも結果が変わらないので、**どちらのイベントでも同じ判定になる**。
///
/// `is_open` を注入しているのは**実窓なしで単体テストできるようにするため**（下の `mod sidecar_lifecycle`）。
/// 本番の呼び出し元は `shutdown_sidecar_if_last_consumer` で、`AppHandle::get_webview_window` を渡す
/// ＝ **判定は必ず Rust 側で実窓を見る**（frontend の設定値は信用しない・docs/security.md §8）。
///
/// ⚠ **061b レビュー（Q-10）で確認・修正不要**: 本体の `!....any(...)` という二重否定は
/// `.all(|l| *l == closing_label || !is_open(l))` より読みにくいが、意図が
/// 「**自分以外に開いている消費者が 1 つでもあるか**を否定する」なので `any` の方が素直と判断した。
/// `is_open` を `impl Fn` / ジェネリクスではなく `&dyn Fn` にしたのも意図的で、
/// モノモーフィズムの利得が無い（呼び出しは窓クローズ時のみ）一方、`&dyn` だと
/// `shutdown_sidecar_if_last_consumer` 側でクロージャを `&is_open` と素直に渡せ、
/// テストヘルパの戻り値型も書きやすい。再修正トリガー＝ホットパスに入ったら（現状は入り得ない）。
fn is_last_sidecar_consumer(closing_label: &str, is_open: &dyn Fn(&str) -> bool) -> bool {
    !SIDECAR_CONSUMER_LABELS
        .iter()
        .any(|label| *label != closing_label && is_open(label))
}

/// 061b: sidecar を使う窓が自窓のほかに 1 つも残っていなければ sidecar を停止する。
///
/// ⚠ **`CloseRequested` と `Destroyed` の両方から呼ぶ**（`open_comment_viewer_window` /
/// `open_effect_overlay_window` の窓イベント登録）。片方だけに絞らない理由:
/// - `Destroyed` だけ → プラットフォームやアプリ終了の畳み方によっては**届かない**ことがある。
/// - `CloseRequested` だけ → 届く保証は同じく無い。
/// 両方に付けて `is_last_sidecar_consumer` で自窓を除外しておけば、**どちらか一方でも届けば収束**し、
/// 両方届いても `comment_sidecar::shutdown` が idempotent（`guard.take()`）なので無害。
///
/// ⚠ **061b レビュー②（受容・修正不要）＝2 窓を「同時に」閉じたときの隙間**: Tauri の manager が窓を
/// map から消すのは `Destroyed` のときだけなので、片方の `CloseRequested` から `Destroyed` が届くまでの
/// 極短い間、その窓は `get_webview_window` に**まだ居る**。この隙間にもう一方も閉じると、
/// **どちらの `CloseRequested` でも落ちない**。**それでも孤児にはならない**——後から届く `Destroyed` が
/// 順に map から窓を消し、**最後に `Destroyed` が届いた窓のハンドラで必ず落ちる**（macOS では tao の
/// `windowWillClose` が `Destroyed` を必ず emit する）。仮に `Destroyed` が届かない環境があっても、
/// 最悪「アプリ稼働中は sidecar が生き残る」で止まり、`RunEvent::Exit` が終了時に無条件で落とす。
/// 実操作では 2 窓の close は秒単位で離れるので現実には踏まない。
/// **再修正トリガー**＝「両方閉じたのに sidecar が残る」が実機で再現したら、`CloseRequested` 側の判定を
/// 「自窓に加えて、`is_closable()` が false／既に close 要求済みの窓も除外する」形へ拡張すること。
///
/// ⚠⚠ **これはアプリ終了時の担保にはならない。** `app.exit(0)` は `ControlFlow::Exit` を立てて
/// イベントループを畳むだけで、**個々の窓の `CloseRequested` も `Destroyed` も配送されない**。
/// アプリ終了で sidecar を落としているのは `run()` の **`RunEvent::Exit`（無条件）だけ**なので、
/// **あれを条件付きにしてはいけない**（孤児プロセスを残さない最後の担保・docs/security.md §6 の趣旨）。
///
/// ⚠ `WINDOW_OPEN_LOCK` は**取らない**。窓イベントハンドラはイベントループ（メインスレッド）から
/// 同期的に呼ばれるので、窓生成コマンドのロック待ちをここで跨ぐと相互待ちを作りかねない
/// （`open_*_window` は `#[tauri::command(async)]`＝worker がロック保持のまま `.build()` で
/// メインスレッドの完了を待つ。ここでロックを取ると相互待ちになる）。
/// `shutdown` 自体は sidecar state の Mutex を短時間取って `kill()` するだけ。
///
/// ⚠ **061b レビュー（S-6）で確認・修正不要**: `on_window_event` の**登録**自体は非同期
/// （`proxy.send_event(WindowMessage::AddEventListener)`＝リスナが効くのは次のループ反復）なので、
/// 「窓を開いた瞬間に閉じる」極端な操作では登録前に閉じ得る。**対策していない**のは、
/// 取りこぼしても残るのが「アプリ稼働中に sidecar が生き続ける」だけで**孤児にはならない**ため
/// （アプリ終了時は `RunEvent::Exit` が無条件で拾う）。既存 `open_comment_viewer_window` も同じ構造。
/// 再修正トリガー＝この取りこぼしが実機で再現し、かつ sidecar の延命が問題になったとき。
fn shutdown_sidecar_if_last_consumer(app: &AppHandle, closing_label: &str) {
    let is_open = |label: &str| app.get_webview_window(label).is_some();
    if is_last_sidecar_consumer(closing_label, &is_open) {
        comment_sidecar::shutdown(app);
    }
}

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
/// 対策として、UDF を分けず（＝設定同期の localStorage を共有したまま。overlaySettings.ts）**全窓で
/// この同一文字列に揃える**（`main` は `tauri.conf.json`、Rust 側は viewer / comment-overlay /
/// pinned-overlay / effect-overlay / **stage-overlay**（061k）の 5 窓。
/// ⚠ 窓数は下の `overlay_window_contract` が固定している）。
/// `main`（最初に生成）にこの引数を効かせることで、共有ブラウザプロセスで
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
    // ⚠⚠ 061b: **無条件 shutdown をやめ、「sidecar を使う窓が他に残っていないか」を見てから落とす**。
    // エフェクト窓（`effect-overlay`）も同じ loopback WS を張るようになり、コメビュ窓を閉じても
    // エフェクトが出続けることが 061b の目的だから。判定の根拠は `is_last_sidecar_consumer` の注記。
    let app_for_event = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            shutdown_sidecar_if_last_consumer(&app_for_event, "comment-viewer");
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
/// ⚠ **061b でこの窓の扱いは変えていない**——061b が sidecar の停止条件を「コメビュ窓 or エフェクト窓」へ
/// 広げたときも、この窓は `SIDECAR_CONSUMER_LABELS` に**入れていない**（この窓はコメビュ窓からしか開けないので、
/// 「この窓だけ開いたまま sidecar を生かす」という状態に意味が無い）。＝**この窓の close で sidecar は落ちない**
/// のも、**この窓が開いていても sidecar が延命されない**のも 033f から不変。
/// sidecar 未起動時はオーバーレイの loopback WS が接続待ちに
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
    // close 時の shutdown 連動（`open_comment_viewer_window` の `on_window_event` 登録）は付けない。
    // ⚠ 061b: この窓は `SIDECAR_CONSUMER_LABELS` に**入っていない**ので、開いていても sidecar は延命されない。
    Ok(())
}

/// 033f 追修正: OBS 用の背景透過オーバーレイ窓（label `comment-overlay`）を閉じる。コメビュ本体の「閉じる」用。
/// 最背面・非フォーカスで開くため Cmd+W で掴みにくく、コメビュ本体から明示的に閉じられるよう用意する。
/// 単一目的コマンド（§3）で、任意ラベルの窓操作は露出しない。窓が無ければ no-op（冪等）。オーバーレイは
/// sidecar を起動していないため `.close()` に shutdown 連動は無く、PID kill・プロセス名 kill も行わず自アプリの
/// ウィンドウを閉じるのみ（§6 の PID kill はそもそも発生しない）。
/// ⚠ **061b: 「no-orphan kill 契機は不変」ではなくなった**（061b レビュー②S-4）。kill 契機は
/// `comment-viewer` / `effect-overlay` の 2 点（`SIDECAR_CONSUMER_LABELS`）へ広がっている。
/// ただし**この窓はそこに入っていない**ので、「この窓を閉じても sidecar は落ちない」は 033f から真のまま。
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
/// PID kill・プロセス名 kill は一切行わず、自アプリのウィンドウを閉じるのみ
/// （§6 の PID kill はそもそも発生しない）。
///
/// ⚠⚠ **061b: 「この窓を閉じれば sidecar も落ちる」は偽になった**（061b レビュー S-1 / S-8）。
/// `.close()` は `CloseRequested` を出すので `open_comment_viewer_window` が登録した窓イベントを必ず通るが、
/// そこは `shutdown_sidecar_if_last_consumer` に置き換わっており、**エフェクト窓が開いていれば
/// sidecar は落ちない**（＝Twitch/YouTube の取得＝外部通信も続く。`stop-session` は送られない）。
/// ⚠ **このコマンドはツール管理の「停止」ボタンの実体**なので、呼び出し側（`MainScreen`）は
/// 「停止しました」と表示しつつ取得が続く状態になり得る。**この非対称はユーザーへ明示すること**
/// （現状は `ObsEffectsScreen` の前提案内が担っている）。docs/security.md §1 の「取得の停止条件」を参照。
/// ⚠ 再修正トリガー＝ツール管理側で「取得が続いている」ことを表示する必要が出たら、
/// `is_effect_overlay_open` を見てフィードバック文言を分岐させる（061b-1 のスコープ外として見送った）。
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
/// `shutdown` を登録しない）＝**閉じても sidecar は落ちない**（§6 の PID kill はそもそも発生しない）。
/// ⚠ **061b: 「no-orphan 3 段 kill の契機はコメビュ窓に集約のまま」ではなくなった**（061b レビュー②S-4）。
/// 契機は `comment-viewer` / `effect-overlay` の 2 点（`SIDECAR_CONSUMER_LABELS`）。
/// ただし**この窓はそこに入っていない**ので、上記「閉じても落ちない」「開いていても延命しない」は真のまま。
/// capability は `capabilities/pinned-overlay.json`（最小権限・
/// `main`/`comment-viewer`/`comment-overlay` 不変）に閉じる。
///
/// **既存 overlay と別のタイトル/位置/サイズにする理由**:
/// - タイトル `StreamDock 固定コメント` は、044a（OBS 自動ソース追加）が
///   `itemName.includes("StreamDock コメントオーバーレイ")` で窓を探す（`obs/obs-client.ts`）ため、
///   **部分一致で紛れない名前**にする必要がある。「固定コメント」はこの文字列を含まない。
///   ⚠ **046d で本窓も 044a の自動追加の対象になった**（046b 時点の「対象外＝手動キャプチャ前提・sidecar 側は
///   不変」という記述は失効）。したがってこのタイトルは表示用の文字列ではなく、
///   sidecar の `OBS_OVERLAYS.pinned.windowTitle` と**バイト一致していなければ機能が壊れる契約**である
///   （下の `#[cfg(test)] mod overlay_window_contract` で固定した）。
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
/// （`overlay_window_contract`）。とくに悪質な失敗モードは、sidecar 側 `ensureOverlaySource` の M2 フォールバック
/// により **既存ソースがある状態で窓名不一致になると `"reused"`＝成功として返る**（UI は成功表示・OBS の
/// ソースは真っ黒）ため、grep 頼みでは配信中に切り分けられない。
/// ① 窓タイトルが sidecar の `OBS_OVERLAYS` とバイト一致し、かつ互いに部分文字列でないこと → テスト済み
///   （⚠ 061a で 3 窓へ拡張。総当たりループなので 4 本目を足しても組み合わせを取りこぼさない）。
/// ② `SHARED_BROWSER_ARGS` が全窓（`main` は `tauri.conf.json`）でバイト一致していること → テスト済み。
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
/// PID kill・プロセス名 kill も行わず自アプリのウィンドウを閉じるのみ（§6 の PID kill はそもそも発生しない）。
/// ⚠ **061b: kill 契機は 2 点（`SIDECAR_CONSUMER_LABELS`）へ広がったが、この窓はそこに入っていない**
/// ＝この窓の close で sidecar が落ちないのは 046b から不変（061b レビュー②S-4）。
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

/// 061k: エフェクトの**全画面（ステージ）側の出力窓**（label `stage-overlay`）を開く。
/// `open_effect_overlay_window`（061a）と**同型の単一目的コマンド**で（§3・任意ラベル/任意オプションの
/// 窓生成は露出しない）、OBS では 4 本目の独立したソースとして取り込む。
///
/// **なぜ 2 本目の出力窓が要るか**: 既存窓は 960×360 固定で、`anchor` は*その箱の中*の 9 分割。
/// OBS ソースが 1 つしか無いと「全画面に出す演出」と「右下に小さく出す投げ銭」を**同時に成立させられない**。
/// ⚠ **動的 N 窓は構造的に不可能**（Tauri v2 の capability は静的 JSON で `windows: ["label"]` が固定配列）
/// なので、**用途別に固定 2 本**という形にしてある。
///
/// **描画・接続・§9 の担保は `effect-overlay` と完全に同じ**——frontend は同じ `EffectOverlayApp` を
/// `output` prop 違いで描くだけで、**新規宛先・新規 WS プロトコル・新規描画ファイル・新規 IPC はゼロ**。
/// `docs/security.md` の 061a 節「失効条件の最終判定」の 3 点（許可 MIME / `innerHTML` 系不使用 /
/// `blob:`・`<iframe>`・外部 URL を作らない）も**同じ経路を通るので 1 バイトも緩んでいない**。
///
/// **sidecar のライフサイクル**: ⚠ **起動はしない**（`ensure_started` を呼ばない＝起動契機はコメビュ窓の
/// 1 箇所のまま）。⚠⚠ **停止には関与する**（`SIDECAR_CONSUMER_LABELS` に入っている）＝
/// **コメビュ窓を閉じてもステージ演出が出続ける**一方、**どの窓も無くなれば必ず落ちる**
/// （孤児プロセスを残さない・docs/security.md §6 の趣旨）。
/// capability は `capabilities/stage-overlay.json`（最小権限・`core:default` のみ／既存 5 枚は不変）に閉じる。
///
/// **窓タイトル `StreamDock ステージ演出`**: 044a/046d の自動ソース追加は sidecar の
/// `OBS_OVERLAYS[kind].windowTitle` と**バイト一致**する窓名を OBS のウィンドウ一覧から `includes` で探すため、
/// これは表示用の文字列ではなく**壊れると機能が壊れる 2 者間契約**である（下の `overlay_window_contract`）。
/// ⚠⚠ **`"StreamDock エフェクト（全画面）"` のような名前は不可**——既存窓のタイトルを部分文字列として
/// 含むと `includes` 一致が窓を取り違え、しかも `ensureOverlaySource` の M2 フォールバックが
/// **`"reused"`＝成功として返す**ので「UI は成功表示・OBS は真っ黒」という静かな壊れ方になる。
/// **既存 3 つとの相互非包含は契約テストが総当たりで固定している。**
///
/// **サイズと位置の根拠**（⚠ `decorations(false)` では手動リサイズが実質できずサイズは永続化されない＝
/// **既定値がすべて**。046c の教訓）:
/// - **1280×720** = `tauri.conf.json` の `main` 既定幅 1280（＝本アプリが前提にする最小デスクトップ幅）に
///   収まり、かつ **16:9＝配信画面と同じ比**。全画面演出の枠として素直に対応が取れる。
/// - **位置 (0, 0)** = 1280×800 で x 0..1280 / y 0..720 ＝**完全に画面内**。
///   ⚠ macOS は**完全に画面外**の窓でウィンドウキャプチャが凍結しやすい（033f）ため画面内は機能要件。
/// - **min_inner_size 320×180** = 既存窓（320×120）と同じ趣旨で 16:9。
/// - ⚠ **既存 3 窓と重なるが意図的**（061a と同じ判断＝OBS の対象特定は窓タイトルなので取り違えない）。
///
/// その他（透過・装飾なし・最背面・非フォーカス・影なし・`background_throttling(Disabled)`・
/// `SHARED_BROWSER_ARGS`・`WINDOW_OPEN_LOCK`・既存窓の再利用は `show()` のみ）は
/// `open_effect_overlay_window` を**完全踏襲**する。とくに `SHARED_BROWSER_ARGS` は Windows で
/// UDF 共有窓の引数が**全窓一致**でないと WebView2 生成が `ERROR_INVALID_STATE` で失敗し、
/// **この窓が開けない回帰**になる（033f 追修正③の経緯。窓数は契約テストが固定）。
///
/// ⚠⚠ **`WINDOW_OPEN_LOCK` は全窓生成コマンドで 1 本を共有している**ので、**2 つの出力窓の生成は
/// Rust 側で直列になる**（起動時復元で 2 窓を同時に開くと、片方は数百 ms 待つ）。
/// `#[tauri::command(async)]` なので UI は固まらない。
/// ⚠ **frontend の開閉キュー（`ObsEffectsScreen`）を窓ごとに 2 本にしているのは別の理由**
/// （＝**同じ窓**への close と open の順序が入れ替わらないようにするため・061i）で、ここの直列化とは無関係。
/// **「窓ごとにキューがある＝2 窓が並列に開く」と読まないこと。**
#[tauri::command(async)]
fn open_stage_overlay_window(app: AppHandle) -> AppResult<()> {
    // 二重生成試行ガード（viewer / comment-overlay / pinned-overlay / effect-overlay と共有）。
    // poison 回復の理由は WINDOW_OPEN_LOCK の注記、保持範囲の考え方は
    // `open_comment_viewer_window` の注記を参照。
    let _guard = WINDOW_OPEN_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);

    // 既に開いていれば多重生成せず再利用する。最背面窓を前面へ引き上げてちらつかせないよう、
    // set_focus はせず show のみ（既に可視なら実質 no-op）。
    if let Some(window) = app.get_webview_window("stage-overlay") {
        let _ = window.show();
        return Ok(());
    }
    // 同一 Vite バンドルを読み込み、frontend は `getCurrentWindow().label` で
    // EffectOverlayApp（output="stage"）を描画する。
    let window =
        WebviewWindowBuilder::new(&app, "stage-overlay", WebviewUrl::App("index.html".into()))
            .title("StreamDock ステージ演出")
            .transparent(true)
            .decorations(false)
            .always_on_bottom(true)
            .focused(false)
            .shadow(false)
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
            .additional_browser_args(SHARED_BROWSER_ARGS)
            .position(0.0, 0.0)
            .inner_size(1280.0, 720.0)
            .min_inner_size(320.0, 180.0)
            .build()
            .map_err(|_| AppError::launch_failed("ステージ演出のオーバーレイを開けませんでした"))?;

    // ⚠⚠ 061k: **この窓も sidecar の生存に関与する**（`SIDECAR_CONSUMER_LABELS`）。
    // エフェクト窓と**同じ**ガードを通す＝「自分以外に sidecar を使う窓が残っていなければ落とす」。
    // これが無いと、他の窓を先に閉じたあとこの窓を閉じても sidecar が落ちず**孤児になる**。
    // ⚠ **起動（`ensure_started`）はしない。** 起動契機はコメビュ窓の 1 箇所のままにしてある。
    // ⚠ 窓を再利用する経路（上の早期 return）では登録しない＝**登録は窓の生成時 1 回だけ**。
    let app_for_event = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            shutdown_sidecar_if_last_consumer(&app_for_event, "stage-overlay");
        }
        _ => {}
    });
    Ok(())
}

/// 061k: ステージ演出オーバーレイ窓（label `stage-overlay`）を閉じる。
/// `close_effect_overlay_window` と同型の単一目的コマンド（§3）で、任意ラベルの窓操作は露出しない。
/// 窓が無ければ no-op（冪等）。**PID kill・プロセス名 kill は行わず**、自アプリのウィンドウを閉じるのみ
/// （§6 の PID kill はそもそも発生しない）。
///
/// ⚠⚠ **`.close()` は `CloseRequested` を出すので、`open_stage_overlay_window` が登録した窓イベント
/// ハンドラを必ず通る**（`.destroy()` と違い intercept 可能な経路）。＝**他の消費者窓が既に閉じている
/// 状態でこのコマンドを呼ぶと sidecar も落ちる**（＝sidecar を使う窓が 1 つも残らないため）。
/// これは意図どおりで、`ObsEffectsScreen` の「ウィンドウを閉じる」が最後の消費者を閉じる操作になり得る。
#[tauri::command]
fn close_stage_overlay_window(app: AppHandle) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("stage-overlay") {
        window.close().map_err(|_| {
            AppError::launch_failed("ステージ演出のオーバーレイを閉じられませんでした")
        })?;
    }
    Ok(())
}

/// 061k: ステージ演出オーバーレイ窓が開いているかを返す読み取り専用コマンド
/// （`is_effect_overlay_open` を手本）。用途は 3 つで、**別々の窓から呼ぶ**:
/// ①`ObsEffectsScreen`（main 窓）が前提ステータス表示とマウント時の窓復元に使う
/// ②`CommentViewerApp`（コメビュ窓）が `enableObs("stage")` を送る前に「窓が実在するか」を確かめるのに使う
/// ③`MainScreen`（main 窓）が**コメビュ停止時のフィードバック文言**を分岐するのに使う
/// （⚠⚠ **`docs/security.md` §1「取得の停止条件」が名指しする導線 2 か所のうちの 1 つ**＝
/// この窓が開いている間はコメビュ窓を閉じても取得が続くので、それを黙らせない）。
/// ⚠ ②が**実窓**を見るのは 046d レビューの指摘と同じ理由——設定 ON ／ 窓なしで走らせると sidecar 側
/// `ensureOverlaySource` が**先に `CreateInput` でソースを作ってから**窓を探して失敗し、
/// キャプチャ対象未設定の空ソースが OBS に残る（ユーザーが手で消すまで消えない）。
#[tauri::command]
fn is_stage_overlay_open(app: AppHandle) -> bool {
    app.get_webview_window("stage-overlay").is_some()
}

/// 032c-b: viewer が接続する Twitch コメント WS の実ポートを返す読み取り専用コマンド（§3・単一目的）。
/// sidecar が bind した実ポート（既定 17331・使用中なら空きポート）を返す。未確定なら `None`。
/// frontend からは raw なパス/ポート/コマンドを受け取らない（ポートは Rust が sidecar の stdout から受領）。
#[tauri::command]
fn get_comment_stream_port(app: AppHandle) -> Option<u16> {
    comment_sidecar::port(&app)
}

/// 060c: テーマ取り込み（外部 `@import` のスナップショット）の制御フレームに載せる**チケット**を返す
/// 読み取り専用コマンド（§3・単一目的・引数ゼロ）。未起動なら `None`。
///
/// ⚠⚠ **これは「sidecar の loopback WS が未認証である」ことへの限定的な対処**である。
/// `theme-import.fetch` は**インターネットへの GET を起こす初めての制御フレーム**で、
/// 従来フレームの受容根拠（「秘密が流れない・loopback に留まる」）が及ばない。
/// チケットを要求することで、`ws://127.0.0.1:<port>` へ繋いだだけの外部プロセス／ブラウザのページが
/// **同意ダイアログを経ずに外部 GET を起こす**経路を塞ぐ（詳細は `comment_sidecar` の
/// `THEME_TICKET_PREFIX` の注記と `docs/security.md` §1 の 060c 例外節）。
///
/// ⚠ アプリ定義コマンドは ACL 対象外＝全 5 窓（061a で `effect-overlay` が加わった）から呼べるが、
/// **webview の外からは呼べない**——
/// それがここで効いている性質そのものである。⚠ 値はログにも画面にも出さない（§9）。
#[tauri::command]
fn get_theme_import_ticket(app: AppHandle) -> Option<String> {
    comment_sidecar::theme_import_ticket(&app)
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
            // 062b: 配信セッション（stream_sessions）。「1 回の配信」の開始/終了時刻・プラットフォーム・
            // 手入力タイトルだけを持つ（第三者の個人データは入らない・docs/security.md §9 追補〔062b〕）。
            // ⚠ **viewer_memory::repository::init より後に置くこと**——閉じ忘れ回収
            //   （下の close_stale）が `viewer_comments` を突き合わせるため。
            stream_session::repository::init(&conn)?;
            // ⚠⚠ 062c: `stream_summary` の init は**無い**（ここに 1 行足す必要がない）。
            //   配信サマリーは `viewer_comments` をその場で集計するだけで、**テーブルを 1 つも作らない**。
            //   集計結果をキャッシュテーブルへ保存すると docs/security.md §9（端末保存）の判断が
            //   やり直しになるため。`idx_viewer_comments_session` が効くので都度計算で足りる。
            //   ⇒ **ここへ `stream_summary::repository::init(&conn)?;` を足したくなったら、
            //      まず何を保存しようとしているのかを疑うこと。**
            // 060b: オーバーレイのカスタム CSS テーマ（overlay_themes）。CSS 実体は
            // app_data_dir/themes/<id>.css で、そのディレクトリは取り込み時に作る
            //（overlay_theme::service の保存ヘルパが冪等に create_dir_all する＝
            //  実行中にディレクトリを消されても復旧できる）。
            overlay_theme::repository::init(&conn)?;
            // ⚠⚠ 064d: `effect_templates` テーブルの作成をやめた（取り込み機能ごと削除）。
            //   ⚠ **既存の開発環境には未使用のテーブルが残る**（DROP はしない＝削除のためだけの
            //   マイグレーションを書かない）。新規環境ではそもそも作られない。
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

                // 062b: 閉じ忘れた配信セッションの回収。アプリを強制終了すると `ended_at` が NULL の行が
                // 残り、放っておくと**永久に「配信中」**になって次の配信と混ざる。最終活動（そのセッションの
                // 最後のコメント。1 件も無ければ開始時刻）から猶予（Rust 側定数）を過ぎたものだけを閉じる。
                // ⚠ frontend のマウント時にも同じコマンドを呼ぶ（猶予中に窓だけ閉じるとタイマーが消えるため、
                //   起動時の 1 回だけでは回収しきれない）。
                // ⚠ 失敗しても起動は続ける（回収は次の起動でも走る。エラーは log_command_err 相当の扱いに
                //   せず握るが、DB が壊れているなら他のコマンドが先に失敗して app_logs へ残る）。
                let _ = stream_session::service::close_stale(&conn);
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
            open_stage_overlay_window,
            close_stage_overlay_window,
            is_stage_overlay_open,
            get_comment_stream_port,
            get_theme_import_ticket,
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
            // 062b: 配信セッション（「1 回の配信」の境界）。すべて単一目的で、capability は増えない
            //（アプリ定義コマンドは ACL 列挙不要）。
            stream_session::commands::start_stream_session,
            stream_session::commands::get_active_stream_session,
            stream_session::commands::update_stream_session_platforms,
            stream_session::commands::end_stream_session,
            stream_session::commands::update_stream_session_title,
            stream_session::commands::list_stream_sessions,
            stream_session::commands::close_stale_stream_sessions,
            // 062c: 配信サマリー（1 回の配信ぶんの集計）。read-only・単一目的で、
            //   **新しい保存もテーブルも増えない**（docs/security.md §9）。capability も増えない。
            stream_summary::commands::get_stream_summary,
            app_update::commands::check_app_update,
            app_update::commands::install_app_update,
            app_update::commands::restart_app,
            audio::commands::list_audio_output_devices,
            audio::commands::play_notification_sound,
            overlay_theme::commands::import_overlay_theme,
            overlay_theme::commands::import_overlay_theme_text,
            overlay_theme::commands::import_overlay_theme_snapshot,
            overlay_theme::commands::list_overlay_themes,
            overlay_theme::commands::get_overlay_theme_css,
            // 060h: フォント資産（意匠とは別ファイル・別 `<style>`）。
            overlay_theme::commands::attach_overlay_theme_fonts,
            overlay_theme::commands::get_overlay_theme_font_css,
            overlay_theme::commands::rename_overlay_theme,
            overlay_theme::commands::delete_overlay_theme,
        ])
        // 032c-b: RunEvent::Exit フックを追加するため .run() を .build()+.run(closure) に分割した
        //（従来は lib.rs に exit フックが無かった）。no-orphan 3 段 kill の②。
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                // アプリ終了時に Twitch コメント取得 sidecar を確実に停止する（孤児を残さない）。
                // ⚠⚠ **061b: ここは絶対に条件付きにしないこと。** `app.exit(0)`（main 窓の close 経由）は
                // `ControlFlow::Exit` を立ててイベントループを畳むだけで、**個々の窓の `CloseRequested` も
                // `Destroyed` も配送されない**（tao は `Event::LoopDestroyed` を 1 発出すだけ）。
                // ＝アプリ終了経路で sidecar を落としているのは**この 1 行だけ**であり、
                // `shutdown_sidecar_if_last_consumer`（窓イベント）はここでは 1 度も走らない。
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
mod overlay_window_contract {
    //! 046d レビュー / 061a: 透過オーバーレイ窓のタイトルと `SHARED_BROWSER_ARGS` の
    //! **言語をまたぐ契約**を固定する。
    //!
    //! ⚠ **061a で `pinned_overlay_contract` から改名した**。3 窓（comment-overlay / pinned-overlay /
    //! effect-overlay）の契約を扱うのに「pinned」を名乗っていると、4 本目を足す人がこのテストへ辿り着けない。
    //! ⚠ **061k で 4 窓になった**（`stage-overlay` を追加）。予告どおり**足したのは `OVERLAY_TITLES` の
    //! 1 行だけ**で、下の 5 テストは自動的に追随している（手で直したのは
    //! `window_commands_used_by_the_frontend_are_registered` の下限 `12 → 15` だけ）。
    //! 旧名を先例として名指ししていた `audio/service.rs` / `overlay_theme/service.rs` /
    //! `app_update/commands.rs` のコメントも併せて更新済み。
    //!
    //! なぜテストが必要か（046d で重大度が上がった）:
    //! - 046d 以前、窓タイトルの誤りは `SettingsView` の注記文言にしか影響しなかった（手動キャプチャ前提）。
    //! - 046d 以後、タイトルは sidecar `obs/obs-client.ts` の `OBS_OVERLAYS[kind].windowTitle` と
    //!   **バイト一致**していないと OBS 自動追加が対象窓を見つけられない。しかも `ensureOverlaySource` の
    //!   M2 フォールバックにより、**既存ソースがある状態での不一致は `"reused"`＝成功として返る**ため
    //!   UI は成功表示・OBS のソースは真っ黒、という切り分け困難な壊れ方をする。
    //! - 候補一致は `includes` なので、**タイトルが互いに部分文字列であってはいけない**
    //!   （片方を含むと、もう片方のソースが誤った窓を掴む）。
    //!
    //! ⚠⚠ **061a の要点＝窓が増えても組み合わせを取りこぼさない形にした**。2 窓のときの手書き比較
    //! （2 方向）をそのまま 3 窓（6 方向）へ増やすと、4 本目で必ず抜ける。`OVERLAY_TITLES` を回す
    //! **総当たりループ**にしてあるので、**足すのは配列の 1 行だけ**で 4 テストすべてが自動的に追随する。
    //!
    //! sidecar 側は TS なので Rust から型では参照できない。`include_str!` で**ソースを文字列として読み**、
    //! リテラルの存在を照合する（新規依存ゼロ・`#[cfg(test)]` のみ＝`cargo check` の通常ビルドには入らない）。
    //! 逆方向（TS→Rust）を静的に検証する手段が他に無いための折衷。
    //! 再修正トリガー＝窓名を Rust/TS の共有定義（ビルド時生成の JSON 等）へ寄せたら、このテストは不要になる。

    /// OBS 自動追加の対象になる透過オーバーレイ窓のタイトル（Rust の `.title` ／ sidecar の
    /// `OBS_OVERLAYS[kind].windowTitle` と**バイト一致**する文字列）。
    /// ⚠ 窓を増やしたら**ここへ 1 行足すだけ**でよい（下のテストは全部この配列を回す）。
    /// ⚠ `comment-viewer` 窓（`コメントビューア for StreamDock`）は自動追加の対象外なので**入れない**。
    const OVERLAY_TITLES: [&str; 3] = [
        // `open_comment_overlay_window`（033f）
        "StreamDock コメントオーバーレイ",
        // `open_pinned_overlay_window`（046b）
        "StreamDock 固定コメント",
        // `open_stage_overlay_window`（061k）
        // ⚠ 既存 2 つを部分文字列として含まず、既存 2 つにも含まれないこと（下の総当たりが固定）。
        // ⚠⚠ **064d で「StreamDock エフェクト」（コーナー窓）を削除した**——あの窓は
        //   取り込んだテンプレート専用で、064 の方針転換（OBS 側のソースを鳴らす）で廃止したため。
        //   ⚠ `"StreamDock エフェクト（全画面）"` を不可にしていた制約は**当時の話**だが、
        //   **総当たりの規律は残る**（名前を足すときは必ずこのループを通すこと）。
        "StreamDock ステージ演出",
    ];

    /// `SHARED_BROWSER_ARGS` を参照している Rust 側の窓の数（`main` は `tauri.conf.json` 側なので含まない）。
    ///
    /// ⚠ 061a レビュー（Q-5）: **手で維持する `4` から `OVERLAY_TITLES` 由来の導出へ変えた**。
    /// 総当たり化の売りが「足すのは `OVERLAY_TITLES` の 1 行だけ」なのに、この定数だけ 2 箇所目の
    /// 編集を要求していたため。`+ 1` は **OBS 自動追加の対象外だが `SHARED_BROWSER_ARGS` は要る窓**＝
    /// `comment-viewer`（`open_comment_viewer_window`）の分。
    /// ⚠ 「透過オーバーレイでない窓」を Rust 側にもう 1 つ足すときだけ、この `+ 1` を増やすこと。
    const RUST_WINDOWS_WITH_SHARED_ARGS: usize = OVERLAY_TITLES.len() + 1;

    const LIB_RS: &str = include_str!("lib.rs");
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");
    /// 061a レビュー（Q-7）: desktop 側の `ObsOverlayKind`（sidecar と**人手で同期している 2 実装目**）。
    /// ⚠ WS 境界で型が失われるので、ずれても typecheck では気付けない。
    const COMMENT_STREAM_TS: &str =
        include_str!("../../src/features/comment-viewer/commentStream.ts");
    /// 061a: frontend の窓操作ラッパ（`invoke("…")` の command 名がここに文字列で並ぶ）。
    const WINDOW_API_TS: &str = include_str!("../../src/features/comment-viewer/windowApi.ts");
    /// 061k: frontend が**ユーザーへ案内する窓名**の唯一の出所（窓名の 3 つ目の写し）。
    /// ⚠ 下の `frontend_window_title_table_matches_overlay_titles` が正。
    const EFFECT_ASSIGNMENTS_TS: &str =
        include_str!("../../src/screens/obs-effects/effectAssignments.ts");
    const OBS_CLIENT_TS: &str =
        include_str!("../../../comment-sidecar/src/obs/obs-client.ts");

    #[test]
    fn titles_do_not_contain_each_other() {
        // どれかが他方の部分文字列になると、sidecar の `includes` 一致が窓を取り違える。
        // ⚠ **総当たり**にしてあるので、窓を足しても組み合わせを取りこぼさない。
        // ⚠ 同一タイトルの重複も同時に捕まる（`a.contains(a)` が真になるため）。
        for (i, a) in OVERLAY_TITLES.iter().enumerate() {
            for (j, b) in OVERLAY_TITLES.iter().enumerate() {
                if i == j {
                    continue;
                }
                assert!(
                    !a.contains(b),
                    "窓タイトルが互いに部分文字列になっている（sidecar の includes 一致が窓を取り違える）: {a} ⊃ {b}"
                );
            }
        }
    }

    #[test]
    fn titles_are_used_by_the_window_builders() {
        // 実際の `.title(...)` 呼び出しに、このモジュールが契約とみなしている文字列が使われていること。
        // ⚠ needle を実行時に組む理由は下の `shared_browser_args_match_all_windows` と同じ（自己参照の罠）。
        // ⚠ 上の `OVERLAY_TITLES` の配列リテラルは `.title("…")` の形ではないので偽陽性にならない。
        for title in OVERLAY_TITLES {
            let needle = format!(".title(\"{title}\")");
            assert!(
                LIB_RS.contains(needle.as_str()),
                "窓タイトル `{title}` を `.title(...)` で使っている窓生成が無い"
            );
        }
    }

    #[test]
    fn titles_match_sidecar_obs_overlays_table() {
        // sidecar の OBS_OVERLAYS が同じ窓名を持っていること（バイト一致・046d の機能要件）。
        // ⚠ 書式にも依存する（`windowTitle: "…"`＝コロンの後スペース 1 つ・ダブルクォート）。
        // prettier がここを改行すると落ちるので、TS 側はこの 1 行の形を維持すること。
        // ⚠ 開き引用符まで needle に含める。`windowTitle: ` だけだと
        // `Record<…, { …; windowTitle: string }>` の**型注釈にもヒットする**（実際に踏んだ）。
        let prefix = format!("{}: \"", "windowTitle");
        for title in OVERLAY_TITLES {
            let needle = format!("{prefix}{title}\"");
            assert!(
                OBS_CLIENT_TS.contains(needle.as_str()),
                "sidecar の OBS_OVERLAYS に windowTitle `{title}` が無い（Rust の窓タイトルと不一致）"
            );
        }
        // ⚠ **逆方向も固定する**: TS 側にだけエントリが増えて Rust 側に窓が無い状態
        //（＝キャプチャ対象の窓が存在しないソースを OBS に作ってしまう）を捕まえる。
        assert_eq!(
            OBS_CLIENT_TS.matches(prefix.as_str()).count(),
            OVERLAY_TITLES.len(),
            "sidecar の OBS_OVERLAYS のエントリ数が Rust の窓数と一致していない"
        );
    }

    #[test]
    fn shared_browser_args_match_all_windows() {
        // Windows では UDF 共有窓の additional_browser_args が全窓一致でないと WebView2 生成が失敗する
        //（033f 追修正③の回帰）。main は tauri.conf.json 側なので、こちらも突き合わせる。
        assert!(
            TAURI_CONF.contains(super::SHARED_BROWSER_ARGS),
            "tauri.conf.json の additionalBrowserArgs が SHARED_BROWSER_ARGS と一致していない"
        );
        // Rust 側の窓すべてが定数を参照していること（リテラル直書きへの退行を防ぐ）。
        // ⚠ needle を実行時に組むのは、`include_str!("lib.rs")` が**このテスト自身のソースも含む**ため。
        // 検索文字列をここに直書きすると自分自身がヒットして数が 1 つ増える（実際に踏んだ）。
        let needle = format!(".additional_browser_args({})", "SHARED_BROWSER_ARGS");
        assert_eq!(
            LIB_RS.matches(needle.as_str()).count(),
            RUST_WINDOWS_WITH_SHARED_ARGS,
            "SHARED_BROWSER_ARGS を参照する窓の数が想定と違う（窓を増減したら定数も更新すること）"
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

    /// 061a レビュー（Q-7）: **`ObsOverlayKind` の 2 実装のずれを機械で止める。**
    ///
    /// この union は sidecar（`obs/obs-client.ts`）と desktop（`features/comment-viewer/commentStream.ts`）の
    /// **2 か所に人手で同期**されている。WS 境界で型が失われるので**ずれても typecheck では気付けず**、
    /// 実害は「desktop が送った種別を sidecar の `parseOverlayKind` が `"comments"` へ落とす」＝
    /// **誤った窓のソースが OBS に作られる**という静かな方向に出る。
    /// ⚠ 上の 3 テスト（窓タイトル契約）は**文字列としてのタイトル**しか見ないので、このずれは捕まえない
    ///（`commentStream.ts` にコメントで明記してあるが、コメントは機械ではない）。
    ///
    /// 実装は既存の `OBS_CLIENT_TS` と同じ手口（`include_str!` で TS をソースとして読む・新規依存ゼロ）。
    /// **再修正トリガー**＝窓名と同じく union も Rust/TS の共有定義（ビルド時生成）へ寄せたら、本テストは不要。
    #[test]
    fn obs_overlay_kind_union_matches_between_sidecar_and_desktop() {
        /// `export type ObsOverlayKind = …;` の右辺を、空白を潰した形で取り出す
        /// （prettier の改行差で落ちないようにするため）。
        fn union_body(src: &str, needle: &str) -> Option<String> {
            let rest = src.split_once(needle)?.1;
            let decl = rest.split_once(';')?.0;
            Some(decl.split_whitespace().collect::<String>())
        }
        // ⚠ needle は実行時に組む（このモジュールも `include_str!("lib.rs")` の対象なので、
        // 直書きすると LIB_RS を見る検査へ流用したときに自己ヒットする＝既存テストと同じ規律）。
        let needle = format!("export type {} =", "ObsOverlayKind");
        let sidecar = union_body(OBS_CLIENT_TS, needle.as_str());
        let desktop = union_body(COMMENT_STREAM_TS, needle.as_str());
        assert!(
            sidecar.is_some(),
            "sidecar の obs-client.ts に ObsOverlayKind の宣言が見つからない"
        );
        assert_eq!(
            sidecar, desktop,
            "ObsOverlayKind が sidecar と desktop でずれている（誤った窓のソースが OBS に作られる）"
        );
        // ⚠ **窓の数とも突き合わせる**。片方だけに値を足した状態は上の assert_eq! が捕まえるが、
        // 「両方に足したのに Rust 側の窓（＝`OVERLAY_TITLES`）を足し忘れた」はこちらでしか止まらない。
        let quoted = sidecar.map(|u| u.matches('"').count() / 2).unwrap_or(0);
        assert_eq!(
            quoted,
            OVERLAY_TITLES.len(),
            "ObsOverlayKind の値の数が Rust の窓数と一致していない"
        );
    }

    /// 061a: **frontend が呼ぶ窓操作コマンドが、実際に `generate_handler!` へ登録されていること。**
    ///
    /// ⚠ command 名は TS 側では**ただの文字列リテラル**で、typo しても `pnpm typecheck` は通る。
    /// 実行時に invoke が reject するだけだが、呼び出し側（`App.tsx` の起動時復元・
    /// `ObsEffectsScreen` のトグル）はどちらも `.catch(() => {})` で握りつぶすので、
    /// **画面上は何も起きないまま静かに壊れる**（「表示 ON にしたのに窓が出ない」が無言で起きる）。
    /// 逆向き（Rust 側で `generate_handler!` から 1 行消す）も同じ壊れ方をする。
    /// TS 側の `windowApi.test.ts` は「ラッパがその名前を呼ぶこと」までしか見られないので、
    /// **名前が Rust に実在するか**はここでしか止められない。
    #[test]
    fn window_commands_used_by_the_frontend_are_registered() {
        // `generate_handler![ … ]` のブロックだけを切り出す（関数定義がある＝登録済み、とは限らないため）。
        // ⚠ needle は実行時に組む（`include_str!("lib.rs")` の自己ヒット対策・このモジュールの規律）。
        let handler_head = format!("{}![", "generate_handler");
        let registered = LIB_RS
            .split_once(handler_head.as_str())
            .and_then(|(_, rest)| rest.split_once(']'))
            .map(|(block, _)| block);
        assert!(
            registered.is_some(),
            "generate_handler! のブロックが見つからない（登録の照合ができない）"
        );
        let registered = registered.unwrap_or("");

        // `windowApi.ts` の `invoke<…>("command_name")` を全部拾う。
        let call_head = format!("{}<", "invoke");
        let mut found = 0usize;
        for chunk in WINDOW_API_TS.split(call_head.as_str()).skip(1) {
            // `invoke<void>("open_effect_overlay_window")` → 最初の引用符の中身を取る。
            let Some((_, after_quote)) = chunk.split_once('"') else {
                continue;
            };
            let Some((command, _)) = after_quote.split_once('"') else {
                continue;
            };
            found += 1;
            assert!(
                registered
                    .split(',')
                    .any(|entry| entry.trim() == command),
                "windowApi.ts が呼ぶ `{command}` が generate_handler! に登録されていない（invoke が実行時に reject し、UI は無反応のまま静かに壊れる）"
            );
        }
        // ⚠ 抽出そのものが壊れて 0 件になったら、このテストは**何も検証しないまま緑になる**。
        // 窓 4 種 × (open / close / is) の 12 本が下限（減ったら抽出か実装のどちらかが壊れている）。
        // ⚠⚠ **064d で 15 → 12 へ戻した**（コーナー窓を廃止して窓が 1 本減ったため）。
        //   ⚠ **窓を増減したら必ずここも直すこと**——上の 4 テストと違い、
        //   この下限だけは `OVERLAY_TITLES` から導出できない（`comment-viewer` 窓は OBS 自動追加の
        //   対象外だが `windowApi.ts` には 3 本ある、という非対称のため）。
        assert!(
            found >= 12,
            "windowApi.ts から抽出できた command が {found} 本しかない（抽出が壊れている可能性）"
        );
    }

    /// 061k: **frontend がユーザーに案内する窓名が、実際の窓タイトルとバイト一致していること。**
    ///
    /// ⚠⚠ **窓名の写しは 3 つある**——Rust の `.title(...)` ／ sidecar の `OBS_OVERLAYS[kind].windowTitle`
    /// ／ **frontend がセットアップ用ガイドと案内文に出す文字列**。上の 3 テストは前 2 者しか見ていない。
    /// ⚠ 3 つ目がずれると**ユーザーは OBS のウィンドウ一覧をその文字列で探して見つけられない**
    /// （＝機能が壊れる。しかも**ガイド本文は OBS のキャプチャに数十秒そのまま映る**ので、
    /// 誤りが配信を見ている視聴者にも読める）。061i の実機確認で実際に踏んだ失敗モードである。
    ///
    /// ⇒ frontend 側は `screens/obs-effects/effectAssignments.ts` の
    /// **`STAGE_OVERLAY_WINDOW_TITLE`（定数 1 本）**に寄せてあるので、ここで突き合わせる。
    /// ⚠⚠ **064d で「出力先 → 窓名の表」から定数 1 本になった**（窓が 1 つになったため）。
    /// **再修正トリガー**＝窓名を Rust/TS の共有定義（ビルド時生成）へ寄せたら、本テストは不要になる。
    #[test]
    fn frontend_window_title_table_matches_overlay_titles() {
        // ⚠ needle は実行時に組む（`include_str!("lib.rs")` の自己ヒット対策・このモジュールの規律）。
        let head = format!("const {} = \"", "STAGE_OVERLAY_WINDOW_TITLE");
        let title = EFFECT_ASSIGNMENTS_TS
            .split_once(head.as_str())
            .and_then(|(_, rest)| rest.split_once('"'))
            .map(|(value, _)| value);
        assert!(
            title.is_some(),
            "effectAssignments.ts に STAGE_OVERLAY_WINDOW_TITLE が見つからない（frontend の案内文が窓名を直書きしている可能性）"
        );
        let title = title.unwrap_or("");
        assert!(
            OVERLAY_TITLES.contains(&title),
            "frontend の STAGE_OVERLAY_WINDOW_TITLE が実在しない窓名 `{title}` を案内している（OBS のウィンドウ一覧で見つからない）"
        );
    }
}

#[cfg(test)]
mod sidecar_lifecycle {
    //! 061b: **sidecar の停止判定**（`is_last_sidecar_consumer`）の単体テスト。
    //!
    //! なぜこれが要るか: 061b は sidecar の生存契機を「コメビュ窓 1 点」から
    //! 「コメビュ窓 or エフェクト窓のどちらかが生きている間」へ広げた。ここを間違えると
    //! **どの窓を閉じても sidecar が落ちない＝孤児プロセスが残る**（docs/security.md §6 の趣旨に反する）
    //! か、逆に **1 窓閉じただけで落ちる**（061b の目的そのものが達成できない）かのどちらかになる。
    //!
    //! ⚠⚠ **最大の罠は「`CloseRequested` の時点では自窓がまだマネージャに居る」こと。**
    //! Tauri v2（tauri-runtime-wry）の実装では:
    //!   - `CloseRequested` … per-window ハンドラ → `RunEvent::WindowEvent` → 実際の窓破棄
    //!     ＝ **ハンドラ実行中は `get_webview_window(自分)` が `Some`**
    //!   - `Destroyed`      … `RunEvent::WindowEvent`（`AppManager::on_window_close` が map から削除）
    //!     → per-window ハンドラ ＝ **ハンドラ実行中は `None`**
    //! 自窓をラベルで除外しておけば**どちらの順序でも同じ判定**になる。下の
    //! `close_requested_ignores_the_window_that_is_closing` がこの穴を名指しで固定している。
    //!
    //! ⚠ **実窓を使う挙動（`shutdown_sidecar_if_last_consumer`）はここでは検証できない**（`AppHandle` が要る）。
    //! そちらは下の `sidecar_lifecycle_contract`（配線の形）と、実機 3 経路
    //! （コメビュ→エフェクトの順／逆順／アプリ終了）で担保する。
    //!
    //! ⚠⚠ **061k security-review で見つかった穴（変異⑯-k が実測で生存した）**: 061b の時点で
    //! 消費者は 2 窓しか無かったため、以下のケースは**ラベルを直書き**していた。061k で 3 窓目
    //! （`stage-overlay`）を足したとき、`SIDECAR_CONSUMER_LABELS` へ 1 行足すだけでは
    //! **新しいラベルを一度も通らないまま全テストが緑になる**——実際に
    //! `is_last_sidecar_consumer` の中で `*label != "stage-overlay"` と除外する変異
    //! （＝**ステージ窓が開いていても sidecar を落とす**＝061k の目的が壊れる）が
    //! **345 本すべて緑のまま生存した**。
    //! ⇒ **ラベルを直書きするケースは残しつつ、`SIDECAR_CONSUMER_LABELS` を回す総当たりを足した**
    //! （`overlay_window_contract` が窓タイトルで採った手口と同じで、**4 窓目を足しても自動で追随する**）。
    //! ⚠ **新しい消費者窓を足す人は、ここに手を入れる必要が無い**——それが総当たりにした目的である。

    use super::{is_last_sidecar_consumer, SIDECAR_CONSUMER_LABELS};

    /// 「開いている窓のラベル一覧」から `is_open` を作るテスト用ヘルパ。
    fn opened<'a>(labels: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |label: &str| labels.contains(&label)
    }

    #[test]
    fn keeps_sidecar_while_the_other_consumer_window_is_open() {
        // コメビュ窓を閉じる。ステージ窓が生きているので**落としてはいけない**
        //（＝061b の目的「コメビュ窓を閉じても配信画面の演出が出続ける」そのもの）。
        // ⚠ 064d: 直書きしていたラベルを `effect-overlay` から `stage-overlay` へ移した
        //   （コーナー窓は取り込み機能ごと廃止＝消費者窓は 2 つになった）。
        assert!(!is_last_sidecar_consumer(
            "comment-viewer",
            &opened(&["stage-overlay"])
        ));
        // 逆順も同じ（ステージ窓を閉じるがコメビュ窓は生きている）。
        assert!(!is_last_sidecar_consumer(
            "stage-overlay",
            &opened(&["comment-viewer"])
        ));
    }

    /// 061k（security-review・変異⑯-k）: **どの消費者窓も、他の 1 つが生きていれば sidecar を延命する。**
    ///
    /// ⚠⚠ **上のケースはラベルを直書きしているので、窓を足しても新しいラベルを一度も通らない。**
    /// ここは `SIDECAR_CONSUMER_LABELS` の**全順序対**を回すので、
    /// 「特定のラベルだけ判定から除外する」変異（＝その窓が開いていても落とす＝**演出が黙って止まる**）を
    /// 窓の数に関係なく殺す。⚠ **窓を足しても手を入れなくてよい**（これが総当たりにした目的）。
    #[test]
    fn every_consumer_window_keeps_the_sidecar_alive_for_every_other_one() {
        for closing in SIDECAR_CONSUMER_LABELS {
            for survivor in SIDECAR_CONSUMER_LABELS {
                if closing == survivor {
                    continue;
                }
                assert!(
                    !is_last_sidecar_consumer(closing, &opened(&[survivor])),
                    "`{closing}` を閉じたとき `{survivor}` が生きているのに sidecar を落とそうとしている\
                     （その窓のコメント表示が黙って止まる＝061b/061k の目的が壊れる）"
                );
            }
        }
    }

    /// 061k（security-review・変異⑯-k の裏側）: **自分以外に消費者が 1 つも無ければ必ず落とす。**
    ///
    /// ⚠⚠ こちらは**孤児プロセスを残さない**側（docs/security.md §6 の趣旨）の総当たりである。
    /// 「特定のラベルだけを常に生存扱いにする」変異＝**その窓を最後に閉じても sidecar が残る**を殺す。
    /// ⚠ 自窓は `CloseRequested` の時点でまだ開いていると報告されるので、
    /// **自窓が開いている状態でも `true`（＝落とす）になること**まで見る。
    #[test]
    fn every_consumer_window_stops_the_sidecar_when_it_is_the_last_one() {
        for closing in SIDECAR_CONSUMER_LABELS {
            // Destroyed 相当（自窓はもう居ない）。
            assert!(
                is_last_sidecar_consumer(closing, &opened(&[])),
                "`{closing}` が最後の消費者なのに sidecar を落とさない（孤児が残る・§6）"
            );
            // CloseRequested 相当（自窓はまだ居る）＋ 消費者でない窓が開いている。
            assert!(
                is_last_sidecar_consumer(
                    closing,
                    &opened(&[closing, "main", "comment-overlay", "pinned-overlay"])
                ),
                "`{closing}` の CloseRequested で自窓の除外が効いていない（どの窓を閉じても落ちなくなる）"
            );
        }
    }

    #[test]
    fn close_requested_ignores_the_window_that_is_closing() {
        // ⚠⚠ **本命**: `CloseRequested` の時点では**自窓がまだ開いていると報告される**。
        // 自窓をラベルで除外していないと、ここが false（＝落とさない）になり
        // **どの窓を閉じても sidecar が落ちなくなる**（孤児が残る）。
        assert!(is_last_sidecar_consumer(
            "comment-viewer",
            &opened(&["comment-viewer"])
        ));
        assert!(is_last_sidecar_consumer(
            "effect-overlay",
            &opened(&["effect-overlay"])
        ));
        // 自窓＋sidecar と無関係な窓が開いていても同じ（それらは消費者ではない）。
        assert!(is_last_sidecar_consumer(
            "effect-overlay",
            &opened(&["effect-overlay", "main", "comment-overlay", "pinned-overlay"])
        ));
    }

    #[test]
    fn stops_when_no_other_consumer_remains() {
        // `Destroyed` の時点では自窓も消えている。どちらの窓を閉じたときも落とす。
        assert!(is_last_sidecar_consumer("comment-viewer", &opened(&[])));
        assert!(is_last_sidecar_consumer("effect-overlay", &opened(&[])));
    }

    #[test]
    fn overlay_only_windows_do_not_keep_the_sidecar_alive() {
        // ⚠ `comment-overlay` / `pinned-overlay` は **`SIDECAR_CONSUMER_LABELS` に入っていない**
        //（033f/046b から不変）。これらが開いていても sidecar は延命されない＝停止条件が緩まない。
        // ミューテーション: どちらかを `SIDECAR_CONSUMER_LABELS` へ足すとこのテストが落ちる。
        assert!(is_last_sidecar_consumer(
            "comment-viewer",
            &opened(&["comment-overlay", "pinned-overlay", "main"])
        ));
    }

    #[test]
    fn unknown_closing_label_still_counts_every_consumer() {
        // 防御的: 知らないラベルで呼ばれても、消費者が生きていれば落とさない（fail-safe 側）。
        assert!(!is_last_sidecar_consumer(
            "main",
            &opened(&["comment-viewer"])
        ));
        assert!(is_last_sidecar_consumer("main", &opened(&[])));
    }

    #[test]
    fn consumer_labels_are_unique() {
        // 重複があると「自窓を除外したのにもう 1 つ同じラベルが残る」＝永久に落ちない形が作れる。
        for (i, a) in SIDECAR_CONSUMER_LABELS.iter().enumerate() {
            for (j, b) in SIDECAR_CONSUMER_LABELS.iter().enumerate() {
                assert!(
                    i == j || a != b,
                    "SIDECAR_CONSUMER_LABELS にラベルの重複がある: {a}"
                );
            }
        }
    }
}

#[cfg(test)]
mod sidecar_lifecycle_contract {
    //! 061b: **`comment_sidecar::shutdown` が「どこから・どういう条件で」呼ばれるかの形**を固定する。
    //!
    //! 上の `sidecar_lifecycle` は判定関数そのものを検証するが、**配線を間違えれば判定関数は素通りされる**
    //! （例: エフェクト窓のハンドラで直接 `shutdown` を呼ぶ／エフェクト窓にハンドラを登録し忘れる）。
    //! 実窓を伴う挙動は単体テストできないので、`overlay_window_contract` と同じ手口
    //! （`include_str!` でソースを文字列として読む・新規依存ゼロ・`#[cfg(test)]` のみ）で**形**を固定する。
    //!
    //! ⚠⚠ **needle は必ず実行時に `format!` で組む。** `include_str!("lib.rs")` は
    //! **このモジュール自身のソースも読む**ので、検索文字列を直書きすると自己ヒットして
    //! 数が合わなくなる／テストが骨抜きになる（`overlay_window_contract` が 2 度踏んで注記を残している）。
    //!
    //! ⚠ ここが緑でも**実挙動の保証にはならない**。最終担保は実機 3 経路
    //! （①コメビュ窓 → エフェクト窓の順で閉じる ②逆順 ③アプリ終了）で、
    //! いずれでも sidecar のプロセスが残らないことをプロセス一覧で確認すること。
    //!
    //! ⚠⚠ **061b レビュー（S-3）で、当初の 5 ケースが実測ミューテーション 4 件を取り逃していた**ので
    //! 検査を強化した。取り逃していたのは:
    //!   - **M1** 2 窓のラベルを**入れ替える**（数もラベルの出現数も変わらないので素通りしていた）
    //!   - **M2** アームから `CloseRequested` を落として `Destroyed` だけにする
    //!   - **M3** `RunEvent::Exit` を `match` で条件化する（`if ` が現れないので素通りしていた）
    //!   - **M5** ガードの `is_open` を `... .is_some() && false` にする（実窓を見るふりだけ）
    //! いずれも「字面が存在するか」しか見ていなかったのが原因なので、**存在ではなく形**
    //! （どの窓のブロックの中にあるか／式そのもの／アームに他に何も無いこと）を見る形へ寄せた。
    //! ⚠ 逆に **M4**（Exit アームに無関係な `if` を足す）で落ちる**偽陽性**も同時に潰してある。

    use super::SIDECAR_CONSUMER_LABELS;

    const LIB_RS: &str = include_str!("lib.rs");

    /// 行コメント（`//` 始まり）を落としたソース。⚠ このモジュールの説明コメント自身が needle を含むため、
    /// 素の `LIB_RS` で数えると常に多く数えてしまう（`updater_plugin_stays_registered` と同じ対策）。
    fn code_only() -> String {
        LIB_RS
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// `head` の直後から**列 0 の `}`**（＝トップレベル定義の終わり）までを切り出す。
    ///
    /// ⚠⚠ 切り出しが「列 0 の閉じ波括弧」に依存しているのは承知のうえで、**上限 `max_len` を必ず掛ける**
    /// （061b レビュー Q-9）。rustfmt の設定変更や関数を `impl` ブロックへ移す変更が入ると、
    /// このブロックは**エラーにならず黙って伸び**、以降の `contains` 検査が別の定義まで拾って
    /// **緑のまま骨抜き**になる。上限を超えたら「前提が崩れた」として落とすのが目的で、
    /// 上限そのものに意味は無い（実測の 2 倍程度を置く）。**上限に引っかかったら数字を上げる前に、
    /// 切り出し方が壊れていないかを先に確かめること。**
    fn block_after(code: &str, head: &str, max_len: usize) -> String {
        let block = code
            .split_once(head)
            .and_then(|(_, rest)| rest.split_once("\n}"))
            .map(|(block, _)| block.to_string())
            .unwrap_or_else(|| panic!("`{head}` が lib.rs に見つからない"));
        assert!(
            block.len() <= max_len,
            "`{head}` から切り出したブロックが {} 文字ある（上限 {max_len}）。\
             列 0 の `}}` までで 1 定義が終わるという前提が崩れ、別の定義まで飲み込んでいる可能性が高い\
             （ここが伸びると以降の検査が緑のまま骨抜きになる）",
            block.len()
        );
        block
    }

    #[test]
    fn shutdown_is_called_from_exactly_two_places() {
        // ⚠⚠ **ミューテーション検知の本命**: 窓イベントで無条件 `shutdown` を呼ぶ実装へ戻すと 3 件になる。
        // 期待する 2 件は ①`shutdown_sidecar_if_last_consumer` の中（＝窓の存在確認を経る唯一の経路）
        // ②`RunEvent::Exit` の中（＝アプリ終了時の無条件停止）。
        // ⚠ これは **lib.rs の中だけ**を数えている。リポジトリ全体では `app_update/commands.rs`
        // （アップデート適用前の再起動経路）にも 3 つ目の呼び出しがあり、それは対象外＝正常
        //（061b レビュー Q-6・数え漏らしではない）。
        let needle = format!("{}::{}(", "comment_sidecar", "shutdown");
        let count = code_only().matches(needle.as_str()).count();
        assert_eq!(
            count,
            2,
            "lib.rs 内の comment_sidecar::shutdown の呼び出しが {count} 箇所ある（期待 2 ＝ 窓の存在確認を経るガード関数の中と RunEvent::Exit の中だけ。lib.rs 外の app_update は数えない）。\
             窓イベントから直接呼ぶと、どちらかの窓を閉じただけで sidecar が落ちる（061b の目的が壊れる）"
        );
    }

    #[test]
    fn the_guard_checks_real_windows_before_shutting_down() {
        // ⚠ frontend の設定値ではなく**実窓**で判定する（docs/security.md §8）ことの字面での固定。
        let code = code_only();
        let guard_head = format!("fn {}(", "shutdown_sidecar_if_last_consumer");
        let body = block_after(&code, &guard_head, 400);

        // ⚠⚠ **実窓を見る式そのもの**を完全一致で固定する（061b レビュー S-3・変異 M5）。
        // 旧実装は `contains("get_webview_window(")` だけを見ていたため、
        // `app.get_webview_window(label).is_some() && false` のような
        // **「実窓を見るふりだけして常に true を返さない」変異が生存**していた
        //（＝どちらか 1 窓を閉じただけで sidecar が落ち、061b の目的そのものが壊れる）。
        // 実窓の有無は `AppHandle` 無しでは実行時に検証できないので、ここは字面の完全一致でしか止められない。
        // ⚠ **式を書き換えるときは、変更後も同じ意味であることを実機 3 経路で確認してからこの行を直すこと。**
        let real_window_probe = format!(
            "let is_open = |label: &str| app.{}(label).is_some();",
            "get_webview_window"
        );
        assert!(
            body.contains(real_window_probe.as_str()),
            "停止ガードが実窓を素で見ていない（設定値で判定してはいけない・§8）。期待する式:\n  {real_window_probe}"
        );
        // ⚠⚠ **極性（`!` の有無）まで固定する**（061b レビュー②S-1・実測で生存した変異）。
        // 旧実装は `contains("is_last_sidecar_consumer(")` しか見ていなかったため、
        // **条件を `if !is_last_sidecar_consumer(...)` へ反転する変異が cargo 280 件緑のまま生存**していた。
        // 反転すると次の 2 つが同時に起きる（この設計が防ごうとしている失敗の両方）:
        //   - 他の消費者窓が生きているとき → **落としてしまう**（061b の目的が壊れ、取得も止まる）
        //   - 自分が最後の消費者のとき     → **落とさない＝孤児プロセスが残る**（§6 の趣旨に反する）
        // 上の `mod sidecar_lifecycle` は純関数だけを見ており**配線の向きは見ていない**ので、
        // 極性を止められるのはここだけ（実窓を伴う挙動は `AppHandle` 無しでは実行時に検証できない）。
        // ⚠ 条件式を書き換えるときは、実機 3 経路（コメビュ→エフェクト／逆順／アプリ終了）で
        //   孤児が残らないことを確かめてからこの needle を直すこと。
        let decide = format!("if {}(closing_label, &is_open) {{", "is_last_sidecar_consumer");
        assert!(
            body.contains(decide.as_str()),
            "停止ガードの条件式が期待の形（**極性を含む**）になっていない。期待する式:\n  {decide}\n\
             ⚠ `!` を付ける／`if let` や `match` へ書き換えると、孤児が残る側にも 061b の目的が壊れる側にも倒れる"
        );
        let shutdown = format!("{}::{}(", "comment_sidecar", "shutdown");
        assert!(
            body.contains(shutdown.as_str()),
            "停止ガードから comment_sidecar::shutdown を呼んでいない"
        );
    }

    #[test]
    fn app_exit_still_stops_the_sidecar_unconditionally() {
        // ⚠⚠ `app.exit(0)` では窓イベント（CloseRequested / Destroyed）が **1 つも配送されない**ので、
        // アプリ終了経路の担保は RunEvent::Exit の無条件 shutdown **だけ**。条件付きにすると孤児が残る。
        let code = code_only();
        let exit_head = format!("{}::{} = event", "RunEvent", "Exit");
        let arm = code
            .split_once(exit_head.as_str())
            .and_then(|(_, rest)| rest.split_once("\n        });"))
            .map(|(arm, _)| arm.to_string())
            .expect("RunEvent::Exit のハンドラが見つからない");
        assert!(
            arm.len() <= 200,
            "RunEvent::Exit のアームが {} 文字ある（上限 200）。切り出しの終端目印がずれて別の場所まで飲み込んでいる",
            arm.len()
        );

        // ⚠⚠ **アームの中身が「停止 1 文だけ」**であることを、空白を潰した完全一致で固定する。
        // 旧実装は `!arm.contains("if ")` だったが、これは**両方向に壊れていた**（061b レビュー S-3）:
        //   - **偽陰性**＝`match any_open { .. }` や `?` で条件化すると `if ` が現れず**素通り**する（実測で生存）
        //   - **偽陽性**＝無関係な `if cfg!(debug_assertions) {}` を 1 行足しただけで落ちる（実測で失敗）
        // 「ここには停止しか書かない」という不変条件そのものを見る形にした。
        // ⚠ ログ出力なども含めて**何も足さないこと**。足したくなったら、それは
        //   `cleanup_before_exit` など別のフックの仕事かどうかを先に考えること。
        let squashed = arm.split_whitespace().collect::<Vec<_>>().join(" ");
        let expected = format!("{{ {}::{}(app_handle); }}", "comment_sidecar", "shutdown");
        assert_eq!(
            squashed, expected,
            "RunEvent::Exit のアームが「無条件の停止 1 文だけ」になっていない。\
             ここはアプリ終了経路で sidecar を落とす**唯一の担保**なので、条件分岐も追加処理も入れてはいけない"
        );
    }

    #[test]
    fn every_consumer_window_registers_the_guard() {
        // ⚠⚠ **エフェクト窓側の登録を忘れる**のが最も危険な抜け方（コメビュ窓を先に閉じたあと
        // エフェクト窓を閉じても誰も落とさない＝孤児）。まず呼び出し数がラベル数と一致すること。
        let code = code_only();
        // ⚠⚠ **needle に「ローカル変数名」を書かないこと**（061b レビュー②Q-1・実測で偽陽性）。
        // 旧実装は `"...(&app_for_event, "` と書いていたため、**挙動を 1 ミリも変えない
        // 変数リネーム（`app_for_event` → 何か）でこのテストが落ち**、しかもメッセージが
        // 「呼び出しが 1 箇所」＝存在しない登録漏れの捜索へ読み手を送り込んでいた。
        // `(&` までにして**呼び出しであること**（定義側は `(app: &AppHandle` なので一致しない）だけを見る。
        let guard_call = format!("{}(&", "shutdown_sidecar_if_last_consumer");
        let count = code.matches(guard_call.as_str()).count();
        assert_eq!(
            count,
            SIDECAR_CONSUMER_LABELS.len(),
            "停止ガードの呼び出しが {count} 箇所（期待 {} ＝ SIDECAR_CONSUMER_LABELS の窓すべてが窓イベントを登録していること）",
            SIDECAR_CONSUMER_LABELS.len()
        );

        // ⚠⚠ **ラベルの出現数だけを見てはいけない**（061b レビュー S-3・変異 M1）。
        // 旧実装は「各ラベルがどこかに 1 回現れる」しか見ていなかったため、
        // **2 窓のラベルを入れ替える変異が生存**していた（自窓ではない方を除外するので判定が反転し、
        // `CloseRequested` では落とさない＝プラットフォーム次第で孤児が残る）。
        // **その窓を生成している関数のブロックの中**にあることまで見る。
        let builder_head = format!("{}::new(&app, ", "WebviewWindowBuilder");
        let both_events = format!(
            "{}::CloseRequested {{ .. }} | {}::Destroyed",
            "WindowEvent", "WindowEvent"
        );
        for label in SIDECAR_CONSUMER_LABELS {
            let window_fn_tail =
                block_after(&code, &format!("{builder_head}\"{label}\""), 1800);

            // ⚠ 変異 M2（片方のイベントだけにする）を止める。どちらのイベントが届くかは
            //   プラットフォームと閉じ方（`.close()` / `.destroy()` / OS の×ボタン）で変わるので、
            //   **両方に付けて自窓をラベル除外する**のが 061b の設計（`is_last_sidecar_consumer` の注記）。
            assert!(
                window_fn_tail.contains(both_events.as_str()),
                "窓 `{label}` の窓イベントが CloseRequested と Destroyed の**両方**を見ていない（片方だけだと取りこぼす経路が残る）"
            );
            // ⚠ 変異 M1（ラベルの取り違え）を止める。⚠ **第 1 引数（変数名）を跨いで第 2 引数だけを見る**
            //   ——ここにローカル変数名を書くと Q-1 の偽陽性が戻る。呼び出しの直後 80 文字だけを切り出し、
            //   その中に `, "<自分のラベル>")` があることを見る（ラベル単体の `contains` では
            //   `get_webview_window("comment-viewer")` 等に誤ヒットするので、必ず引数の位置ごと見る）。
            let args_tail = window_fn_tail
                .split_once(guard_call.as_str())
                .map(|(_, rest)| rest.chars().take(80).collect::<String>())
                .unwrap_or_default();
            let with_label = format!(", \"{label}\")");
            assert!(
                args_tail.contains(with_label.as_str()),
                "窓 `{label}` が**自分のラベル**で停止ガードを呼んでいない（ラベルを取り違えると自窓の除外が効かず判定が反転する）"
            );
        }
    }

    #[test]
    fn consumer_labels_are_windows_that_actually_exist() {
        // ラベルの typo は「実在しない窓を数える」＝**永久に落ちない**方向に効くので、
        // `WebviewWindowBuilder::new(&app, "<label>"` に実在することを突き合わせる。
        let code = code_only();
        let builder_head = format!("{}::new(&app, ", "WebviewWindowBuilder");
        for label in SIDECAR_CONSUMER_LABELS {
            let needle = format!("{builder_head}\"{label}\"");
            assert!(
                code.contains(needle.as_str()),
                "SIDECAR_CONSUMER_LABELS の `{label}` を生成している窓が lib.rs に無い（ラベルの typo は「落ちない」方向に壊れる）"
            );
        }
    }
}
