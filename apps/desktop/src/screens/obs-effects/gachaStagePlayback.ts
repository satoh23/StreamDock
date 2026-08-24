/**
 * ⚠⚠⚠ **063c 段 2-b: 当選 1 件の「いま何を出しているか」を、経過時間だけから決める純関数。**
 *
 * ## なぜ純関数なのか
 *
 * 演出は **抽選中 → 開封 → 結果** の 3 段で、⚠ **段の切り替えと絵のコマ送り**という
 * 2 種類のタイマーが要る。これを [`EffectOverlayApp`] の中で `setTimeout` の連鎖として書くと、
 * ⚠⚠ **「途中でアンマウントされた」「秒数設定が 0 だった」「次の当選が来た」の 3 つが絡んだときの
 * 正しさがコンポーネントの中でしか確かめられない**（061b 以来この repo が繰り返し避けてきた形）。
 * ⇒ **状態を「経過時間」1 本に畳み、そこから見えるものを導出する。**
 * ⚠ 呼び出し側が持つ状態は `elapsedMs` **だけ**で、タイマーは**一定間隔で足すもの 1 本**になる。
 *
 * ## ⚠⚠ 抽選そのものはここに無い（**あってはいけない**）
 *
 * 当たりは `effectFire.ts` の `decideFireResults` が**もう決めている**。
 * ここは**決まったものを何秒間どう見せるか**だけを持つ。
 * ⚠⚠⚠ **この層で `Math.random()` を呼ばないこと**——呼んだ瞬間に
 * 「演出は A、OBS は B」という**実機でしか見えない食い違い**が生まれる（`gachaStageEvent.ts` の注記が正）。
 */

/**
 * 抽選中: マシンのコマを送る間隔（ミリ秒）。⚠ 短すぎると絵が溶け、長すぎると止まって見える。
 *
 * ⚠⚠⚠ **063c 段 2-c: 実機で「速い」と言われたので 1.3 倍ゆっくりにした**（120 → 156）。
 * ⚠ 動かしたのは**この間隔と開封の段だけ**で、[`GACHA_RESULT_MS`]（結果を読む時間）は**据え置き**である
 * ——あちらは「動きの速さ」ではなく「読み終わる時間」なので、1.3 倍する理由が無い。
 * ⚠⚠ **CSS 側のアニメーション（`gachaShake` など）も同じ 1.3 倍で揃えてある**。
 * 片方だけ変えると**絵のコマ送りと揺れの周期がずれる**ので、
 * ここを触ったら `EffectOverlayApp.module.css` の `@keyframes` も必ず一緒に触ること。
 */
export const GACHA_SPIN_FRAME_MS = 156;

/**
 * 抽選中の**最後**に「カプセルが出てくる」絵（`machine-5`）を**1 枚のまま持たせる**時間。
 *
 * ⚠⚠ **[`GACHA_SPIN_MS`] より必ず短くしておくこと**（＝回転を 1 度も見せずに排出だけが映らない）。
 * ⚠ 段 2-b では抽選中がユーザー設定だったため「短ければ排出を出さない」という分岐が要ったが、
 * **段 4-a で定数になったので、その分岐は消えた**（下の `gachaStageView` の注記が正）。
 *
 * ⚠⚠⚠ **063c 段 2-c: 2 コマ送りから「1 枚を持たせる」へ変えた。**
 * シートの 6 コマ目は**排出されるカプセルの色が違う**（青／桃・赤／白ではない）ので、
 * 挟むと「**青いカプセルが出てきて、赤いカプセルが割れる**」になる。
 * ⇒ **絵を増やさずに時間だけ延ばす**（コマ送りの間隔 × 3）。
 * ⚠ ここを延ばしても**抽選中の全体の長さは変わらない**（内訳が変わるだけ）。
 */
export const GACHA_DISPENSE_MS = GACHA_SPIN_FRAME_MS * 3;

/** 開封: カプセルのコマを送る間隔（ミリ秒）。⚠ 063c 段 2-c で 1.3 倍（170 → 221）。 */
export const GACHA_OPEN_FRAME_MS = 221;

/**
 * 開封の段の長さ（ミリ秒）。⚠ **コマ送り（4 コマ）より長い**——
 * 最後のコマ（割れた殻）を少し持たせてから結果へ移ると、切り替わりが唐突に見えない。
 * ⚠⚠ 063c 段 2-c で 1.3 倍（900 → 1170）。**コマ送りと一緒に伸ばさないと持たせる時間が消える。**
 */
export const GACHA_OPEN_MS = 1170;

/**
 * 結果を出しておく時間（ミリ秒）。⚠ 063c (1) の既定値どおり。
 *
 * ⚠⚠ **ここは設定にしていない**——設定にしたのは**抽選中の秒数だけ**である（063c (1)）。
 * 理由＝結果が読めない速さになると**景品名を出す意味が消える**うえ、
 * 「短くしたら読めなくなった」は配信中に気づけない。⚠ **再修正トリガー＝実機で「長い」と言われたとき。**
 */
export const GACHA_RESULT_MS = 5000;

/**
 * ⚠⚠⚠ **063c 段 4-a: 抽選中（マシンが回る）の長さ（ミリ秒）。**
 *
 * ⚠⚠ **段 2-b では設定（`GACHA_SPIN_MS_KEY`）だったが、段 4-a で定数へ戻した。**
 * 依頼者の指示＝「**この設定値を変えることによるメリットが配信者になく、
 * 逆に項目が増えることで画面が複雑になってしまっている**」。
 * ⇒ **設定ごと消えたので、「0 ＝ 抽選中を出さない」という分岐も無くなった**
 * （到達しない分岐を残すと、読む人が「設定できる」と誤解する）。
 * ⚠ 伸ばさないこと——**当たるたびにこの秒数だけ配信が止まる**。
 */
export const GACHA_SPIN_MS = 1500;

/** 抽選中に回すマシンのコマ数（`machine-1` 〜 `machine-4`）。 */
export const GACHA_SPIN_FRAMES = 4;
/** 開封のコマ数（`capsule-1` 〜 `capsule-4`）。 */
export const GACHA_OPEN_FRAMES = 4;

/**
 * いま出すもの。⚠ **`null` ＝ この当選は出し終わった**（呼び出し側が次の 1 件へ進む合図）。
 *
 * ⚠ `frame` は **0 始まり**（`spin` は `machine-N`、`open` は `capsule-N` の N-1）。
 * ⚠⚠ `spin` の `frame` は **[`GACHA_SPIN_FRAMES`] ちょうどになりうる**（＝排出の 1 枚・5 コマ目）。
 */
export type GachaStageView =
  | { phase: "spin"; frame: number }
  | { phase: "open"; frame: number }
  | { phase: "result" };

/**
 * 当選 1 件の演出のうち、`elapsedMs` の時点で出すものを返す。
 *
 * @param elapsedMs この当選を出し始めてからの経過（ミリ秒）
 * @returns 出すもの。⚠ **`null` は「終わり」**
 */
export function gachaStageView(elapsedMs: number): GachaStageView | null {
  // ⚠ 負の経過（時計が巻き戻る／呼び出し側の初期化漏れ）は 0 として扱う。
  const elapsed = Math.max(0, elapsedMs);
  const spin = GACHA_SPIN_MS;
  // ⚠⚠ **`GACHA_SPIN_MS > GACHA_DISPENSE_MS` が前提**（上の注記）。崩すと排出の絵が先に来る。

  if (elapsed < spin) {
    const remaining = spin - elapsed;
    // ⚠⚠ 最後は「カプセルが出てくる」絵を **1 枚のまま持たせる**（上の `GACHA_DISPENSE_MS` の注記が正）。
    //   ⚠⚠⚠ **ここでコマを送らないこと**——シートの 6 コマ目は排出されるカプセルの色が違う。
    //   ⚠ 段 2-b に在った `spin > GACHA_DISPENSE_MS`（＝抽選中が短いときは排出を出さない）は
    //     **段 4-a で消した**——両方とも定数になり、**常に真**になったため
    //     （残すと「設定で変わりうる」と読めてしまう）。
    if (remaining <= GACHA_DISPENSE_MS) {
      return { phase: "spin", frame: GACHA_SPIN_FRAMES };
    }
    return {
      phase: "spin",
      frame: Math.floor(elapsed / GACHA_SPIN_FRAME_MS) % GACHA_SPIN_FRAMES,
    };
  }

  const sinceOpen = elapsed - spin;
  if (sinceOpen < GACHA_OPEN_MS) {
    // ⚠ コマ送りが終わったら**最後のコマで止める**（`min` を外すと存在しないコマを指す）。
    return {
      phase: "open",
      frame: Math.min(
        GACHA_OPEN_FRAMES - 1,
        Math.floor(sinceOpen / GACHA_OPEN_FRAME_MS),
      ),
    };
  }

  if (sinceOpen < GACHA_OPEN_MS + GACHA_RESULT_MS) return { phase: "result" };
  return null;
}

/**
 * 演出 1 件の**全長**（ミリ秒）。⚠ キューの見積もりと、テストの期待値をここから引くため。
 *
 * ⚠⚠ **約 7.7 秒**（抽選中 1.5 ＋ 開封 1.17 ＋ 結果 5.0）。
 * ⚠ キューは 3 件までなので、**最悪 23 秒ぶん溜まる**（`GACHA_QUEUE_MAX` の注記が正）。
 */
export function gachaStageTotalMs(): number {
  return GACHA_SPIN_MS + GACHA_OPEN_MS + GACHA_RESULT_MS;
}
