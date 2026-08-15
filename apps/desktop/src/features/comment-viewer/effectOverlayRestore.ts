import {
  loadEffectOverlayEnabled,
  loadStageOverlayEnabled,
} from "./overlaySettings";
import {
  isEffectOverlayOpen,
  isStageOverlayOpen,
  openEffectOverlayWindow,
  openStageOverlayWindow,
} from "./windowApi";

/**
 * 061a: **永続設定が ON なのにエフェクトの出力窓が無ければ開き直す**（アプリ起動時の復元）。
 *
 * ⚠ 呼ぶのは `App.tsx` の `MainWindowApp` のマウント時**だけ**（＝アプリ起動時。コメビュ窓・
 * オーバーレイ窓からは発火しない）。046b が固定コメント窓で同じことをしている理由と同じで、
 * **配信開始時に窓が無いと OBS のウィンドウキャプチャソースが真っ黒のまま始まる**。
 * 「`obs-effects` 画面を開いたときだけ復元する」案は、その画面を毎回訪れないと窓が出ないので目的を満たさない。
 *
 * ⚠⚠ **設定は `is*Open()` の解決を待ってから読み直す。** 先に読んで握ったままにすると、
 * 解決を待つ間にユーザーが**条件を消して**派生値が false になったとき、
 * **stale な true で窓を開いてしまう**（046b が同じ理由で state ではなく直読みを選んだ判断。
 * 自動 close 経路が無いので、一度こうなるとセッション中は「条件が無いのに窓が OBS に映り続ける」が解消しない）。
 * ⚠ **061k で 061i 申し送り §9 の残骸を返済した**——この段落は長らく **061i で廃止された旧トグルの
 * OFF 操作**を stale-true の原因として名指ししていたが、いまの値は
 * 「**表示する条件が 1 件以上あるか**」の派生値である（原因も「条件を消したとき」に変わっている）。
 *
 * ## ⚠⚠ 061k: **出力窓が 2 本になったので、2 窓を「独立に」復元する**
 *
 * - **片方の `is*Open()` の結果で、もう片方を判断しないこと。** 実際にありうる状態は
 *   「コーナーだけ条件がある」「ステージだけ条件がある」「両方」「どちらも無い」の 4 通りで、
 *   まとめて判定すると**片方だけ開くべきときに 2 つ開く／1 つも開かない**のどちらかになる。
 * - ⚠ 「解決を待ってから設定を読む」順序も**窓ごとに**守る（上の stale-true の理由は窓ごとに成立する）。
 * - ⚠ **2 窓の open は `Promise.all` で投げてよいが、実際の窓生成は Rust 側で直列になる**
 *   （`WINDOW_OPEN_LOCK` は全窓生成コマンドで 1 本を共有）。`#[tauri::command(async)]` なので
 *   UI は固まらず、片方が数百 ms 待つだけである。**ここを「並列に開く」と読まないこと。**
 * - ⚠ **片方の失敗でもう片方を巻き添えにしない**（`Promise.all` は最初の reject で終わるので使わない）。
 *   窓生成の失敗は「その窓だけ OBS が真っ黒」に留めるのが正しい。
 *
 * ⚠ **セットアップ用ガイドの旗（`EFFECT_OVERLAY_GUIDE_PENDING_KEY`）は立てない**（061a レビュー Q-1）。
 * 旗を立てるのは「ウィンドウが停止中のときのテスト表示」＝**明示操作**だけで、この復元経路で立てると
 * 「条件を残したまま配信直前に StreamDock を起動」でガイドが数十秒 OBS のキャプチャに映る。
 *
 * ⚠ 自動 close は作らない（設定 OFF で窓が開いていても閉じない）。親 046 の「窓が消えると OBS ソースが
 * 壊れる」規律に揃える＝**設定が正・窓が従**だが、寄せる向きは「開く」だけ。
 *
 * ⚠ **本関数は例外を握りつぶさない**（窓生成の失敗は呼び出し側の関心事）。`App.tsx` 側で `.catch` する。
 * ⚠ ただし**窓ごとの失敗は互いに独立**なので、両方の結果を待ってから最初のエラーを投げ直す。
 *
 * 061a レビュー（Q-9）: `App.tsx` の `useEffect` に直書きされていたものを、**単体テストできるように
 * ここへ切り出した**。`MainWindowApp` は invoke 依存の hook を多数マウントするため、あちらでは
 * 「ユーザー操作なしに窓が開く」という 061a で唯一セキュリティ的に意味のある挙動がテストの死角に落ちていた。
 */
export async function restoreEffectOverlayWindow(): Promise<void> {
  /**
   * ⚠ 1 窓ぶんの復元。**「開いているか」を待ってから設定を読む**順序をここで閉じている
   * （2 窓ぶんに複製すると片方だけ順序を崩す変更が入りうるため、1 か所に閉じる）。
   */
  const restore = async (
    isOpen: () => Promise<boolean>,
    loadEnabled: () => boolean,
    open: () => Promise<void>,
  ): Promise<void> => {
    const open_ = await isOpen();
    // ⚠ ここで初めて設定を読む（上の注記）。順序を入れ替えないこと。
    if (!loadEnabled() || open_) return;
    await open();
  };

  // ⚠⚠ **2 窓を独立に走らせる**（`allSettled` なので片方の失敗がもう片方を止めない）。
  const results = await Promise.allSettled([
    restore(isEffectOverlayOpen, loadEffectOverlayEnabled, openEffectOverlayWindow),
    restore(isStageOverlayOpen, loadStageOverlayEnabled, openStageOverlayWindow),
  ]);
  // ⚠ 失敗は握りつぶさない（呼び出し側の関心事）。2 つ失敗したら最初のものを投げ直す。
  const failed = results.find((r) => r.status === "rejected");
  if (failed !== undefined && failed.status === "rejected") throw failed.reason;
}
