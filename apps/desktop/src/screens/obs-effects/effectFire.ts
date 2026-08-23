import type { CommentViewDto } from "../../features/comment-viewer/types";
import type { EffectGacha, GachaDefinition } from "./effectAssignments";
import {
  decideEffects,
  type EffectMatcher,
  type EffectObsSource,
  type EffectTriggerState,
} from "./effectTrigger";
import { drawGachaPrizeIndex } from "./gachaDraw";

/**
 * 063b: **「決めた発火」を「鳴らす OBS のソース名」へ翻訳する 1 か所**（純関数）。
 *
 * ## ⚠⚠⚠ なぜこのモジュールが要るのか（抽選の位置がここでしか固定できない）
 *
 * 本タスク最大の設計判断は **「どこで引くか」** で、答えは
 * **「発火が確定してから引く」**（＝畳み込み・バースト上限・クールダウンを全部通した後）である。
 * ⚠⚠ **却下した案は 2 つ**:
 *
 * 1. ⚠⚠⚠ **`select` の中で引く**（＝ガチャを [`EffectObsSource`] へ解決してから返す）… **穴 A**。
 *    `createConditionMatcher` の `select` は **`condition.when` の照合より前**に呼ばれるので、
 *    ①**当たっていない条件でも引く** ②**はずれ（`null`）が「通さない kind」と区別できず次の条件へ落ちる**
 *    ＝ **ガチャを外したら、下に並んだ別の条件が代わりに発火する**。
 *    ⚠ ②は「出ない」を見るテストでは殺せない（**出てはいる**）ので、
 *    `effectFire.test.ts` は **`random` の呼び出し回数**と**鳴ったソース名**の両方で固定している。
 * 2. **[`decideEffects`] の中で引く**（出すと決まった直後に解決）… ⚠ 却下。実現形が 2 つしかなく両方だめ:
 *    ①`effectAssignments.ts` を import する ⇒ **あちらが `effectTrigger.ts` を import しているので循環**
 *    （かつ「発火層は純関数のまま」という現行の層の向きが壊れる）
 *    ②`resolve` コールバックを注入する ⇒ 注入点が 2 本になって契約が「決める」から「決めて解決する」へ変わり、
 *    さらに ⚠⚠ **はずれを表現する語彙が無い**（要素を落とすと「出した件数」と実際が食い違い、
 *    [`EffectObsSource`] へ潰すと「引いたが鳴らすものが無い」を返す形が無い）。
 *
 * ⇒ **合成をこの 1 本に閉じた。** ⚠⚠ **呼び出し側（`CommentViewerApp`）で組み立てないこと**——
 * そうすると 7 つの変異を殺すテストが 2000 行の React コンポーネントの中でしか書けず、
 * テスト側が**本番と違う組み方で組み直す**ことになる（`effectAssignments.test.ts` の
 * 「⚠ **スタブ matcher で代用しないこと**——実測」と同じ罠）。
 *
 * ## ⚠⚠ 「発火＝1 回引いた」と定義する（はずれでも枠を消費する）
 *
 * [`decideEffects`] は**返した時点で** `recentFires` / `lastConditionAt` / `lastGiftAt` に記録済みなので、
 * **はずれ（`-1`）でもバースト枠とクールダウンは消費される**。⚠⚠ **これが既定であり、意図でもある**:
 * 消費しないと**合計 30% のガチャは 7 割の確率で「無料でもう 1 回」**になり、クールダウンが実質無効化する。
 * ⇒ **はずれは「引いた結果、鳴らす音が無かった」だけ**である。
 * ⚠ 消費しない形にするには `recentFires.pop()` 相当の巻き戻しが要り、
 * **「出したときだけ記録する」**（061b / 061j が 2 度踏んで作った不変条件）を壊す。⚠ **やらないこと。**
 *
 * ## ⚠ 同一視聴者の連投を絞っていない理由（回しすぎ防止として足りている）
 *
 * `state.lastGiftAt` は **`gift` 種別だけ**を畳むので、「同一視聴者の連投」を直接絞る仕組みは無い。
 * ⚠ **意図的に足していない**（＝ [`EffectTriggerState`] に視聴者 id の Map を増やしていない）:
 *   - **課金トリガー**（`cooldownMs: 0`）… バースト上限が**窓全体で 5 秒に 3 件**を既に縛る。
 *     ⚠ **お金を払った人の演出を落とす方向へ倒さない**（061j が `cooldownMs: 0` と決めた理由と同じ）。
 *   - **キーワード条件**（`KEYWORD_COOLDOWN_MS = 10_000`）… 条件ごとのクールダウンは**投稿者を問わない**ので、
 *     **同一視聴者の連投は既に 10 秒に 1 回まで**に縛られている。
 * ⚠⚠ **決定的な点**: 視聴者ごとの Map を足して変わるのは「**別の視聴者のキーワードが通りやすくなる**」ことだけで、
 * これは**発火回数が増える方向**＝ 回しすぎ防止の逆である（公平性の機能であって荒らし耐性の機能ではない）。
 * ⚠ **再修正トリガー＝実機で「1 人に占有される」が起きたとき。** そのときは §9 のとおり
 * **メモリ上のみ・永続化しない・表示名も本文も持たない**（`viewerIdOf` ＝ `provider:userId` だけ）で足すこと。
 *
 * ## ⚠ 回しすぎ防止の定数を 063b で変えていない理由（レビュー Q-7）
 *
 * 4 経路のロジックも定数も **1 バイトも変えていない**が、⚠ **意味は変わった**
 * （「演出が出すぎる」→「**ガチャが回りすぎる**」）ので、そのうえで妥当と判断した根拠を残す:
 *
 * - **バースト上限（5 秒に 3 件）** … ⚠ ガチャに対しては**緩いほうへ倒れて見える**
 *   （演出なら「3 つ同時に光る」で頭打ちだが、ガチャは**当選機会が 3 回**になる）。
 *   ⚠⚠ **それを打ち消しているのが上の「はずれでも枠を消費する」**である——
 *   合計 30% のガチャでも 3 回で枠を使い切るので「無料でもう 1 回」にはならない。
 *   ⇒ **2 つ揃って妥当**であり、片方だけ変えないこと。
 * - **gift の 5 秒畳み込み** … コミュニティギフト N+1 を 1 回に畳む＝「1 課金 1 抽選」。
 *   ガチャでも意味は同じなので**変更不要**。
 * - **条件ごとのクールダウン（10 秒）** … 投稿者を問わないので連投も縛られる（上記の節が正）。
 *
 * ⚠⚠⚠ **再検討トリガー＝ 063f（当選結果をチャットへ書く）に着手するとき。**
 * あちらの sidecar 側スロットル（最短 3 秒）と **5 秒に 3 件が正面衝突する**
 * （3 件目が落ちる）。⚠ **063b の側では今いじらない**——衝突の形が決まるのはあちらだから。
 *
 * ## §9
 *
 * ⚠⚠ **戻り値は `sourceName` の配列だけ**＝**ユーザー自身が OBS で付けた名前**である。
 * **第三者のコメント本文も表示名も 1 バイトも通らない**（型として載せる場所が無い）。
 * ⚠⚠ **抽選履歴・当選者・視聴者 id を 1 つも保存しない**（この関数は localStorage を**書かない**）。
 * ⚠ 景品名もここには現れない（鳴らすのに要るのはソース名だけ）。
 */

/** 063b: 発火として流れる値（⚠ **レーンは 1 本**・理由は `createEffectFireMatcher` の JSDoc が正）。 */
export type EffectFire = EffectObsSource | EffectGacha;

/**
 * ガチャ 1 件を引いて、鳴らすソース名を返す（⚠ **はずれ・見つからない・景品 0 件はすべて `null`**）。
 *
 * ⚠⚠ **抽選は [`drawGachaPrizeIndex`] をそのまま使う**（063a）。置き換えると
 * 「テスト抽選で見た確率」と「本番の確率」が別実装になり、
 * **063 唯一の差別化点＝％が信用できること**が壊れる（あちらの JSDoc が正）。
 * ⚠⚠⚠ **`-1`（はずれ）を「最後の景品」へ倒さないこと**——倒すと「合計 30% なのに必ず何か当たる」になる。
 *
 * ⚠⚠ **一覧に無い `gachaId` は `null`**（＝何も鳴らさない）。**黙って別のガチャへ化けさせない**
 * ——先頭へフォールバックさせると「削除したガチャの条件が、新しく作った別のガチャを鳴らす」が起きる
 * （064b の「指す先が消えていたら出さない」と同じ規律で、`EffectGacha` の id を詰めない理由と対）。
 *
 * ⚠ **検証を新設しない**（§8）——景品の形式検査は `parseGachaPrize` / `parseGachaDefinition` が
 * `loadGachaLibrary` の中で既に済ませている。ここで 2 通り目を書くと**片方だけ緩む**。
 * ⚠ ソース名の実在照合は sidecar 側（064a の `GetInputList` 突き合わせ）が壁なので、
 * **景品の `sourceName` も OBS ソース直指定とまったく同じ経路**を通る。
 */
function drawGachaSourceName(
  fire: EffectGacha,
  gachas: readonly GachaDefinition[],
  random: () => number,
): string | null {
  const gacha = gachas.find((g) => g.id === fire.gachaId);
  if (gacha === undefined) return null;
  const index = drawGachaPrizeIndex(gacha.prizes, random);
  // ⚠⚠ `-1` ＝ **はずれ**（合計が 100% 未満なら正常に起きる）／景品 0 件も同じ `-1`。
  if (index < 0) return null;
  return gacha.prizes[index].sourceName;
}

/**
 * このバッチで**鳴らす OBS のソース名**を決める。⚠ **`state` は [`decideEffects`] が破壊的に更新する。**
 *
 * @param added   まだ発火判定に通していないコメント（`takeFreshComments` を通したもの）
 * @param updated ⚠ **1 件も読まない**（[043e] の Jewels combo 再送。[`decideEffects`] が捨てる）
 * @param state   時間窓の状態。⚠ **レーンは 1 本なので 1 インスタンスだけ**
 * @param now     現在時刻(ms)。⚠ **引数で受ける**ので本関数は決定的
 * @param matchEffect `createEffectFireMatcher()` の戻り値
 * @param loadGachas ガチャの一覧を読む（⚠ **ガチャの発火が 1 件でもあるときだけ 1 回呼ぶ**）。
 *   ⚠⚠ **鳴らす直前に読み直すのが意図である**——matcher が呼ばれるたびに条件を読み直しているのと同じ規律で、
 *   **main 窓でガチャを編集した直後の 1 件目から効く**。⚠ バッチの先頭で 1 回に固定しないこと。
 * @param random 乱数。⚠⚠ **演出用であって暗号用途ではない**（呼び出し側は `Math.random` を渡す）。
 *   ⚠ 「不正防止に `crypto.getRandomValues` では」への答え＝ **当選結果は端末内で完結し、
 *   視聴者側は結果を検証も予測もできない**（配信画面に出るだけ）ので、予測困難性に守る対象が無い。
 *   ⚠ **引数で受けるのはテストで確率を固定するため**（直接 `Math.random` を呼ぶと規則を固定できない）。
 * @returns 鳴らすソース名（⚠ **はずれた発火はここに現れない**＝ 戻り値の長さは発火の件数と一致しない）
 */
export function decideFireSourceNames(
  added: CommentViewDto[],
  updated: CommentViewDto[],
  state: EffectTriggerState,
  now: number,
  matchEffect: EffectMatcher<EffectFire>,
  loadGachas: () => readonly GachaDefinition[],
  random: () => number,
): string[] {
  // ⚠⚠ **多重発火の抑制 4 経路はすべてこの 1 行の向こう側にある**
  //   （①`updated` を読まない ②同一投稿者の gift の畳み込み ③バースト上限 ④条件ごとのクールダウン）。
  //   ⚠ **ガチャのために作り直さないこと**（061d-2 レビュー S-4 の「同じ規則を 2 通りに書かない」）。
  const fires = decideEffects<EffectFire>(added, updated, state, now, matchEffect);
  // ⚠ ガチャが 1 件も無いバッチで localStorage を読まないための早期 return。
  if (fires.length === 0) return [];

  // ⚠ 一覧はバッチ内で 1 回だけ読む（同じバッチの中でガチャが書き換わることはない）。
  let gachas: readonly GachaDefinition[] | null = null;
  const sourceNames: string[] = [];
  for (const fire of fires) {
    switch (fire.kind) {
      case "obs-source":
        sourceNames.push(fire.sourceName);
        break;
      case "gacha": {
        // ⚠⚠ **抽選はここ**＝ 畳み込み・バースト上限・クールダウンを**すべて通った後**である。
        //   ⚠ ここより前（`select` の中／`decideEffects` の中／ループの外）へ動かさないこと。
        if (gachas === null) gachas = loadGachas();
        const sourceName = drawGachaSourceName(fire, gachas, random);
        // ⚠ はずれ・一覧に無い・景品 0 件は**何も鳴らさない**（枠は既に消費済み＝上記「発火＝1 回引いた」）。
        if (sourceName !== null) sourceNames.push(sourceName);
        break;
      }
      default: {
        // ⚠⚠ **前方互換の 3 枚目**（1 枚目＝`parseAssignment` の未知 kind → `none`、
        //   2 枚目＝`createEffectFireMatcher` の `!== "none"`）。⚠ **`never` なので kind が増えると
        //   コンパイルが落ちる**＝「知らない発火先が黙って捨てられる／黙って鳴る」の両方を型で塞ぐ。
        // ⚠⚠⚠ **レビュー Q-6（訂正）: これは「同時に落ちる 2 枚目」ではなく「順に落ちる 2 段目」である。**
        //   `EffectFire` は `EffectAssignment` から**導出していない手書きの union** なので、
        //   `EffectAssignment` に 4 本目を足しても**ここは落ちない**。実測で落ちるのは
        //   `createEffectFireMatcher` の 1 か所だけ（`TS2322`）。
        //   ⚠ そこを直す → 戻り型を広げる → `decideFireSourceNames` の引数と合わなくなる →
        //   `EffectFire` を広げる → **そこで初めてこの `never` が落ちる**、という連鎖になる。
        //   ⚠⚠ **結論は変わらない**（どのみち判断を強制される）が、
        //   **「4 本目を足した瞬間に 2 か所落ちる」とは読まないこと。**
        const unreachable: never = fire;
        void unreachable;
      }
    }
  }
  return sourceNames;
}
