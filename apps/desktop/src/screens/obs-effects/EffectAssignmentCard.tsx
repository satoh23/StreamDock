import { Button } from "../../components/primitives";
import { Select } from "../comment-viewer/Select";
import { DEFAULT_EFFECT_ASSIGNMENT } from "./effectAssignments";
import { EFFECT_EVENT_ROWS } from "./effectEventRows";
import type { UseEffectTemplates } from "./useEffectTemplates";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061d-2: **イベント種別ごとのエフェクトの割り当て**（main 窓の「OBSエフェクト」画面）。
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
 * ## 壊れ方（⑪）
 *
 * ⚠⚠ **実在しないテンプレート id を指す割り当ては「組み込み」として表示し、警告を出す。**
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
 * ⚠⚠ **「すべての割り当てを解除（組み込みに戻す）」は復帰導線である**（060d の「既定のデザインに
 * 戻す」と同じ位置づけ）。壊れたテンプレート（巨大・真っ黒・画面全体を覆う）を割り当てると
 * 配信画面が読めなくなり、エフェクト窓は**透過・最背面・非フォーカスで何も操作できない**。
 * ここだけが脱出路なので、**テストで固定する**。
 */

/** `<select>` の値。⚠ テンプレートは `template:<id>` で表す（`<option value>` は文字列しか持てない）。 */
const NONE_VALUE = "none";
const BUILTIN_VALUE = "builtin";
const TEMPLATE_PREFIX = "template:";

export function EffectAssignmentCard({
  templates,
  listState,
  assignments,
  setAssignment,
  clearAllAssignments,
}: UseEffectTemplates) {
  return (
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        <h3>イベントごとのエフェクト</h3>
        <p>
          スーパーチャットやサブスクなど、種類ごとにどのエフェクトを出すかを選べます。
        </p>
      </div>
      <div className={layout.panelBody}>
        <p className={styles.note}>
          「組み込み」は名前と金額を出す標準のエフェクトです。取り込んだテンプレートを選ぶと、そのテンプレートが配信画面に出ます。
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

        <div className={styles.assignmentList}>
          {EFFECT_EVENT_ROWS.map(({ eventType, label }) => {
            const assignment = assignments[eventType] ?? DEFAULT_EFFECT_ASSIGNMENT;
            // ⚠⚠ **選択肢に無い id は「組み込み」として表示する**（⑪）。`<select>` の value が
            //   選択肢に無いと**ブラウザが勝手に先頭（＝「エフェクトを出さない」）を選ぶ**ので、
            //   ここで明示的に組み込みへ落とす。⚠ **一覧が届く前も含めて**この判定は要る。
            const notInList =
              assignment.kind === "template" &&
              !templates.some((t) => t.id === assignment.templateId);
            // ⚠⚠ **警告を出すのは `listState === "ready"` のときだけ**（061d-2 レビュー S-1）。
            //   `notInList` と分けてあるのが要点——**表示の受け皿**（上）と
            //   **「無い」という断言**（下）は別の判断で、後者は一覧が読めて初めて成立する。
            const missing = notInList && listState === "ready";
            const value =
              assignment.kind === "none"
                ? NONE_VALUE
                : assignment.kind === "template" && !notInList
                  ? `${TEMPLATE_PREFIX}${assignment.templateId}`
                  : BUILTIN_VALUE;
            return (
              <div key={eventType} className={styles.assignmentRow}>
                <span className={styles.assignmentLabel}>{label}</span>
                <Select
                  value={value}
                  ariaLabel={`${label}のエフェクト`}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === NONE_VALUE) {
                      setAssignment(eventType, { kind: "none" });
                    } else if (next.startsWith(TEMPLATE_PREFIX)) {
                      setAssignment(eventType, {
                        kind: "template",
                        templateId: next.slice(TEMPLATE_PREFIX.length),
                      });
                    } else {
                      setAssignment(eventType, { kind: "builtin-monetary" });
                    }
                  }}
                >
                  {/* ⚠ 呼び方は「エフェクトを出さない」（「なし」にしない＝UX の決定）。 */}
                  <option value={NONE_VALUE}>エフェクトを出さない</option>
                  <option value={BUILTIN_VALUE}>組み込み（名前と金額）</option>
                  {templates.map((template) => (
                    <option
                      key={template.id}
                      value={`${TEMPLATE_PREFIX}${template.id}`}
                    >
                      {template.name}
                    </option>
                  ))}
                </Select>
                {missing && (
                  <p className={styles.errorText}>
                    割り当てていたテンプレートが見つかりません。いまは組み込みのエフェクトで表示されます。
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.rowActions}>
          {/* ⚠⚠ **復帰導線。no-op にする変異はテストがレッドにする。** */}
          <Button type="button" onClick={clearAllAssignments}>
            すべての割り当てを解除（組み込みに戻す）
          </Button>
        </div>
        <p className={styles.note}>
          すべてのイベントを組み込みのエフェクト（名前と金額）に戻します。テンプレートは削除されません。配信画面が読めなくなったときは、これで元に戻せます。
        </p>
      </div>
    </section>
  );
}
