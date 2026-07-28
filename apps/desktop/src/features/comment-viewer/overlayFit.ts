/**
 * 046c: オーバーレイの「内容を窓に収める縮小率（スケール）」を求めるソルバ。
 *
 * 背景: 固定コメント専用オーバーレイ（`PinnedOverlayApp`）は窓の高さが固定で、`ol.list` が
 * `flex:1 + overflow-y:auto`・スクロールバーは overlay スコープで非表示・`followMode="off"` のため、
 * 窓より背の高いコメントは**黙って下側が切れる**（046b の E2E で 290 字の長文が約 57% で見切れた）。
 * 窓の既定高さを上げたうえで、それでも収まらないぶんは表示全体を縮小して**必ず全文を出す**。
 *
 * このモジュールは **DOM を一切知らない**（`useFollowScroll.ts` と違い ref も触らない）。呼び出し側が
 * 「スケールを適用してから測る」関数を渡し、ここは数値の探索だけを行う＝jsdom がレイアウトを持たなくても
 * 意味のある単体テストが書ける、という切り分けにしてある。
 */

/** 反復の上限。実測では 2〜3 回で収束するので、これは異常時の打ち切り。 */
export const MAX_FIT_ITERATIONS = 8;

/**
 * 「はみ出している」と見なす最小の超過量（px）。`100/k` の丸めで出るサブピクセル差で無駄に縮めないための許容。
 *
 * ⚠ **ここを「余白を取る」向き（`content <= available - N`）にしてはいけない**。`scrollHeight` は仕様上
 * **`clientHeight` を下限にクランプ**され、内容が収まっているときは `scrollHeight === clientHeight` になるため、
 * `content <= available - N`（N>0）は**絶対に真にならず、短いコメントでも必ず縮小されてしまう**
 * （046c の初回実装で実際にこの誤りを踏んだ）。収まり判定は `content - available <= 許容` の向きで書くこと。
 */
export const FIT_TOLERANCE_PX = 1;

/**
 * スケールの数値ガード。**UX 上の下限ではない**（依頼者の決定は「下限を設けず必ず全文を収める」）。
 * 呼び出し側が `width/height: ${100/k}%` を当てるため、k が 0 に近づくと巨大なレイアウトを組んでしまう。
 * それを防ぐためだけの値で、k=0.1 は 480px 窓ならレイアウト幅 4800px ＝ 約 24,000 字相当。
 * Twitch の 500 字 / YouTube の 200 字という本文上限に対して 40 倍以上の余裕があり、
 * 実運用でここに到達することはない（＝「下限なし」の方針と実質矛盾しない）。
 * 再修正トリガー＝コピペ等で 24,000 字を超える固定コメントが現実に出たら、この値を下げる。
 */
export const MIN_FIT_SCALE = 0.1;

/** 1 反復あたり必ず下げる最小幅。比率推定が効かない場合でも単調減少させ、停止を保証するための値。 */
export const FIT_STEP = 0.02;

/**
 * 測定結果。`content`＝内容の実高さ（`ol.scrollHeight`）、`available`＝収められる高さ（`ol.clientHeight`）。
 * いずれも**変換前**の CSS px。
 *
 * **`content >= available` が常に成り立つ**（`scrollHeight` は `clientHeight` で下限クランプされる）。
 * 収まっているかどうかは「`content` が `available` を**超えているか**」でしか分からず、
 * 収まっている場合に「どれだけ余っているか」は取得できない。この非対称が判定式の形を決めている。
 */
export interface FitMeasurement {
  content: number;
  available: number;
}

/**
 * スケールを 0.02 刻みに丸める（切り捨て＝安全側）。`100/k` の浮動小数ノイズを消して再ラスタ回数を抑え、
 * テストの期待値も安定させる。
 */
export function quantizeScale(scale: number): number {
  return Math.floor(scale * 50) / 50;
}

/**
 * 内容が収まる最大のスケールを返す。
 *
 * **契約**: `measure(k)` は「k を DOM へ適用してから測る」こと。この関数が return した時点で、
 * **DOM には返り値のスケールが適用済み**になる（呼び出し側が別途適用し直す必要はない＝React state と
 * DOM の二重管理を作らないための設計）。実装上は「最後に `measure` へ渡した値」を `applied` に持ち回って
 * それを返すことで、**全経路（収束・下限クランプ・反復打ち切り）で契約を満たす**。
 * ⚠ `scale` をそのまま返してはいけない: ループ末尾で `scale = next` を先に代入するため、反復を使い切った
 * 経路では `scale` が「まだ measure へ渡していない次の候補」になり、返り値と DOM が 1 段ズレる。
 *
 * **収束の根拠**: 呼び出し側は `transform: scale()` ＋ `width/height: ${100/k}%` で縮小する。
 * transform はレイアウトに影響しないので **CSS のフォントサイズは変わらない**。k を下げると
 * レイアウト幅 `W/k` が広がって行数は単調非増加、収容量 `available = H/k` は厳密単調増加。
 * よって `content/available` は k について厳密単調で、k→0 では本文が 1 行に収まる。
 * ＝**下限を設けなくても必ず収まる**（`MIN_FIT_SCALE` は上記のとおり別目的のガード）。
 *
 * 比率推定に `sqrt` を使うのは、高さが概ね `A·k + B`（A=本文・B=固定クローム）で `content/available`
 * が k の二次形になるため。ただし固定クローム B が支配的なときは sqrt が過大評価になり 1 発では決まらないので、
 * `k - FIT_STEP` との `min` を取って**毎回必ず 1 段は下げる**。これで measure が非単調・敵対的でも停止する。
 */
export function fitScale(measure: (scale: number) => FitMeasurement): number {
  let scale = 1;
  // 最後に measure へ渡した値＝現在 DOM に当たっている値。**必ず `apply` 経由で measure を呼び、
  // 返り値は常に `applied`** にすることで、どの経路（収束・下限クランプ・反復打ち切り）でも
  // 「返り値＝DOM に適用済み」の契約が構造的に破れないようにする（上記 JSDoc の ⚠）。
  let applied = 1;
  const apply = (k: number): FitMeasurement => {
    applied = k;
    return measure(k);
  };

  for (let i = 0; i < MAX_FIT_ITERATIONS; i++) {
    const { content, available } = apply(scale);

    // 測れない環境（jsdom はレイアウトを持たず常に 0／窓が非表示）では縮小しない。
    // 契約どおり DOM を等倍へ戻してから返す。
    if (!(available > 0)) {
      if (applied !== 1) apply(1);
      return applied;
    }

    // 収まった（`content === available` ＝ はみ出しゼロ。上の FIT_TOLERANCE_PX の注記も参照）。
    if (content - available <= FIT_TOLERANCE_PX) return applied;

    const estimated = scale * Math.sqrt(available / content);
    const next = quantizeScale(Math.min(estimated, scale - FIT_STEP));

    if (next <= MIN_FIT_SCALE) {
      apply(MIN_FIT_SCALE);
      return applied;
    }
    scale = next;
  }

  // 上限まで回っても収まらなかった場合は、**最後に measure へ渡した値**を返す。
  // ⚠ ここで `scale` を返すと、ループ末尾の `scale = next` のぶんだけ返り値が DOM より 1 段小さくなり契約が破れる
  //（`FIT_TOLERANCE_PX` を一定量だけ超え続ける measure＝分割不能な要素があるケースで実際に到達する）。
  return applied;
}
