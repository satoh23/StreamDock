import { useState } from "react";
import { Button } from "../../components/primitives";
import { ConfirmDialog } from "../../components/ConfirmDialog";
// ⚠ 063f 段 1-b: 「高度な設定」の中のトグル 1 つだけに使う（画面を跨ぐ部品は `components/`・061g）。
import { ToggleSwitch } from "../../components/ToggleSwitch";
import type { ObsSourceEntry } from "../../features/comment-viewer/overlaySettings";
import {
  GACHA_DEFINITION_MAX,
  GACHA_NAME_MAX_LENGTH,
  loadEffectConditions,
  nextGachaId,
  referencedGachaIds,
  sanitizeGachaName,
  type GachaDefinition,
  type GachaPrize,
} from "./effectAssignments";
import { conditionLabel } from "./effectEventRows";
import { GachaPrizeTable } from "./GachaPrizeTable";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 063d: **名前付きのガチャの一覧**（作る・名前を変える・景品を編集する・消す）。
 *
 * ⚠⚠⚠ **このカードが在る理由＝ 063a では同じガチャを 2 回入力させていたから。**
 * 063a は景品を割り当てに直付けしていたので、「スパチャとビッツで同じガチャ」を作るには
 * **景品表を 2 回入力**し、**直すときも 2 箇所直す**必要があった
 * （⚠ 片方を忘れると**確率が静かにずれる**——画面のどこにも出ない）。
 * ⇒ **ガチャ本体をここに 1 つだけ置き、条件は `gacha:<id>` で指すだけ**にした。
 *
 * ## ⚠⚠ なぜタブを増やさず「共通の下部」に置くのか（063d 穴 V）
 *
 * 063a は 穴 G で「3 枚目のタブにすると**共通の下部＝出力窓の設定がガチャにも掛かって見える**」
 * としてタブ追加を却下した。⚠ **その共通の下部は 064e / 064f で既に空になっており、
 * 却下の理由そのものは失効している。**
 *
 * ⚠⚠ **それでも結論は変えない。理由が別に立つからである**——ガチャは
 * 「コメントで出すエフェクト」でも「配信イベント」でもなく、**両方のタブから参照される共有物**である。
 * 3 枚目のタブにすると「**3 種類目のエフェクト**」に見え、それは嘘になる。
 * ⇒ **タブの外（両タブに掛かる場所）に置くのが、この構造をそのまま表している。**
 *
 * ## ⚠ 消すときは黙って壊さない（063d 穴 R）
 *
 * 使用中のガチャを消すと、それを指していた条件は**参照が切れて「出さない」へ倒れる**。
 * ⇒ **どの条件で使われているかを列挙して確認する**（`ConfirmDialog`）。
 * ⚠ 消したあとは条件行に警告が出る（064b の「OBS にこの名前のソースが見つかりません」と同じ手）。
 */

/** ⚠ 新しいガチャの既定名。⚠ 連番は **id の数字部分**（`nextGachaId` が採る＝必ず一意）。 */
const NEW_GACHA_NAME = "新しいガチャ";

/** `"g:"` の長さ。⚠ 既定名の連番を id から取り出すためだけに使う（接頭辞の持ち主は保存層）。 */
const GACHA_ID_PREFIX_LENGTH = 2;

/** ⚠ 名前を受け付けなかった理由。⚠ `GachaPrizeTable` の `PERCENT_INVALID_TEXT` と同じ位置づけ。 */
const NAME_EMPTY_TEXT = "名前を入れてください（空にはできません）。";

export function GachaLibraryCard({
  gachas,
  obsSources,
  onChange,
  chatEnabled,
  onChatEnabledChange,
}: {
  gachas: readonly GachaDefinition[];
  /** 064b / 064f と同じ経路で受け取る OBS ソース一覧（`null` ＝ **まだ 1 度も取っていない**）。 */
  obsSources: readonly ObsSourceEntry[] | null;
  /** ⚠ 保存は呼び出し側（`ObsEffectsScreen`）が 1 か所で行う（064f の `obsSources` と同じ役割分担）。 */
  onChange: (gachas: readonly GachaDefinition[]) => void;
  /**
   * ⚠⚠⚠ **063f 段 1-b: 「ガチャの結果をチャットに書き込む」の現在値**
   * （⚠⚠ **2026-08-30 以降は、これが同意の唯一の旗である**——旧記述「同意の 2 枚目」は
   * 親トグルの廃止で嘘になった。`docs/security.md` §1「追補（063f）」の「同意」節が正）。
   * ⚠⚠ **書き手は `ObsEffectsScreen` 1 か所**（`saveGachaChatEnabled` をここで呼ばないこと）。
   */
  chatEnabled: boolean;
  /**
   * トグルの操作を親（`ObsEffectsScreen`）へ返すだけ。⚠ **保存はあちらが 1 か所で行う。**
   *
   * ⚠⚠⚠ **2026-08-30: ここには削除した `chatSendAllowed`（親トグルの状態）の JSDoc が
   * 残っていた**（＝ prop の説明が 1 つずれていた）。親が無くなったので**説明ごと消した**。
   */
  onChatEnabledChange: (next: boolean) => void;
}) {
  /**
   * いま景品表を開いているガチャの id（`null` ＝ どれも開いていない）。
   *
   * ⚠⚠ **同時に 1 つだけ開く。** 複数開けると、⚠ 同じ `labelPrefix` の
   * `＋ 景品を追加` / `テスト抽選` が画面に並ぶ（レビュー Q-063a-7 で潰した罠が別の形で戻る）。
   */
  const [openId, setOpenId] = useState<string | null>(null);
  /** 名前の入力中の生文字列（061j 穴 α と同じ＝1 打鍵ごとに保存しない）。 */
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  /** 削除確認の対象（`null` ＝ 出していない）。 */
  const [deleting, setDeleting] = useState<GachaDefinition | null>(null);
  /**
   * ⚠ 名前を受け付けなかった理由（id キー・`null` ＝ 出していない）。
   *
   * ⚠⚠ **レビュー Q-4（修正）: 空名を「黙って戻す」のをやめた。** 旧実装は
   * `if (name.length === 0) return;` で入力欄を元の値へ戻すだけで、**画面に理由が出なかった**
   * ——`GachaPrizeTable` の `percentErrors` が既に持っている形（レビュー Q-063a-1
   * 「受け付けなかったら必ず理由を出す」）と**同じ規律をここにも敷く**。
   */
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  /**
   * ⚠⚠⚠ **この窓がこのセッションで発行した id**（削除されても減らない）。
   *
   * ⚠⚠ **レビュー Q-1（修正）: `referencedGachaIds()` だけでは穴 W が塞ぎきれない。**
   * あれは**保存済みの条件**しか見ないので、**未確定行（`EffectAssignmentCard` の `draftRow`）が
   * 指しているガチャ**は数えられない。⇒ 手編集なしに次の順で踏める:
   *   1. ガチャを作る（`g:1`）／2. 未確定行のエフェクトに `g:1` を選ぶ（**まだ保存されない**）／
   *   3. `g:1` を削除（保存済みの参照はゼロ）／4. ガチャを作る → **`g:1` が再利用される**／
   *   5. 未確定行を確定 → **ユーザーが選んだのとは別の、いま作ったガチャを指す**
   * ⚠ 手順 3〜4 の間だけ「削除されました」の警告が出て、**手順 4 で消える**ので
   * 最終状態には手がかりが 1 つも残らない（＝「黙って壊れる」側）。
   *
   * ⇒ **一度発行した id は、そのセッションの間ずっと避ける。** 未確定行はメモリ上にしか無く、
   * 窓を開き直せば消えるので、**この state の寿命と未確定行の寿命が一致する**＝ これで塞がる。
   * ⚠ **localStorage には持たない**（保存項目を増やすと、それ自体が新しい壊れ方の入口になる）。
   */
  const [issuedIds, setIssuedIds] = useState<readonly string[]>([]);

  const canAdd = gachas.length < GACHA_DEFINITION_MAX;

  const addGacha = () => {
    if (!canAdd) return;
    // ⚠⚠⚠ **消した id を再利用しない**——一覧に無くても、条件がまだ指している id
    //   （保存済み＝`referencedGachaIds()` ／ 未保存＝`issuedIds`）は避ける。
    //   ⚠ `nextGachaId` の注記が正。再利用すると古い参照が新しいガチャを黙って指す。
    const id = nextGachaId(gachas, [...referencedGachaIds(), ...issuedIds]);
    setIssuedIds((prev) => [...prev, id]);
    // ⚠ 名前は必ず非空にする（保存層が空名を落とすので、空で作ると**作った瞬間に消える**）。
    // ⚠⚠ **レビュー Q-8（修正）: 連番の元を `gachas.length + 1` から id へ変えた。**
    //   件数基準だと「作る→作る→1 つ目を消す→作る」で**同名の行が 2 つ並び**、
    //   `aria-label`（`〜 の名前` / `〜 を削除` / `〜 の景品を編集`）が衝突する
    //   （読み上げでどちらの行か分からず、`getByLabelText` も引けなくなる＝ Q-063a-6/7 と同型）。
    //   ⚠ id は削除しても詰めないので、**既定名は必ず一意になる**。
    const name = sanitizeGachaName(
      `${NEW_GACHA_NAME} ${id.slice(GACHA_ID_PREFIX_LENGTH)}`,
    );
    onChange([...gachas, { id, name, prizes: [] }]);
    // ⚠ 作ったら開く（作った直後に何も起きないと「押したのに増えていない」に見える）。
    setOpenId(id);
  };

  const replaceGacha = (id: string, next: GachaDefinition) =>
    onChange(gachas.map((g) => (g.id === id ? next : g)));

  const commitName = (gacha: GachaDefinition) => {
    const raw = nameDrafts[gacha.id];
    setNameDrafts((prev) => {
      const next = { ...prev };
      delete next[gacha.id];
      return next;
    });
    if (raw === undefined) return;
    const name = sanitizeGachaName(raw).trim();
    // ⚠⚠ **空名は受け付けない**（`<select>` の選択肢に出るので、空だと選べないガチャになる）。
    //   ⚠⚠⚠ **レビュー Q-4（修正）: 黙って戻さず、理由を出す**（レビュー Q-063a-1 と同じ規律）。
    //   旧実装はここで `return` するだけで、**入力欄が元に戻る以外に何も起きなかった**
    //   ——063a-2 が捨てられた理由そのもの（「戻された理由が画面に出ない」）を踏んでいた。
    if (name.length === 0) {
      setNameErrors((prev) => ({ ...prev, [gacha.id]: NAME_EMPTY_TEXT }));
      return;
    }
    // ⚠ 通ったら理由を消す（落ちる／通るの 2 経路しかない＝`commitPercent` と同じ形）。
    clearNameError(gacha.id);
    replaceGacha(gacha.id, { ...gacha, name });
  };

  /** ⚠ 理由を 1 件消す（打ち直し始めたときと、受け付けたとき）。 */
  const clearNameError = (id: string) =>
    setNameErrors((prev) => {
      if (prev[id] === undefined) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const setPrizes = (gacha: GachaDefinition, prizes: readonly GachaPrize[]) =>
    replaceGacha(gacha.id, { ...gacha, prizes });

  /**
   * ⚠⚠ **削除しようとしているガチャを、どの条件が使っているか。**
   *
   * ⚠ 条件は `EffectAssignmentCard` が state で持っているが、**ここでは保存値を直接読む**——
   * 削除は稀な操作なので**押した瞬間の最新**を見るほうが正しく、
   * かつ**条件の state を画面まで持ち上げる配線を作らずに済む**（064d が「画面を跨ぐ配線を残さない」
   * としたのと同じ判断）。
   *
   * ## ⚠ レビュー Q-10: **未確定行（`draftRow`）はここに出ない**（修正不要と判断）
   *
   * `EffectAssignmentCard` の未確定行はまだ保存されていないので、`loadEffectConditions()` には
   * 現れない＝ そのガチャを消しても**列挙に出ない**。⚠ **修正不要の理由**＝未確定行は
   * **保存値をまだ 1 バイトも持っていない**ので、消しても「保存済みの設定が黙って壊れる」ことは無い
   * （消えた id を指したまま確定させても、条件行に 064b と同じ警告が出る）。
   * ⚠⚠ **ただし採番のほうは別問題で、そちらは実バグだった**——[`issuedIds`] の注記が正
   * （レビュー Q-1）。**列挙と採番を同じ理由で片付けないこと。**
   * ⚠ **再修正トリガー＝未確定行が「保存される下書き」になったとき**（窓を開き直しても残る形）。
   */
  const usedBy = (gachaId: string): string[] =>
    loadEffectConditions()
      .filter((c) => c.effect.kind === "gacha" && c.effect.gachaId === gachaId)
      .map((c) => conditionLabel(c));

  const confirmDelete = () => {
    if (deleting === null) return;
    onChange(gachas.filter((g) => g.id !== deleting.id));
    if (openId === deleting.id) setOpenId(null);
    setDeleting(null);
  };

  const deletingUsedBy = deleting === null ? [] : usedBy(deleting.id);

  return (
    // ⚠⚠ **骨格は `formLayout.module.css` の `panel` を使う**（この画面の他のカードと同じ）。
    //   ⚠ `ObsEffectsScreen.module.css` に `card` / `cardHead` / `cardBody` は**無い**
    //   ——あれはコメビュ窓（`CommentViewerApp.module.css`）のクラスで、
    //   ⚠⚠ **間違えて使うと `className` が `undefined` になり、枠も余白も背景も無い素の DOM になる**
    //   （jsdom はレイアウトを解決しないので**テストは全部緑のまま**＝目視でしか気づけない）。
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        <h3>ガチャ</h3>
        <p>
          ガチャを作っておくと、上の「エフェクトを表示する条件」から選べます。
          同じガチャを複数の条件に設定でき、ここで直すとすべてに反映されます。
        </p>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠⚠⚠ **063c 段 4-d: 演出の設定（トグル・配置・文字色・プレビュー）は
            [`GachaStageCard`] へ出した。**
            依頼者の指摘＝「**項目が増えることで画面が複雑になってしまっている**」。
            ⚠⚠ このカードは **「何が当たるか」（景品と確率）** だけを持ち、
            **「どう見えるか」** はあちらが持つ。⚠ **戻さないこと。** */}
        {gachas.length === 0 ? (
          <p className={styles.note}>
            ガチャがありません。「ガチャを作る」で追加してください。
          </p>
        ) : (
          <div className={styles.gachaLibraryList}>
            {gachas.map((gacha) => {
              const open = openId === gacha.id;
              return (
                <div key={gacha.id} className={styles.gachaLibraryRow}>
                  <span className={`${layout.field} ${styles.gachaLibraryName}`}>
                    <input
                      type="text"
                      value={nameDrafts[gacha.id] ?? gacha.name}
                      /* ⚠ レビュー Q-8: **アクセシブル名はガチャ名**。既定名は id 由来で必ず一意だが、
                         ⚠⚠ **ユーザーが手で 2 つのガチャに同じ名前を付ける経路は残る**（そのときだけ
                         `aria-label` が重複する）。⚠ 修正不要と判断した理由＝ここへ通番や id を混ぜると
                         **読み上げが「新しいガチャ 1（1 件目）の名前」のように冗長**になり、
                         かつ既存の検査 14 本のラベルが全部変わる（＝書き換えでガードが緩むリスク）。
                         ⚠ **再修正トリガー＝実機で「どちらの行か分からない」と言われたとき。**
                         そのときは名前の重複を保存層で弾くのではなく、**ラベル側に位置を足す**こと
                         （名前を一意に強制すると「同じ名前を付けたい」を禁止することになる）。 */
                      aria-label={`${gacha.name} の名前`}
                      maxLength={GACHA_NAME_MAX_LENGTH}
                      onChange={(e) => {
                        setNameDrafts((prev) => ({
                          ...prev,
                          [gacha.id]: e.target.value,
                        }));
                        // ⚠ 打ち直し始めたら前回の理由は消す（古い理由が新しい入力に付いて見えない
                        //   ＝`GachaPrizeTable` の確率欄と同じ作法）。
                        clearNameError(gacha.id);
                      }}
                      onBlur={() => commitName(gacha)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitName(gacha);
                      }}
                    />
                  </span>
                  {/* ⚠ 景品の件数は畳んでいても読めるようにする（開かないと分からない、を作らない）。 */}
                  <span className={styles.gachaLibraryCount}>
                    景品 {gacha.prizes.length} 件
                  </span>
                  <span className={styles.gachaLibraryActions}>
                    {/* ⚠ 開閉は文言で状態を出す（アイコンだけだとどちらか読めない）。 */}
                    <Button
                      type="button"
                      aria-label={`${gacha.name} の景品を${open ? "閉じる" : "編集"}`}
                      onClick={() => setOpenId(open ? null : gacha.id)}
                    >
                      {open ? "閉じる" : "景品を編集"}
                    </Button>
                    <Button
                      type="button"
                      aria-label={`${gacha.name} を削除`}
                      onClick={() => setDeleting(gacha)}
                    >
                      削除
                    </Button>
                  </span>
                  {nameErrors[gacha.id] !== undefined && (
                    // ⚠⚠⚠ レビュー Q-4: **受け付けなかったなら理由を出す**（Q-063a-1 と同じ規律）。
                    //   ⚠ 行は `flex-wrap` なので `.errorText` が下へ回り込む（`.gachaRow` と同じ手）。
                    <p className={styles.errorText}>{nameErrors[gacha.id]}</p>
                  )}
                  {open && (
                    // ⚠⚠ **表は 063a のものをそのまま使う**（作り直さない）。
                    //   ⚠ `labelPrefix` は**ガチャ名**（063a では条件名だった）。
                    <GachaPrizeTable
                      prizes={gacha.prizes}
                      obsSources={obsSources}
                      labelPrefix={gacha.name}
                      onChange={(prizes) => setPrizes(gacha, prizes)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.rowActions}>
          <Button type="button" onClick={addGacha} disabled={!canAdd}>
            ガチャを作る
          </Button>
        </div>
        {/* ⚠ 押せない理由を書く（061a Q-1）。 */}
        {!canAdd && (
          <p className={styles.note}>
            ガチャは {GACHA_DEFINITION_MAX} 個までです。
          </p>
        )}

        {/* ⚠⚠⚠ **063f 段 1-b: 高度な設定（既定で閉じる）。**

            依頼者の指示（2026-08-29）＝「**ガチャ設定のカードに『高度な設定』として、
            ガチャ結果をチャット欄に投稿する（ツイッチ限定）機能欄を作って欲しい。
            高度な設定は普段は折りたたみされてるかたちで**」。

            ⚠⚠ **上の JSDoc の「このカードは景品と確率だけを持つ」に対する、意図的な 3 つ目**である
            ——063c 段 4-d が「**何が当たるか**」と「**どう見えるか**」で切ったのに、ここへ
            「**どこへ知らせるか**」が入る。⚠ **黙って混ぜたのではない**: 依頼者が
            「ガチャ機能でしか使わないのでまとめたい」と判断し、**普段の画面を複雑にしないために
            折りたたんだ**。⇒ ⚠⚠⚠ **畳みを外さないこと**（外すと 4-d の指摘がそのまま戻る）。

            ⚠⚠⚠ **既定 OFF だからこそ畳んでよい。** 既定 ON の設定を畳むと
            「**本人が見ていない同意**」になる（`docs/security.md` §1「追補（063f）」）。 */}
        <details className={styles.gachaAdvanced}>
          {/* ⚠⚠⚠ **2026-08-30・security-review S-2: 畳んだままでも「いま ON か」が読めるようにした。**
              既定 OFF なので畳んでよい、という判断は変えていない（上のコメントが正）が、
              ⚠⚠ **一度 ON にしたあとは、閉じた画面から「自動で書き込まれる状態にある」ことが
              読めなかった**——`docs/security.md` §1「追補（063f）」が禁じた
              「**本人が見ていない同意**」が、既定 OFF とは別の経路で復活する形だった。
              ⚠⚠⚠ **2026-08-30: 旧「親が OFF なら子は効かないので AND が成立しているときだけ出す」は
              対象ごと消えた**（親トグルの廃止）。⇒ **この旗が ON なら、それがそのまま同意である。**
              ⚠⚠ **同意が 1 枚になったぶん、この表示はむしろ重くなった**
              （`docs/security.md` §1 追補が「`summary` に現在値を出し続けること」を必須と明記）。
              ⚠⚠⚠ **この表示を消さないこと。** 消すなら畳みも外すこと（どちらか一方は要る）。 */}
          <summary>
            高度な設定
            {chatEnabled ? "（チャットへの書き込み: ON）" : ""}
          </summary>
          <div className={styles.gachaAdvancedBody}>
            <ToggleSwitch
              label="ガチャの結果をチャットに書き込む（Twitch のみ）"
              checked={chatEnabled}
              onChange={onChatEnabledChange}
            />
            {/* ⚠⚠⚠ **何が起きるかを先に言う**（061a Q-1）。
                ⚠⚠⚠ **063f 段 3: 「引いた人の表示名も書く」ことを必ず明記すること。**
                `docs/security.md` §9 の「追補の追補（063f）」が
                **「同意の中身が画面から読めなければ、それは同意になっていない」**と定めている。
                ⚠⚠ **ここを薄めたら、このトグルは同意として成立しなくなる。**
                ⚠ 旧文「引いた人の名前は書きません」は段 3 で**嘘になった**ので消した。 */}
            <p className={styles.note}>
              ⚠ 当たったときに、あなたのアカウント名で配信のチャットへ景品名と引いた人の表示名を書き込みます。
              書き込みは視聴者に見え、あとから消せません。
            </p>
            {/* ⚠⚠⚠ **2026-08-31（依頼者指示）: 上の同意文の下にあった注記 3 本を削除した。**
                消したのは ①演出とチャットの順序（結果が出てから書く・連発時は書かない）
                ②「初回は Twitch にログインし直す必要がある／YouTube のチャットには非対応」
                ③「書き込めなかったときはコメビュ窓の上部に出る（`title` で理由が読める）」。
                ⚠⚠ **挙動は 1 つも変えていない**（順序も再ログイン要件も失敗表示先もそのまま）。
                ⚠⚠⚠ **帰結を正直に書く**: 旧トークンには `user:write:chat` が無いので、
                アプリを更新しただけの人は **ON にしても毎回失敗し、その理由が画面のどこにも無い**。
                ⇒ 061a Q-1「黙って効かない、を作らない」を、この点については満たしていない
                （`docs/security.md` §「同意は…このカードに書き続けること」も同日に書き換えた）。
                ⚠ 再導入のトリガー＝「ON にしたのに書き込まれない」の問い合わせが来たとき。 */}
          </div>
        </details>
      </div>

      {/* ⚠⚠⚠ 063d 穴 R: **使用中のガチャを黙って壊さない。**
          ⚠ 消すと、それを指していた条件は参照が切れて「出さない」へ倒れる。 */}
      <ConfirmDialog
        open={deleting !== null}
        title="ガチャを削除しますか？"
        message={
          deletingUsedBy.length === 0
            ? `「${deleting?.name ?? ""}」を削除します。`
            : `「${deleting?.name ?? ""}」は使われています。削除すると、下の条件はエフェクトを出さなくなります。`
        }
        details={
          deletingUsedBy.length === 0 ? undefined : (
            <ul>
              {deletingUsedBy.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          )
        }
        confirmLabel="削除"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}
