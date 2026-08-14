import { getEffectTemplateMedia } from "../../features/obs-effects/effectTemplateApi";
import { safeEffectMedia, type SafeEffectMedia } from "./effectMedia";

/**
 * 061d-2: エフェクト窓が持つ**テンプレートメディアの先読みキャッシュ**（④）。
 *
 * ⚠⚠ **存在理由＝「発火の瞬間に `get_effect_template_media` を呼ばない」**（061c 申し送り 6）。
 * 1 テンプレートで最大 5MiB ＝ base64 で約 6.7M 文字が返るので、投げ銭が来た瞬間に IPC を
 * 待つと **OBS のキャプチャがカクつく**（実機確認⑧が測るのはまさにこれ）。
 *
 * ## 鮮度について（穴 α の結論・⚠ 実コードで裏取りした前提）
 *
 * ⚠⚠ **テンプレートは id ごとに不変である。** 取り込みは毎回
 * `effect_template::service` の `Uuid::new_v4()` で**新しい id を採番**し、
 * `repository.rs` には **`INSERT` しか無い**（`UPDATE` も `ON CONFLICT` も無い）。
 * アプリ内編集の導線も無い（061d の「やらないこと」）。
 * ＝ **「同じ id なのに中身が変わった」が構造的に起こらない**ので、
 * ここに載った値も `EffectTemplateRecord` も**古くならない**。起こりうるのは 2 つだけ:
 *   - **まだ知らない id**（取り込み直後）… キャッシュミス → [`prime`] で温める
 *   - **消えた id** … 一覧から消え、`get_effect_template_media` も失敗する
 *     → ⚠ **061h 以降は「その 1 件を出さない」**（061d-2 の「組み込みへフォールバック」は廃止。下記 061h 節）
 *
 * ⚠⚠ **再修正トリガー＝「テンプレートを編集する」コマンドが増えたとき。**
 * そのとき id → 中身が可変になり、上の論証ごと崩れる（発火ごとの取り直し、または
 * 変更 nonce キーによる明示的な無効化を設計し直すこと）。
 *
 * ## キャッシュミスのときに何が起きるか（穴 β の結論＝案 (c)）
 *
 * ⚠⚠ **その回は組み込み意匠で出し切り、裏で温めて次回からテンプレートにする。**
 * 却下した 2 案:
 *   - **(a) 先に組み込みを出して、届いたら差し替える** … 配信画面で**見た目が途中で変わる**
 *     （視聴者には不具合に見える）。撤去タイマーの起点も曖昧になる。
 *   - **(b) 届くまで待って出す** … 6.7M 文字の IPC ぶん遅れる（＝申し送り 6 の禁止そのもの）。
 *     失敗時は無反応の時間が生まれる。
 * ⚠⚠ **決め手は「実機確認⑧で先読みの成否をどう観測するか」である。** §9 と `eslint` の
 * `no-console` により、この窓は計測ログを 1 バイトも出せない＝観測手段は**画面の見た目しかない**。
 * (a) は常に「組み込み → テンプレート」に見え、(b) は先読みの有無に関わらず同じ絵が出るので、
 * **どちらも先読みが効いたか判別できない**。(c) だけが
 * 「**1 回目からテンプレートが出るか**」という二値で先読みの成否を目に見える形にする。
 *
 * ## ⚠⚠ 061h: 上の「案 (c)」は反転した（＝この節は当時の記録であって現在の仕様ではない）
 *
 * ⚠⚠ **いまのキャッシュミスは「その 1 件を出さない」**（`EffectOverlayApp` の [`fire`] が正）。
 * 上の 3 案の比較は**組み込み意匠という受け皿が在った前提**で書かれており、061h でその受け皿ごと
 * 廃止したので、(c)（＝その回は組み込みで出し切る）は**選択肢として存在しない**。
 * ⚠ **上の節を消さずに残してあるのは、却下した (a)(b) の理由が 061h 後も生きているため**——
 * 「見た目が途中で変わる」「6.7M 文字の IPC を待つ」はどちらも今も採ってはいけない。
 * ⚠ 皮肉なことに**決め手だった観測性はむしろ上がった**（いまの二値は「出るか／何も出ないか」）。
 * ⚠⚠ **本モジュールの契約としては「呼び出し側がミス時に何を出すかは呼び出し側が決める」**であり、
 * このキャッシュは**フォールバック先を 1 つも知らない**（061d-2 の JSDoc は知っている書き方だった）。
 * **再修正トリガー＝ミス時の受け皿（063 のガチャ等）が再び生まれたとき**——そのとき
 * 3 案の比較をここでやり直すこと（案の並びは上に残してある）。
 */

/**
 * キャッシュが保持してよい **base64 の文字数**の合計（④の「20MiB」）。
 *
 * ⚠⚠ **これは「キャッシュが保持する量」であって「窓が消費する量」ではない**（穴 ζ）。
 * 表示中のエフェクトは `<img src>` と React の state が data URI 文字列を掴んでいるので、
 * ここから追い出しても**アンマウントされるまで解放されない**。
 * ＝ 最悪時の常駐は「キャッシュ 20MiB ＋ 表示中 3 件ぶん」。
 *
 * ⚠ **061c の `MAX_TOTAL_BYTES`（1 テンプレートのファイル合計 5MiB）とは単位も対象も違う。**
 * あちらは取り込み時のファイルサイズ、こちらは **base64 化した後の文字数**の、全テンプレート横断の常駐上限。
 * ⚠ 計測に文字数を使うのは、base64 が ASCII なので V8 が 1 バイト文字列（SeqOneByteString）で
 * 保持し、**文字数 ≒ 実バイト数**になるため。`Blob` を作って測るような余計な確保はしない。
 * ⚠ 帰結として、**1 テンプレートが最大 6.7M 文字になりうるので最悪 3 件弱しか載らない**。
 * 通常のテンプレート（数百 KB）なら数十件載る。割り当ては最大 6 件なので実運用では足りる。
 *
 * **再修正トリガー**＝実機でメモリが問題になったら下げる。⚠ **`EFFECT_MAX_CONCURRENT` は触らない**。
 */
export const EFFECT_MEDIA_CACHE_MAX_CHARS = 20 * 1024 * 1024;

/** data URI の文字数（メディア＋音源）。⚠ これがキャッシュの「重さ」の定義。 */
const weigh = (media: SafeEffectMedia): number =>
  media.media.length + (media.sound?.length ?? 0);

export interface EffectMediaCache {
  /** 載っていればそれを返し、**LRU の末尾へ動かす**。無ければ `undefined`。 */
  get(templateId: string): SafeEffectMedia | undefined;
  /**
   * 先読み（または発火時ミスの裏読み）。
   *
   * ⚠ **await するかどうかは呼び出し側が決める**（このキャッシュはミス時の受け皿を 1 つも知らない）。
   * ⚠⚠ **061h 現在の呼び出し側は 2 通り**: 本番の発火（`fire`）は**待たずにその 1 件を出さない**
   * （＝発火の瞬間に IPC を呼ばない・061c 申し送り 6）／テスト表示（`fireTest`）は
   * **明示操作 1 回なので待ってから出す**。⚠ 061d-2 の「呼び出し側は組み込みで出し切る（案 (c)）」は
   * **組み込み意匠ごと廃止された**（module doc の 061h 節が正）。
   * ⚠ 同じ id の同時取得は 1 本に畳む（6.7M 文字の IPC が並ばない）。
   * ⚠ 一度失敗した id は**再挑戦しない**（[`clearFailures`] を呼ぶまで）。
   */
  prime(templateId: string): Promise<void>;
  /** 指定 id 以外を捨てる（割り当てから外れたテンプレートを LRU 任せにしない）。 */
  retain(templateIds: readonly string[]): void;
  /** 描画時にデコードが失敗した id を「もう試さない」側へ倒す（`onMediaError` から呼ぶ）。 */
  markFailed(templateId: string): void;
  /** 失敗の記録を捨てて再挑戦できるようにする（割り当てが変わったときに呼ぶ）。 */
  clearFailures(): void;
}

/**
 * キャッシュを 1 つ作る。
 *
 * ⚠ **モジュール singleton にしない**（`createEffectTriggerState()` と同じ形）。窓のコンポーネントが
 * ref で持つので、テストで global reset が要らず、窓を 2 つ開いても状態が混ざらない。
 *
 * @param maxChars テスト用に上限を差し替えるための引数。⚠ **本番は既定値のまま**——
 *   実測 20MiB を超える文字列をテストで作るのは非現実的なので、
 *   **小さい上限を渡して追い出し順を固定する**ためにだけ開けてある。
 *   ⚠ **061d-2 レビュー（受容・修正不要）**: 1 件が単独で `maxChars` を超える場合、
 *   [`store`] の直後に [`evict`] が同じ 1 件を捨てるので**永久にキャッシュされない**
 *   （＝ `prime` が呼ばれるたびに取り直す）。既定の 20MiB に対して 1 テンプレートは
 *   最大でも base64 約 6.7M 文字（Rust の合計 5MiB 上限）なので**到達しない**。
 *   **再修正トリガー＝既定を 7M 文字未満まで下げるとき**（そのときは「単独で超える 1 件は
 *   載せない代わりに失敗として記録する」等、取り直しが繰り返されない形にすること）。
 */
export function createEffectMediaCache(
  maxChars: number = EFFECT_MEDIA_CACHE_MAX_CHARS,
): EffectMediaCache {
  /**
   * ⚠ **`Map` の挿入順をそのまま LRU として使う**（先頭が最も古い）。
   * ヒット時に delete → set で末尾へ動かし、上限超過は先頭から捨てる。
   */
  const entries = new Map<string, SafeEffectMedia>();
  /** 取得中の Promise（同一 id の重複取得を畳む）。 */
  const inflight = new Map<string, Promise<void>>();
  /**
   * ⚠⚠ **取得に失敗した／ガードに弾かれた id。** 記録しないと、**投げ銭が来るたびに
   * 6.7M 文字の IPC が走る**（＝実機確認⑧が測っているカクつきを、フォールバック経路が自分で作る）。
   */
  const failed = new Set<string>();
  let totalChars = 0;

  const evict = () => {
    // ⚠ 追い出しても表示中の実メモリは減らない（上の定数の注記）。ここが守るのは
    //   「使われていないテンプレートを持ち続けない」ことだけ。
    for (const [id, media] of entries) {
      if (totalChars <= maxChars) break;
      entries.delete(id);
      totalChars -= weigh(media);
    }
  };

  const store = (templateId: string, media: SafeEffectMedia) => {
    const existing = entries.get(templateId);
    if (existing !== undefined) totalChars -= weigh(existing);
    entries.delete(templateId);
    entries.set(templateId, media);
    totalChars += weigh(media);
    evict();
  };

  return {
    get(templateId) {
      const media = entries.get(templateId);
      if (media === undefined) return undefined;
      // LRU の末尾へ（＝いま使ったものは最後まで残る）。
      entries.delete(templateId);
      entries.set(templateId, media);
      return media;
    },

    prime(templateId) {
      if (failed.has(templateId)) return Promise.resolve();
      if (entries.has(templateId)) return Promise.resolve();
      const running = inflight.get(templateId);
      if (running !== undefined) return running;
      const task = getEffectTemplateMedia(templateId)
        .then((raw) => {
          // ⚠⚠ **描画シンクの最終防波堤**（`data:` ＋ MIME 完全一致 ＋ base64 文字集合）。
          //   ⚠ **ここを通った値だけをキャッシュへ入れる**＝ 生の `EffectTemplateMedia` は
          //   キャッシュにも state にも一切載らない（`SafeEffectMedia` しか出口が無い）。
          const safe = safeEffectMedia(raw);
          if (safe === undefined) {
            failed.add(templateId);
            return;
          }
          store(templateId, safe);
        })
        .catch(() => {
          // ⚠ 失敗の詳細（id・パス・エラー文言）は握りつぶす（§9・`no-console`）。
          //   削除済みテンプレートを指す割り当てはここへ来る＝⚠ **061h 以後、その id は何も出ない**
          //   （組み込みへ落ちない）。⚠⚠ 解除は [`clearFailures`] だけなので、
          //   **その id はセッション中ずっと無音になりうる**（module doc の 061h 節・
          //   `EffectOverlayApp` の `fire` の「観測できない無音」注記が正）。
          failed.add(templateId);
        })
        .finally(() => {
          inflight.delete(templateId);
        });
      inflight.set(templateId, task);
      return task;
    },

    retain(templateIds) {
      const keep = new Set(templateIds);
      for (const [id, media] of entries) {
        if (keep.has(id)) continue;
        entries.delete(id);
        totalChars -= weigh(media);
      }
    },

    markFailed(templateId) {
      failed.add(templateId);
      const media = entries.get(templateId);
      if (media === undefined) return;
      entries.delete(templateId);
      totalChars -= weigh(media);
    },

    clearFailures() {
      failed.clear();
    },
  };
}
