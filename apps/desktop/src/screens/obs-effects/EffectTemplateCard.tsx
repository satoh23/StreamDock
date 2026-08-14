import { useEffect, useState } from "react";
import type { EffectTemplateRecord } from "../../features/obs-effects/effectTemplateApi";
import {
  requestEffectTestFire,
  saveEffectOverlayGuidePending,
  saveEffectTestFirePending,
} from "../../features/comment-viewer/overlaySettings";
import { Button } from "../../components/primitives";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EFFECT_EVENT_LABEL } from "./effectEventRows";
import { EffectTemplatePreview } from "./EffectTemplatePreview";
import type { UseEffectTemplates } from "./useEffectTemplates";
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
 * ⚠ **どちらも省略しないこと。案内は 3 文すべてをテストが回帰として固定している。**
 * （⚠ 061d-1 レビュー S-1: 当初は「専用フォルダを選べ」「プレビューを見ろ」の 2 文だけを固定しており、
 * **「なぜ専用フォルダが要るか」を説明する中間の 1 文を削る変異が生存していた**。理由を失うと残り 2 文は
 * 根拠のない指示に劣化するので、3 文を独立に固定してある。文言を編集するときは 3 つとも見ること。）
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
  eventTypesUsing,
  effectWindowOpen,
  openEffectOverlay,
}: UseEffectTemplates & {
  /**
   * 061h: エフェクト窓が開いているか（`null` ＝ 未取得）。⚠ **前提ステータスの持ち主は
   * `ObsEffectsScreen`**（2 秒ごとのポーリング）で、ここはそれを注記と経路の分岐に使う。
   * ⚠ **省略可にしない**——既定値を持たせると、渡し忘れたときに
   * 「窓が停止中でも注記が出ない＝黙って何も起きない」へ倒れる（061a 以来の規律）。
   */
  effectWindowOpen: boolean | null;
  /**
   * 061i: **エフェクト窓を開く**（判断 4）。⚠ **この module は `windowApi` を import しない**
   * ——窓の invoke は `ObsEffectsScreen` の直列化キュー（`effectOverlayOpRef`）を通す必要があり、
   * ここから直接投げると「『ウィンドウを閉じる』と競合して順序が入れ替わる」経路を作ってしまう。
   * ⚠ **省略可にしない**（渡し忘れが「押しても窓が開かない」＝黙って何も起きないへ倒れる）。
   */
  openEffectOverlay: () => void;
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
    if (effectWindowOpen === false) {
      saveEffectTestFirePending(templateId);
      // ⚠⚠ **セットアップ用ガイドの新しい起点はここだけ**（判断 3・061a レビュー Q-1）。
      //   061h までは `ObsEffectsScreen` の表示トグル ON が起点だったが、あのトグルは 061i で消えた。
      //   ⚠ **条件を編集して窓が自動で開いたときは立てない**（`ObsEffectsScreen` の
      //   `openEffectOverlay` はこの旗を触らない）——立てると**条件を足すたび**に
      //   ガイドが 30 秒 OBS へ映る。ここは「窓が停止中に、位置合わせのために開いた」瞬間である。
      saveEffectOverlayGuidePending(true);
      openEffectOverlay();
      return;
    }
    requestEffectTestFire(templateId);
  };

  /** 表示秒数の見出し用。⚠ 壊れ値は握りつぶす（一覧が落ちるより「—」のほうがよい）。 */
  const durationLabel = (durationMs: number): string =>
    Number.isFinite(durationMs) ? `${(durationMs / 1000).toFixed(1)}秒` : "—";

  /**
   * 061d-2: 削除確認の**追加の 1 文**。⚠⚠ **割り当てに使われているときはその旨を出す**（(3) の指定）。
   *
   * ⚠ **実際にそうなること**を書く——061d-2 は「組み込みのエフェクトに戻ります」だったが、
   *   061h で戻し先が「表示しない」になったので文言も追随する（`clearEffectAssignmentsForTemplate`）。
   * ⚠ `message`（`<p>` 1 つ）ではなく `details` に載せるのは、`ConfirmDialog` の本文が改行を
   *   保持しない単一段落だから（060c が同じ理由で `details` を足している）。
   */
  const deleteDetails = (template: EffectTemplateRecord) => {
    const used = eventTypesUsing(template.id);
    if (used.length === 0) return undefined;
    const labels = used
      .map((eventType) => EFFECT_EVENT_LABEL[eventType] ?? eventType)
      .join("・");
    return (
      <p className={styles.errorText}>
        このテンプレートは「{labels}
        」に割り当てられています。削除すると、その割り当ては「表示しない」に戻ります。
      </p>
    );
  };

  return (
    <section className={layout.panel}>
      <div className={layout.panelHead}>
        <h3>エフェクトのテンプレート</h3>
        <p>
          StreamDock 形式のテンプレート（画像や動画＋設定ファイル）を取り込んで、配信画面に出すエフェクトとして使えます。
        </p>
      </div>
      <div className={layout.panelBody}>
        {/* ⚠ 親 061 の決定「『そのままテンプレートとして適用』の意味を UI で正しく伝えること」。
            他所の HTML エフェクト（たぬえさ3 の forOBS3.html 等）は**読めない**。 */}
        <p className={styles.note}>
          他の配信ツール向けの HTML
          エフェクトは読み込めません。フォルダの中に manifest.json
          があるもの（StreamDock 形式）だけを扱います。
        </p>

        {/* ⚠⚠ **061c security-review S-3 の唯一の緩和策。省略しないこと。**
            この文言はテストが回帰として固定している。 */}
        <p className={`${styles.note} ${styles.caution}`}>
          テンプレート専用のフォルダを選んでください。選んだフォルダの中にある画像や音を読み込みます。ダウンロードフォルダなど、他のファイルが入っている場所を選ぶと、意図しない画像が配信画面に出ることがあります。取り込んだ直後にプレビューが出るので、必ず内容を確認してください。
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
          <p className={styles.note}>
            「配信画面でテスト表示」を押すと、そのエフェクトをエフェクトのウィンドウへ 1
            回だけ出します。OBS
            での位置合わせに使ってください（イベントの条件に使っていないエフェクトでも出せます）。
            {effectWindowOpen === false &&
              "エフェクトのウィンドウが停止中のため、ウィンドウを開いてから表示します。"}
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
