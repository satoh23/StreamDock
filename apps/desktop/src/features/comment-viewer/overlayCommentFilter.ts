import type { CommentSource, CommentViewDto } from "./types";

/**
 * 067a: **オーバーレイ窓が、どの配信元のコメントを描いてよいか**を決める純関数群。
 *
 * ## ⚠⚠ 何のための設定か
 *
 * Twitch は利用規約（ToS §11 Simulcasting・`legal.twitch.com`）で、同時配信中に
 * 他プラットフォームのチャットを Twitch の配信画面へ統合することを禁じている。
 * ⚠ 2026-02 に Twitch の CEO が配信内で「取り締まらない」と述べたが、
 * ⚠⚠ **2026-08-12 の ToS 改訂後も条文は残っている**。
 * ⇒ StreamDock は**判断を配信者に渡す**——出す配信元を選べるようにし、事実を設定画面に書く。
 *   文言と経緯は `docs/tasks/067-multistream-output-split.md` §25 が正。
 *
 * ## ⚠⚠⚠ 配信先ごとの出し分けは行わない（2026-09-12 撤回）
 *
 * 067b/067c/067e は「Twitch 向け」「YouTube 向け」の 2 つの窓を作り、Branch Output で
 * 配信先ごとに別の映像を送る方式だったが、**撤回して削除した**。
 * 理由は、その方式が**配信者のシーン管理を乗っ取る**（合成シーンを番組シーンにするしかなく、
 * 配信中のシーン切り替えを禁止することになる）ため。⚠ 詳細は上記 §25。
 * ⇒ **オーバーレイ窓は 1 つ**で、そこに出す配信元をユーザーが選ぶ。
 *
 * ## ⚠⚠⚠ 効く範囲は `comment-overlay` 窓だけである（レビュー S-2・2026-09-12）
 *
 * OBS がキャプチャする窓は他にもあり、**そちらはこの設定を読まない＝素通りする**:
 * - `pinned-overlay`（`PinnedOverlayApp`）… 固定コメント。⚠ Twitch のコメントをピン留めしていると、
 *   トグルを OFF にしても**配信に載り続ける**。
 * - `stage-overlay`（`EffectOverlayApp` → `GachaEffectStage`）… ガチャ演出の `viewerName`
 *   ＝**第三者の表示名**。⚠ 同じく OFF にしても載る。
 *
 * ⚠ **これは 067a 当初からの範囲で、撤回で新たに空いた穴ではない。**今直さない理由は、
 * 3 窓すべてを絞るなら `resolveOverlaySources` を 3 ラベル対応にし、`PinnedOverlayApp` /
 * `EffectOverlayApp` の入口にも `filterCommentsBySource` を通す必要があり、**本撤回の範囲を超える**ため。
 * ⚠⚠ **再修正のトリガー**: ①「OFF にしたのに出る」の報告が出たとき ②Twitch がエンフォースを再開したとき
 * ③この 3 窓のどれかに新しいコメント描画経路が増えるとき。そのときは**別タスクで 3 窓まとめて**扱うこと
 * （1 窓だけ塞ぐと「塞いだ窓と素通りの窓」が混在してかえって危ない）。
 */

/** 067a: 描画対象の配信元の集合（表示側の判断は必ずこの型を経由する）。 */
export type OverlaySourceFilter = readonly CommentSource[];

/** 067a: オーバーレイ窓のウィンドウラベル（033f 以来の既存窓）。 */
export const COMMENT_OVERLAY_LABEL = "comment-overlay";

/**
 * 067a: **既定**の描画対象（＝035b 以来の現行挙動＝全部出す）。
 * ⚠ 既定を変えると既存ユーザーのオーバーレイから黙ってコメントが消えるので、**変えないこと**。
 */
export const DEFAULT_OVERLAY_SOURCES: OverlaySourceFilter = ["twitch", "youtube"];

/**
 * 067a: **窓ラベルとユーザー設定から、その窓が描いてよい配信元を決める**（本ファイルの中心）。
 *
 * ⚠⚠⚠ **未知のラベルは「何も描かない」に倒す**（fail-closed）。
 * 「全部描く」に倒すと、ラベルの typo やリファクタの取りこぼしが
 * **「出さないはずのコメントが配信に載る」**として現れる。
 * ⚠ 逆に倒しておけば、壊れ方は「コメントが出ない」＝**実機で即分かる**方向になる。
 * ⚠ この分岐は `overlayCommentFilter.test.ts` が固定している。
 *
 * ⚠⚠ **fail-closed なのは「ラベル軸」だけである**（レビュー S-4・2026-09-12）。
 * **値の読み方は逆向き**——`overlaySettings.ts` の [`loadOverlayShowTwitch`] は
 * `getItem(KEY) !== "false"` ＝ **`"false"` 以外のあらゆる値が ON** に倒れる。
 * ⇒ localStorage が壊れた値を持てば「出さないはずのコメントが出る」側に落ちる。
 * ⚠ それでもこの向きが正しいのは、**既定 ON が 035b 以来の機能要件**だからである
 * （既定を OFF にすると、アップデートしただけで既存ユーザーのオーバーレイからコメントが消える）。
 * ⇒ **「この関数が fail-closed だから設定全体が fail-closed」と読まないこと。**
 *
 * @param label `getCurrentWindow().label`（呼び出し側が渡す。ここでは Tauri API を触らない＝純関数）
 * @param configured ユーザー設定
 */
export function resolveOverlaySources(
  label: string,
  configured: OverlaySourceFilter = DEFAULT_OVERLAY_SOURCES,
): OverlaySourceFilter {
  if (label === COMMENT_OVERLAY_LABEL) return configured;
  // ⚠ 未知のラベル（将来の窓・typo）は空集合＝何も描かない。
  return [];
}

/**
 * 067a: コメント配列を、描いてよい配信元だけに絞る。
 *
 * ⚠ **描画のたびに絞る**（受信時ではない）。設定を切り替えたときに、
 * 既に受け取っているコメントも即座に反映されるようにするため
 * （受信時に捨てると、ON に戻しても過去分が戻らない）。
 */
export function filterCommentsBySource(
  comments: readonly CommentViewDto[],
  allowed: OverlaySourceFilter,
): CommentViewDto[] {
  // ⚠ 空集合なら必ず空配列（fail-closed の帰結をここでも保つ）。
  // ⚠⚠ **この 1 行は冗長である**（下の `filter` は `allowed` が空なら同じく `[]` を返す）。
  // レビュー Q-6 のミューテーション確認で、消してもテストが全緑のままだと実測した。
  // ⇒ **テストが守っている行ではなく、意図を目に見える形にするために置いている行**である。
  // ⚠ 消してよいが、消すなら「空集合 → 空配列」が `filter` の性質に暗黙に依存することになる。
  if (allowed.length === 0) return [];
  return comments.filter((c) => allowed.includes(c.source));
}

/**
 * 067a: 2 つの ON/OFF から統合窓の設定値を組み立てる（`overlaySettings` の読み出しと描画の橋渡し）。
 * ⚠ 両方 OFF は**そのまま空集合**にする（＝何も出ない）。勝手に既定へ戻さない——
 * ユーザーが明示的に両方 OFF にしたなら、その意思どおり何も出さないのが正しい
 * （「設定したのに効かない」を作らない・061a Q-1）。
 */
export function toOverlaySourceFilter(
  showTwitch: boolean,
  showYouTube: boolean,
): OverlaySourceFilter {
  const sources: CommentSource[] = [];
  if (showTwitch) sources.push("twitch");
  if (showYouTube) sources.push("youtube");
  return sources;
}
