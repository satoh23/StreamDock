/**
 * 027 First-Run Tutorial の完了フラグ永続化。
 * features/theme/theme.ts と同方式で localStorage を直接 read/write し、
 * 例外（プライベートモード等で書けない）は握りつぶす（frontend のみ・外部送信しない）。
 */

/** localStorage の保存キー（1 個のみ）。 */
const STORAGE_KEY = "stream-dock.tutorial.completed";

/** チュートリアルを完了（または一度開始して中断）済みか。未設定・不正値・例外は false。 */
export function isTutorialCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * チュートリアルを完了扱いにする（開始時点で記録＝中断しても再表示しない最小実装）。
 * 書けない場合は黙って無視する（表示は継続できる）。
 */
export function markTutorialCompleted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // 書き込み不可でも致命的でないため握りつぶす。
  }
}
