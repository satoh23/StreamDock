import { useState } from "react";
import { Button } from "../../components/primitives";
import { Select } from "../../components/Select";
import {
  DEFAULT_EFFECT_ASSIGNMENT,
  isUsableKeyword,
  KEYWORD_CONDITION_MAX,
  KEYWORD_MAX_LENGTH,
  sanitizeKeywordInput,
  type EffectAssignment,
  type EffectKeywordMatch,
} from "./effectAssignments";
import { EFFECT_EVENT_LABEL } from "./effectEventRows";
import {
  effectSelectValue,
  isEffectTemplateMissingFromList,
  NONE_VALUE,
  TEMPLATE_PREFIX,
} from "./effectSelectValue";
import type { UseEffectTemplates } from "./useEffectTemplates";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061d-2: **イベント種別ごとのエフェクトの割り当て**（main 窓の「OBSエフェクト」画面）。
 * ⚠ **061i(5) で画面上の呼び方は「エフェクトを表示する条件」になった**（動作の主語になったため。
 * 061j でキーワード条件が入ると「イベントごと」では表現できなくなる）。⚠ **保存形（`EffectAssignments`）と
 * 値の意味は 061i では 1 ミリも変えていない**——変えるのは 061j。
 *
 * ⚠⚠ **ここが「たぬえさ3 より簡単に」の分かれ目**（061d の (2)）。行は
 * `MONETARY_EVENT_TYPES` から**最初から全部並んでいて**、各行でエフェクトを選ぶだけ。
 * 「条件を追加」ボタンで行を増やす形にしない。
 *
 * ⚠ **金額の閾値による出し分けはまだ作らない**（種別だけで動かして実機の手応えを見る）。
 * **再修正トリガー＝「高額だけ豪華にしたい」と言われたとき**——そのときは
 * スーパーチャットの行を `monetaryTone` のティアで 3 行に割る形にする。
 * ⚠ **063（ガチャ）も同じ表に乗る**（`EffectAssignment` の union に 3 本目を足す）。
 *
 * ## 壊れ方（⑪ → ⚠ 061h で反転）
 *
 * ⚠⚠ **実在しないテンプレート id を指す割り当ては「表示しない」として表示し、警告を出す。**
 * ⚠ 061d-2 はここを**「組み込み」として表示**していた（壊れても何かは出る、という方針）。
 * 061h で組み込みを廃止したので、**受け皿が「表示しない」しか無い**——かつ
 * 「壊れているのに何かが出て『動いている』ように見える」ほうが今の運用では害が大きい。
 * ⚠ **保存値は書き換えない**——`list_effect_templates` が一時的に失敗しただけ／061c の
 * 「読めない行は黙って落とす」に当たっただけ、という場合に**ユーザーの設定が黙って消える**ため。
 * 書き換えるのは**削除操作のときだけ**（`useEffectTemplates.runDelete`）。
 * ⚠⚠ **061d-2 レビュー S-1: 警告を出してよいのは `listState === "ready"` のときだけ。**
 * 一覧は非同期に届くので、`templates` が空なだけで警告を出すと
 * ①**毎回、画面を開いた一瞬だけ**「見つかりません」が点滅する
 * ②一覧の取得に失敗したときは**恒久的に**出て、隣のカードの「一覧を読み込めませんでした」と
 *   矛盾した 2 文が並ぶ（＝「テンプレートが消えた」とユーザーに誤解させ、不要な復帰操作へ誘導する）。
 * **「保存値は触らない」を表示側でも守る**＝ 一覧が読めていないなら「無い」と断言しない。
 *
 * ⚠⚠ **「すべて「表示しない」に戻す」は復帰導線である**（060d の「既定のデザインに
 * 戻す」と同じ位置づけ）。壊れたテンプレート（巨大・真っ黒・画面全体を覆う）を割り当てると
 * 配信画面が読めなくなり、エフェクト窓は**透過・最背面・非フォーカスで何も操作できない**。
 * ここだけが脱出路なので、**テストで固定する**（no-op にする変異でレッドになること）。
 * ⚠ 061h で文言と戻し先が変わったが（「組み込みに戻す」→「すべて「表示しない」に戻す」）、
 * **位置づけは不変**。むしろ**配信画面を完全に静かにできる**ようになったぶん強くなっている。
 */

/**
 * ⚠⚠ **061j (0): `<select>` の値の組み立ては [`effectSelectValue`] へ切り出した**
 * （061h 申し送り ⑦-c の返済。理由の全文は `effectSelectValue.ts` の module JSDoc が正）。
 * ⚠ **ここで `template:<id>` を組み立て直さないこと**——組み立てが 2 か所になると、
 * 「選択肢に無い id を明示的に落とす」規則が片方だけ緩む（そして DOM からは観測できない）。
 */

/**
 * 061j: 条件 1 行の「**どのエフェクトを出すか**」。
 *
 * ⚠⚠ **イベント条件の行とキーワード条件の行が 1 実装を共有する。** 選択肢の中身・順序・
 * 値の意味を 2 か所に書くと、**片方だけ 061h ⑦-c の偶然に戻る**（そして DOM からは観測できない）。
 * ⚠ **選択肢の中身と順序は 1 文字も変えていない**（061h 申し送り ⑦-c ／ 061i の判断）。
 */
function ConditionEffectSelect({
  effect,
  templates,
  listState,
  ariaLabel,
  onChange,
}: {
  effect: EffectAssignment;
  templates: UseEffectTemplates["templates"];
  listState: UseEffectTemplates["listState"];
  ariaLabel: string;
  onChange: (effect: EffectAssignment) => void;
}) {
  // ⚠⚠ **警告を出すのは `listState === "ready"` のときだけ**（061d-2 レビュー S-1）。
  //   `notInList` と分けてあるのが要点——**表示の受け皿**（`effectSelectValue`）と
  //   **「無い」という断言**（この警告）は別の判断で、後者は一覧が読めて初めて成立する。
  const missing =
    isEffectTemplateMissingFromList(effect, templates) && listState === "ready";
  return (
    <>
      <Select
        value={effectSelectValue(effect, templates)}
        ariaLabel={ariaLabel}
        onChange={(e) => {
          const next = e.target.value;
          // ⚠ テンプレート以外はすべて「出さない」（061h：選択肢は 2 種類しかない）。
          onChange(
            next.startsWith(TEMPLATE_PREFIX)
              ? {
                  kind: "template",
                  templateId: next.slice(TEMPLATE_PREFIX.length),
                }
              : { kind: "none" },
          );
        }}
      >
        {/* ⚠ 呼び方は「エフェクトを出さない」（「なし」にしない＝UX の決定）。
            ⚠ 061h: 「組み込み（名前と金額）」の `<option>` を削除した。
            ⚠⚠ **中身と順序を変えないこと**（061h ⑦-c ／ 061i の判断）。 */}
        <option value={NONE_VALUE}>エフェクトを出さない</option>
        {templates.map((template) => (
          <option key={template.id} value={`${TEMPLATE_PREFIX}${template.id}`}>
            {template.name}
          </option>
        ))}
      </Select>
      {missing && (
        // ⚠⚠ **061h: これが「出さない側へ倒した」ことを観測可能にしている 1 文である。**
        //   エフェクト窓は透過・最背面・非フォーカスで何も出せないので、
        //   「割り当てたのに出ない」に気付ける場所はここしかない
        //   （`EffectOverlayApp` の `fire()` の注記が、この警告を反転の前提として名指ししている）。
        <p className={styles.errorText}>
          割り当てていたエフェクトが見つかりません。いまは何も表示されません。
        </p>
      )}
    </>
  );
}

/**
 * 061j: **未確定のキーワード行**（まだ localStorage に無い行）。
 *
 * ⚠⚠ **これがある理由＝判断 9（空文字を保存しない）と「条件を追加」ボタンの衝突を解くため。**
 * 追加ボタンで生えた直後の行はキーワードが空なので、素直に保存すると**保存層がその場で落として
 * 行が生えない**。⇒ **非空になって初めて永続化する**（048 の数値入力と同じ形）。
 * ⚠ **同時に 1 本だけ**（2 本目を作れると「未確定が溜まる」状態ができる）。
 */
interface DraftKeywordRow {
  text: string;
  match: EffectKeywordMatch;
  effect: EffectAssignment;
}

export function EffectAssignmentCard({
  templates,
  listState,
  conditions,
  setConditionEffect,
  addKeywordCondition,
  updateKeywordCondition,
  removeCondition,
  clearAllAssignments,
}: UseEffectTemplates) {
  /**
   * ⚠⚠ **061j（穴 α）: 入力中の生文字列はここに持ち、`onChange` では保存しない。**
   *
   * 048（読み上げ最大文字数）が同じ判断をしている:
   * > **確定は blur と Enter のみ**（`onChange` 即時にしない）… 親 state が変わらない＝
   * > **1 打鍵ごとに localStorage へ書かない**
   *
   * ⚠ **061j では代償が 048 より大きい**——`EFFECT_ASSIGNMENTS_KEY` が変わると
   * **エフェクト窓の `storage` 購読が `warmTemplates()` を回し、`list_effect_templates` の invoke が
   * 打鍵ごとに 1 本飛ぶ**（＋ キャッシュの `clearFailures` / `retain` / `prime` が毎回走る）。
   * ⚠ `<select>`（当て方・エフェクト）は**1 操作で確定する**ので `onChange` 即時のままでよい
   *   （イベント条件の行と同じ挙動＝規則を 2 通りにしない）。
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftRow, setDraftRow] = useState<DraftKeywordRow | null>(null);

  const eventConditions = conditions.filter((c) => c.when.type === "event");
  const keywordConditions = conditions.filter((c) => c.when.type === "keyword");
  const canAddKeyword =
    draftRow === null && keywordConditions.length < KEYWORD_CONDITION_MAX;

  /**
   * 既存のキーワード行を確定する。
   *
   * ⚠ **空になったら直前の確定値へ戻す**（048 の「空 / NaN は直前の確定値へ戻す」と同じ）。
   *   ＝ 打ち間違いでユーザーの条件が消えない。⚠ **空を保存する経路をここで作らない。**
   * ⚠ 空判定は [`isUsableKeyword`]（＝正規化の持ち主に聞く）。ここで `text.trim() === ""` と
   *   書いても**いまは同じ結果**だが、空判定の規則を 2 か所に書かないために述語へ寄せている。
   */
  const commitKeyword = (id: string, match: EffectKeywordMatch) => {
    const raw = drafts[id];
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (raw === undefined) return;
    const text = sanitizeKeywordInput(raw);
    if (!isUsableKeyword(text)) return;
    updateKeywordCondition(id, { text, match });
  };

  /** 未確定行を確定する。⚠ **空のままなら永続化しない**（行はそのまま残るので打ち直せる）。 */
  const commitDraftRow = () => {
    if (draftRow === null) return;
    const text = sanitizeKeywordInput(draftRow.text);
    if (!isUsableKeyword(text)) {
      // ⚠ 詰めた結果は入力欄へ書き戻す（「打ったら短くなった」が見える・048 の規律）。
      setDraftRow({ ...draftRow, text });
      return;
    }
    addKeywordCondition({ text, match: draftRow.match }, draftRow.effect);
    setDraftRow(null);
  };

  return (
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        {/* ⚠ 061i(5): 「イベントごとのエフェクト」→「**エフェクトを表示する条件**」。
            061i で「条件が 1 件でもあればエフェクト窓を開く」という**動作の主語**になったので、
            画面の呼び方も「条件」へ揃える（前提ステータスの「表示する条件」行と同じ語）。
            ⚠ 061j でキーワード条件（自由テキスト）が入ると「イベントごと」では**表現できなくなる**
            ——先に語のほうを合わせておく。 */}
        <h3>エフェクトを表示する条件</h3>
        <p>
          スーパーチャットやサブスクなど、どのイベントを受け取ったときにエフェクトを出すかを決めます。
        </p>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠ 061h: 「組み込み（名前と金額）」の説明を落とした（廃止したため）。
            ⚠ **「選ばなければ何も出ない」を明示する**——これが 061h の既定そのもので、
            旧版（未設定だと組み込みが出る）から更新するユーザーには**振る舞いが変わる**点だから。 */}
        <p className={styles.note}>
          取り込んだエフェクトを選ぶと、そのイベントを受け取ったときに配信画面へ出ます。「エフェクトを出さない」のままなら、そのイベントでは何も表示されません。
        </p>
        {/* ⚠⚠ **061i（判断 1・2）: 条件を 1 つでも決めるとウィンドウが自動で開く**ことを明示する。
            表示トグルを廃止した以上、**ユーザーから見て「いつ窓が開くのか」が説明される場所はここだけ**
            である（061a 以来の「黙って何かが起きる／起きない状態を作らない」の両方向）。
            ⚠ **閉じ方も同じ文で書く**——「開いたら二度と閉じられない」と誤解させないため
            （判断 1 の脱出路＝前提ステータスの「ウィンドウを閉じる」）。
            ⚠ **「条件を全部『出さない』に戻すと窓が閉じる」とは書かない**（＝閉じないので嘘になる）。 */}
        <p className={styles.note}>
          条件を 1
          つでも設定すると、エフェクトのウィンドウが自動で開きます（下の「エフェクトのウィンドウ」の「ウィンドウを閉じる」でいつでも閉じられます）。
        </p>
        {/* ⚠⚠ **061i（判断 5）: (b)(c)(d) の「壊れて何も出ない」に対する唯一の実用的な観測手段。**
            `EffectOverlayApp` の `fire()` の JSDoc が列挙しているとおり、無音になる 5 経路のうち
            **下の「見つかりません」警告が拾えるのは (a) だけ**で、メディアが読めない／デコードに
            失敗した場合は**警告も出ない**。⚠ だから `missing` の警告文とは別に**常時**出す
            （壊れてから探しに来ても遅い＝「割り当てる前に確かめられる」ことを知らせるのが目的）。 */}
        <p className={styles.note}>
          割り当てる前に、上の一覧の「配信画面でテスト表示」で実際に出るか確かめられます。エフェクトが壊れていると、条件に設定しても何も表示されません。
        </p>
        {/* ⚠⚠ **061h の移行案内**（061h レビュー Q-8）。旧版の保存値 `{"kind":"builtin-monetary"}` は
            `parseAssignment` が**未知 kind として「出さない」へ倒す**ので、更新したユーザーは
            **自分で設定を変えた覚えが無いのに何も出なくなる**。⚠ しかも `notInList` は
            `kind === "template"` のときしか立たないので、**上の「見つかりません」警告も出ない**
            （旧値はこの画面に届く前に `{kind:"none"}` へ化けている）＝
            気付ける経路が 1 本も無い状態だった。061a 以来の「黙って何も起きない状態を作らない」に反する。
            ⚠⚠ **判定コードを書かずに静的な 1 文にしてある**のが要点——旧値を検知するには
            `parseAssignment` の手前で生 JSON を覗く経路が要り、「未知 kind は安全側へ倒す」という
            **1 本の規則を 2 通りに書く**ことになる（＝移行コードを書かないという 061h の判断と矛盾する）。
            新規ユーザーに出ても実害が無い文面にしてある。
            ⚠ **再修正トリガー＝ 061h を含むバージョンが十分に行き渡ったとき**（数バージョン後にこの
            `<p>` ごと削除する。⚠ そのとき消し忘れないよう、文中に「以前のバージョン」と明記してある）。 */}
        <p className={styles.note}>
          以前のバージョンで「組み込み（名前と金額）」のエフェクトを使っていた場合は、この更新で「エフェクトを出さない」に戻っています。使いたいエフェクトを取り込んで、選び直してください。
        </p>
        {/* ⚠ UX 6（061d-1 からの持ち越し）: 長いテンプレートは撤去される前に押し出されうる。
            ⚠ 秒数も件数も断言しない（実装の定数が変わっても文言が嘘にならない書き方）。 */}
        <p className={styles.note}>
          短い時間にたくさん届いたときは、いくつかは表示されません。表示時間の長いテンプレートは、次のエフェクトが続くと再生の途中で消えることがあります。
        </p>
        {/* ⚠⚠ **061d-2 security-review S-1**: テンプレートの音は **OS 既定の出力**へ出る＝
            OBS で「デスクトップ音声」を取り込んでいれば**配信に載る**（061c 申し送り 5 の意図どおり）。
            ⚠ これを書いていたのは**プレビュー枠の注意文だけ**で、しかも音ありテンプレートを
            プレビューしたときにしか出なかった。**プレビューを見ずに割り当てる導線が実在する**ので、
            「知らないまま配信に音が出る」経路が残っていた。ここで必ず目に入るようにする。
            ⚠ 059b の通知音（Rust・実デバイス指定・**配信に載せない**）とは別系統である旨も含める。 */}
        <p className={`${styles.note} ${styles.caution}`}>
          音があるテンプレートを選ぶと、その音はパソコンの既定のスピーカーから出ます。OBS で「デスクトップ音声」を取り込んでいる場合は、配信にも流れます（コメントの通知音とは別の音です）。
        </p>

        {/* ⚠⚠ **061j（判断 11）: 1 コメントに出るのは 1 つだけ。** これを書かないと
            「スパチャにキーワードも当たるのに 1 つしか出ない」が**黙って起きる**
            （061a 以来の「黙って何かが起きる／起きない状態を作らない」）。
            ⚠ 走査順（イベント → キーワード）がそのまま優先順位なので、画面の並びで説明できる。 */}
        <p className={styles.note}>
          1
          つのコメントに複数の条件が当てはまるときは、上から順に最初に当てはまった条件だけが使われます（エフェクトは 1
          つだけ出ます）。
        </p>

        <div className={styles.assignmentList}>
          {eventConditions.map((condition) => {
            const eventType =
              condition.when.type === "event" ? condition.when.eventType : "";
            const label = EFFECT_EVENT_LABEL[eventType] ?? eventType;
            return (
              <div key={condition.id} className={styles.assignmentRow}>
                <span className={styles.assignmentLabel}>{label}</span>
                <ConditionEffectSelect
                  effect={condition.effect}
                  templates={templates}
                  listState={listState}
                  ariaLabel={`${label}のエフェクト`}
                  onChange={(effect) => setConditionEffect(condition.id, effect)}
                />
              </div>
            );
          })}
        </div>

        {/* --- 061j: キーワード条件（自由テキスト） ------------------------------------------ */}

        <h4 className={styles.subHeading}>コメントの言葉で出す</h4>
        {/* ⚠⚠ **061d の (2)（「条件を追加」ボタンで行を増やさない）は、イベント条件についてだけ維持する。**
            キーワードは**本質的に可変長**なので追加ボタンが要る——061d が避けたかったのは
            **「たぬえさ3 のタグをコピペで増やす手作業」**であって、「増やせること」そのものではない。 */}
        <p className={styles.note}>
          コメントに特定の言葉が入っていたらエフェクトを出します。投げ銭かどうかに関係なく、ふつうのコメントでも出ます。大文字・小文字や全角・半角の違いは区別しません。
        </p>
        {/* ⚠⚠ **判断 12: 通常チャットでは文字が出ない**（`amountText` も `message` も無く、
            `eventLabel` が空になるので `effectTemplateLine` が 1 行も描かない）。
            ⚠ **これは仕様として受け入れる**——`{text}`（コメント本文）を差し込み変数に足すと
            **第三者の自由入力が配信画面に大写しになる**（§9・`docs/security.md` §8 の 061c 節が
            変数追加時の再評価を要求している）。⇒ **画面で明示する。** */}
        <p className={styles.note}>
          言葉で出したエフェクトには、金額やイベント名の文字は出ません（テンプレートの絵や動画だけが出ます）。
        </p>
        {/* ⚠ 判断 7（クールダウン）。⚠⚠ **秒数を断言しない**——定数（`KEYWORD_COOLDOWN_MS`）が
            変わっても文言が嘘にならない書き方にする（061a レビュー Q-1 の規律）。 */}
        <p className={styles.note}>
          同じ言葉が続けて書かれたときは、少し間隔を空けて反応します（連呼で画面が埋まらないようにするためです）。
        </p>

        <div className={styles.keywordList}>
          {keywordConditions.map((condition, index) => {
            if (condition.when.type !== "keyword") return null;
            const { text, match } = condition.when;
            const n = index + 1;
            // ⚠ 入力中は下書き、確定後は保存値。⚠ **`??` で分ける**（空文字の下書きを保存値で
            //   上書きしないため＝ `||` にすると「全部消して打ち直す」ができなくなる）。
            const shown = drafts[condition.id] ?? text;
            return (
              <div key={condition.id} className={styles.keywordRow}>
                <span className={`${layout.field} ${styles.keywordText}`}>
                  <input
                    type="text"
                    value={shown}
                    aria-label={`キーワード ${n}`}
                    // ⚠ ブラウザの補助であって保証ではない（048 の `min` / `max` と同じ位置づけ）。
                    //   実際の上限は確定時の `sanitizeKeywordInput` と保存層が担う。
                    maxLength={KEYWORD_MAX_LENGTH}
                    placeholder="例: 草"
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [condition.id]: e.target.value,
                      }))
                    }
                    onBlur={() => commitKeyword(condition.id, match)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitKeyword(condition.id, match);
                    }}
                  />
                </span>
                <Select
                  value={match}
                  ariaLabel={`キーワード ${n} の当て方`}
                  onChange={(e) => {
                    // ⚠ `<select>` は 1 操作で確定するので即 commit（打鍵の問題が無い）。
                    //   ⚠ 入力中の下書きがあれば**一緒に確定する**（当て方だけ保存されて
                    //   キーワードが古いまま、というズレを作らない）。
                    const nextMatch =
                      e.target.value === "exact" ? "exact" : "contains";
                    const raw = drafts[condition.id];
                    const nextText =
                      raw === undefined ? text : sanitizeKeywordInput(raw);
                    if (raw !== undefined && isUsableKeyword(nextText)) {
                      setDrafts((prev) => {
                        const next = { ...prev };
                        delete next[condition.id];
                        return next;
                      });
                    }
                    updateKeywordCondition(condition.id, {
                      text: isUsableKeyword(nextText) ? nextText : text,
                      match: nextMatch,
                    });
                  }}
                >
                  <option value="contains">この言葉を含む</option>
                  <option value="exact">この言葉と完全に一致</option>
                </Select>
                <ConditionEffectSelect
                  effect={condition.effect}
                  templates={templates}
                  listState={listState}
                  ariaLabel={`キーワード ${n} のエフェクト`}
                  onChange={(effect) => setConditionEffect(condition.id, effect)}
                />
                <Button
                  type="button"
                  onClick={() => removeCondition(condition.id)}
                >
                  削除
                </Button>
              </div>
            );
          })}

          {draftRow !== null && (
            // ⚠⚠ **未確定行**（まだ保存されていない）。⚠ 条件の件数にも派生値にも数えない。
            <div className={styles.keywordRow}>
              <span className={`${layout.field} ${styles.keywordText}`}>
                <input
                  type="text"
                  value={draftRow.text}
                  aria-label={`キーワード ${keywordConditions.length + 1}`}
                  maxLength={KEYWORD_MAX_LENGTH}
                  placeholder="例: 草"
                  autoFocus
                  onChange={(e) =>
                    setDraftRow({ ...draftRow, text: e.target.value })
                  }
                  onBlur={commitDraftRow}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitDraftRow();
                  }}
                />
              </span>
              <Select
                value={draftRow.match}
                ariaLabel={`キーワード ${keywordConditions.length + 1} の当て方`}
                onChange={(e) =>
                  setDraftRow({
                    ...draftRow,
                    match: e.target.value === "exact" ? "exact" : "contains",
                  })
                }
              >
                <option value="contains">この言葉を含む</option>
                <option value="exact">この言葉と完全に一致</option>
              </Select>
              <ConditionEffectSelect
                effect={draftRow.effect}
                templates={templates}
                listState={listState}
                ariaLabel={`キーワード ${keywordConditions.length + 1} のエフェクト`}
                onChange={(effect) => setDraftRow({ ...draftRow, effect })}
              />
              <Button type="button" onClick={() => setDraftRow(null)}>
                削除
              </Button>
            </div>
          )}
        </div>

        <div className={styles.rowActions}>
          <Button
            type="button"
            onClick={() =>
              setDraftRow({
                text: "",
                match: "contains",
                effect: DEFAULT_EFFECT_ASSIGNMENT,
              })
            }
            disabled={!canAddKeyword}
          >
            条件を追加
          </Button>
        </div>
        {/* ⚠ **「黙って何も起きない」を作らない**——押せない理由を必ず書く（061a 以来の規律）。 */}
        <p className={styles.note}>
          言葉の条件は{KEYWORD_CONDITION_MAX}個まで、1
          つの言葉は{KEYWORD_MAX_LENGTH}文字までです。言葉を入力してエフェクトを選ぶと保存されます（入力欄から離れるか
          Enter で確定します）。
        </p>

        <div className={styles.rowActions}>
          {/* ⚠⚠ **復帰導線。no-op にする変異はテストがレッドにする。** */}
          <Button type="button" onClick={clearAllAssignments}>
            すべて「表示しない」に戻す
          </Button>
        </div>
        {/* ⚠⚠ **061j: 文言を実態へ合わせた。** 戻すのは「すべての条件」（イベント＋言葉）で、
            ⚠ **入力した言葉そのものは消さない**（復帰導線であってリセットではない＝
            テンプレートを削除しないのと同じ判断。ユーザーが打った文字列を勝手に捨てない）。 */}
        <p className={styles.note}>
          すべての条件を「エフェクトを出さない」に戻します。入力した言葉やテンプレートは削除されません。配信画面が読めなくなったときは、これで元に戻せます。
        </p>
      </div>
    </section>
  );
}
