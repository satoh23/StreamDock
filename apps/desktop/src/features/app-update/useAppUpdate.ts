import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  checkAppUpdate,
  installAppUpdate,
  listenAppUpdateProgress,
  restartApp,
} from "./appUpdateApi";
import type { AppUpdateStatus } from "./bindings/AppUpdateStatus";

/**
 * 055c: アプリ更新状態のフック。`usePresets` / `useLogs` と同じく **App が 1 つだけ持ち**、
 * `Header`（バッジ）と `UpdateScreen`（本文）へ props で配る。
 *
 * ⚠ **「更新なし」と「確認できなかった」を潰さないこと**（055b）。
 * - 更新なし ＝ resolve して `available: false` → `phase: "ready"` ＋ `status.available === false`
 * - 確認できなかった ＝ reject → `phase: "error"` ＋ **`status` は `null` のまま**
 * `catch` して `available: false` を作らないので、オフラインが「最新です」に化けない。
 *
 * ⚠ **§9: 生エラー文字列・URL・ローカルパスを画面にもコンソールにも出さない。**
 * そのため `toErrorMessage(e)`（`AppError.message` を素通しする既存ヘルパ）は**使わない**。
 * 今日の Rust 側は固定文言だけを返すが、素通しは「将来 message に何が入っても出す」形になるため、
 * ここでは**このモジュールが持つ定数だけ**を `error` に載せ、例外オブジェクトはフックの外へ一切出さない。
 * `console.*` も 1 つも書かない。
 *
 * ⚠ 更新状態を localStorage / SQLite に**永続化しない**（新規の保存経路を作らない）。
 */

/** 取得失敗時に画面へ出してよい唯一の文言（バージョン文字列以外の可変情報を含めない）。 */
export const UPDATE_CHECK_ERROR_MESSAGE =
  "更新を確認できませんでした。ネットワークの状態を確認して、しばらくしてからもう一度お試しください。";

/** DL / インストール失敗時の定型文言（055d）。生エラー・URL・パスは載せない（§9）。 */
export const UPDATE_INSTALL_ERROR_MESSAGE =
  "更新のインストールに失敗しました。ネットワークの状態を確認して、しばらくしてからもう一度お試しください。";

/**
 * インストールが進まなくなったときの文言（055d・watchdog 発火時）。
 *
 * ⚠ **再試行ではなくアプリの再起動を促す**のは、この状態が
 * 「Rust 側の処理がまだ生きているかもしれないが、UI からは追跡できなくなった」を意味するため。
 * invoke は abort できないので、ここで「もう一度お試しください」と言うのは正確でない。
 */
export const UPDATE_INSTALL_STALLED_MESSAGE =
  "更新を完了できませんでした。アプリを終了して、もう一度起動してからお試しください。";

/**
 * `installing` に入ってから、進展が無いまま何 ms 経ったら諦めるか（055d）。
 *
 * ⚠ **これは plugin 内部の「こちらでは消せない panic 経路」への逃げ道**。
 * `tauri-plugin-updater` の macOS 昇格インストール経路は
 * `script.compile().expect(…)` / `tx.send(r).unwrap()` / `rx.recv().unwrap()` を含み、
 * ここで panic すると **invoke の Promise が永久未解決**になって UI が「インストール中」から戻らない。
 * こちらの Rust コードから `unwrap`/`expect` を全廃しても防げない。
 *
 * ⚠ **Rust 側の処理は止まらない**。これは UI を返すだけの仕掛けであって、キャンセルではない。
 * したがって watchdog 発火後に遅れて Promise が settle しても state を上書きしないよう、
 * `installRunRef`（世代カウンタ）で無効化している。
 *
 * ⚠ **Windows では発火しない**。Windows の `install()` はプロセスごと終了するので、
 * タイマもろとも消える（発火する頃にはアプリが存在しない）。
 *
 * 値の根拠: DL は別フェーズ（`downloading`）なので、この 120 秒が測るのは
 * **署名検証＋アーカイブ展開＋自己置換**だけ。数百 MB でも数十秒に収まる想定で、倍以上の余裕を取った
 * （実測は 099b）。短くしすぎると正常な更新を「失敗」と誤表示する。
 */
export const INSTALL_WATCHDOG_MS = 120_000;

/**
 * `install()` を始めてからの**絶対上限**（055d review S-5）。
 *
 * ⚠ **上の watchdog だけでは足りない**理由: `core:event:allow-emit` は `core:default` に含まれるので、
 * **どの窓の webview からでも `app-update:progress` を偽造できる**。実行中でないイベントは捨てているが、
 * **実行中は信頼して watchdog を張り直す**ので、偽イベントを送り続けられると
 * 「plugin 内部の panic から抜ける唯一の逃げ道」が永久に発火しなくなる。
 * この 1 本は**進捗では絶対に延長されない**ので、何が届いても必ず上限で UI が戻る。
 *
 * 値の根拠: DL（低速回線で数百 MB）＋署名検証＋展開＋自己置換を全部含めた実時間の上限。
 * 15 分あれば正常系を殺さない一方、「押してから 15 分戻らない」は明らかに異常と言える。
 * ⚠ Windows では発火しない（`install()` がプロセスごと終了させるのでタイマもろとも消える）。
 */
export const INSTALL_DEADLINE_MS = 900_000;

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "ready"
  | "downloading"
  | "installing"
  | "installed"
  | "error";

/** DL の進捗。総バイト数が不明なら `totalBytes` は `null`（＝UI は不定形表示）。 */
export interface AppUpdateProgressState {
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface UseAppUpdateResult {
  /** 確認できたときだけ入る。取得失敗時は `null` のまま（`available:false` に潰さない）。 */
  status: AppUpdateStatus | null;
  phase: AppUpdatePhase;
  /** 取得失敗時の定型文言。生エラー由来の文字列は入らない。 */
  error: string | null;
  /** `downloading` / `installing` の間だけ入る。それ以外は `null`。 */
  progress: AppUpdateProgressState | null;
  /** ユーザーの明示操作による再確認。実行中は何もしない（多重実行しない）。 */
  recheck: () => Promise<void>;
  /** アップデートボタン。実行中は何もしない（`recheck` と相互排他）。 */
  install: () => Promise<void>;
  /** 再起動ボタン（macOS）。解決しない Promise を返す（プロセスが再起動する）。 */
  restart: () => Promise<void>;
}

export function useAppUpdate(): UseAppUpdateResult {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AppUpdateProgressState | null>(null);

  /**
   * 055b レビュー S-4:「実行中は再実行しない」。`check_app_update` には Rust 側のガードも
   * レート制限も無いので、多重実行を防ぐのはここの責務。
   *
   * ⚠ **StrictMode の二重発火を止めているのもこの 1 本**。`main.tsx` は `<React.StrictMode>` なので
   * dev では effect が mount → cleanup → mount と 2 回走るが、**この 2 回は同一 tick で同期に起きる**ため、
   * `await` の**前**に同期でフラグを立てれば 2 回目は必ず弾ける。
   * 当初は「起動時 1 回」用の `startedRef` を別に持っていたが、**ミューテーションで確認したところ
   * 外しても全テストが緑のまま**だった（＝この 1 本が両方を担っており、`startedRef` は
   * どのテストでも区別できない防御コードだった）ので、`inFlightRef` 1 本に畳んだ。
   *
   * ⚠ **訂正（055c review）**: 当初ここには「`startedRef` を殺せるテストは**原理的に**書けない」と
   * 書いていたが、**これは誤り**。`inFlightRef` が守れるのは「実行中の再入」だけで、
   * **完了後に同一インスタンス上で effect が再実行される経路**は素通しする。
   * React 19.2 の `<Activity>` で実測すると、hide → show で `checkAppUpdate` が **2 回**発火する
   * （`<Activity mode="hidden">` は state と ref を保持したまま effect だけを破棄し、
   * visible で同一インスタンス上に再生成するため、`inFlightRef` は既に false に戻っている）。
   * ＝畳んだ判断は「現在この経路が存在しないので今は要らない」であって「守る価値が無い」ではない。
   *
   * ⚠ **再修正トリガー（2 つ。どちらか一方でも成立したら旧 `startedRef` 相当が要る）**:
   * 1. 下の `run` の `useCallback` に依存を足す（effect の依存が変わって再実行されうる）。
   * 2. **このフックを持つ木が、完了後に effect を作り直しうる構造に入る**——
   *    `<Activity>` / Offscreen での保持、`<Suspense>` の再開、タブ化などが該当する。
   *    実測済みの経路なので「起きるかもしれない」ではなく「入れたら必ず 2 回走る」。
   *
   * ⚠ **055d: `install` とも共有する**（＝`recheck` と `install` は相互排他）。
   * 更新チェックの最中にインストールを始める／その逆に意味は無く、
   * どちらも「実行中は何もしない」で正しい。上の再修正トリガー 2 つは `install` にもそのまま当てはまる。
   */
  const inFlightRef = useRef(false);

  /**
   * 実行の「世代」。`recheck` / `install` のどちらを始めるときも +1 する。
   *
   * ⚠ **watchdog で見捨てた実行が、後から state と `inFlightRef` を巻き戻すのを防ぐ**ためのもの。
   * Rust 側の処理は止められないので、「もう見捨てた実行」の結果は捨てるしかない。
   *
   * ⚠ **check と install で共有する**のが要点。別々に持つと、watchdog 後に始めた `recheck` の
   * 実行中に、見捨てた install が遅れて settle して `inFlightRef` を落とし、
   * 3 本目が走れてしまう。「共有フラグは共有の世代で守る」。
   */
  const runRef = useRef(0);

  /** 進捗イベントを state に反映してよいか（`install` 実行中だけ true）。 */
  const installActiveRef = useRef(false);

  /** watchdog のタイマ ID。進捗が来るたびに張り直す（滑走窓）。 */
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 絶対上限のタイマ ID。`install()` 開始時に 1 回だけ張り、**進捗では張り直さない**。 */
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    runRef.current += 1;
    const generation = runRef.current;
    setPhase("checking");
    setProgress(null);
    try {
      const result = await checkAppUpdate();
      if (runRef.current !== generation) return;
      setStatus(result);
      setError(null);
      setPhase("ready");
    } catch {
      // ⚠ 例外を束縛しない（束縛できる形にすると、後から誰かが message を画面へ載せられる）。
      //    Rust 側の `map_err(|_| …)` と同じ構えを frontend でも取る。
      if (runRef.current !== generation) return;
      setStatus(null);
      setError(UPDATE_CHECK_ERROR_MESSAGE);
      setPhase("error");
    } finally {
      // 自分がまだ「現在の実行」であるときだけフラグを返す（見捨てられた実行は何もしない）。
      if (runRef.current === generation) inFlightRef.current = false;
    }
  }, []);

  /** 2 本のタイマをまとめて止める。`installing` を抜けるすべての経路から呼ぶ。 */
  const clearInstallTimers = useCallback(() => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (deadlineRef.current !== null) {
      clearTimeout(deadlineRef.current);
      deadlineRef.current = null;
    }
  }, []);

  /**
   * 実行を見捨てて UI を返す（watchdog と絶対上限の**共通の**後始末）。
   *
   * ⚠ やることが 3 つある:
   * 1. `installActiveRef` を落とす（＝以後の進捗イベントを無視する）。
   * 2. `inFlightRef` を**返す**。ここを忘れると、見捨てた実行の Promise が永久に settle しないため
   *    **フラグが立ちっぱなしになり、再確認もアップデートも二度と押せなくなる**
   *    （＝UI だけ戻して操作は死んだまま、という一番たちの悪い状態）。
   * 3. 世代を進める。これで、後から settle した「見捨てた実行」が state を巻き戻さなくなる。
   *
   * ⚠ 2 の副作用として、**見捨てた Rust 側の処理が走ったままもう 1 本 install を始められる**。
   * これは Rust 側の `InstallGuard` が受け止め、**`"alreadyRunning"` として返ってくる**
   * （＝下の `install` はそれを「完了」にせず、もう一度この文言へ落とす・055d review S-2）。
   */
  const abandonInstall = useCallback(
    (generation: number) => {
      if (runRef.current !== generation) return;
      clearInstallTimers();
      installActiveRef.current = false;
      inFlightRef.current = false;
      runRef.current += 1;
      setProgress(null);
      setError(UPDATE_INSTALL_STALLED_MESSAGE);
      setPhase("error");
    },
    [clearInstallTimers],
  );

  /** 滑走窓の watchdog を張り直す。`install()` を始めた時点と、進捗が来るたびに呼ぶ。 */
  const armWatchdog = useCallback(
    (generation: number) => {
      if (watchdogRef.current !== null) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(
        () => abandonInstall(generation),
        INSTALL_WATCHDOG_MS,
      );
    },
    [abandonInstall],
  );

  const install = useCallback(async () => {
    // `recheck` と同じ 1 本のフラグで守る（await の**前**に同期で立てるのが要点）。
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    runRef.current += 1;
    const generation = runRef.current;
    installActiveRef.current = true;

    setError(null);
    setProgress(null);
    // Rust 側の 1 発目のイベントを待たずに UI を移す（再 check のあいだ無反応に見えないように）。
    setPhase("downloading");
    // ⚠ **ここで張るのが重要**。進捗イベントが来たときだけ張ると、
    //    「1 発目のイベントが永久に来ない」（Rust 側が最初の check で固まる・emit 自体が失敗する・
    //    plugin 内部で panic する）というまさに救いたいケースを取りこぼす。
    armWatchdog(generation);
    // ⚠ 絶対上限は**ここでしか張らない**（進捗で延長されない＝偽イベントで無力化されない・review S-5）。
    deadlineRef.current = setTimeout(
      () => abandonInstall(generation),
      INSTALL_DEADLINE_MS,
    );

    try {
      const outcome = await installAppUpdate();
      // ⚠ ここに来るのは macOS だけ。Windows は `install()` の中でプロセスが終了するので
      //    この行に到達しない（＝Promise が settle しないのが正常系）。
      if (runRef.current !== generation) return;
      clearInstallTimers();
      installActiveRef.current = false;
      setProgress(null);
      // ⚠ **resolve ＝ 完了ではない**（055d review S-2）。走行中の 2 本目は Rust 側の `InstallGuard` に
      //    弾かれて `"alreadyRunning"` で返るので、これを「完了」に畳むと
      //    **自己置換が走っている最中に再起動を促す**ことになる（macOS では最悪 `.app` が消える）。
      //    見捨てた実行がまだ生きているという意味なので、watchdog 発火時と同じ文言に落とす。
      if (outcome === "alreadyRunning") {
        setError(UPDATE_INSTALL_STALLED_MESSAGE);
        setPhase("error");
        return;
      }
      // ⚠ `"noUpdate"`（再 check したら更新が無かった）は現状も「完了」に畳んでいる。押しても
      //    再起動するだけで害が無いため（progress.md 055d 節⑧の受容）。区別する材料は揃っているので、
      //    「更新していないのに再起動を促された」という混乱が実際に起きたらここだけで直せる。
      setPhase("installed");
    } catch {
      // ⚠ 例外を束縛しない（§9）。DL 失敗・署名検証失敗・展開失敗・権限不足・
      //    インストール先パスの shell メタ文字（review S-1）をすべて定型文言に畳む。
      if (runRef.current !== generation) return;
      clearInstallTimers();
      installActiveRef.current = false;
      setProgress(null);
      setError(UPDATE_INSTALL_ERROR_MESSAGE);
      setPhase("error");
    } finally {
      if (runRef.current === generation) inFlightRef.current = false;
    }
  }, [clearInstallTimers, armWatchdog, abandonInstall]);

  const restart = useCallback(async () => {
    // ⚠ この Promise は解決しない（プロセスが再起動する）。失敗しても画面に出す先が無いので握る。
    try {
      await restartApp();
    } catch {
      // 再起動できなかった場合はユーザーが手で終了するしかない。文言を増やさず現状表示のままにする。
    }
  }, []);

  /**
   * 進捗イベントの購読（055d・**リポジトリ初の Tauri イベント購読**）。
   *
   * ⚠ **`cancelled` ガードが必須**。`listen` は Promise を返すので、StrictMode の二重 mount では
   * cleanup が先に走って `unlisten` が `null` のまま解除を取りこぼす（＝リスナが 1 本漏れる）。
   *
   * ⚠ 依存を空にしているので、購読はこのフックの生存期間＝**アプリの生存期間**と一致する。
   * `UpdateScreen` の unmount（他画面への遷移）では解除されない＝インストール中に画面を離れて戻っても
   * 進捗は追い続ける。`UpdateScreen` 側に購読を置いてはいけない。
   *
   * ⚠ ハンドラは `phase` を**クロージャで参照しない**（stale closure になる）。
   * 反映してよいかは `installActiveRef` で判定する。
   */
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listenAppUpdateProgress((payload) => {
      // ⚠ イベントは webview 側からも emit できる（`core:event:allow-emit` が既定で配られている）。
      //    実行中でなければ捨てる＝偽の進捗で勝手に「更新中」表示にならない。
      // ⚠ **実行中は信頼している**（バイト数もフェーズもそのまま反映し、watchdog も張り直す）。
      //    ＝偽イベントを送り続けられると watchdog は永久に発火しないので、
      //    それを受け止めるのが `INSTALL_DEADLINE_MS`（進捗で延長されない絶対上限・review S-5）。
      //    ペイロードは表示にしか使わず、**完了判定は必ず invoke の resolve** で行う（この不変条件は崩さない）。
      if (!installActiveRef.current) return;
      armWatchdog(runRef.current);
      setProgress({
        downloadedBytes: payload.downloadedBytes,
        totalBytes: payload.totalBytes,
      });
      setPhase(payload.phase === "installing" ? "installing" : "downloading");
    })
      .then((fn) => {
        if (cancelled) {
          void fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // 購読できなくても更新自体は走る（進捗が出ないだけ）。例外は束縛せず握る（§9）。
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        void unlisten();
        unlisten = null;
      }
    };
  }, [armWatchdog]);

  // アンマウント時に 2 本のタイマを確実に止める（生き残って消えた木の state を触らないように）。
  useEffect(() => clearInstallTimers, [clearInstallTimers]);

  // 起動時に 1 回だけ自動チェックする（親 055 の決定・ON/OFF トグルは作らない）。
  // ⚠ 二重発火を止めているのは上の `inFlightRef`。実機では Rust 側の HTTP が DevTools の
  //   Network に出ないため二重発火を目視できない＝この不変条件は
  //   `useAppUpdate.test.tsx` の StrictMode テストでしか守れない。
  // ⚠ そのテストが固定しているのは「**二重 mount で 1 回**」であって「**常に 1 回**」ではない
  //   （上の再修正トリガー 2 の経路は素通しする）。テストが緑であることを
  //   「起動時 1 回が保証されている」と読み替えないこと。
  useEffect(() => {
    void run();
  }, [run]);

  // ⚠ 失敗しても**自動リトライしない**（S-4 の後半）。再チェックはユーザーの明示操作のみ。
  return { status, phase, error, progress, recheck: run, install, restart };
}
