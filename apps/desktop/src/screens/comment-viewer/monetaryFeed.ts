import { hasComboPayloadChanged } from "../../features/comment-viewer/mergeComments";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { isMonetaryEvent } from "./viewerFormat";

/**
 * 047: 課金コメント（スパチャ/ビッツ/サブスク/メンシプ/ギフト/ドネーション/ジュエル）の**常時ティッカー用の蓄積**。
 * React/CSS/DOM 非依存の純関数（`viewerFormat.ts` と同じく、この module 単体でテストできる状態に保つ）。
 *
 * ## なぜ `comments` から導出しないのか（本 module が存在する理由）
 *
 * 表示用の `comments` は `MAX_COMMENTS = 200`（`mergeComments.ts`）でクランプされる。よって
 * `comments.filter(isMonetaryEvent)` でティッカーを作ると、**200 件のコメントが流れた時点でスパチャが帯から消える**。
 * 本機能の目的は「流れて消える一覧の中で投げ銭を見失わないための常時表示」なので、それは目的を直接壊す
 *（046a も同じ轍を踏み、固定したコメントが一覧から流れ去ると解除できなくなる不具合を実機で踏んでいる）。
 * そこで**課金コメントだけを別に蓄積する**。上限は `MONETARY_MAX` で、あふれたら**最古から**捨てる。
 *
 * ## 保存しない
 *
 * localStorage 等へは**永続化しない**（セッション内のみ）。①「前回配信で来た投げ銭の表示名・金額が、次の配信の
 * 起動時にユーザー操作ゼロで画面へ出る」経路を作らない（046b の S-1 で `savePinned([])` を明示したのと同じ方針・
 * docs/security.md §9 追補〔046a〕）②保存するデータの種類が変わると軽レビューでは済まなくなる（046 の教訓）。
 *
 * ## 配置（features/ ではなく screens/comment-viewer/ にある理由）
 *
 * 抽出条件 `isMonetaryEvent` が `./viewerFormat.ts`（screens/comment-viewer）にあり、features/ から screens/ を
 * import する前例がリポジトリに無いため。`viewerFormat.ts` 自身が「React 非依存の純ロジックが
 * screens/comment-viewer に置かれる」前例なので、そちらへ揃えた。`mergeComments`（features/）への依存は
 * screens → features＝通常の向きで問題ない。
 */

/**
 * ティッカーに保持する課金コメントの**目安**上限。超過分は古い方から捨てる（末尾＝最古）。
 *
 * 50 は「1 配信ぶんの投げ銭はだいたい収まり、かつピルが増えすぎて横スクロールが苦にならない」線。
 * 全期間の履歴・集計は 038（視聴者メモリ）の領分で、ここは**見逃し防止のための直近ウィンドウ**に徹する。
 *
 * ⚠ **047f 以降、これは「既読を含めた総数の目安」であって絶対上限ではない**。`isRead` を注入した場合、
 * **捨てるのは既読だけ**で未読はこの上限を超えて残る（下記 `mergeMonetary` の JSDoc）。絶対上限は
 * `MONETARY_HARD_MAX`。
 */
export const MONETARY_MAX = 50;

/**
 * 047f: **未読を含めた絶対上限**（メモリの防御値）。通常運用では到達しない。
 *
 * 未読を捨てない規則にすると、配信者がピルを一度も押さない場合だけ件数が単調増加しうる。そこを止めるための
 * 値で、TTS の `MAX_PRIORITY_BACKLOG`（049 フォローアップ・課金を捨てない優先キューの防御上限）と
 * まったく同じ位置づけ＝**到達したら未読でも最古から捨てる**（そこまで来たら見逃し防止より資源が優先）。
 *
 * 500 の根拠: 1 配信で 500 件の投げ銭が来て、かつ**そのすべてを一度も押していない**状況＝運用として既に
 * 破綻しており、そこまで持てば十分という線。要素は DTO 参照 1 個ぶんで、実測が要る規模ではない。
 * 再調整トリガー＝実機で 500 に張り付くなら、上限を上げるのではなく「押させる導線」を疑うこと。
 */
export const MONETARY_HARD_MAX = 500;

/**
 * 受信バッチ（`comments.append` の incoming）から課金コメントだけを取り出して蓄積する。
 *
 * - `isMonetaryEvent` で絞る＝**通常 chat は入らない**（未知の種別も false で入らない）。
 * - **新着は先頭（＝ティッカーの左端）へ積む**。ティッカーは自動スクロールしない設計なので、最新が常に定位置に
 *   出る＝配信者がどこを見ていても新しい投げ銭が視界に入る（「過去を見ている最中に飛ばされる」も起きない）。
 * - 同一 id は**件数を増やさず中身だけ差し替える**。差し替え条件は `mergeComments` と**完全に同じ規則**:
 *   ① jewels 以外の同一 id 再送は「同じコメントの再配信」でしかないので完全にスキップ
 *   ② jewels は `hasComboPayloadChanged`（＝Rust が UPDATE する列と同じ比較キー）が真のときだけ差し替える。
 *   これが無いと 043e の combo 更新（同一 id で金額が伸びる）にティッカーが追随せず、**金額が古いまま固まる**。
 * - **変化が 1 つも無ければ `prev` をそのまま返す**（参照が変わらない＝無駄な再レンダを起こさない）。
 *   sidecar は chat を大量に流すため、この early-out が効く場面が支配的になる。
 *
 * 冪等（同じ incoming を 2 回渡しても結果が変わらない）なので、React StrictMode で updater が二重実行されても
 * 件数はぶれない（`mergeComments` と同じ論拠）。
 *
 * `mergeComments` が id→位置の Map を持つのに対し本関数が `findIndex` の線形探索なのは、
 * ①先頭 unshift で位置が毎回ずれるため Map の維持コストが釣り合わない ②`prev` が実運用では数十件で
 * incoming も 1 件ずつ届く、の 2 点による（200 件を捌く `mergeComments` とは規模が違う）。
 *
 * ## 047f（実機不具合）: 未読は上限で捨てない
 *
 * `isRead` を注入すると、上限超過で**捨てるのは既読だけ**になり、未読は `MONETARY_MAX` を超えて残る
 * （絶対上限は `MONETARY_HARD_MAX`）。**未注入なら従来と完全に同じ**（`ttsQueue` の getter 群と同じ作法で、
 * 既存の呼び出しとテストが壊れない）。
 *
 * **なぜ必要か**: 実機で「未読数が 50 件以上数えられない」と報告された。バッジの頭打ちは症状の一部で、
 * 本体は**未読のまま帯から消えた投げ銭は二度と押せない＝見逃す**こと。これは本 module の docstring が
 * `MAX_COMMENTS`(=200) について「機能の目的を直接壊す」と警告しているのと**同じ壊れ方**で、
 * 200 件クランプを避けるために作ったモジュールが自前の 50 件クランプで同じ穴を開けていた。
 *
 * 直し方は 049 フォローアップの TTS 優先キュー（**課金は捨てず先に読む**）と同じ判断軸:
 * 未読＝「まだ見ていない投げ銭」＝この機能の存在理由そのものなので捨てない。既読＝「もう見た」＝参考情報
 * なので捨てる。結果、**「未読数 ＝ 押せるピルの数」が常に一致する**（押せない未読が生まれない）。
 * 通常運用では押すたび既読化されるので総数は 50 前後へ収束する。
 */
export function mergeMonetary(
  prev: CommentViewDto[],
  incoming: CommentViewDto[],
  isRead?: (id: string) => boolean,
): CommentViewDto[] {
  // 変化があったときだけ新しい配列を作る（null のうちは prev を読む＝参照据え置きの early-out を成立させる）。
  let next: CommentViewDto[] | null = null;
  const current = () => next ?? prev;

  for (const c of incoming) {
    if (!isMonetaryEvent(c.eventType)) continue;

    const at = current().findIndex((p) => p.id === c.id);
    if (at === -1) {
      // 新規 id: 先頭（＝最新が左）へ積む。
      next = [c, ...current()];
      continue;
    }
    // ---- 同一 id の「更新」経路（mergeComments の 043e 分岐と同じ規則）----
    //
    // 【レビュー Q-1/申し送り5・共有の粒度／修正不要】比較キー（`hasComboPayloadChanged`）は
    // `mergeComments` から export して共有しているが、**「jewels だけが更新対象」というポリシー自体は
    // ここに複製されている**。将来 jewels 以外にも combo 更新型のイベントが増えると `mergeComments` だけが
    // 直され、ティッカーは静かに追随しなくなる（テストでも落ちない種類の腐り方）。
    // それでも据え置くのは、述語ごと（`shouldReplaceSameId(prev, next)` 相当）寄せると **表示・TTS・保存の
    // 3 系統がぶら下がる単一注入点**へ追加の改変を入れることになり、今回の「export 1 行だけ」という
    // 最小差分の利点を失うため。代わりに下の 1 行を比較キーの共有で守っている。
    // 再修正トリガー＝**jewels 以外の eventType でも同一 id 更新を受けるようになったとき**（そのときは
    // `mergeComments.ts` に `shouldReplaceSameId` を新設し、この 2 行を 1 呼び出しへ畳んで単一の真実にする）。
    if (c.eventType !== "jewels") continue;
    if (!hasComboPayloadChanged(current()[at], c)) continue;
    const updated = [...current()];
    updated[at] = c;
    next = updated;
  }

  if (next === null) return prev;
  return clamp(next, isRead);
}

/**
 * 上限クランプ（先頭＝最新を残し、末尾＝最古から捨てる）。
 *
 * - `MONETARY_MAX` 以下なら何もしない（**この高速パスが支配的**＝通常運用では下の走査に入らない）。
 * - `isRead` 未注入なら従来どおり機械的に `MONETARY_MAX` で切る（後方互換）。
 * - `isRead` 注入時は**超過分を既読から古い順に落とす**。未読を落とす前に既読を使い切ったら、そこで止める
 *   ＝残る件数は `max(未読数, MONETARY_MAX)` になる。
 * - それでも `MONETARY_HARD_MAX` を超えたら、未読でも最古から機械的に落とす（資源の防御）。
 */
function clamp(
  list: CommentViewDto[],
  isRead?: (id: string) => boolean,
): CommentViewDto[] {
  if (list.length <= MONETARY_MAX) return list;
  if (!isRead) return list.slice(0, MONETARY_MAX);

  // 末尾（＝最古）から見て、既読なら超過分として捨てる。未読は飛ばして残す。
  let excess = list.length - MONETARY_MAX;
  const kept: CommentViewDto[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (excess > 0 && isRead(c.id)) {
      excess -= 1;
      continue;
    }
    kept.push(c);
  }
  kept.reverse(); // 走査が最古→最新だったので、先頭＝最新の並びへ戻す。
  return kept.length > MONETARY_HARD_MAX
    ? kept.slice(0, MONETARY_HARD_MAX)
    : kept;
}
