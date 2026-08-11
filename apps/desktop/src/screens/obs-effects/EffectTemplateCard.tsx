import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  deleteEffectTemplate,
  getEffectTemplateMedia,
  importEffectTemplate,
  listEffectTemplates,
  type EffectTemplateRecord,
} from "../../features/obs-effects/effectTemplateApi";
import { toErrorMessage } from "../../features/tools/useTools";
import { Button } from "../../components/primitives";
import { ConfirmDialog } from "../comment-viewer/ConfirmDialog";
import { ToggleSwitch } from "../comment-viewer/ToggleSwitch";
import { safeEffectMedia, type SafeEffectMedia } from "./effectMedia";
import type { EffectTemplateVars } from "./effectTemplateText";
import { EffectTemplateView } from "./EffectTemplateView";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061d: テンプレートの取り込み・一覧・削除・**プレビュー**（main 窓の「OBSエフェクト」画面）。
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
 * ⚠⚠ **プレビューは「無言で何も出さない」に倒れてはいけない**（061d-1 レビュー S-2）。
 * ユーザーへ「必ず内容を確認してください」と言っている以上、確認できなかったときは**その事実を出す**。
 * 具体的には ①一覧の再取得に失敗してもプレビューは出す（`importEffectTemplate` が返した record を
 * **そのまま**使い、一覧の `find` に依存させない）②メディアがデコードできなければ `onMediaError` で
 * `failed` へ倒す。＝ **fail-closed（出せなかったと言う）であって fail-open（黙って空）ではない。**
 *
 * ⚠ **責務量について**: 一覧・取り込み・削除・プレビュー・音を 1 コンポーネントが持っている
 * （060d の `OverlayThemeCard` は `useThemeImport` へ切り出した先例がある）。**061d-1 では切らない**
 * ——061d-2 で「削除時に割り当てを解除」「割り当て中なら確認文を変える」が入ると削除フローと
 * 割り当て state が絡み、いま引いた境界がそのまま無効になるため。
 * **再修正トリガー＝061d-2 の割り当て結線を入れるとき。** そのとき `useEffectTemplates`
 * （一覧＋取り込み＋削除＋割り当て解除）と `EffectTemplatePreview`（プレビュー＋音）へ 2 分割する。
 *
 * ⚠⚠ **プレビューはこの画面の中だけで再生する。エフェクト窓へは出さない。**
 * エフェクト窓は OBS がキャプチャし続けているので、そこで再生すると**配信中に出てしまう**。
 * ＝ この module は `openEffectOverlayWindow` も `requestEffectTestFire` も import しない
 * （テストが「エフェクト窓向けの localStorage キーへ 1 バイトも書かない」ことを固定している）。
 *
 * ⚠ **描画は `EffectTemplateView` 1 本**（エフェクト窓と共有）。ここに 2 つ目の描画実装を書かない。
 * ⚠ **`safeEffectMedia` を必ず通す**。弾かれたら描かずに「表示できません」と出す
 * （プレビューは配信に出ないので、ここは組み込みへフォールバックしない＝**取り込みが壊れている事実を
 * ユーザーに見せる**ほうが役に立つ。エフェクト窓のフォールバックとは目的が違う）。
 * ⚠ **テンプレート名・パス・エラーの詳細を `console.*` へ出さない**（§9。
 * `eslint.config.js` の `no-console` が `src/screens/obs-effects/**` に効いている）。
 */

/**
 * プレビューで使うダミーの差し込み値。
 *
 * ⚠ **金額ありの経路**（`text.template`）を出す。課金イベントで最も多く、テンプレート作者が
 * まず確認したいのがこちらのため。⚠ 金額なしの経路（`templateWithoutAmount`）は
 * **実際のサブスク／dev-mock で確認する**（061d タスクファイルの実機確認⑩）。
 * ⚠ 061b の `TEST_FIRE_REQUEST`（エフェクト窓側の固定ダミー）とは**別物**——あちらは
 * 「OBS の位置合わせ」、こちらは「取り込んだ中身の確認」で、目的も出る場所も違う。
 */
const PREVIEW_VARS: EffectTemplateVars = {
  name: "テスト太郎",
  amountText: "¥1,000",
  message: null,
  eventLabel: "スーパーチャット",
};

type PreviewState = "idle" | "loading" | "ready" | "blocked" | "failed";

/** 表示秒数の見出し用。⚠ 壊れ値は握りつぶす（一覧が落ちるより「—」のほうがよい）。 */
const durationLabel = (durationMs: number): string =>
  Number.isFinite(durationMs) ? `${(durationMs / 1000).toFixed(1)}秒` : "—";

export function EffectTemplateCard() {
  const [templates, setTemplates] = useState<EffectTemplateRecord[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<EffectTemplateRecord | null>(null);

  /**
   * プレビュー中のテンプレート。
   *
   * ⚠⚠ **一覧（`templates`）から `find` して導出しない**（061d-1 レビュー S-2(a)）。
   * 取り込み直後のプレビューは **061c S-3 の唯一の緩和策**そのものなのに、`find` に依存させると
   * **`reload()` が失敗しただけでプレビュー枠が無言の空になる**（＝緩和策が fail-open する）。
   * `importEffectTemplate` は record を返しているので、一覧の成否に相乗りする理由が無い。
   */
  const [previewTemplate, setPreviewTemplate] =
    useState<EffectTemplateRecord | null>(null);
  /**
   * メディア取得の依存キー。⚠ **record の同一性ではなく id** を見る
   * （`reload()` で同じ中身の別オブジェクトになっても 6.7MB を取り直さない）。
   */
  const previewId = previewTemplate?.id ?? null;
  const [previewMedia, setPreviewMedia] = useState<SafeEffectMedia | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  /** 「もう一度再生」用の通し番号。⚠ **再取得はしない**（`key` を変えて要素を作り直すだけ）。 */
  const [previewNonce, setPreviewNonce] = useState(0);
  /**
   * プレビューの音を鳴らすか。⚠⚠ **既定 OFF**——`<audio>` は **OS 既定の出力**へ出るので、
   * OBS で「デスクトップ音声」を取り込んでいると**配信にも流れる**。
   * 「配信画面に出るものは既定で出さない」（`EFFECT_MONETARY_ENABLED_KEY` が既定 false である規律）と揃える。
   * ⚠ **永続しない**（画面を開き直すたびに OFF へ戻る）。一度 ON にしたことを覚えていると、
   * 数日後に配信直前へ来たユーザーが**自分で ON にした記憶のないまま**音を出してしまう。
   *
   * ⚠⚠ **「既定 OFF」を担保しているのはこの初期値ではなく、下の `previewId` の `useEffect` が
   * 毎回行う `setPreviewSound(false)` である**（初期値を `true` にする変異は振る舞いを変えない
   * ＝061d-1 のミューテーションで実測した equivalent mutant）。
   * ⚠ 061d-1 レビュー Q-3 で **reset を `openPreview` から effect へ移した**——`openPreview` に置くと
   * 「`previewTemplate` を非 null にするのは `openPreview` だけ」という**呼び出し規律**に依存し、
   * 061d-2 で割り当て UI からプレビュー導線が増えた瞬間に**黙って音が鳴る側へ倒れる**。
   * effect に置けば「**`previewId` が変わるあらゆる経路**で必ず OFF」が構造的に成立する。
   *
   * ⚠ 音量は **059a の `sound-volume` と共有しない**——あちらは Rust・実デバイス指定・**配信に載せない**系統、
   * こちらは webview の `<audio>`・OS 既定出力・**配信に載る**系統で、1 つのスライダーが
   * 2 つの別々の音声経路を意味することになる。061d は専用のスライダーも作らず、
   * テンプレート作者のミックスをそのまま鳴らす。**再修正トリガー＝「音が大きすぎる」と実機で言われたとき。**
   */
  const [previewSound, setPreviewSound] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTemplates(await listEffectTemplates());
      setListState("ready");
    } catch {
      // ⚠ 一覧が読めないこと自体は伝えるが、詳細は出さない（§9）。
      setListState("failed");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // プレビュー対象が変わったら data URI を取り直す。⚠ `previewNonce`（再生し直し）は**依存に入れない**
  // ——最大 6.7MB の文字列なので、再生ボタンのたびに IPC で取り直すのは無駄。
  useEffect(() => {
    // ⚠⚠ **「プレビューの音は既定 OFF」を担保しているのはこの 1 行**（061d-1 レビュー Q-3）。
    //   `previewId` が変わるあらゆる経路（一覧のボタン／取り込み直後／061d-2 で増える導線）を
    //   必ず通るので、呼び出し側の規律に頼らずに構造で守れる。
    //   ⚠ 「もう一度再生」（`previewNonce`）は `previewId` を変えないのでここを通らない
    //   ＝ ユーザーが自分で ON にした音を再生し直しで勝手に消さない。
    setPreviewSound(false);
    if (previewId === null) {
      setPreviewMedia(null);
      setPreviewState("idle");
      return;
    }
    let cancelled = false;
    setPreviewMedia(null);
    setPreviewState("loading");
    getEffectTemplateMedia(previewId)
      .then((raw) => {
        if (cancelled) return;
        // ⚠⚠ **描画シンクの最終防波堤**（`data:` ＋ MIME 完全一致 ＋ base64 文字集合）。
        //   ここを外すと IPC 境界を越えてきた値がそのまま `src` に入る。
        const safe = safeEffectMedia(raw);
        if (safe === undefined) {
          setPreviewState("blocked");
          return;
        }
        setPreviewMedia(safe);
        setPreviewState("ready");
      })
      .catch(() => {
        if (!cancelled) setPreviewState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  /**
   * プレビューを開く（＝対象を差し替える）。
   * ⚠ **record をそのまま受け取る**（id だけ受け取って一覧から引き直さない＝S-2(a) の理由）。
   * ⚠ 音の OFF は上の `useEffect` が担う（ここには置かない＝Q-3 の理由）。
   */
  const openPreview = useCallback((template: EffectTemplateRecord) => {
    setPreviewTemplate(template);
    setPreviewNonce((n) => n + 1);
  }, []);

  const startImport = async () => {
    setError(null);
    // ⚠ 061d-1 レビュー Q-8: `busy` は **`open()` の前**に立てる。後に立てると
    //   ネイティブダイアログが開いている間だけボタンが押せる状態が残る（ダイアログのモーダル性に依存しない）。
    setBusy(true);
    try {
      let picked: string | string[] | null;
      try {
        picked = await open({
          multiple: false,
          directory: true,
          title: "エフェクトのテンプレートのフォルダを選択",
        });
      } catch {
        // ⚠ 061d-1 レビュー P-1: ここだけは **`tauri-plugin-dialog` のエラー文言**で、こちらの管理下に無い
        //   （`import_effect_template` 以降は Rust の `AppError`＝すべて固定安全文言）。§9 のため固定文言にする。
        setError("フォルダ選択ダイアログを開けませんでした。");
        return;
      }
      if (typeof picked !== "string") return;
      // ⚠ 生パスをそのまま渡す。**検証は Rust 側**（§8）で、ここでの整形は 1 文字も行わない。
      const record = await importEffectTemplate(picked);
      // ⚠⚠ **取り込み直後は必ずプレビューを開く**（061c security-review S-3 の緩和策）。
      //   「選んだフォルダに元から在った画像」が取り込まれてしまった場合、ここでしか気付けない。
      //   ⚠⚠ **これが一覧の成否に巻き込まれないことを担保しているのは、`openPreview` が
      //   `record` を直接受け取ること**（＝`templates.find` を使わないこと）である（061d-1 レビュー S-2(a)）。
      //   ⚠ 下の `reload()` より先に呼んでいるのは防御的な順序づけにすぎない——`reload()` は
      //   内部で catch していて throw しないので、**入れ替えても振る舞いは変わらない**
      //   （実測で equivalent mutant）。「先に呼んでいるから安全」と読まないこと。
      openPreview(record);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async (template: EffectTemplateRecord) => {
    setBusy(true);
    setError(null);
    try {
      await deleteEffectTemplate(template.id);
      // ⚠ 消したものをプレビューしたままにしない（取り直しに失敗して "failed" が出るだけになる）。
      if (previewTemplate?.id === template.id) setPreviewTemplate(null);
      setPendingDelete(null);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
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
          <p className={styles.note}>
            取り込んだテンプレートはまだありません。
          </p>
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
                <Button
                  type="button"
                  onClick={() => openPreview(template)}
                  disabled={busy}
                >
                  プレビュー
                </Button>
                <Button
                  type="button"
                  onClick={() => setPendingDelete(template)}
                  disabled={busy}
                >
                  削除
                </Button>
              </li>
            ))}
          </ul>
        )}

        {previewId !== null && (
          <div className={styles.preview}>
            {/* ⚠ 061a の教訓（Q-1）と同じ規律＝**約束できることだけ書く**。
                この枠は main 窓の中なので「配信画面には出ていない」は断言してよい。 */}
            <p className={styles.previewCaption}>
              プレビュー（配信画面には出ていません）
            </p>
            <div className={styles.previewStage}>
              {previewState === "loading" && (
                <p className={styles.note}>読み込み中…</p>
              )}
              {previewState === "blocked" && (
                <p className={styles.errorText}>
                  このテンプレートのメディアは表示できません。取り込み直してください。
                </p>
              )}
              {previewState === "failed" && (
                <p className={styles.errorText}>
                  テンプレートのメディアを読み込めませんでした。
                </p>
              )}
              {previewState === "ready" &&
                previewMedia !== null &&
                previewTemplate !== null && (
                  // ⚠ `key` に通し番号を混ぜて「もう一度再生」で要素ごと作り直す
                  //   （`<video>` / GIF は一度再生すると止まるので、state だけでは戻せない）。
                  <EffectTemplateView
                    key={`${previewTemplate.id}:${previewNonce}`}
                    layout={previewTemplate.layout}
                    text={previewTemplate.text}
                    media={previewMedia}
                    vars={PREVIEW_VARS}
                    // ⚠⚠ **061d-1 レビュー S-2(b)**: ガードを通った data URI でもデコードは失敗しうる
                    //   （マジックバイトは通るが途中で切れた WebM / APNG 等）。渡さないと
                    //   **枠が無言で空になる**＝「確認しました」とユーザーが誤認する。
                    //   ⚠ ここは**組み込みへ落とさない**（プレビューは配信に出ないので、
                    //   壊れている事実を見せるほうが役に立つ。エフェクト窓の 061d-2 のフォールバックとは目的が違う）。
                    onMediaError={() => setPreviewState("failed")}
                  />
                )}
            </div>

            <div className={styles.rowActions}>
              <Button
                type="button"
                onClick={() => setPreviewNonce((n) => n + 1)}
                disabled={previewState !== "ready"}
              >
                もう一度再生
              </Button>
              <Button type="button" onClick={() => setPreviewTemplate(null)}>
                プレビューを閉じる
              </Button>
            </div>

            {previewTemplate?.hasSound === true && (
              <>
                <ToggleSwitch
                  label="プレビューの音を鳴らす"
                  checked={previewSound}
                  // ⚠ 061d-1 レビュー Q-7: ON にしたときは通し番号も進めて**映像ごと作り直す**。
                  //   `<audio>` だけ先頭から鳴ると、再生途中の映像と音がずれたまま確認することになる。
                  //   OFF は鳴っているものを止めるだけなので作り直さない。
                  onChange={(next) => {
                    setPreviewSound(next);
                    if (next) setPreviewNonce((n) => n + 1);
                  }}
                />
                <p className={`${styles.note} ${styles.caution}`}>
                  プレビューの音はパソコンのスピーカーから出ます。OBS で「デスクトップ音声」を取り込んでいる場合は、配信にも流れます。
                </p>
              </>
            )}

            {/* ⚠⚠ **音を鳴らさないときは `<audio>` を DOM に置かない**（`muted` で消すのではなく）。
                「既定 OFF」を state の値ではなく**要素の有無**で担保する＝ミュート解除の変異が作れない。
                ⚠ `<video>` 側は常に `muted`（`EffectTemplateView`）なので、音の経路はこの 1 本だけ。
                ⚠ **`onError` は付けない**（061d-1 レビュー P-3）。音源のデコード失敗は「鳴らないだけ」で
                ①メディアは出ているので画面は無言にならない ②`effectMedia.ts` が「音が鳴らないことは
                配信を壊さない／エフェクトが出ないことは壊す」と線を引いており、そちらと整合する。
                **再修正トリガー＝実機で「音ありのはずが鳴らない」報告が出たとき**（そのとき原因が
                デコード失敗か autoplay policy かを分ける必要が生じるので、その時点で足す）。 */}
            {previewSound &&
              previewState === "ready" &&
              previewMedia?.sound !== undefined && (
                <audio
                  key={`sound:${previewId}:${previewNonce}`}
                  src={previewMedia.sound}
                  autoPlay
                  data-testid="effect-preview-sound"
                />
              )}
          </div>
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
        confirmLabel="削除"
        danger
        busy={busy}
        onConfirm={() => {
          if (pendingDelete !== null) void runDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
