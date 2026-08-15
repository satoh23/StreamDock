import { useState } from "react";
import { Button } from "../../components/primitives";
import { Select } from "../../components/Select";
import {
  DEFAULT_EFFECT_ASSIGNMENT,
  DEFAULT_EFFECT_OUTPUT,
  EFFECT_OUTPUT_LABEL,
  EFFECT_OUTPUTS,
  isUsableKeyword,
  KEYWORD_CONDITION_MAX,
  KEYWORD_MAX_LENGTH,
  sanitizeKeywordInput,
  type EffectAssignment,
  type EffectKeywordMatch,
  type EffectOutput,
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
 * ## ⚠⚠ 061p: 説明文を削り、復帰導線（「すべて「表示しない」に戻す」）を削除した
 *
 * 061p の指示は「**説明が長すぎる**（IT に詳しくない人は読まない）」「**このボタンは要らない**」で、
 * このカードは **note が 7 本**あった（移行案内・バースト・音・優先順位・テスト表示の勧め ほか）。
 * ⇒ **カード見出しの説明 2 行 ＋ キーワード欄の 1 行**まで削っている。
 * ⚠⚠ **消した文のうち「黙って何も起きない／黙って何かが起きる」を防いでいたもの**は、
 * 061a 以来の規律に従い**見出しの説明へ畳んで残した**（＝条件を 1 つ設定すると窓が自動で開く）。
 * ⚠ **音が配信に載る旨（061d-2 security-review S-1）と専用フォルダの案内（061c S-3）は
 * [`EffectTemplateCard`] 側へ集約**した（テンプレートを取り込む場所に置くほうが目に入る）。
 * ⚠⚠ **復帰導線を消した代償**——壊れたテンプレート（巨大・真っ黒・画面全体を覆う）を割り当てると
 * 配信画面が読めなくなり、エフェクト窓は**透過・最背面・非フォーカスで何も操作できない**。
 * 061p 以降の脱出路は「**条件を 1 行ずつ『エフェクトを出さない』へ戻す**」だけである
 * （同じ 061p で「ウィンドウを閉じる」も消えた）。⚠ **再修正トリガー＝実機で戻せなくなったとき**
 * （そのときは `clearAllEffectConditions` ごと復活させる・`effectAssignments.ts` の注記が正）。
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
 * 061k: 条件 1 行の「**どこへ出すか**」（判断 4）。
 *
 * ⚠⚠ **`ConditionEffectSelect` と同じく、イベント行とキーワード行が 1 実装を共有する。**
 * 選択肢を 2 か所に書くと片方だけラベルや値がずれる（そして DOM からは観測しづらい）。
 *
 * ⚠⚠ **`effect.kind === "none"` の行は `disabled` にする。** 「何も出さない条件の出力先」に
 * 意味は無く、保存層（`parseOutput`）が**既定へ丸める**ので、有効にすると
 * **「選んだのに元へ戻る」**という説明できない挙動になる（判断 4-b の帰結）。
 * ⚠ **`disabled` を外すなら、丸めのほうも同時に見直すこと**（対で成立している）。
 */
function ConditionOutputSelect({
  output,
  disabled,
  ariaLabel,
  onChange,
}: {
  output: EffectOutput;
  disabled: boolean;
  ariaLabel: string;
  onChange: (output: EffectOutput) => void;
}) {
  return (
    <Select
      value={output}
      ariaLabel={ariaLabel}
      disabled={disabled}
      onChange={(e) => {
        // ⚠ 未知の値は既定へ（`<select>` の選択肢しか来ないが、保存層と同じ向きに倒しておく）。
        const next = e.target.value;
        onChange(
          (EFFECT_OUTPUTS as readonly string[]).includes(next)
            ? (next as EffectOutput)
            : DEFAULT_EFFECT_OUTPUT,
        );
      }}
    >
      {/* ⚠ 並びは `EFFECT_OUTPUTS`（＝既定の `"corner"` が先頭）。⚠⚠ **先頭を変えないこと**——
          061h ⑦-c と同じ理由で、ブラウザの既定選択と「規則が選ぶ値」が一致していることに
          いくつかの検査が乗っている。 */}
      {EFFECT_OUTPUTS.map((o) => (
        <option key={o} value={o}>
          {EFFECT_OUTPUT_LABEL[o]}
        </option>
      ))}
    </Select>
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
  setConditionOutput,
  addKeywordCondition,
  updateKeywordCondition,
  removeCondition,
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
        {/* ⚠⚠ 061p: **カードの説明はここ 2 行だけ**（旧: 説明 1 行 ＋ note 7 本）。
            ⚠ 2 文目を残しているのは 061i 判断 1・2 の**唯一の説明**だから——表示トグルを廃止した
            いま、「いつ窓が開くのか」を書いている場所がここしかない（061a 以来の規律＝
            **黙って何かが起きる／起きない状態を作らない**）。⚠ **消さないこと。** */}
        <p>
          どのコメントで、どのエフェクトを出すかを決めます。条件を 1
          つでも設定すると、配信画面用のウィンドウが自動で開きます。
        </p>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠⚠ **061p: ここにあった note 7 本をすべて削除した**（指示＝説明が長すぎる）。
            消したのは①「選ばなければ何も出ない」②窓が自動で開く説明（→ 見出しの説明へ移設）
            ③「割り当てる前にテスト表示で確かめられる」④061h の移行案内（旧「組み込み」の保存値）
            ⑤バースト時に間引かれる旨⑥音が配信に載る旨（→ [`EffectTemplateCard`] へ移設）
            ⑦「1 コメントに出るのは 1 つだけ」。
            ⚠⚠ **④は「以前のバージョンから更新した人が、自分で変えていないのに何も出なくなる」を
            知らせる唯一の文だった。** 061h から数バージョン経ており、元々「行き渡ったら消す」と
            書いてあった文なので、061p の削除でその予定を前倒ししている（＝消し忘れではない）。
            ⚠ **再修正トリガー＝旧版からの更新で「何も出ない」という問い合わせが出たとき。** */}
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
                {/* ⚠ 061k: 出力先。⚠ 「出さない」行では選べない（保存層が既定へ丸めるため）。 */}
                <ConditionOutputSelect
                  output={condition.output}
                  disabled={condition.effect.kind === "none"}
                  ariaLabel={`${label}の出力先`}
                  onChange={(output) => setConditionOutput(condition.id, output)}
                />
              </div>
            );
          })}
        </div>

        {/* --- 061j: キーワード条件（自由テキスト） ------------------------------------------ */}

        <h4 className={styles.subHeading}>コメントの言葉で出す</h4>
        {/* ⚠⚠ **061p: ここの note 3 本を 1 本へ畳んだ**（大文字小文字・全角半角／文字は出ない／
            連呼のクールダウン）。⚠ 残した 1 行に**上限と正規化**だけを入れているのは、
            上限が「＋ が押せなくなる理由」で、正規化が「打った言葉と当たり方が違う」の唯一の説明だから。
            ⚠ 消した 2 つ（金額やイベント名の文字が出ない／連呼時のクールダウン）は
            **黙って起きても実害が「出ない・遅れる」に留まる**ので落とした。 */}
        <p className={styles.note}>
          コメントに入っていたらエフェクトを出す言葉を、{KEYWORD_CONDITION_MAX}
          個まで登録できます（大文字・小文字や全角・半角は区別しません）。
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
                {/* ⚠ 061k: 出力先。⚠ イベント行と**同じ 1 実装**を共有する。 */}
                <ConditionOutputSelect
                  output={condition.output}
                  disabled={condition.effect.kind === "none"}
                  ariaLabel={`キーワード ${n} の出力先`}
                  onChange={(output) => setConditionOutput(condition.id, output)}
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
          {/* ⚠⚠ **061p: 文字ボタン（「条件を追加」）から ＋ アイコンへ変えた**（指示）。
              ⚠⚠ **アクセシブル名は「条件を追加」のまま**（`aria-label`）——グリフだけの
              ボタンは**読み上げで「プラス」としか読まれず、何が増えるのか分からない**。
              ⚠ **`aria-hidden` を付けたグリフを子に置く**（読み上げが `aria-label` と
              二重に読まないように）。⚠ **名前を変えないこと**——`getByRole("button", …)` で
              引いている検査があり、名前を変えると「押せるが誰も押さない」状態を検知できなくなる。 */}
          <Button
            type="button"
            aria-label="条件を追加"
            onClick={() =>
              setDraftRow({
                text: "",
                match: "contains",
                effect: DEFAULT_EFFECT_ASSIGNMENT,
              })
            }
            disabled={!canAddKeyword}
          >
            <span className={styles.iconGlyph} aria-hidden="true">
              ＋
            </span>
          </Button>
        </div>
      </div>
    </section>
  );
}
