import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppUpdateInstallOutcome } from "./bindings/AppUpdateInstallOutcome";
import type { AppUpdateProgress } from "./bindings/AppUpdateProgress";
import type { AppUpdateStatus } from "./bindings/AppUpdateStatus";

/**
 * 055b: アプリ自己アップデートの Tauri command の薄いラッパ。
 * コンポーネントは invoke を直接呼ばず、この API 経由で更新状態を取得する。
 *
 * 055d: DL/インストール/再起動と、進捗イベントの購読を足した。
 * ⚠ **`@tauri-apps/api/event` を「値として」import してよいのはこのファイルだけ**（`invoke` と同じ構え）。
 * リポジトリ初の Tauri イベント利用なので、購読の入口を 1 箇所に閉じ込めておく。
 * `useAppUpdate.ts` が `UnlistenFn` を **type-only** で import しているのは対象外
 * （型は実行時に何も引き込まない・055d review Q-14）。
 *
 * ⚠⚠⚠ **2026-08-23（063c 段 2-a）訂正: 値 import は 2 本になった。**
 * 2 本目は `screens/obs-effects/gachaStageEvent.ts`（**窓間イベントの入口**＝当選結果を
 * コメビュ窓からステージ窓へ `emitTo` で渡す）。⚠ 用途が違う——**こちらは Rust → frontend の通知**、
 * あちらは **frontend → frontend（窓間）**である。
 * ⚠⚠ **3 本目を作らないこと。** 新しい購読が要るなら、
 * 「Rust からの通知」ならこのファイル、「窓間」なら `gachaStageEvent.ts` へ寄せる
 * （入口が散ると「誰がどの窓に何を撒いているか」が追えなくなる、という 055d の理由がそのまま生きている）。
 */

/**
 * 公開リリースの `latest.json` を見て「更新があるか」を判定する（055b）。
 *
 * **引数は取らない**。宛先（endpoint URL）も現在バージョンも Rust/`tauri.conf.json` 側が持ち、
 * frontend からは一切渡さない（docs/security.md §3 最小権限 / §8）。
 *
 * ⚠ **reject を握り潰さないこと**。「更新なし」は `{ available: false }` で **resolve** し、
 * 「確認できなかった」（ネットワーク到達不可 / エンドポイント 404 / JSON 破損 / 署名検証失敗）は
 * `AppError`（`code: "UPDATE_CHECK_FAILED"`）で **reject** する。055c はこの 2 つを別表示にするため、
 * ここで catch して `available: false` に潰すと仕様が壊れる。
 *
 * Rust 側は 15 秒でタイムアウトするので、この Promise が永久に pending になることはない。
 */
export function checkAppUpdate(): Promise<AppUpdateStatus> {
  return invoke<AppUpdateStatus>("check_app_update");
}

/**
 * 更新をダウンロードしてインストールする（055d）。
 *
 * **引数は取らない**。URL・バージョン・ファイル名・保存先を frontend から渡す経路を作らない
 * （§3 最小権限 / §8）。Rust 側は毎回 `check` からやり直すので、こちらから `AppUpdateStatus` を
 * 渡し直す必要も無い。
 *
 * - resolve ＝ **何が起きたかは戻り値 `AppUpdateInstallOutcome` が示す**（055d review S-2）。
 *   - `"installed"` … DL とインストールを完了した（macOS）。
 *   - `"noUpdate"` … 押した時点では更新があったが、再確認したら無かった＝**何もしていない**。
 *   - `"alreadyRunning"` … 別のインストールが走行中だった＝**何もしていない**。
 *   ⚠ **resolve したことを「完了」と読まないこと。** `"alreadyRunning"` を完了として扱うと、
 *   走行中の自己置換の最中に再起動を促す誤報になる（最悪 `.app` が消える）。
 * - reject ＝ `AppError`（`code: "UPDATE_INSTALL_FAILED"`）。DL 失敗・**署名検証失敗**・展開失敗・
 *   置換の権限不足・**インストール先パスに shell メタ文字がある**（review S-1 の fail-closed）を
 *   すべて含む。⚠ **`message` を画面に出さないこと**（§9・定型文言を使う）。
 *
 * ⚠ **Windows ではこの Promise は resolve も reject もしない**。plugin の `install()` が
 * インストーラを起動した直後に `std::process::exit(0)` するため、**プロセスごと消える**のが正常系。
 * 呼び出し側はこれを異常として扱わないこと（`useAppUpdate` は「installing のまま」で待つ）。
 *
 * ⚠ **DL は既定で無期限ではない**（Rust 側で connect 15 秒 / read 30 秒）。ただし plugin 内部には
 * こちらで消せない panic 経路があり、そこを踏むと Promise が永久未解決になる。
 * 逃げ道は `useAppUpdate` の watchdog（`INSTALL_WATCHDOG_MS`）。
 */
export function installAppUpdate(): Promise<AppUpdateInstallOutcome> {
  return invoke<AppUpdateInstallOutcome>("install_app_update");
}

/**
 * アプリを再起動して新しいバージョンを反映する（055d）。
 *
 * ⚠ **この Promise は解決しない**（プロセスが再起動するため）。await の完了を待つ設計にしないこと。
 * Rust 側は再起動前に sidecar を明示的に停止する（孤児プロセスを残さない）。
 */
export function restartApp(): Promise<void> {
  return invoke<void>("restart_app");
}

/**
 * DL/インストールの進捗イベント名（Rust 側の `APP_UPDATE_PROGRESS_EVENT` と一致させること）。
 *
 * ⚠ **2 箇所に同じ文字列を持っている**（ts-rs は const を書き出さないため）。
 * ズレると進捗が一切表示されないまま気付けないので、`appUpdateApi.test.ts` で値を固定している。
 */
export const APP_UPDATE_PROGRESS_EVENT = "app-update:progress";

/**
 * 進捗イベントを購読する。戻り値の関数で必ず解除すること。
 *
 * ⚠ **capability は増えていない**。`listen` に必要な `core:event:allow-listen` は `core:default` に
 * 既に含まれており（`core:default` → `core:event:default` → `allow-listen`）、4 窓すべてが
 * `core:default` を持っている＝`capabilities/*.json` は 1 文字も変えていない。
 *
 * ⚠ Rust 側は `app.emit()`＝**全窓ブロードキャスト**で送っている（`emit_to` でラベルを指定しても、
 * 既定の `listen()` は `EventTarget::Any` で登録されるため tauri 側のフィルタを素通りする＝絞れない）。
 * 実際にメイン窓だけが受け取るのは「`MainWindowApp` でしか購読しない」というアプリ側の構造による。
 * ペイロードはバイト数とフェーズだけなので情報漏えいの面は無い（§9）。
 *
 * ⚠ **進捗イベントは webview 側からも emit できる**（`core:event:allow-emit` も既定で配られている）＝
 * 内容を信頼して処理を分岐させないこと。**完了判定は必ず `installAppUpdate()` の resolve で行う**。
 */
export function listenAppUpdateProgress(
  handler: (progress: AppUpdateProgress) => void,
): Promise<UnlistenFn> {
  return listen<AppUpdateProgress>(APP_UPDATE_PROGRESS_EVENT, (event) => {
    handler(event.payload);
  });
}
