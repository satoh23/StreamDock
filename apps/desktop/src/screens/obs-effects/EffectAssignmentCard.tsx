import { Button } from "../../components/primitives";
import { Select } from "../../components/Select";
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

/** `<select>` の値。⚠ テンプレートは `template:<id>` で表す（`<option value>` は文字列しか持てない）。 */
const NONE_VALUE = "none";
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
        {/* ⚠ 061h: 「組み込み（名前と金額）」の説明を落とした（廃止したため）。
            ⚠ **「選ばなければ何も出ない」を明示する**——これが 061h の既定そのもので、
            旧版（未設定だと組み込みが出る）から更新するユーザーには**振る舞いが変わる**点だから。 */}
        <p className={styles.note}>
          取り込んだエフェクトを選ぶと、そのイベントを受け取ったときに配信画面へ出ます。「エフェクトを出さない」のままなら、そのイベントでは何も表示されません。
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

        <div className={styles.assignmentList}>
          {EFFECT_EVENT_ROWS.map(({ eventType, label }) => {
            const assignment = assignments[eventType] ?? DEFAULT_EFFECT_ASSIGNMENT;
            // ⚠⚠ **選択肢に無い id は「エフェクトを出さない」として表示する**（061h で反転）。
            //   ⚠ **判定そのものは 061d-2 のまま残す**——`<select>` の value が選択肢に無いと
            //   **ブラウザが勝手に先頭を選ぶ**という理由は 061h でも生きているので、
            //   **明示的に**落とす先を書く必要がある（判定ごと消すと、たまたま先頭が
            //   「エフェクトを出さない」であることに依存した形になる）。
            //   ⚠ 061h で変えたのは**落とす先だけ**（`BUILTIN_VALUE` → `NONE_VALUE`）。
            //   ⚠ **一覧が届く前も含めて**この判定は要る。
            const notInList =
              assignment.kind === "template" &&
              !templates.some((t) => t.id === assignment.templateId);
            // ⚠⚠ **警告を出すのは `listState === "ready"` のときだけ**（061d-2 レビュー S-1）。
            //   `notInList` と分けてあるのが要点——**表示の受け皿**（上）と
            //   **「無い」という断言**（下）は別の判断で、後者は一覧が読めて初めて成立する。
            const missing = notInList && listState === "ready";
            const value =
              assignment.kind === "template" && !notInList
                ? `${TEMPLATE_PREFIX}${assignment.templateId}`
                : NONE_VALUE;
            return (
              <div key={eventType} className={styles.assignmentRow}>
                <span className={styles.assignmentLabel}>{label}</span>
                <Select
                  value={value}
                  ariaLabel={`${label}のエフェクト`}
                  onChange={(e) => {
                    const next = e.target.value;
                    // ⚠ テンプレート以外はすべて「出さない」（061h：選択肢は 2 種類しかない）。
                    if (next.startsWith(TEMPLATE_PREFIX)) {
                      setAssignment(eventType, {
                        kind: "template",
                        templateId: next.slice(TEMPLATE_PREFIX.length),
                      });
                    } else {
                      setAssignment(eventType, { kind: "none" });
                    }
                  }}
                >
                  {/* ⚠ 呼び方は「エフェクトを出さない」（「なし」にしない＝UX の決定）。
                      ⚠ 061h: 「組み込み（名前と金額）」の `<option>` を削除した。 */}
                  <option value={NONE_VALUE}>エフェクトを出さない</option>
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
                  // ⚠⚠ **061h: これが「出さない側へ倒した」ことを観測可能にしている 1 文である。**
                  //   エフェクト窓は透過・最背面・非フォーカスで何も出せないので、
                  //   「割り当てたのに出ない」に気付ける場所はここしかない
                  //   （`EffectOverlayApp` の `fire()` の注記が、この警告を反転の前提として名指ししている）。
                  <p className={styles.errorText}>
                    割り当てていたエフェクトが見つかりません。いまは何も表示されません。
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.rowActions}>
          {/* ⚠⚠ **復帰導線。no-op にする変異はテストがレッドにする。** */}
          <Button type="button" onClick={clearAllAssignments}>
            すべて「表示しない」に戻す
          </Button>
        </div>
        <p className={styles.note}>
          すべてのイベントを「エフェクトを出さない」に戻します。テンプレートは削除されません。配信画面が読めなくなったときは、これで元に戻せます。
        </p>
      </div>
    </section>
  );
}
