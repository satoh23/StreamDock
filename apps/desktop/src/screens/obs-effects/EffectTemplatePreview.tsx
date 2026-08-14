import { useCallback, useEffect, useState } from "react";
import {
  getEffectTemplateMedia,
  type EffectTemplateRecord,
} from "../../features/obs-effects/effectTemplateApi";
import { Button } from "../../components/primitives";
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { safeEffectMedia, type SafeEffectMedia } from "./effectMedia";
import type { EffectTemplateVars } from "./effectTemplateText";
import { EffectTemplateView } from "./EffectTemplateView";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061d: テンプレート 1 件の**プレビュー**（main 窓の中だけで再生する）。
 *
 * ⚠⚠ **061d-2 で `EffectTemplateCard` から切り出した**（061d-1 レビュー Q-9 の分割トリガーが
 * 「061d-2 の割り当て結線を入れるとき」で発火した）。一覧・取り込み・削除・割り当ての state は
 * `useEffectTemplates` へ、プレビューと音はここへ。
 *
 * ⚠⚠ **プレビューはこの画面の中だけで再生する。エフェクト窓へは出さない。**
 * エフェクト窓は OBS がキャプチャし続けているので、そこで再生すると**配信中に出てしまう**。
 * ＝ この module は `openEffectOverlayWindow` も `requestEffectTestFire` も import しない
 * （テストが「エフェクト窓向けの localStorage キーへ 1 バイトも書かない」ことを固定している）。
 *
 * ⚠⚠ **「無言で何も出さない」に倒れてはいけない**（061d-1 レビュー S-2）。ユーザーへ
 * 「必ず内容を確認してください」と言っている以上、確認できなかったときは**その事実を出す**
 * ＝ fail-closed（出せなかったと言う）であって fail-open（黙って空）ではない。
 *
 * ⚠ **描画は `EffectTemplateView` 1 本**（エフェクト窓と共有）。ここに 2 つ目の描画実装を書かない。
 * ⚠ **`safeEffectMedia` を必ず通す**。弾かれたら描かずに「表示できません」と出す
 * （プレビューは配信に出ないので、ここは組み込みへフォールバックしない＝**取り込みが壊れている事実を
 * ユーザーに見せる**ほうが役に立つ。エフェクト窓のフォールバックとは目的が違う）。
 * ⚠ **テンプレート名・パス・エラーの詳細を `console.*` へ出さない**（§9）。
 */

/**
 * プレビューで使うダミーの差し込み値。
 *
 * ⚠ **金額ありの経路**（`text.template`）を出す。課金イベントで最も多く、テンプレート作者が
 * まず確認したいのがこちらのため。⚠ 金額なしの経路（`templateWithoutAmount`）は
 * **実際のサブスク／dev-mock で確認する**（061d タスクファイルの実機確認⑩）。
 * ⚠ 061b の `TEST_FIRE_REQUEST_BASE`（エフェクト窓側の固定ダミー）とは**別物**——あちらは
 * 「OBS の位置合わせ」、こちらは「取り込んだ中身の確認」で、目的も出る場所も違う。
 */
const PREVIEW_VARS: EffectTemplateVars = {
  name: "テスト太郎",
  amountText: "¥1,000",
  message: null,
  eventLabel: "スーパーチャット",
};

type PreviewState = "idle" | "loading" | "ready" | "blocked" | "failed";

interface EffectTemplatePreviewProps {
  /**
   * プレビュー対象。
   * ⚠⚠ **一覧から `find` して導出したものを渡さないこと**（061d-1 レビュー S-2(a)）。
   * 取り込み直後のプレビューは **061c S-3 の唯一の緩和策**そのものなので、
   * `reload()` が失敗しただけでプレビュー枠が無言の空になってはいけない。
   */
  template: EffectTemplateRecord;
  onClose: () => void;
}

export function EffectTemplatePreview({
  template,
  onClose,
}: EffectTemplatePreviewProps) {
  /**
   * メディア取得の依存キー。⚠ **record の同一性ではなく id** を見る
   * （一覧の再取得で同じ中身の別オブジェクトになっても 6.7MB を取り直さない）。
   */
  const templateId = template.id;
  const [media, setMedia] = useState<SafeEffectMedia | null>(null);
  const [state, setState] = useState<PreviewState>("idle");
  /** 「もう一度再生」用の通し番号。⚠ **再取得はしない**（`key` を変えて要素を作り直すだけ）。 */
  const [nonce, setNonce] = useState(0);
  /**
   * プレビューの音を鳴らすか。⚠⚠ **既定 OFF**——`<audio>` は **OS 既定の出力**へ出るので、
   * OBS で「デスクトップ音声」を取り込んでいると**配信にも流れる**。
   * 「配信画面に出るものは既定で出さない」（`EFFECT_MONETARY_ENABLED_KEY` が既定 false である規律）と揃える。
   * ⚠ **永続しない**（画面を開き直すたびに OFF へ戻る）。一度 ON にしたことを覚えていると、
   * 数日後に配信直前へ来たユーザーが**自分で ON にした記憶のないまま**音を出してしまう。
   *
   * ⚠⚠ **「既定 OFF」を担保しているのはこの初期値ではなく、下の `templateId` の `useEffect` が
   * 毎回行う `setSoundOn(false)` である**（初期値を `true` にする変異は振る舞いを変えない
   * ＝061d-1 のミューテーションで実測した equivalent mutant）。
   * ⚠ 061d-1 レビュー Q-3 で **reset を「開く」操作側から effect へ移した**——呼び出し側の規律
   * （「プレビューを開くのはこの 1 箇所だけ」）に依存すると、**プレビュー導線が増えた瞬間に
   * 黙って音が鳴る側へ倒れる**。effect に置けば「**対象が変わるあらゆる経路**で必ず OFF」が成立する。
   * ⚠ **061d-2 で実際に導線が 2 本になった**（一覧のプレビューボタン／取り込み直後）が、
   * この形のおかげで**追加の対処は要らなかった**。
   *
   * ⚠ 音量は **059a の `sound-volume` と共有しない**——あちらは Rust・実デバイス指定・**配信に載せない**系統、
   * こちらは webview の `<audio>`・OS 既定出力・**配信に載る**系統で、1 つのスライダーが
   * 2 つの別々の音声経路を意味することになる。061d は専用のスライダーも作らず、
   * テンプレート作者のミックスをそのまま鳴らす。**再修正トリガー＝「音が大きすぎる」と実機で言われたとき。**
   */
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    // ⚠⚠ **「プレビューの音は既定 OFF」を担保しているのはこの 1 行**（061d-1 レビュー Q-3）。
    setSoundOn(false);
    let cancelled = false;
    setMedia(null);
    setState("loading");
    getEffectTemplateMedia(templateId)
      .then((raw) => {
        if (cancelled) return;
        // ⚠⚠ **描画シンクの最終防波堤**（`data:` ＋ MIME 完全一致 ＋ base64 文字集合）。
        //   ここを外すと IPC 境界を越えてきた値がそのまま `src` に入る。
        const safe = safeEffectMedia(raw);
        if (safe === undefined) {
          setState("blocked");
          return;
        }
        setMedia(safe);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const replay = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <div className={styles.preview}>
      {/* ⚠ 061a の教訓（Q-1）と同じ規律＝**約束できることだけ書く**。
          この枠は main 窓の中なので「配信画面には出ていない」は断言してよい。 */}
      <p className={styles.previewCaption}>
        プレビュー（配信画面には出ていません）
      </p>
      {/* ⚠ 061d-2: 枠の背景を「配信映像の上」を模した暗色にしたので、その旨を書いておく
          （枠が暗いことを意匠の気まぐれだと思わせない）。文字色の判断は
          `EffectTemplateView.module.css` の `.text` の注記が正。 */}
      <p className={styles.previewCaption}>
        配信映像の上に出る想定で、暗い背景で表示しています。
      </p>
      <div className={styles.previewStage}>
        {state === "loading" && <p className={styles.note}>読み込み中…</p>}
        {state === "blocked" && (
          <p className={styles.errorText}>
            このテンプレートのメディアは表示できません。取り込み直してください。
          </p>
        )}
        {state === "failed" && (
          <p className={styles.errorText}>
            テンプレートのメディアを読み込めませんでした。
          </p>
        )}
        {state === "ready" && media !== null && (
          // ⚠ `key` に通し番号を混ぜて「もう一度再生」で要素ごと作り直す
          //   （`<video>` / GIF は一度再生すると止まるので、state だけでは戻せない）。
          <EffectTemplateView
            key={`${templateId}:${nonce}`}
            layout={template.layout}
            text={template.text}
            media={media}
            vars={PREVIEW_VARS}
            // ⚠⚠ **061d-1 レビュー S-2(b)**: ガードを通った data URI でもデコードは失敗しうる
            //   （マジックバイトは通るが途中で切れた WebM / APNG 等）。渡さないと
            //   **枠が無言で空になる**＝「確認しました」とユーザーが誤認する。
            //   ⚠ ここは**組み込みへ落とさない**（プレビューは配信に出ないので、
            //   壊れている事実を見せるほうが役に立つ。エフェクト窓のフォールバックとは目的が違う）。
            onMediaError={() => setState("failed")}
          />
        )}
      </div>

      <div className={styles.rowActions}>
        <Button type="button" onClick={replay} disabled={state !== "ready"}>
          もう一度再生
        </Button>
        <Button type="button" onClick={onClose}>
          プレビューを閉じる
        </Button>
      </div>

      {template.hasSound && (
        <>
          <ToggleSwitch
            label="プレビューの音を鳴らす"
            checked={soundOn}
            // ⚠ 061d-1 レビュー Q-7: ON にしたときは通し番号も進めて**映像ごと作り直す**。
            //   `<audio>` だけ先頭から鳴ると、再生途中の映像と音がずれたまま確認することになる。
            //   OFF は鳴っているものを止めるだけなので作り直さない。
            onChange={(next) => {
              setSoundOn(next);
              if (next) replay();
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
          **再修正トリガー＝実機で「音ありのはずが鳴らない」報告が出たとき**。 */}
      {soundOn && state === "ready" && media?.sound !== undefined && (
        <audio
          key={`sound:${templateId}:${nonce}`}
          src={media.sound}
          autoPlay
          data-testid="effect-preview-sound"
        />
      )}
    </div>
  );
}
