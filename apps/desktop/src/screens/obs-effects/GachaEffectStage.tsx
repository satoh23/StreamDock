import capsule1Url from "../../assets/gacha/capsule-1.png";
import capsule2Url from "../../assets/gacha/capsule-2.png";
import capsule3Url from "../../assets/gacha/capsule-3.png";
import capsule4Url from "../../assets/gacha/capsule-4.png";
import machine1Url from "../../assets/gacha/machine-1.png";
import machine2Url from "../../assets/gacha/machine-2.png";
import machine3Url from "../../assets/gacha/machine-3.png";
import machine4Url from "../../assets/gacha/machine-4.png";
import machine5Url from "../../assets/gacha/machine-5.png";
import sparkleUrl from "../../assets/gacha/sparkle.png";
import telopGachaUrl from "../../assets/gacha/telop-gacha.png";
import telopRareUrl from "../../assets/gacha/telop-rare.png";
import telopPakaUrl from "../../assets/gacha/telop-paka.png";
import type { CSSProperties } from "react";
import type { GachaStageView } from "./gachaStagePlayback";
import styles from "./EffectOverlayApp.module.css";

/**
 * ⚠⚠⚠ **063c 段 2-b: ガチャの当選を配信画面に描く**（[`EffectOverlayApp`] のガチャ層の中身）。
 *
 * ## ⚠⚠ ここは「描くだけ」である
 *
 * **抽選もしない・時間も数えない・localStorage も読まない。**
 * 何を出すかは [`gachaStageView`] が経過時間から決め、当たりは `effectFire.ts` が決めている。
 * ⚠⚠⚠ **この 3 つのどれかをここへ持ち込むと、「演出は A・OBS は B」という
 * 実機でしか見えない食い違い**か、**テストで固定できない時間依存**のどちらかが生まれる。
 *
 * ## ⚠ 意匠を別の CSS モジュールに分けていない理由
 *
 * `EffectOverlayApp.module.css` を import している（このファイル専用の CSS を作っていない）。
 * ⚠⚠ **`scripts/check-css-guards.mjs` の (10-r) が走査するのはあのファイル 1 枚だけ**なので、
 * 新しいモジュールを作ると **`.gachaLayer` の位置指定（意匠ではなく要件）が走査の外へ出る**。
 * ⚠ 分けたくなったら、**先に (10-r) の走査先を増やすこと。**
 *
 * ## §9（⚠⚠⚠ **063c 段 3 で線が動いた**）
 *
 * ⚠⚠ 画面に出る文字は **`prizeLabel`（ユーザー自身の入力）** と
 * **`viewerName`（⚠⚠⚠ 第三者の表示名）** の 2 つだけである。
 * ⚠⚠⚠ **`viewerName` はこのリポジトリで唯一「演出に載る第三者データ」**で、
 * `docs/security.md` §9 の追補が根拠になっている。
 * ⚠ **コメント本文・視聴者 id・金額・アバターを受け取る口を作らないこと**——
 * この窓は OBS のキャプチャに映るので、**視聴者にそのまま読める**。
 * ⚠⚠ 名前を切るのは送る側（`stageViewerName`）で、**ここで長さをいじらない**（規則を 2 通りにしない）。
 *
 * ## ⚠⚠⚠ 素材に焼き込まれた文字は「測れるもの」しか使っていない
 *
 * 元シートには「大当たり！」のテロップとカードが在るが**使っていない**——
 * ⚠ **どの景品が当たっても「大当たり」と出る**のは視聴者に対する嘘になる（当たりやすさは景品ごとに違う）。
 * ⚠⚠ **「レア！」は使う**（063c 段 3）——`rare` は [`isGachaRarePrize`] が
 * **ユーザーが打った％そのもの**から決めているので、**測れるし嘘にならない**。
 * ⚠⚠⚠ **閾値をこのファイルに持ち込まないこと**（`rare` を受け取るだけ）——
 * 持ち込むと「抽選が思っているレア度」と「絵が主張するレア度」が別実装になる。
 * ⚠ 素材の出どころと切り出しの規則は `docs/assets-source/extract-gacha-assets.py` が正。
 */

/**
 * 抽選中に回すマシンのコマ（⚠ **順序が意味を持つ**）。
 * 1〜4＝ハンドルが回る（ループ）／5＝カプセルが出てくる（抽選中の最後・**1 枚を持たせる**）。
 *
 * ⚠⚠⚠ **063c 段 2-c: シートの 6 コマ目は使わない**——**排出されるカプセルの色が違う**（青／桃）ため、
 * 挟むと「**青いカプセルが出てきて、赤いカプセルが割れる**」になる。
 * ⚠ 排出を長く見せたいときは**コマを増やすのではなく [`GACHA_DISPENSE_MS`] を延ばす**こと。
 */
const MACHINE_FRAMES = [
  machine1Url,
  machine2Url,
  machine3Url,
  machine4Url,
  machine5Url,
];

/**
 * 開封のコマ（閉じている → ひび → 開いて発光 → **二つに割れる**）。
 * ⚠ 4 コマ目だけ**シートの 5 番目のセル**から切ってある（理由は `extract-gacha-assets.py` が正）。
 */
const CAPSULE_FRAMES = [capsule1Url, capsule2Url, capsule3Url, capsule4Url];

export function GachaEffectStage({
  view,
  prizeLabel,
  viewerName,
  rare,
  prizeColor,
}: {
  view: GachaStageView;
  /** ⚠ 景品の表示名（[`gachaPrizeLabel`] が決めた後の値）。⚠⚠ **空文字は来ない。** */
  prizeLabel: string;
  /**
   * ⚠⚠⚠ 引いた視聴者の表示名（`null` ＝ 出さない）。**唯一の第三者データ**（上の §9 節が正）。
   * ⚠ **3 段すべてに出す**——「誰のガチャか」は**結果が出る前に分かっていないと意味が無い**
   * （抽選中に出ていないと、視聴者は自分の番かどうか分からないまま数秒待つことになる）。
   */
  viewerName: string | null;
  /** ⚠ 確率が低い景品か（判定は [`isGachaRarePrize`] が持つ・**ここでは受け取るだけ**）。 */
  rare: boolean;
  /**
   * ⚠⚠ 063c 段 4-b / **段 5-e**: 景品名の色（**CSS の色そのもの**）。
   *
   * ⚠⚠⚠ **段 5-e で保存形が「6 択の id」から「自由な色（`#rrggbb`）」へ変わった。**
   * （旧記述: 「id ではなく解決済みの色を受け取る／変換は `gachaPrizeColorCss` 1 か所」——
   * ⚠ **あの関数はもう存在しない**。段 4-b の文章が残っていたのを 段 5-e レビュー Q-3 で訂正した。）
   *
   * ⚠⚠ **受け取るのは検査済みの CSS 色**で、関門は
   * [`parseGachaPrizeColor`]（`features/comment-viewer/overlaySettings.ts`）**ただ 1 つ**である——
   * 通る文法は **`#` ＋ 16 進 6 桁だけ**（`url(…)` も `var(…)` も `;` も表現できない）。
   * ⚠⚠⚠ **`localStorage` の生の値がここへ直接届く経路を作らないこと。**
   * ⚠ ここで既定値を持たないこと（2 通り目の既定は必ず食い違う。既定は `parseGachaPrizeColor` が持つ）。
   * ⚠⚠ この値は `--gacha-prize-color` として `style` に入り、**消費先は `.gachaPrize` の `color:` 1 か所**
   * ——`url()` を受けるプロパティで使うと透過窓から外部リクエストが出る
   * （`scripts/check-css-guards.mjs` の (10-u) が固定している）。
   */
  prizeColor: string;
}) {
  // ⚠ 3 段で同じものを同じ場所に出すので、**組み立ては 1 か所**にする
  //   （段ごとに書くと、片方だけ直して「開封のときだけ名前が消える」が起きる）。
  //
  // ⚠⚠⚠ **063c 段 6: 名前だけを `<span>` で包んで大きくする**（依頼者＝「**結構小さくして
  //   エフェクトは左下などに表示する想定なので、今の大きさだと誰のガチャかわからない**」）。
  //   ⚠ **「さんのガチャ」は今までの大きさのまま**にしてある——あれは文脈語で、
  //   大きくしても読みやすさに効かない一方、**行数だけが増える**（1 行に入る文字数は
  //   文字サイズに反比例するので、6 文字の接尾辞を大きくすると名前の入る幅がそのぶん減る）。
  // ⚠⚠⚠ **063c 段 6-c: 大きくするのは「ユーザー名」だけ**（依頼者の指示）。
  //   ⇒ **1 行目＝名前（大）／2 行目＝「さんのガチャ」（小・1 行にまとめる）**。
  //   ⚠ **敬称「さん」を名前側へ付けないこと**（段 6-b は付けていたが、依頼者＝
  //   「**さんは「のガチャ」と同じ大きさにして／ユーザー名だけが大きく表示されるイメージ**」）。
  //   ⚠⚠ **「さんのガチャ」は 6 文字で必ず 1 行に収まる**ので、ここで割れる心配は無い
  //   （割れるのは名前のほうだけ）。
  // ⚠⚠ 改行は `.gachaViewerName` の `display: block` が作る（`<br>` を置かない）——
  //   置くと**名前が空のときに空行だけが残る**形を新しく作ることになる
  //   （いまは `viewerName === null` で器ごと出さないので、その状態自体が存在しない）。
  // ⚠ 2 行目の先頭に来る半角空白は、**行頭の空白として CSS が畳む**ので中央寄せはずれない。
  //
  // ⚠⚠⚠ **文字の並びは 1 バイトも変えていない**（"〇〇" ＋ " " ＋ "さんのガチャ"）。
  //   `document.body.textContent` を丸ごと突き合わせている §9 のテストが見ているのはこの並びなので、
  //   ⚠ **`{" "}` を消さないこと**（消すと並びが "〇〇さんのガチャ" になり、そちらがレッドになる）。
  const viewer =
    viewerName === null ? null : (
      <p className={styles.gachaViewer}>
        <span className={styles.gachaViewerName}>{viewerName}</span>{" "}
        さんのガチャ
      </p>
    );

  // ⚠ 色は CSS 変数で渡す（`.gachaPrize` が `var(--gacha-prize-color)` で受ける）。
  //   ⚠⚠ **`color` を直接インラインで当てないこと**——当てると
  //   CSS 側の `text-shadow`（縁取り）と別々の場所で管理することになる。
  const stageStyle = {
    "--gacha-prize-color": prizeColor,
  } as CSSProperties;

  if (view.phase === "spin") {
    return (
      <div className={styles.gachaStage} style={stageStyle}>
        {viewer}
        {/* ⚠ `alt=""` ＝ 意味を持たない装飾（読み上げ対象にしない）。
            ⚠⚠ **コマは 1 枚ずつ差し替える**（全コマを重ねて opacity で切り替える形にしないこと——
            透過窓では重なったコマの半透明部分が互いに透けて、絵が濁る）。 */}
        <img
          className={styles.gachaMachine}
          src={MACHINE_FRAMES[Math.min(view.frame, MACHINE_FRAMES.length - 1)]}
          alt=""
        />
        <img className={styles.gachaTelop} src={telopGachaUrl} alt="" />
      </div>
    );
  }

  if (view.phase === "open") {
    return (
      <div className={styles.gachaStage} style={stageStyle}>
        {viewer}
        <img
          className={styles.gachaCapsule}
          src={CAPSULE_FRAMES[Math.min(view.frame, CAPSULE_FRAMES.length - 1)]}
          alt=""
        />
        <img className={styles.gachaTelop} src={telopPakaUrl} alt="" />
      </div>
    );
  }

  return (
    <div className={styles.gachaStage} style={stageStyle}>
      {/* ⚠⚠⚠ **063c 段 5-c: 光は「いちばん先」に置く**（DOM 順で先＝背面）。
          ⚠⚠ 段 4 までは「レア！」がこれより**前**に書かれていたため、
          **キラキラがテロップの上に乗って「レア！」が沈んで見えた**（依頼者の指摘）。
          ⚠ `z-index` では直さない——透過窓で重なり順の管理点を増やすと、
          **OBS 側の合成でどう見えるかが予測できなくなる**。⇒ **順序 1 本で決める。**
          ⚠⚠ 063c 段 2-c: **放射状のバーストと光球はやめた**（画面の半分を占めて景品名より強かった）。
          いまは金の粒 1 枚だけ＝**背景を明るくするが主役を食わない**。 */}
      <img className={styles.gachaSparkle} src={sparkleUrl} alt="" />
      {viewer}
      <img className={styles.gachaShell} src={CAPSULE_FRAMES[3]} alt="" />
      {/* ⚠⚠⚠ **063c 段 5-b: 「が当たりました」を消した**（依頼者の指示）。
          ⚠ 残っているのは**景品名 1 行だけ**である＝ **主役をいちばん大きく出す**
          （CSS 側で 64px → 84px にしたのと同じ判断）。
          ⚠⚠ **説明文を戻さないこと**——戻すなら「なぜ景品名だけでは足りないか」を先に書くこと。 */}
      <div className={styles.gachaCard}>
        <p className={styles.gachaPrize}>{prizeLabel}</p>
        {/* ⚠⚠⚠ **063c 段 6-e: 「レア！」を景品名の器の「中」へ移した**（依頼者の実機指摘＝
            「**文字を大きくしたことによって「レア！」のアイコンが文字に被って見えなくなった**」）。

            ## ⚠⚠ 犯人は消去法で一意に決まる

            「レア！」より**後に描かれる**のは `.gachaShell` と `.gachaCard` の 2 つだけで
            （このファイルは `z-index` を 1 つも使わない＝重なり順は DOM 順 1 本で決める）、
            殻は `bottom: 4%` ＝ **y 345px より下**なので届かない。⇒ **器しかありえない。**

            ## ⚠⚠⚠ なぜ器が「上から」被さってきたのか

            器は `align-items: center` ＋ `margin-bottom: 120px` で置かれているので、
            **景品名が伸びると上下へ half ずつ広がる**＝ **上端が上がってくる**。
            ⚠ 段 6-d が名前の帯を避けてテロップを 80px 下げた先が、ちょうどその領域だった
            （テロップ 161〜293px ／ 器 212〜340px ⇒ **縦 81px＝テロップの 61%** が下地の下）。
            ⚠⚠ **景品名の長さに関係なく無条件で起きる**——器の上端は 1 行なら必ず 212px だからである。

            ## ⚠⚠ 中へ入れると「隠される経路」が構造的に消える

            器の子は**器より後に描かれる**ので、⚠⚠⚠ **器がどれだけ伸びても沈まない。**
            ⚠ しかも器と**一緒に動く**ので、景品名が 24 文字（4 行）になってもずれない。
            ⚠⚠ **`z-index` は足していない**（段 5-c の「順序 1 本で決める」を守ったままである）。

            ⚠ 「ガチャ！」「パカッ！」は**動かしていない**——あの 2 つは**段のラベル**で、
            結果の器が存在しない段に出るものだからである（同じ場所に置きようがない）。

            **再修正トリガー＝「レア！」を右上の独立したテロップへ戻したくなったとき。**
            ⚠⚠⚠ そのときは**先に器が上へ伸びる性質を解くこと**（`margin-bottom: 120px` ＋ 上下中央）。
            解かずに戻すと、**この不具合がそのまま再発する**。 */}
        {rare && (
          <img className={styles.gachaTelopRare} src={telopRareUrl} alt="" />
        )}
      </div>
    </div>
  );
}
