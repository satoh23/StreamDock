import { loadEffectOverlayEnabled } from "./overlaySettings";
import { isEffectOverlayOpen, openEffectOverlayWindow } from "./windowApi";

/**
 * 061a: **永続設定が ON なのにエフェクト窓が無ければ開き直す**（アプリ起動時の復元）。
 *
 * ⚠ 呼ぶのは `App.tsx` の `MainWindowApp` のマウント時**だけ**（＝アプリ起動時。コメビュ窓・
 * オーバーレイ窓からは発火しない）。046b が固定コメント窓で同じことをしている理由と同じで、
 * **配信開始時に窓が無いと OBS のウィンドウキャプチャソースが真っ黒のまま始まる**。
 * 「`obs-effects` 画面を開いたときだけ復元する」案は、その画面を毎回訪れないと窓が出ないので目的を満たさない。
 *
 * ⚠⚠ **設定は `isEffectOverlayOpen()` の解決を待ってから読み直す。** 先に読んで握ったままにすると、
 * 解決を待つ間にユーザーが表示トグルを OFF にしたとき、**stale な true で窓を開いてしまう**
 *（046b が同じ理由で state ではなく直読みを選んだ判断。自動 close 経路が無いので、
 * 一度こうなるとセッション中は「設定 OFF なのに窓が OBS に映り続ける」が解消しない）。
 *
 * ⚠ **セットアップ用ガイドの旗（`EFFECT_OVERLAY_GUIDE_PENDING_KEY`）は立てない**（061a レビュー Q-1）。
 * 旗を立てるのは `ObsEffectsScreen` の表示トグル ON＝**明示操作**だけで、この復元経路で立てると
 * 「設定 ON のまま配信直前に StreamDock を起動」でガイドが 30 秒間 OBS のキャプチャに映る。
 *
 * ⚠ 自動 close は作らない（設定 OFF で窓が開いていても閉じない）。親 046 の「窓が消えると OBS ソースが
 * 壊れる」規律に揃える＝**設定が正・窓が従**だが、寄せる向きは「開く」だけ。
 *
 * ⚠ **本関数は例外を握りつぶさない**（窓生成の失敗は呼び出し側の関心事）。`App.tsx` 側で `.catch` する。
 *
 * 061a レビュー（Q-9）: `App.tsx` の `useEffect` に直書きされていたものを、**単体テストできるように
 * ここへ切り出した**。`MainWindowApp` は invoke 依存の hook を多数マウントするため、あちらでは
 * 「ユーザー操作なしに窓が開く」という 061a で唯一セキュリティ的に意味のある挙動がテストの死角に落ちていた。
 */
export async function restoreEffectOverlayWindow(): Promise<void> {
  const open = await isEffectOverlayOpen();
  // ⚠ ここで初めて設定を読む（上の注記）。順序を入れ替えないこと。
  if (!loadEffectOverlayEnabled() || open) return;
  await openEffectOverlayWindow();
}
