import { useState } from "react";
import { Button } from "../../components/primitives";
import { Select } from "../../components/Select";
import type { ObsSourceEntry } from "../../features/comment-viewer/overlaySettings";
import {
  GACHA_PRIZE_MAX,
  GACHA_PRIZE_NAME_MAX_LENGTH,
  sanitizeGachaPrizeName,
  type GachaPrize,
} from "./effectAssignments";
import {
  effectSelectAssignment,
  gachaPrizeSelectValue,
  isObsSourceMissingFromList,
  OBS_SOURCE_PREFIX,
} from "./effectSelectValue";
import {
  drawGachaPrizeIndex,
  GACHA_PERCENT_SCALE,
  gachaPercentToWeight,
  gachaTotalPercentText,
  gachaTotalWeight,
  gachaWeightToPercent,
  isGachaOverAllocated,
} from "./gachaDraw";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 063a: **ガチャの景品を編集する表**（条件 1 行の割り当てが「ガチャ」のときだけ開く）。
 *
 * ⚠⚠⚠ **本タスクの成否はこの 1 枚の表そのものである。** 要望⑦の芯は
 * 「たぬえさよりかなり簡単に作れる」で、063s が特定した痛点は
 * 「**画面に％が出ないまま、決めた当選確率を自分でクジの本数へ換算し、
 * 景品ごとに 1 件ずつ編集画面を開いて入力する反復**」だった。
 * ⇒ **ここで消しているのは「％が出ない」と「1 件ずつ画面を開く」の 2 つ**である。
 * ⚠ **「条件を追加」に相当する操作を作らないこと**——行を足す＝景品を足す、だけ。
 *
 * ⚠⚠ **勝てないところは正直に受け入れている**（063s の手数表）——
 * **素材（メディアソース）の登録は OBS 側の作業として残る**ので、操作回数の総和では
 * たぬえさ3 のフォルダ経路に勝てない。**この画面が勝ちに行くのは UI の分かりやすさだけ**である。
 *
 * ## ⚠⚠ タブを増やさなかった理由（穴 G）
 *
 * `ObsEffectsScreen` は「タブ 2 枚 ＋ **共通の下部**」で、下部（配信画面に表示／OBS へ自動で反映／
 * 前提ステータス）は**両タブの外**にある。⚠ ガチャを 3 枚目のタブにすると、
 * **ガチャが使わない出力窓の設定が、ガチャにも掛かって見える**。
 * ⇒ **既存の条件行の中に開く**形にした。⚠ ガチャが鳴らすのは条件行と同じ OBS のソースなので、
 * 「条件 1 件 → ソース 1 本」が「条件 1 件 → ソース N 本＋重み」へ広がっただけに見える
 * （063s の「再開時にどこから始めるか」が推した形）。
 *
 * ## ⚠ 新しい行を足すのに OBS の一覧が要る
 *
 * 景品は **`sourceName` が必須**（無い景品は保存層が落とす）なので、
 * ⚠⚠ **一覧が取れていない／0 件のときは ＋ を押せない**（押せても保存できない行が生えるだけ）。
 * ⇒ ボタンを `disabled` にし、**理由を書く**（061a Q-1 の規律＝黙って押せない状態を作らない）。
 * ⚠ 061j のキーワード行が採った「未確定行（`DraftKeywordRow`）」の仕組みは**持ち込まない**
 * ——あちらは「打ち終わるまで保存できない」ためのもので、こちらは**選ぶだけで確定できる**。
 */
/**
 * 063a-3: 景品を足したときの既定の確率（**10%**）。⚠ 値の単位は**0.1%**である
 * （[`GACHA_PERCENT_SCALE`] が 1000 ＝ 100% なので、100 が 10%）。
 *
 * 根拠＝**押した直後の行が「ありえる値」で入っていること**。0 は保存層が落とすので不可、
 * 100% は 1 行で全部を取ってしまい「はずれ」が消えるので不可。
 *
 * ⚠⚠ **他の行や「残り」を見て値を決めない**（063a-2 は残りの範囲へ収めていたが、それが
 * 行どうしの連動＝「フォーム側が補正される」の一部だった）。**常に 10% で足し、
 * 合計が 100% を超えたら合計行の赤字で伝える**（[`commitPercent`] の注記が正）。
 */
const DEFAULT_PRIZE_WEIGHT = 100;

/** 063a-3: どの景品にも当たらなかったときの表示名。⚠ **「何も起きない」を画面に出すため**の名前。 */
const MISS_LABEL = "何も出ない";

/**
 * レビュー Q-063a-1: ％を受け付けなかった理由（⚠ **直し方まで書く**・061a Q-1）。
 *
 * ⚠⚠ **合計の超過はここに入れないこと**——あれは行の値としては正しく、
 * 受け付けたうえで合計行の赤字で伝える（[`commitPercent`] の注記が正）。
 *
 * ⚠ **文を 1 本にしてある。** 入力欄が `type="number"` なので、`"abc"` のような非数値は
 * ブラウザ（と jsdom）が**空文字へ正規化**して届く＝「数字でない」と「範囲外」を
 * **ユーザーが区別できる形では踏み分けられない**（実装当初は 2 本に分けていたが、
 * 片方が UI から到達不能だとテストで判明した）。⇒ **両方をこの 1 文が受ける。**
 */
const PERCENT_INVALID_TEXT = "0.1〜100 の数字で入れてください（例: 10）。";

/** 重み（0.1% 単位）→ 入力欄に出す％の文字列。⚠ 末尾の `.0` を出さない（`5` と出す）。 */
const percentInputValue = (weight: number): string =>
  String(gachaWeightToPercent(weight));

export function GachaPrizeTable({
  prizes,
  obsSources,
  labelPrefix,
  onChange,
}: {
  /**
   * ⚠⚠ 063d: **受け取るのは景品の配列だけ**（`EffectGacha` でも `GachaDefinition` でもない）。
   * この表は「景品を編集する」ことしか知らない＝ **ガチャがどこにぶら下がっているかに依存しない**。
   * ⚠ 063a では割り当て（`EffectGacha`）を直接受けていたが、063d でガチャ本体が
   * 一覧へ移ったので、**在り処に依存しない形へ 1 段下げた**（表そのものは 1 行も変えていない）。
   */
  prizes: readonly GachaPrize[];
  /** 064b と同じ経路で受け取る OBS ソース一覧（`null` ＝ **まだ 1 度も取っていない**）。 */
  obsSources: readonly ObsSourceEntry[] | null;
  /** aria-label の接頭辞（**ガチャごとに一意**にするため。例: 「大当たりガチャ」）。 */
  labelPrefix: string;
  onChange: (prizes: readonly GachaPrize[]) => void;
}) {
  /**
   * ⚠⚠⚠ **保存値をそのまま描く。揃えない・直さない。**
   *
   * 063a-2 はここで「合計を 1000 へ揃える」正規化（`normalizeGachaWeights`）を通していたが、
   * それが**行どうしの連動**を生み、依頼者の言う「**フォーム側が補正されるからめっちゃ使いにくい**」
   * の正体だった。⇒ **063a-3 で正規化ごと削除した。**
   * ⚠⚠ **「描く前に揃える」処理を書き戻さないこと。** 打った数字がそのまま残ることが
   * この画面の唯一の約束である（[`gachaDraw.ts`](./gachaDraw.ts) の `GACHA_PERCENT_SCALE` の注記が正）。
   */
  const total = gachaTotalWeight(prizes);
  /** ⚠ 合計が 100% を超えている＝**そのままでは抽選できない**（⚠ 入力は戻さない）。 */
  const overAllocated = isGachaOverAllocated(prizes);
  /** 何も当たらない確率（＝はずれ）。⚠ 超過中は 0 として扱う（負の残りを画面に出さない）。 */
  const missWeight = Math.max(0, GACHA_PERCENT_SCALE - total);

  /**
   * ⚠⚠ **入力中の生文字列はここに持ち、`onChange` では保存しない**（061j 穴 α と同じ）。
   * 1 打鍵ごとに localStorage へ書くと、`EFFECT_ASSIGNMENTS_KEY` の `storage` 購読が毎回走る。
   * ⚠ `<select>`（OBS ソース）は 1 操作で確定するので即 commit（条件行と同じ挙動）。
   */
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [percentDrafts, setPercentDrafts] = useState<Record<number, string>>({});

  /**
   * 063a-3 / レビュー Q-063a-1: **受け付けなかった％の理由**（行ごと）。
   *
   * ⚠⚠⚠ **「黙って元の値へ戻る」を作らないためだけに在る。** 063a-2 が捨てられた理由の 1 つが
   * **「戻された理由が画面に出ない」**ことだったのに、063a-3 でも
   * 「その行だけで成立しない値」（数値でない／0.1% 未満／100% 超）は**無言で戻っていた**。
   * ⇒ **合計の超過を赤字で伝えているのと同じ手**で、単行の不正値も理由を出す。
   * ⚠ **これは「補正」ではない**——値は戻るが、**戻した理由が必ず画面に出る**（061a Q-1）。
   * ⚠ 受け付けた瞬間に消す（`commitPercent` の成功経路と `setPercentDrafts` の入力中）。
   */
  const [percentErrors, setPercentErrors] = useState<Record<number, string>>({});

  /**
   * ⚠⚠ **§9: テスト抽選の結果は state にしか置かない**（localStorage にも DB にも書かない）。
   * 抽選履歴・当選者を保存すると §9 の重みが跳ね上がる（063a の「やらないこと」）。
   * ⚠ **窓を閉じれば消える**のが仕様である（画面にもそう書く）。
   */
  const [lastDraw, setLastDraw] = useState<string | null>(null);
  const [tally, setTally] = useState<Record<string, number>>({});
  const tallyTotal = Object.values(tally).reduce((a, b) => a + b, 0);

  /** 表示に使う名前。⚠ **空なら OBS のソース名**（`GachaPrize.name` の注記が正・規則はここ 1 か所）。 */
  const prizeLabel = (prize: GachaPrize): string =>
    prize.name.length > 0 ? prize.name : prize.sourceName;

  /**
   * ⚠⚠⚠ **書き戻しは必ずここを通す。** ⚠ **ここで％を直さないこと**——
   * 063a-2 は合計 1000 へ正規化していたが、それが「**打った数字が勝手に変わる**」の正体だった。
   * ⇒ **受け取った値をそのまま渡す**（合計の超過は画面で伝える）。
   */
  const commit = (next: readonly GachaPrize[]) => onChange(next);

  const replacePrize = (index: number, prize: GachaPrize) =>
    commit(prizes.map((p, i) => (i === index ? prize : p)));

  /**
   * レビュー Q-063a-6: **行の並びが変わる操作の直前に、未確定の入力を全部捨てる。**
   *
   * ⚠⚠⚠ ドラフト（`nameDrafts` / `percentDrafts` / `percentErrors`）も React の `key` も
   * **index で引いている**ので、並べ替え・削除・追加で index の指す景品が変わると
   * **未確定の入力が別の行へ書き込まれる**。
   * ⚠ 現状これを踏まないのは「↑↓・削除・追加を押す前に必ず input の `blur` が走って
   * ドラフトが確定・破棄される」という**どこにも書かれていない暗黙の前提**のおかげで、
   * ドラッグ&ドロップ並べ替え・`onMouseDown` の `preventDefault`・
   * 「確率順に並べ替え」ボタンのいずれかが入った瞬間に壊れる。
   * ⇒ **前提に頼らず、構造を変える 3 箇所（`addPrize` / `removePrize` / `movePrize`）で明示的に捨てる。**
   * ⚠ **捨ててよい理由**＝上記のとおり blur が先に走るので、ここへ来る時点で
   * 残っているドラフトは「確定されなかった入力」だけである。
   */
  const dropDrafts = (): void => {
    setNameDrafts({});
    setPercentDrafts({});
    setPercentErrors({});
  };

  /** 景品は `sourceName` が必須なので、**一覧が無い／0 件のときは行を足せない**（理由は画面に出す）。 */
  const hasObsSources = obsSources !== null && obsSources.length > 0;
  /**
   * ⚠⚠ **「残りが足りないから足せない」をやめた**（063a-3）。
   * 063a-2 は残りから分けてもらう形だったので残量ガードが要ったが、
   * いまは**各行が独立**なので、**足せない理由は「上限」と「OBS のソースが無い」だけ**である。
   */
  const canAddPrize = prizes.length < GACHA_PRIZE_MAX && hasObsSources;

  /**
   * 景品を 1 つ足す。⚠⚠ **末尾に足すだけ**（063a-2 の「最後の行の手前へ挿入」は不要になった＝
   * 「残り」担当の行がもう無いため）。⚠ **他の行の値には 1 ミリも触らない。**
   */
  const addPrize = () => {
    if (!canAddPrize || obsSources === null) return;
    dropDrafts();
    commit([
      ...prizes,
      { name: "", weight: DEFAULT_PRIZE_WEIGHT, sourceName: obsSources[0].name },
    ]);
  };

  const removePrize = (index: number) => {
    dropDrafts();
    commit(prizes.filter((_, i) => i !== index));
  };

  /** 並べ替え。⚠ **隣と入れ替えるだけ**（`preset_items` の `reorder` と違い id が無いので index で足りる）。 */
  const movePrize = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= prizes.length) return;
    dropDrafts();
    const next = [...prizes];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved);
    commit(next);
  };

  /** 名前を確定する。⚠ 詰めた結果は入力欄へ書き戻す（「打ったら短くなった」が見える・048 の規律）。 */
  const commitName = (index: number) => {
    const raw = nameDrafts[index];
    setNameDrafts((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    if (raw === undefined) return;
    replacePrize(index, { ...prizes[index], name: sanitizeGachaPrizeName(raw) });
  };

  /**
   * ⚠⚠⚠ **確率（％）を確定する。063a-3 の中心。**
   *
   * ⚠⚠ **入力は「％」であって「重み」ではない。** 063s が特定した痛点は
   * 「**％で決めたのに、それを自分でクジの本数へ手で換算させられる**」ことだった。
   * ⇒ **画面から「重み」という言葉を消し、ユーザーが頭の中で持っている単位（％）をそのまま受ける。**
   *
   * ⚠⚠⚠ **他の行を一切見ない**（063a-3 で反転した）。
   * 063a-2 は「他の行との合計が 100% を超える値を受け付けない（直前の値へ戻す）」としていたが、
   * それが依頼者の言う「**フォーム側が補正されるからめっちゃ使いにくい**」の正体だった——
   * **入力の順番に依存し**（先に下げないと上げられない）、**戻された理由も画面に出ない**。
   * ⇒ **受け付けないのは「その行の値として成立しないもの」だけ**にした:
   *   1. 数値でない
   *   2. 0.1% 未満（＝重み 0。保存層が落とすうえ「絶対に出ない景品」になる）
   *   3. 100% 超（**1 行だけで 100% を超える値**は、どう転んでも成立しない）
   * ⚠ **合計の超過は「受け付けない理由」ではない**——画面の合計行が赤字で伝え、抽選だけ止める。
   *
   * ⚠⚠⚠ **レビュー Q-063a-1: 受け付けないときは必ず理由を出す**（[`percentErrors`] の注記が正）。
   * 063a-2 が捨てられた理由の 1 つが「**戻された理由が画面に出ない**」ことだったのに、
   * ここは**無言で元の値へ戻していた**。⇒ 上の 3 つのどれで落ちたかを行の下に出す。
   */
  const commitPercent = (index: number) => {
    const raw = percentDrafts[index];
    setPercentDrafts((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    if (raw === undefined) return;
    // ⚠ 落ちたら理由を残し、通ったら消す（落ちる／通るの 2 経路しかない）。
    const reject = (): void =>
      setPercentErrors((prev) => ({ ...prev, [index]: PERCENT_INVALID_TEXT }));
    const parsed = Number(raw);
    // ⚠⚠ `Number.isFinite` は**入力欄からは到達しない**（`type="number"` が非数値を空文字へ
    //   正規化し、`Number("")` は 0 になって下の範囲検査で落ちる）。それでも残すのは、
    //   **この関数が「その行だけで成立する値か」の唯一の持ち主**だからで、
    //   ⚠ 将来 `type` を変えたときにここが穴にならないようにするため。
    if (!Number.isFinite(parsed)) {
      reject();
      return;
    }
    const weight = gachaPercentToWeight(parsed);
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > GACHA_PERCENT_SCALE) {
      reject();
      return;
    }
    setPercentErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    replacePrize(index, { ...prizes[index], weight });
  };

  /**
   * テスト抽選。⚠⚠ **本番の発火と「抽選そのもの」は同一実装で、違いは 2 つだけ**（063b で確定）:
   *   1. **OBS を鳴らさない**（穴 E の決定）——ここは当たった景品の**名前を数えて出す**だけである。
   *   2. **多重発火の抑制を 1 つも通らない**（畳み込み・バースト上限・クールダウンは
   *      `decideEffects` が持ち、そちらは配信中の経路にしか無い）＝**押した回数だけ引ける**。
   * ⚠⚠⚠ **抽選の確率は本番とまったく同じである**——どちらも [`drawGachaPrizeIndex`] を呼び、
   * 分母は `GACHA_PERCENT_SCALE` 固定。**ここで見た当たり方が配信中の当たり方**であり、
   * それが 063 唯一の差別化点（％が信用できること）そのものなので、
   * ⚠ **どちらか一方を別実装にしないこと**（本番側は `effectFire.ts` の `decideFireSourceNames` が正）。
   *
   * ⚠ レビュー Q-063a-10: `tally` を**表示名でキーにしている**ので、同名の景品
   * （名前が空で OBS ソースも同じ場合を含む）は**合算される**。**意図的にこのままにしている**——
   * ここで見たいのは「打った％どおりに当たるか」の体感で、**画面に出ている名前どおりに数えるのが素直**
   * だからである（index で数えると「大当たり 3 / 大当たり 1」と同名が並び、かえって読めない）。
   * ⚠ **直すべき条件＝ 063b が当選ログや実測の内訳を出すようになったとき**
   * （そのときは景品の同一性が意味を持つので、index か id で数えること）。
   */
  const testDraw = () => {
    if (overAllocated) return;
    const index = drawGachaPrizeIndex(prizes, Math.random);
    // ⚠⚠⚠ 063a-3: `-1` は「**何も当たらなかった**」（合計が 100% 未満なら必ず起きる）。
    //   ⚠ **黙って何もしないのが最悪**なので、「はずれ」として数える。
    const label = index < 0 ? MISS_LABEL : prizeLabel(prizes[index]);
    setLastDraw(label);
    setTally((prev) => ({ ...prev, [label]: (prev[label] ?? 0) + 1 }));
  };

  return (
    <div className={styles.gachaPanel}>
      {/* ⚠⚠⚠ **063b で「配信中の自動抽選はまだ動きません」の 1 文を消した**——
          063a / 063d では `select` が当たり判定の前に落としていたが、いまはこのガチャを
          条件に割り当てると**配信中に実際に引かれる**（`effectFire.ts` の `decideFireSourceNames`）。
          ⚠⚠ **「チャットへの書き込みには対応していません」は残す**——当選結果をチャットへ書く機能
          （**063f**・旧「066 段 3」）はまだ無いので、いまも嘘ではない。
          ⚠⚠⚠ **2026-08-23 訂正: その前提だった 066 段 2（`start-session` のチケット化）は完了した。**
          ⚠ **消してよくなる条件＝ 063f（自動送信）を繋いだとき**（066 段 2 の完了だけでは消せない）。
          ⚠ 黙って何も起きない状態を作らないため、約束できることだけを書く（061a Q-1）。 */}
      <p className={styles.note}>
        景品ごとに「出る確率」を入れてください。
        合計が 100%
        に足りないぶんは「何も出ない（はずれ）」になります。はずれにも演出を出したいときは、はずれの行を足してください。
        いまは当たったときに配信画面へ出すことだけができます（チャットへの書き込みには対応していません）。
      </p>

      {prizes.length === 0 ? (
        <p className={styles.note}>景品がありません。</p>
      ) : (
        <div className={styles.gachaList}>
          {/* ⚠⚠ **「重み」という言葉を画面から消した**（063a-2）。たぬえさ3 の用語をそのまま出すと、
              063s が特定した痛点（％→クジの本数への手換算）を**消したことにならない**。
              ⚠⚠ **「当たったら」列は、いまは 1 種類しか選べない**——[063t](../../../../docs/tasks/063t-gacha-output-types-spike.md)
              が確定させたとおり、StreamDock はガチャの出力 4 型のうち「配信画面に出す」しかできない
              （チャットに書く経路が 1 本も無い）。⚠ **列名を「OBS のソース」にしないのは、
              将来ここが増える場所だから**であり、増えるまでは下の注記で正直に断っている。 */}
          <div className={`${styles.gachaRow} ${styles.gachaHead}`}>
            <span className={styles.gachaName}>景品名</span>
            <span className={styles.gachaPercent}>出る確率</span>
            <span className={styles.gachaSource}>当たったら</span>
            <span className={styles.gachaActions} />
          </div>
          {prizes.map((prize, index) => {
            const n = index + 1;
            const missing =
              obsSources !== null &&
              isObsSourceMissingFromList(
                { kind: "obs-source", sourceName: prize.sourceName },
                obsSources,
              );
            // ⚠⚠ 一覧に無い名前でも `<option>` を出す（出さないとブラウザが先頭を選び、
            //   **黙って別のソースへ化ける**）。⚠ 警告は下に出す。
            //   ⚠ `missing` は一覧が未取得のとき常に `false` なので、**未取得も自前の option が要る**。
            const needsOwnOption = obsSources === null || missing;
            const options = needsOwnOption
              ? [...(obsSources ?? []).map((s) => s.name), prize.sourceName]
              : (obsSources ?? []).map((s) => s.name);
            return (
              <div key={index} className={styles.gachaRow}>
                <span className={`${layout.field} ${styles.gachaName}`}>
                  <input
                    type="text"
                    value={nameDrafts[index] ?? prize.name}
                    aria-label={`${labelPrefix} 景品 ${n} の名前`}
                    maxLength={GACHA_PRIZE_NAME_MAX_LENGTH}
                    placeholder="例: 大当たり"
                    onChange={(e) =>
                      setNameDrafts((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                    onBlur={() => commitName(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitName(index);
                    }}
                  />
                </span>
                {/* ⚠⚠⚠ **063a-3: すべての行が自由に入力できる。**
                    063a-2 は「いちばん下＝残り（入力不可）」にしていたが、そのせいで
                    **行どうしが連動し、合計 100% を超える入力が黙って元へ戻る**——
                    しかも**入力の順番に依存**した（先に下げないと上げられない）。
                    ⚠ **連動を作り直さないこと。** 合計の超過は下の合計行で伝える。 */}
                <span className={`${layout.field} ${styles.gachaPercent}`}>
                  <input
                    type="number"
                    value={percentDrafts[index] ?? percentInputValue(prize.weight)}
                    aria-label={`${labelPrefix} 景品 ${n} の出る確率`}
                    // ⚠ ブラウザの補助であって保証ではない（048 の `min` / `max` と同じ位置づけ）。
                    //   ⚠⚠ **他の行を見た制限は掛けない**（それが「補正されて使いにくい」の原因だった）。
                    min={0.1}
                    max={100}
                    step={0.1}
                    onChange={(e) => {
                      setPercentDrafts((prev) => ({
                        ...prev,
                        [index]: e.target.value,
                      }));
                      // ⚠ 打ち直し始めたら前回の理由は消す（古い理由が新しい入力に付いて見えない）。
                      setPercentErrors((prev) => {
                        if (prev[index] === undefined) return prev;
                        const next = { ...prev };
                        delete next[index];
                        return next;
                      });
                    }}
                    onBlur={() => commitPercent(index)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitPercent(index);
                    }}
                  />
                </span>
                <span className={styles.gachaSource}>
                  <Select
                    value={gachaPrizeSelectValue(prize.sourceName)}
                    ariaLabel={`${labelPrefix} 景品 ${n} の OBS のソース`}
                    onChange={(e) => {
                      // ⚠ 分解は `effectSelectAssignment` に閉じる（`slice` をここに書かない）。
                      const next = effectSelectAssignment(e.target.value);
                      if (next.kind !== "obs-source") return;
                      replacePrize(index, { ...prize, sourceName: next.sourceName });
                    }}
                  >
                    {options.map((name) => (
                      <option
                        key={`${OBS_SOURCE_PREFIX}${name}`}
                        value={`${OBS_SOURCE_PREFIX}${name}`}
                      >
                        {name}
                      </option>
                    ))}
                  </Select>
                </span>
                <span className={styles.gachaActions}>
                  <Button
                    type="button"
                    aria-label={`${labelPrefix} 景品 ${n} を上へ`}
                    disabled={index === 0}
                    onClick={() => movePrize(index, -1)}
                  >
                    <span className={styles.iconGlyph} aria-hidden="true">
                      ↑
                    </span>
                  </Button>
                  <Button
                    type="button"
                    aria-label={`${labelPrefix} 景品 ${n} を下へ`}
                    disabled={index === prizes.length - 1}
                    onClick={() => movePrize(index, 1)}
                  >
                    <span className={styles.iconGlyph} aria-hidden="true">
                      ↓
                    </span>
                  </Button>
                  {/* ⚠ アクセシブル名に景品番号を入れる（↑ ↓ と同じ規律）。
                      ⚠⚠ **見た目の文字は「削除」のまま**——キーワード行の削除ボタンと**同じ画面に並ぶ**ので、
                      読み上げで「削除」が複数個あると**どの行のものか分からない**。 */}
                  <Button
                    type="button"
                    aria-label={`${labelPrefix} 景品 ${n} を削除`}
                    onClick={() => removePrize(index)}
                  >
                    削除
                  </Button>
                </span>
                {percentErrors[index] !== undefined && (
                  // ⚠⚠⚠ Q-063a-1: **戻したなら理由を出す。** 黙って元の値に戻すのは
                  //   063a-2 が捨てられた理由そのものである（061a Q-1）。
                  <p className={styles.errorText}>{percentErrors[index]}</p>
                )}
                {missing && (
                  // ⚠⚠ 064b と**同じ文**（OBS 側で名前を変えた／消したときに気付ける唯一の場所）。
                  <p className={styles.errorText}>
                    OBS にこの名前のソースが見つかりません。名前を変えた場合は選び直してください。
                  </p>
                )}
              </div>
            );
          })}
          {/* ⚠⚠⚠ 063a-3: **合計は「結果」であって「制約」ではない。**
              超過していても**入力は戻さない**——ここに出して、ユーザーに直してもらう。
              ⚠ **足りないぶんは「何も出ない」**（＝はずれ）であって、エラーではない。 */}
          <div className={`${styles.gachaRow} ${styles.gachaTotal}`}>
            <span className={styles.gachaName}>合計</span>
            <span className={styles.gachaPercent}>
              {gachaTotalPercentText(prizes)}
            </span>
            <span className={styles.gachaSource}>
              {overAllocated ? null : missWeight > 0 ? (
                `何も出ない: ${gachaWeightToPercent(missWeight).toFixed(1)}%`
              ) : (
                "ちょうど 100%"
              )}
            </span>
            <span className={styles.gachaActions} />
          </div>
          {overAllocated && (
            // ⚠⚠⚠ **入力を戻す代わりに、ここで伝える。** 直し方まで書く（061a Q-1）。
            <p className={styles.errorText}>
              合計が{" "}
              {gachaWeightToPercent(total - GACHA_PERCENT_SCALE).toFixed(1)}%
              多いです。どれかの確率を下げてください（このままでは抽選できません）。
            </p>
          )}
        </div>
      )}

      {/* ⚠⚠ レビュー Q-063a-7: **この 2 つにも `labelPrefix` を付ける。**
          表は条件行ごとに開くので、付けないと**ガチャを 2 つ設定した瞬間に
          同じアクセシブル名のボタンが 2 個**になり、読み上げでどちらの表のものか分からなくなる
          （行内の ↑ ↓ 削除に景品番号を入れているのとまったく同じ規律）。 */}
      <div className={styles.rowActions}>
        <Button
          type="button"
          aria-label={`${labelPrefix} 景品を追加`}
          onClick={addPrize}
          disabled={!canAddPrize}
        >
          <span className={styles.iconGlyph} aria-hidden="true">
            ＋
          </span>
        </Button>
        {/* ⚠⚠ 合計が 100% を超えている間は押せない（⚠ **入力を戻す代わりの止め方**）。 */}
        <Button
          type="button"
          aria-label={`${labelPrefix} テスト抽選`}
          onClick={testDraw}
          disabled={prizes.length === 0 || overAllocated}
        >
          テスト抽選
        </Button>
      </div>

      {/* ⚠ 押せない理由を書く（061a Q-1）。⚠ 一覧の取り直しボタンは持たない
          （064a の `ObsSourceCard` が唯一の持ち主・同じ操作を 2 か所に置かない）。 */}
      {!hasObsSources ? (
        <p className={styles.note}>
          景品を追加するには、先に OBS のソースを取得してください。
        </p>
      ) : prizes.length >= GACHA_PRIZE_MAX ? (
        <p className={styles.note}>景品は {GACHA_PRIZE_MAX} 個までです。</p>
      ) : null}

      {lastDraw !== null && (
        // ⚠⚠ 穴 E: **画面の中にテキストで出すだけ**（OBS のソースは鳴らさない）。
        //   ⚠ 実際に鳴らす案は却下した——**配信中に押すと本番の画面へ出てしまう**うえ、
        //   OBS 未接続だと何も起きず「壊れている」と読めるため（判断の全文は progress.md の 063a 節）。
        //   ⚠ 確率の体感を確かめるには 1 回では足りないので、**累計の内訳**を併せて出す。
        <p className={styles.gachaResult}>
          結果: {lastDraw}
          {tallyTotal > 0 && (
            <>
              {" ／ "}
              テスト抽選 {tallyTotal} 回:{" "}
              {Object.entries(tally)
                .map(([label, count]) => `${label} ${count}`)
                .join(" / ")}
            </>
          )}
        </p>
      )}
    </div>
  );
}
