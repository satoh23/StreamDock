import { useEffect, useState } from "react";
import type { EffectTemplateRecord } from "../../features/obs-effects/effectTemplateApi";
import {
  requestEffectTestFire,
  saveEffectOverlayGuidePending,
  saveEffectTestFirePending,
  saveStageTestFirePending,
} from "../../features/comment-viewer/overlaySettings";
import { Button } from "../../components/primitives";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EffectTemplatePreview } from "./EffectTemplatePreview";
import type { UseEffectTemplates } from "./useEffectTemplates";
import type { EffectOutput } from "./effectAssignments";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061d: テンプレートの取り込み・一覧・削除・**プレビュー導線**（main 窓の「OBSエフェクト」画面）。
 *
 * 060d の `OverlayThemeCard`（一覧・削除・壊れたときの復帰導線）と同じ形をなぞる。
 *
 * ⚠⚠ **この画面の案内文とプレビューは意匠ではなく安全機構である**（061c security-review S-3）。
 * `manifest.media` は「**選ばれたディレクトリ直下に既に在る別のファイル**」も名指しできる——
 * フォルダ包みでない zip を `~/Downloads` へ直接展開して `~/Downloads` を選ぶと、
 * ユーザーの私的な画像が配信画面に出る。Rust 側では**構造的に塞げない**
 * （ディレクトリを列挙しない設計上、どれが同梱ファイルかを区別する材料が無い）ので、
 * **①「テンプレート専用のフォルダを選んでください」の案内 ②取り込み直後のプレビュー**が唯一の緩和策。
 * ⚠ **どちらも省略しないこと。**
 * ⚠⚠ **061p で①を 4 文 → 1 文へ短縮した**（指示＝説明が長すぎる）。残したのは
 * **指示（専用フォルダを選べ）と根拠（中の画像や音を全部読む）**で、削ったのは例示
 * （ダウンロードフォルダ）と②への言及（**②の実装自体は無改変**なので、促さなくても目に入る）。
 * （⚠ 061d-1 レビュー S-1: 当初は「専用フォルダを選べ」「プレビューを見ろ」の 2 文だけを固定しており、
 * **「なぜ専用フォルダが要るか」を説明する中間の 1 文を削る変異が生存していた**。理由を失うと指示は
 * 根拠のない文に劣化するので、⚠ **061p 以降も「指示」と「根拠」の 2 要素をテストが独立に固定している**。）
 *
 * ⚠⚠ **061d-2 で state を `useEffectTemplates` へ、プレビューを `EffectTemplatePreview` へ切り出した**
 * （061d-1 レビュー Q-9 の分割トリガーが「061d-2 の割り当て結線を入れるとき」で発火した）。
 * ここに残るのは**案内文・取り込みボタン・一覧・削除確認・プレビューの開閉**だけ。
 *
 * ⚠⚠ **プレビューはこの画面の中だけで再生する。エフェクト窓へは出さない。**
 * ＝ **プレビュー導線は** 窓を開かず、**エフェクト窓向けの localStorage キーへ
 * 1 バイトも書かない**（テストが固定している）。
 *
 * ⚠⚠ **061h で「配信画面でテスト表示」が各行に入り、この module は
 * `requestEffectTestFire` を import するようになった。** ＝ 061d-1 の
 * 「この module はエフェクト窓向けのキーへ書かない」という不変条件は
 * **「プレビュー導線では書かない」へ限定された**（テスト表示は**明示操作で配信画面へ出すためのボタン**
 * なので、書くのが仕様そのもの）。⚠ **プレビュー側の担保（061c security-review S-3 の緩和策が
 * 配信へ漏れないこと）は 1 ミリも緩めていない**——書くのはボタンの `onClick` だけである。
 * ⚠ 載せるのは **nonce と record の `id`** だけ（§9 の判断は `EFFECT_TEST_FIRE_KEY` の JSDoc が正）。
 *
 * ## ⚠⚠ 061i: テスト表示が**窓を開く**ようになった（判断 3・4）
 *
 * 061h までは「窓が停止中なら押しても何も起きない」だった（注記でそう案内していた）。
 * ⚠ しかし **061i で「条件を 1 つも作らずに OBS の位置合わせをする」ことが要件になった**
 * ——表示トグルが消えたので、**このボタン以外に窓を開く明示操作が存在しない**。
 * ⇒ **窓が停止中なら、開いてから出す**。⚠ 経路は状態で**きっかり 2 つに分かれる**:
 *
 * | `effectWindowOpen` | やること |
 * |---|---|
 * | `false`（停止中） | ①**保留旗**を立てる ②**ガイド旗**を立てる ③窓を開く（⚠ `storage` は書かない） |
 * | `true` / `null` | 従来どおり [`requestEffectTestFire`] で `storage` 発火（⚠ 旗は書かない） |
 *
 * ⚠⚠ **2 経路を混ぜないこと。** 開いている窓は保留旗を読み直さないので、旗を立てても
 * **消えない残骸**になり、次に窓を開いた瞬間に無操作でエフェクトが出る（046b レビュー S-1 と同型）。
 * ⚠ **`null`（未取得）は `storage` 側へ倒す**——「実は開いていた」ときの壊れ方が上記のとおり
 * 質が悪いのに対し、こちらの壊れ方は「押しても出ない」＝ 061h までと同じで、
 * ポーリングは画面のマウント直後に 1 回走るので**人間の操作では踏まない**。
 * ⚠⚠ **`storage` の代わりに保留旗を使う理由**（判断 4）＝ `open_effect_overlay_window` の解決は
 * **窓生成の完了**であって、**エフェクト窓の React が `storage` リスナーを登録し終えたこと**ではない。
 * 「open を await → nonce を書く」と実装すると**確率的に取りこぼす**（詳細は
 * `EFFECT_TEST_FIRE_PENDING_KEY` の JSDoc）。
 *
 * ## ⚠⚠ 061k（判断 8）: テスト表示は **2 つの窓の両方へ出す**
 *
 * テスト表示の目的は **OBS の位置合わせ**で、061k 以降は**合わせる対象が 2 ソースある**
 * （セットアップでは 2 つとも OBS に追加するのだから、**同時に出るほうが目的に合っている**）。
 * ⇒ **上の表を窓ごとに独立に適用する**（コーナーは開いていてステージは停止中、が通常の状態）。
 * ⚠⚠ **保留旗も窓ごとに 2 本あり、各窓は自分の旗だけを読む**——1 本にすると
 * 先にマウントした窓が両方を食い、もう片方が無反応になる。
 *
 * ⚠ **却下した案＝行に「出力先」の選択を足す**: `.templateRow` のボタンは**既に 3 個**で、
 * **061h レビュー Q-4 が「再修正トリガー＝ボタンが 4 個以上になるとき」**と明記している
 * （`.templateRow > button` の `flex: none` / `white-space: nowrap` は 3 個前提。
 * ⚠⚠ **jsdom はレイアウトを解決しないのでテストは全部緑のまま壊れる**）。
 * ＝ 出力先の選択をここへ足すと**行を 2 段にする作業が付いてくる**ので、判断 8 は UI 追加ゼロを選んだ。
 * ⚠ **再修正トリガー＝「片方だけ出したい」と言われたとき**——そのとき wire に出力先を載せ、
 * **同時に `.templateRow` を 2 段レイアウトへ変えること**（Q-4 のトリガーを一緒に消化する）。
 *
 * ⚠ **代償＝ステージ窓を使う気が無いユーザーでも、テスト表示で窓が開く。**
 * 緩和は ①開いた窓には**必ずそのテンプレートが出る**（＝「開いたのに何も出ない窓」ではない）
 * ②前提ステータスに 2 行出て、それぞれに「ウィンドウを閉じる」がある（判断 11）
 * ③「表示する条件」行の内訳で「全画面 0」が見える。
 */
export function EffectTemplateCard({
  templates,
  listState,
  busy,
  error,
  imported,
  lastDeletedId,
  startImport,
  pendingDelete,
  requestDelete,
  cancelDelete,
  runDelete,
  conditionLabelsUsing,
  effectWindowOpen,
  stageWindowOpen,
  openEffectOverlay,
}: UseEffectTemplates & {
  /**
   * 061h: **コーナー側**のエフェクト窓が開いているか（`null` ＝ 未取得）。⚠ **前提ステータスの持ち主は
   * `ObsEffectsScreen`**（2 秒ごとのポーリング）で、ここはそれを注記と経路の分岐に使う。
   * ⚠ **省略可にしない**——既定値を持たせると、渡し忘れたときに
   * 「窓が停止中でも注記が出ない＝黙って何も起きない」へ倒れる（061a 以来の規律）。
   */
  effectWindowOpen: boolean | null;
  /**
   * 061k: **ステージ側**の窓が開いているか（`null` ＝ 未取得）。⚠ `effectWindowOpen` と**同型・独立**。
   * ⚠⚠ **片方の値でもう片方を代表させないこと**——代表させると「開いている窓に旗を立てる」
   * （＝消えない残骸）か「停止中の窓へ `storage` を撒く」（＝押しても出ない）のどちらかが起きる。
   */
  stageWindowOpen: boolean | null;
  /**
   * 061i: **エフェクトの出力窓を開く**（判断 4）。⚠ **この module は `windowApi` を import しない**
   * ——窓の invoke は `ObsEffectsScreen` の直列化キューを通す必要があり、
   * ここから直接投げると「『ウィンドウを閉じる』と競合して順序が入れ替わる」経路を作ってしまう。
   * ⚠ **省略可にしない**（渡し忘れが「押しても窓が開かない」＝黙って何も起きないへ倒れる）。
   * ⚠ 061k: **どちらの窓かを引数で指定する**（キューも窓ごとに分かれている）。
   */
  openEffectOverlay: (output: EffectOutput) => void;
}) {
  /** プレビュー中のテンプレート。⚠ **record をそのまま持つ**（一覧から `find` しない・S-2(a)）。 */
  const [preview, setPreview] = useState<EffectTemplateRecord | null>(null);

  // ⚠⚠ **取り込み直後は必ずプレビューを開く**（061c security-review S-3 の緩和策）。
  //   `useEffectTemplates` が返す `imported` は **`importEffectTemplate` の戻り値そのもの**なので、
  //   一覧の再取得（`reload()`）が失敗してもプレビューは開く（＝緩和策が fail-open しない）。
  useEffect(() => {
    if (imported !== null) setPreview(imported);
  }, [imported]);

  // 消したものをプレビューしたままにしない（取り直しに失敗して "failed" が出るだけになる・Q-4）。
  //
  // ⚠⚠ **「一覧に無くなったら閉じる」にしてはいけない。** 取り込みは
  // 「`imported` を立てる → 一覧を取り直す」の順なので、その間**新しい record は一覧にまだ載っていない**
  // ＝ 取り込み直後のプレビュー（**061c S-3 の唯一の緩和策**）が開いた瞬間に閉じられうる。
  // **削除という明示的な出来事だけ**を見る（061d-1 が `runDelete` の中で直接閉じていたのと同じ意味）。
  useEffect(() => {
    if (lastDeletedId === null) return;
    setPreview((prev) => (prev?.id === lastDeletedId ? null : prev));
  }, [lastDeletedId]);

  /**
   * 061i（判断 3・4）: 「配信画面でテスト表示」。⚠ **窓が停止中なら開いてから出す。**
   *
   * ⚠⚠ 経路の分岐と、その理由はクラス JSDoc の表が正（**2 経路を混ぜないこと**）。
   * ⚠ 旗を **`openEffectOverlay()` より先に**書くのは `saveEffectOverlayGuidePending` の作法と同じ
   * （窓のマウントは invoke の解決より後なので順序は保証されるが、その保証に依存しない）。
   */
  const handleTestFire = (templateId: string) => {
    // ⚠⚠ **061k（判断 8）: 2 つの窓に対して、それぞれ独立に経路を選ぶ。**
    //   ⚠ 停止中の窓には**その窓の保留旗**を立てて開く／開いている窓には `storage` を撒く。
    //   ⚠ **相手の旗を立てない・相手の状態で判断しない**（片方だけ停止中、が通常の状態）。
    const stagePending = stageWindowOpen === false;
    const cornerPending = effectWindowOpen === false;
    if (cornerPending) saveEffectTestFirePending(templateId);
    if (stagePending) saveStageTestFirePending(templateId);
    // ⚠⚠ **セットアップ用ガイドの新しい起点はここだけ**（判断 3・061a レビュー Q-1）。
    //   061h までは `ObsEffectsScreen` の旧トグル ON が起点だったが、あのトグルは 061i で消えた。
    //   ⚠ **条件を編集して窓が自動で開いたときは立てない**（`ObsEffectsScreen` の
    //   `openEffectOverlay` はこの旗を触らない）——立てると**条件を足すたび**に
    //   ガイドが 30 秒 OBS へ映る。ここは「窓が停止中に、位置合わせのために開いた」瞬間である。
    //   ⚠ 061k: **旗は窓ごとに分けていない**（1 本で 2 窓とも倒れる）——ガイドは「窓の位置を示す」
    //   ためのもので、**開いた窓すべてに出るのが正しい**（どちらを開いても位置合わせ中である）。
    if (cornerPending || stagePending) saveEffectOverlayGuidePending(true);
    // ⚠ **旗を書き終えてから開く**（`saveEffectOverlayGuidePending` と同じ作法）。
    if (cornerPending) openEffectOverlay("corner");
    if (stagePending) openEffectOverlay("stage");
    // ⚠ **開いている（または未取得の）窓へは従来どおり `storage` で撒く。**
    //   ⚠⚠ **2 経路を混ぜないこと**——開いている窓に旗を立てると**消えない残骸**になり、
    //   次に窓が開いた瞬間に無操作でエフェクトが出る（046b レビュー S-1 と同型）。
    //   ⚠ `storage` は**全窓へ飛ぶ**ので、片方でも `storage` 経路なら 1 回書けば足りる。
    if (!cornerPending || !stagePending) requestEffectTestFire(templateId);
  };

  /** 表示秒数の見出し用。⚠ 壊れ値は握りつぶす（一覧が落ちるより「—」のほうがよい）。 */
  const durationLabel = (durationMs: number): string =>
    Number.isFinite(durationMs) ? `${(durationMs / 1000).toFixed(1)}秒` : "—";

  /**
   * 061d-2: 削除確認の**追加の 1 文**。⚠⚠ **条件に使われているときはその旨を出す**（(3) の指定）。
   *
   * ⚠ **実際にそうなること**を書く——061d-2 は「組み込みのエフェクトに戻ります」だったが、
   *   061h で戻し先が「表示しない」になったので文言も追随する（`clearEffectConditionsForTemplate`）。
   * ⚠ `message`（`<p>` 1 つ）ではなく `details` に載せるのは、`ConfirmDialog` の本文が改行を
   *   保持しない単一段落だから（060c が同じ理由で `details` を足している）。
   *
   * ⚠⚠ **061j（判断 13）: ラベル化は hook（`conditionLabelsUsing`）が持つ。**
   *   061i までは `eventTypesUsing` が返すイベント種別をここで `EFFECT_EVENT_LABEL` に通していたが、
   *   **キーワード条件をラベルにする方法がこちら側に無い**（保存形を知らないため）。
   *   ⇒ ここは**受け取った文字列を並べるだけ**になり、`EFFECT_EVENT_LABEL` の import も消えた。
   * ⚠ キーワードは**ユーザー自身の入力**なので確認ダイアログに出してよい（§9）。
   *   ⚠ **React のテキストノードとして描く**（`details` は `ReactNode`・`dangerouslySetInnerHTML` は使わない）。
   */
  const deleteDetails = (template: EffectTemplateRecord) => {
    const used = conditionLabelsUsing(template.id);
    if (used.length === 0) return undefined;
    return (
      <p className={styles.errorText}>
        このテンプレートは「{used.join("・")}
        」に割り当てられています。削除すると、その条件は「表示しない」に戻ります。
      </p>
    );
  };

  return (
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        {/* ⚠ 061p: 見出しを「エフェクトのテンプレート」から改名（指示）。⚠ **カードの位置も
            画面の一番下へ移した**（並べ替えたのは `ObsEffectsScreen` 側）。 */}
        <h3>エフェクトのインポート</h3>
        {/* ⚠ 061p: 説明は 2 行まで。⚠ 「HTML エフェクトは読めない」（親 061 の決定＝
            『そのままテンプレートとして適用』の意味を UI で正しく伝えること）は
            **note を 1 本立てずにここへ畳んだ**。 */}
        <p>
          StreamDock 形式のフォルダ（画像や動画＋manifest.json）を取り込みます。他の配信ツール向けの
          HTML エフェクトは読み込めません。
        </p>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠⚠ **061c security-review S-3 の唯一の緩和策。省略しないこと。**
            ⚠ 061p で 4 文 → 1 文へ短縮した（指示＝説明が長すぎる）。**削ったのは理由と例示**
            （ダウンロードフォルダ／取り込み直後のプレビューを見よ）で、**指示そのものと
            「フォルダの中身を全部読む」という根拠は残している**。
            ⚠⚠ **取り込み直後にプレビューを必ず開く実装は 1 ミリも変えていない**
            （＝文で促さなくても目に入る。緩和策の本体はあちら）。
            ⚠ **この 1 文はテストが回帰として固定している。文言を編集するときは
            `EffectTemplateCard.test.tsx` の該当検査も一緒に見ること。** */}
        <p className={`${styles.note} ${styles.caution}`}>
          テンプレート専用のフォルダを選んでください（選んだフォルダの中にある画像や音を、すべて読み込みます）。
        </p>
        {/* ⚠⚠ **061d-2 security-review S-1**: テンプレートの音は **OS 既定の出力**へ出る＝
            OBS で「デスクトップ音声」を取り込んでいれば**配信に載る**。
            ⚠ 061p で `EffectAssignmentCard`（条件カード）からここへ移設し、3 文 → 1 文にした
            ——**取り込む場所に置くほうが目に入る**（条件を作らずにテスト表示だけする導線もある）。
            ⚠ 059b の通知音（Rust・実デバイス指定・**配信に載せない**）とは別系統である。 */}
        <p className={`${styles.note} ${styles.caution}`}>
          音があるテンプレートは、配信にも音が流れます。
        </p>

        <div className={styles.rowActions}>
          <Button type="button" onClick={() => void startImport()} disabled={busy}>
            フォルダを選んで取り込む
          </Button>
        </div>

        {listState === "failed" && (
          <p className={styles.errorText}>
            テンプレートの一覧を読み込めませんでした。画面を開き直してください。
          </p>
        )}

        {listState === "ready" && templates.length === 0 && (
          <p className={styles.note}>取り込んだテンプレートはまだありません。</p>
        )}

        {templates.length > 0 && (
          <ul className={styles.templateList}>
            {templates.map((template) => (
              <li key={template.id} className={styles.templateRow}>
                <span className={styles.templateName}>{template.name}</span>
                <span className={styles.templateMeta}>
                  {durationLabel(template.durationMs)}
                  {template.hasSound ? "・音あり" : ""}
                </span>
                {/* ⚠⚠ 061h: **配信画面（エフェクト窓）へ 1 回だけ出す。**
                    ⚠ 隣の「プレビュー」とは**出す先が違う**——あちらはこの画面の中だけで再生し
                    （061c security-review S-3 の緩和策）、こちらは OBS に映る窓へ出す。
                    ⚠ **条件とは独立**（条件に使っていないテンプレートでも位置合わせできる）。
                    ⚠ 送るのは nonce と `template.id` だけで、中身はエフェクト窓側の固定ダミー（§9）。
                    ⚠⚠ **061i: 窓が停止中なら開いてから出す**（判断 4・上の `handleTestFire`）。 */}
                <Button
                  type="button"
                  onClick={() => handleTestFire(template.id)}
                  disabled={busy}
                >
                  配信画面でテスト表示
                </Button>
                <Button
                  type="button"
                  onClick={() => setPreview(template)}
                  disabled={busy}
                >
                  プレビュー
                </Button>
                <Button
                  type="button"
                  onClick={() => requestDelete(template)}
                  disabled={busy}
                >
                  削除
                </Button>
              </li>
            ))}
          </ul>
        )}

        {templates.length > 0 && (
          // ⚠⚠ **「黙って何も起きない」を作らない**（061a 以来の規律）。
          // ⚠⚠ **061i で挙動が変わったので文言も変えた**——061h の注記は
          //   「ウィンドウが停止中のため、いまは何も表示されません」と書いていたが、
          //   いまは**開いてから出す**ので、そのままだと**嘘になる**（061a レビュー Q-1 の規律＝
          //   約束できることだけ書く。文言を実装より先に古くしない）。
          // ⚠⚠ **061k レビュー Q-2（修正）: この注記が `effectWindowOpen` だけを見ていた。**
          //   「コーナーは開いていてステージは停止中」は上の JSDoc が「通常の状態」と書いている状態で、
          //   そのとき注記が出ないまま `handleTestFire` が**ステージ窓を無告知で開く**。
          //   上の JSDoc が受容した「⚠ 代償＝ステージ窓を使う気が無いユーザーでも窓が開く」を
          //   **事前に伝える唯一の文がここ**なので、**どちらか一方でも停止中なら出す**。
          // ⚠ どちらが停止中かまでは書かない（文が長くなるうえ、2 窓とも出るのが仕様なので
          //   ユーザーが取る行動は同じ）。⚠ **窓を増やしたらここの条件も増やすこと。**
          <p className={styles.note}>
            {/* ⚠ 061p: 3 文 → 1 文（指示）。⚠ **停止中の窓を開くという分岐だけは残す**
                （061k レビュー Q-2＝「ステージ窓を使う気が無いユーザーでも窓が開く」ことを
                事前に伝える唯一の文がここ。黙って窓が増えるのを避ける）。 */}
            「配信画面でテスト表示」を押すと、そのエフェクトを 2 つのウィンドウへ 1 回だけ出します。
            {(effectWindowOpen === false || stageWindowOpen === false) &&
              "停止中のウィンドウは、開いてから表示します。"}
          </p>
        )}

        {preview !== null && (
          <EffectTemplatePreview
            // ⚠ `key` に id を入れて、対象が変わったら state ごと作り直す
            //   （前のテンプレートの `<audio>` や再生中の映像を持ち越さない）。
            key={preview.id}
            template={preview}
            onClose={() => setPreview(null)}
          />
        )}

        {error !== null && <p className={styles.errorText}>{error}</p>}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="テンプレートを削除しますか？"
        message={
          pendingDelete === null
            ? ""
            : `「${pendingDelete.name}」を削除します。ファイルも一緒に削除され、元に戻せません。`
        }
        details={pendingDelete === null ? undefined : deleteDetails(pendingDelete)}
        confirmLabel="削除"
        danger
        busy={busy}
        onConfirm={() => {
          if (pendingDelete !== null) void runDelete(pendingDelete);
        }}
        onCancel={cancelDelete}
      />
    </section>
  );
}
