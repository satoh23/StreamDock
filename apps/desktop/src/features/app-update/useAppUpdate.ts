import { useCallback, useEffect, useRef, useState } from "react";
import { checkAppUpdate } from "./appUpdateApi";
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

export type AppUpdatePhase = "idle" | "checking" | "ready" | "error";

export interface UseAppUpdateResult {
  /** 確認できたときだけ入る。取得失敗時は `null` のまま（`available:false` に潰さない）。 */
  status: AppUpdateStatus | null;
  phase: AppUpdatePhase;
  /** 取得失敗時の定型文言。生エラー由来の文字列は入らない。 */
  error: string | null;
  /** ユーザーの明示操作による再確認。実行中は何もしない（多重実行しない）。 */
  recheck: () => Promise<void>;
}

export function useAppUpdate(): UseAppUpdateResult {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const [error, setError] = useState<string | null>(null);

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
   */
  const inFlightRef = useRef(false);

  const run = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase("checking");
    try {
      const result = await checkAppUpdate();
      setStatus(result);
      setError(null);
      setPhase("ready");
    } catch {
      // ⚠ 例外を束縛しない（束縛できる形にすると、後から誰かが message を画面へ載せられる）。
      //    Rust 側の `map_err(|_| …)` と同じ構えを frontend でも取る。
      setStatus(null);
      setError(UPDATE_CHECK_ERROR_MESSAGE);
      setPhase("error");
    } finally {
      inFlightRef.current = false;
    }
  }, []);

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
  return { status, phase, error, recheck: run };
}
