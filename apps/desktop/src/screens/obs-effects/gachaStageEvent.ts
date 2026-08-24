import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  STAGE_OVERLAY_WINDOW_LABEL,
  type GachaPrizeOutput,
} from "./effectAssignments";

/**
 * ⚠⚠⚠ **063c 段 2-a: 当選結果をコメビュ窓 → ステージ窓へ 1 方向で伝える 1 か所。**
 *
 * ## ⚠⚠⚠ なぜ「伝える」のか（**二重抽選を構造的に不可能にする**）
 *
 * 絶対にやってはいけないのは **ステージ窓が自分でもう一度引くこと**である——
 * `Math.random()` が 2 回独立に走るので、**演出は A が当たったと言っているのに OBS は B を鳴らす**。
 * ⚠ しかも**その食い違いは実機でしか観測できない**（どちらの窓も単体では正しく見える）。
 * ⇒ **抽選は `effectFire.ts` の `decideFireResults` ただ 1 か所**（[`drawGachaPrizeIndex`] の
 * プロダクション呼び出しは**2 か所のまま**）で、ここは**その結果を運ぶだけ**である。
 * ⚠⚠ **このモジュールに `random` を持ち込まないこと。**
 *
 * ## ⚠⚠ 伝達路に Tauri の窓間イベントを選んだ理由（3 案の比較・063c (2)）
 *
 * | 案 | 判断 |
 * |---|---|
 * | **(a) `emitTo` → `listen`** | ✅ **採用。** 永続しない／他窓に撒かない／⚠⚠ **未認証の loopback WS からは到達できない**／**capability 追加ゼロ**（`core:default` ⊃ `core:event:default`） |
 * | (b) localStorage ＋ `storage` | ⚠ **永続する**ので「窓を開き直したら古い当たりが出る」を自前で塞ぐ必要がある。⚠ `storage` は**全窓へ撒く**（コメント窓・固定窓も受け取って捨てる） |
 * | (c) sidecar の WS でブロードキャスト | ❌ ⚠⚠⚠ **却下。** loopback WS は**未認証**なので、**ブラウザで開いた任意のページが「大当たり！」を配信画面に出せる**。塞ぐには 4 本目のチケットが要り、割に合わない |
 *
 * ⚠⚠⚠ **(c) を却下したこの理由が、本モジュールの存在理由そのものである**——
 * 窓間イベントは **Tauri の IPC の中**にあり、**sidecar からも外部からも emit できない**。
 * ⚠ **将来ここを WS 経由へ「性能のために」移さないこと**（移した瞬間に上の穴が開く）。
 *
 * ## ⚠⚠ `@tauri-apps/api/event` を値として import する 2 本目のファイルである
 *
 * 055d 以来この規律は「**`appUpdateApi.ts` だけ**」だったが、
 * ⚠⚠⚠ **063c 段 2-a でここが 2 本目になった**（あちらの JSDoc も同時に直してある）。
 * ⚠ **3 本目を作らないこと**——窓間イベントの入口はこの 1 本に閉じる。
 * 理由は 055d と同じで、**購読の入口が散ると「誰がどの窓に何を撒いているか」が追えなくなる**。
 *
 * ## §9（⚠⚠⚠ **063c 段 3 で線が動いた**——必ず `docs/security.md` の追補を読むこと）
 *
 * ⚠⚠ **段 2-a まで**: ペイロードに載るのは**ユーザー自身が入力した文字列だけ**だった
 * （景品名／自分が OBS で付けたソース名）。
 * ⚠⚠⚠ **段 3 から**: **引いた視聴者の表示名 1 本だけ**が載る（[`GachaStageResult.viewerName`]）。
 * 依頼者の要望「**どのユーザーのガチャなのかが分かるようにしたい**」に、名前以外で答える方法が無いため。
 *
 * ⚠⚠⚠ **載せてよいのは表示名だけである。**
 * **コメント本文・視聴者 id・金額・アバターを足さないこと**——足すと
 * **OBS のキャプチャ経由で視聴者にそのまま読める**（この窓は配信画面に出る面である）。
 * ⚠ **表示名の長さを切るのは [`GACHA_VIEWER_NAME_MAX`] 1 か所**（`effectFire.ts` の `stageViewerName`）。
 * ⚠⚠ **抽選履歴・当選者は相変わらずどこにも保存しない**
 * （このモジュールは localStorage を読み書きしない／`EffectOverlayApp` のキューは**メモリだけ**で、
 * 窓を閉じれば消える＝ 046a の固定コメントのように**端末に残らない**）。
 */

/**
 * イベント名。⚠ Tauri の制約で **英数字と `-` `/` `:` `_` しか使えない**。
 *
 * ⚠ 接頭辞を付けているのは、`tauri://` の組み込みイベントや将来の別イベントと衝突させないため。
 */
export const GACHA_STAGE_RESULT_EVENT = "stream-dock:gacha-stage-result";

/**
 * 063c 段 2-a: ステージ窓へ渡す**当選 1 件**。
 * ⚠⚠ **これ以上のフィールドを足さないこと**（§9・上の注記）。
 * ⚠ 作る側は `effectFire.ts` の [`GachaFireDetail`] で、**あちらと形を揃えてある**
 * （⚠⚠ ただし**型としては別物のまま**にしてある——あちらは発火層の値で、
 * こちらは**窓の境界を越える値**＝ [`parseGachaStageResult`] を必ず通る側だから）。
 */
export interface GachaStageResult {
  /**
   * 当選景品の表示名。⚠ **決めるのは [`gachaPrizeLabel`] 1 か所**（ここで組み立て直さない）。
   * ⚠⚠ **空文字は来ない**（無名の景品は `GACHA_UNNAMED_PRIZE_LABEL` になる）。
   */
  prizeLabel: string;
  /**
   * その景品の出力先。⚠ **演出側が「組み込み」と「OBS のソース」を出し分けるために要る**——
   * ⚠⚠ とくに **`obs-source` なのに OBS にそのソースが無い**とき、
   * 演出だけが当たりを宣言する（063c レビュー Q-12 追記 2）ので、
   * **ステージ窓側でも「そのソースは OBS に見つかりません」を出せる**ようにしてある。
   */
  output: GachaPrizeOutput;
  /**
   * ⚠⚠⚠ **063c 段 3: 引いた視聴者の表示名**（`null` ＝ 出さない）。
   *
   * ⚠⚠⚠ **これがこのペイロードで唯一の第三者データである**（`docs/security.md` §9 追補が正）。
   * ⚠ **本文・視聴者 id・金額・アバターを足さないこと**——足す場所を作らないことが線そのもの。
   * ⚠⚠ 長さは送る側（`stageViewerName`）が切る。**ここで 2 通り目の規則を書かない**（§8）。
   */
  viewerName: string | null;
  /**
   * ⚠⚠ **その景品の確率が低い（[`GACHA_RARE_MAX_PERCENT`] 未満）か**＝演出に「レア！」を出すか。
   * ⚠⚠⚠ **ここに確率そのものを載せないこと**——載せると
   * **「当たりやすさ」が配信画面へ出せる形になる**（063 が出さないと決めているのは実測の相対確率だが、
   * 設定値であっても**演出に出す必然性が無い**）。⇒ **真偽 1 ビットだけ運ぶ。**
   */
  rare: boolean;
}

/**
 * 当選結果を**ステージ窓だけ**へ送る。⚠ **投げっぱなし**（`await` しても意味が無い）。
 *
 * ⚠⚠⚠ **本線（OBS を鳴らすこと）を絶対に止めないこと。** ステージ窓が閉じている・
 * Tauri の IPC が失敗した・そもそもブラウザで動かしている（テスト）——どれでも
 * **`requestObsSourceFire` は通常どおり実行されなければならない**（063c の完了条件）。
 * ⇒ ここは `void` を返す（`Promise` を呼び出し側へ返さない＝ **`await` を書けなくする**）。
 *
 * ## ⚠⚠ `.catch()` が何を防いでいるか（**同期例外の防止ではない**）
 *
 * ⚠ `emitTo` は非同期なので**そもそも同期例外を投げない**——
 * したがって `.catch()` を外しても**本線は止まらない**（呼び出し側のループは回り続ける）。
 * ⚠ **ここは正直に書いておく**（「本線を守るための catch」と読むと、外しても害が無いと誤解される）。
 * `.catch()` が実際に防いでいるのは **未処理の rejection** で、害は 2 つある:
 *   1. ⚠⚠ **§9**: 将来グローバルの `unhandledrejection` をログや画面に繋いだとき、
 *      **拒否理由に宛先やペイロードが載りうる**（＝景品名が意図しない経路へ出る）。
 *   2. 開発中のノイズになり、**本当の異常が埋もれる**。
 * ⚠ ログには出さない（§9・`eslint.config.js` の `no-console` が `src/screens/obs-effects/**` に効いている）。
 *
 * ⚠⚠ **ステージ窓が閉じているときは黙って捨てられる**のが正しい挙動である
 * （`emitTo` は宛先が存在しなくても例外を投げない）。「開いていなければ開く」を**ここに書かないこと**——
 * それは「**視聴者のコメントが窓を開き、OBS へ接続する**」＝ `docs/security.md` §1 の
 * 044a 例外の対極であり、063c 段 1 が **(iii) として明示的に却下した形**である。
 */
export function emitGachaStageResult(result: GachaStageResult): void {
  void emitTo(
    STAGE_OVERLAY_WINDOW_LABEL,
    GACHA_STAGE_RESULT_EVENT,
    result,
  ).catch(() => {
    // ⚠ 何もしない（上の JSDoc が理由）。
  });
}

/**
 * ステージ窓側で当選結果を購読する。⚠ **呼んでよいのは `EffectOverlayApp` だけ。**
 *
 * ⚠⚠ **受け取った値は必ず [`parseGachaStageResult`] を通してから渡す**（下記）。
 *
 * ## ⚠⚠ `listen` は「どの窓が送ったか」を見ない（063c 段 5 レビュー S-3・受容）
 *
 * `@tauri-apps/api` の `listen()` は **`EventTarget::Any`** で登録されるので、
 * ⚠ この購読は **`CommentViewerApp` 以外の窓が同じイベント名で emit しても受け取る**
 * （`appUpdateApi.ts` が「既定の `listen()` は tauri 側のフィルタを素通りする＝絞れない」と
 * 書いているのと同じ性質である）。
 *
 * ⚠⚠ **今日これは穴ではない。** 送れるのは **Tauri の IPC を持つ窓＝アプリ同梱のコードだけ**で、
 * 6 窓のいずれもリモート/第三者の HTML を読み込まない。⚠⚠⚠ **`csp: null` の下でこの前提を
 * 支えているのは「そもそも外部のページを開かない」ことだけ**なので、上の表の (c)（sidecar の
 * 未認証 WS）を却下した理由は**依然として成立している**（あちらは外部から到達できる）。
 *
 * ⚠⚠⚠ **再評価トリガー＝どれかの webview がリモート/第三者由来の HTML を読み込む形になったとき。**
 * そのときは `csp` と一緒に見直し、必要なら送り手の窓を絞る形
 * （Rust 側で中継する／`EventTarget` を指定する）へ寄せること。
 * ⚠ **絞らないまま外部ページを開く窓を作らないこと**——開いた瞬間に
 * 「任意のページが『大当たり！』を配信画面に出せる」という (c) の穴がこちら側に生える。
 */
export function listenGachaStageResult(
  onResult: (result: GachaStageResult) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(GACHA_STAGE_RESULT_EVENT, (event) => {
    const result = parseGachaStageResult(event.payload);
    if (result !== null) onResult(result);
  });
}

/**
 * ペイロードの**形**を確かめる（⚠ 受け入れられなければ `null`＝**その 1 件を捨てる**）。
 *
 * ## ⚠⚠ ここが「2 通り目の検証」になっていない理由（§8）
 *
 * 063c は「**検証は `parseGachaPrize` / `parseGachaDefinition` が持ち、2 通り目を作らない**」を
 * 制約にしている。⚠ **ここが見るのは「形」だけ**——`kind` が既知か、`prizeLabel` が文字列か——であって、
 * **意味の規則（長さ・制御文字・ソース名の書式）を 1 つも再実装していない**。
 * ⚠⚠ **再実装しないことが要点である**: 意味の規則をここにも書くと、
 * `parseGachaPrize` を緩めたときに**こちらだけが厳しいまま残り、当たっているのに演出が出ない**が起きる。
 *
 * ⚠ **では何のために在るのか**＝ **描画を落とさないため**である。
 * 型注釈は実行時に何も保証しないので、`undefined` が来た瞬間に
 * `result.prizeLabel` で throw し、**透過窓が真っ白になって OBS に映る**。
 * ⚠⚠ **未知の `kind` は捨てる**（`{kind:"builtin"}` へ倒さない——
 * 倒すと「将来の出力先が、古いビルドでは黙って組み込み演出になる」＝ [`parseGachaPrizeOutput`] と同じ判断）。
 */
function parseGachaStageResult(raw: unknown): GachaStageResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { prizeLabel, output, viewerName, rare } = raw as {
    prizeLabel?: unknown;
    output?: unknown;
    viewerName?: unknown;
    rare?: unknown;
  };
  if (typeof prizeLabel !== "string" || prizeLabel.length === 0) return null;
  if (typeof output !== "object" || output === null) return null;
  // ⚠⚠⚠ **063c 段 3: 表示名とレアは「壊れていたら捨てる」ではなく「無かったことにする」。**
  //   ⚠ ここで `null` を返す（＝当選 1 件を丸ごと捨てる）と、
  //   **名前が空の視聴者が引いたときに演出が出ない**＝当たったのに何も起きない、になる。
  //   ⇒ **当選そのものは必ず出し、付加情報だけを落とす。**
  const name =
    typeof viewerName === "string" && viewerName.length > 0 ? viewerName : null;
  // ⚠⚠ **`=== true` で見る**（`Boolean(rare)` にしない）。緩めると `"false"` や `1` が
  //   レア扱いになり、**普通の景品に「レア！」が出る**＝視聴者に対する嘘になる。
  //   ⚠ 倒す先は必ず `false`（＝古いビルドの payload はレアではない）。
  const isRare = rare === true;
  const kind = (output as { kind?: unknown }).kind;
  if (kind === "builtin") {
    return {
      prizeLabel,
      output: { kind: "builtin" },
      viewerName: name,
      rare: isRare,
    };
  }
  if (kind === "obs-source") {
    const sourceName = (output as { sourceName?: unknown }).sourceName;
    if (typeof sourceName !== "string" || sourceName.length === 0) return null;
    return {
      prizeLabel,
      output: { kind: "obs-source", sourceName },
      viewerName: name,
      rare: isRare,
    };
  }
  return null;
}
