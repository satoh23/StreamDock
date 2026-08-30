# 063h ガチャ抽選結果の記録（`gacha_draws`・⚠ **すべての抽選を残す**）

> 状態: **未着手**（2026-08-30 起票）。層＝ **Rust ＋ frontend**。
> ⚠⚠⚠ **`security-review` 必須**（端末内保存ポリシーの変更＝`docs/security.md`
> 「レビュー必須条件」の**「取得コメント・視聴者情報の端末保存」に該当**する）。
>
> ✅ **着手条件は満たされた（2026-08-30）**——[063g](063g-gacha-prize-mail-spike.md) の結論が出た。
> ⚠⚠⚠ **答え＝`trigger_comment_id` は不要。列を 1 本も足さずに着手してよい**
> （下の「(2) テーブル」の `trigger_comment_id` の節が正）。
> ⚠⚠ **063g は「やらない」で完了した**（ガチャ景品の自動配布は実装しない）ので、
> 「引き金のコメントから宛先を引く」という**列の存在理由そのものが消えた**。
>
> | 実施順 | タスク | 状態 |
> |---|---|---|
> | 1 | [063g](063g-gacha-prize-mail-spike.md) ガチャ景品の自動配布 技術調査 | ✅ **完了＝やらない**（2026-08-30） |
> | **2** | **063h（本タスク）** ガチャ抽選結果の記録 | ⚠ **未着手**（⚠⚠ **着手可能**） |
> | 3 | [063i](063i-gacha-summary-view.md) 配信サマリーにガチャ結果を出す | ⚠ 未着手 |

## 目的

依頼者の要望（2026-08-30・原文）:

> その配信で行われたガチャについて、**誰がガチャを引いて誰が何を引いたのか**を配信サマリーで
> 確認できるようにしたい。

本タスクは **記録**まで（画面に出すのは [063i](063i-gacha-summary-view.md)）。

⚠⚠⚠ **記録するのは「当たり」だけではない。すべての抽選を残す**（依頼者の判断・2026-08-30）:

> ハズレも記録して欲しい。**そもそもハズレという概念がないため**全て記録するようにして欲しい。
> **ハズレ無しのガチャを作る配信者もいるはず**なので。

⇒ 画面にも DB にも「ハズレ」という語を持ち込まない。何も当たらなかった抽選は
**`prize_label = NULL`**（画面表記は既存の **「何も出ない」**）として、**1 回の抽選として等しく記録する**。

## ⚠⚠⚠ 本タスクは、既存の明文の決定を反転させる

いまのコードとドキュメントは「**保存しない**」と 3 か所で明言している。**全部直すのが本タスクの一部**である。

| 場所 | いまの記述 | 本タスク後 |
|---|---|---|
| [task-board.md:309](../task-board.md#L309) | ⚠ **抽選履歴・当選者・視聴者 id を永続化しない**（保存すると §9 追補〔046a〕の対象になり軽レビューでは済まなくなる） | ⚠ **反転する**（＝まさに軽レビューでは済まないので `security-review` を通す） |
| [effectFire.ts](../../apps/desktop/src/screens/obs-effects/effectFire.ts#L123) `EffectFireResult` の JSDoc | ⚠ **ここに「誰が引いたか」を足さないこと**（§9・抽選履歴と当選者を持たないという 063c の制約） | ⚠ **発火レーンについては維持**。記録レーンを**別に**作る（下の (1)） |
| [gachaDraw.ts](../../apps/desktop/src/screens/obs-effects/gachaDraw.ts) `gachaProbabilityText` の JSDoc | 「§9 で**抽選履歴も当選者も保存しない**ので、そもそも実測を集める場所が無い」 | ⚠ **前提が変わったことを追記する**（⚠⚠ ただし**実測の相対確率を画面に出すのは本タスクではやらない**——穴 D の決定は不変） |

## 現在の前提（⚠ 実コードで確認済み・2026-08-30）

### (a) 抽選は 1 か所・発火は 1 レーン

- 抽選の本体は [`drawGachaPrizeIndex`](../../apps/desktop/src/screens/obs-effects/gachaDraw.ts)（分母 **1000 固定**）。
  ⚠ **置き換えないこと**（テスト抽選と本番の確率が別実装になる）。
- 配信中の呼び出しは [`decideFireResults`](../../apps/desktop/src/screens/obs-effects/effectFire.ts#L269) の中の
  `drawGachaResult` **ただ 1 か所**で、戻り値は `EffectFireResult[]`。
- ⚠⚠⚠ **何も当たらなかった抽選は `null` になり、ここで消える**
  （`drawGachaResult`: `const index = drawGachaPrizeIndex(...); if (index < 0) return null;`）。
  ⇒ **いまの戻り値では「引いたが何も出なかった」を外へ出せない。**
- `EffectFireResult.gacha`（`GachaFireDetail`）は **`prizeLabel` / `viewerName` / `rare` の 3 つだけ**。
  視聴者 id・本文・金額・アバターは**型として載せる場所が無い**（§9 の線）。
- 表示名は [`stageViewerName`](../../apps/desktop/src/screens/obs-effects/effectFire.ts#L243) が
  **20 コードポイントで切って `…` を付ける**（演出とチャットのための整形であって検証ではない）。

### (b) 発火の現場に、記録に要るものが全部そろっている

[CommentViewerApp.tsx の発火ブロック](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L1580)は
`setComments` の updater の**外**にあり、`takeFreshComments(obsEffectSeenIdsRef.current, incoming)` で
**同じコメントを二度発火させない**ようになっている。同じコンポーネントに:

- `sessionIdRef`（062b・**未確定なら `null`**）
- 元のコメント（`freshForObs` の各要素＝`CommentViewDto`＝**視聴者 id と表示名を持っている**）

がある。⇒ **記録を挿す場所はここ 1 か所でよい**（新しい配線を発明しない）。

### (c) 記録の先例（062b / 038a）

- コメントの記録は `recordOrBufferComments(added, true)`
  （[CommentViewerApp.tsx:1372](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L1372)）。
  **session id が未確定なら貯めて、確定後に流す**（[pendingRecords.ts](../../apps/desktop/src/features/stream-session/pendingRecords.ts)）。
  ⚠ 貯めないと「**画面に出たのに DB に無い**」が静かに起きる（062b が最も避けた失敗）。
- Rust 側は `INSERT OR IGNORE` で冪等・集計は毎回再計算。**単一 `Mutex<Connection>` で直列化**。
- ⚠⚠⚠ **038c の「初見／久しぶり」判定は、`viewers` 行が**その時点で**存在しないことで決まる**
  （[repository.rs:406](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L406) の `prior_last`）。
  ⇒ **`viewers` 行を先に作る経路を増やすと、初見バッジが点かなくなる**（穴 B の根拠）。

### (d) DB の流儀

- **マイグレーション基盤は無い**。各 `repository::init` が**冪等 DDL** を撃ち、列の後付けは `ensure_column`。
- `init` の呼び出しは [lib.rs:797-818](../../apps/desktop/src-tauri/src/lib.rs#L797) に並ぶ（⚠ **順序に意味がある**）。
- 検証ヘルパは `util.rs` の `now_rfc3339` / `reject_control_chars` / `require_non_empty`。
- ts-rs の binding 出力先は **`src/features/comment-viewer/bindings/`**
  （⚠ `check:bindings` は**ハードコードされた 6 ディレクトリしか見ない**ので、そこ以外へ出すと
  **生成漏れがあってもチェックが緑になる**）。

## このタスクでやること

### (1) ⚠⚠⚠ 発火層を **2 レーン**に割る（本タスクの中心）

```
decideFireResults(...) → { fires: EffectFireResult[], draws: GachaDrawOutcome[] }
                             ↑ 演出・チャット（既存のまま）  ↑ 記録専用（当たり ＋ 何も出ない）
```

- `fires` は **いまとまったく同じ中身**（当たりだけ・`GachaFireDetail` も無改変）。
  ⇒ ⚠⚠ **[063c](063c-gacha-presentation.md)（演出）と [063f](063f-gacha-chat-output.md)（チャット投稿）の
  コードは 1 バイトも変わらない**（呼び出し側の分割代入だけが変わる）。
- `draws` は**抽選が起きた回数ぶん**並ぶ。何も当たらなかった抽選は `prizeLabel: null`。
- 記録レーンにだけ **視聴者 id** を載せる。

```ts
/** 063h: 抽選 1 回の記録（⚠ 演出にもチャットにも渡さない）。 */
export interface GachaDrawOutcome {
  /** 引き金になったコメント id（＝記録 id の材料・穴 A）。 */
  commentId: string;
  /** ⚠ そのコメントの中で何回目の抽選か（0 始まり・穴 A）。 */
  nth: number;
  /** `provider:providerUserId`（⚠⚠ **記録レーンだけが持つ**）。 */
  viewerId: string;
  /** ⚠ **切っていない表示名**（`stageViewerName` の 20 文字 ＋ `…` は通さない・穴 D）。 */
  viewerName: string;
  gachaId: string;
  /** 抽選した時点のガチャ名（⚠ ユーザー自身の入力）。 */
  gachaName: string;
  /** ⚠⚠ **`null` ＝ 何も出なかった**（＝ 1 回の抽選として記録する）。 */
  prizeLabel: string | null;
  rare: boolean;
}
```

⚠⚠⚠ **却下した案 1: `EffectFireResult` に「何も出ない」の variant を足す。**
下流（[063c] の `emitGachaStageResult` と [063f] の `sendGachaChat`）が
**明示的に無視することでしか安全にならない**。⚠ **1 か所忘れると、何も当たっていないのに
演出が出てチャットに投稿される**——**視聴者に見えて、あとから消せない**（§1 の 066 節）。
⇒ **型として「発火ではないもの」を発火の配列に混ぜないこと。**

⚠⚠ **却下した案 2: 記録のために `CommentViewerApp` でもう一度抽選する。**
**確率が二重に引かれる**（当たった景品と記録が食い違う）。論外だが、
「発火レーンに視聴者 id が無いから」という理由で発想されうるので明記しておく。

⚠ **却下した案 3: `decideEffects`（`effectAssignments.ts`）の戻り値を広げる。**
あそこは **061b 段 1-b が「戻り値にコメント由来の値を 1 つも載せない」を実装している唯一の場所**で、
広げると §9 の線が**発火層まで後退する**（`effectFire.ts` の既存 JSDoc が正）。
⇒ **線は 063c と同じく `decideFireResults` に留める。**

### (2) `gacha_draws` テーブル（新規モジュール `gacha_history`）

```sql
CREATE TABLE IF NOT EXISTS gacha_draws (
    id           TEXT PRIMARY KEY,   -- 決定的な文字列（穴 A）
    session_id   TEXT NOT NULL,      -- ⚠ stream_sessions への FK は張らない（既存の流儀）
    viewer_id    TEXT NOT NULL,      -- provider:providerUserId（⚠⚠ FK は張らない・穴 B）
    viewer_name  TEXT NOT NULL,      -- 抽選した時点の表示名（空文字を許す）
    gacha_id     TEXT NOT NULL,
    gacha_name   TEXT NOT NULL,
    prize_label  TEXT,               -- ⚠⚠ NULL ＝ 何も出なかった
    rare         INTEGER NOT NULL DEFAULT 0,
    drawn_at     TEXT NOT NULL,      -- RFC3339
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gacha_draws_session ON gacha_draws(session_id);
CREATE INDEX IF NOT EXISTS idx_gacha_draws_viewer  ON gacha_draws(viewer_id);
```

- ⚠ **`prize_label` に「何も出ない」という文字列を入れない。** 入れると
  「そういう名前の景品」と区別できなくなる（**ユーザーは景品名を自由に付けられる**）。
- **`viewer_name` を持つ理由**: ①063i が **JOIN 無しで**一覧を出せる
  ②`viewers.name` は**今の名前**なので、後で改名されると「その配信で誰が引いたか」がずれる。
- **`gacha_name` を持つ理由**: ガチャは後から改名・削除される（[063d](063d-gacha-library.md) のライブラリ）。
  ⚠ **記録は当時の名前で残す**（`gacha_id` だけだと、消したガチャの履歴が読めなくなる）。
- ⚠⚠⚠ **`trigger_comment_id` 列は入れない（2026-08-30・[063g](063g-gacha-prize-mail-spike.md) で確定）。**
  063g は「**ガチャ景品の自動配布はやらない**」で完了したので、
  「引き金のコメントから宛先を引く」という**この列の存在理由そのものが消えた**。
  ⚠⚠ **仮に将来 063g の再開トリガーを引いても、この列は要らない**——
  063g が唯一残した再開の入口（Twitch のウィスパー）は宛先が **Twitch のユーザー id** であり、
  それは **`viewer_id`（`provider:providerUserId`）に既に入っている**からである。
  ⚠ **`id` から切り出して代用しないこと**（id の形は実装都合で、パースし始めると形を変えられなくなる）。
- ⚠⚠ **「送信済みフラグ」の類も、いま足さない。** ⚠ 配布機能をやらないので使い道が無く、
  **使わない列は §9 の説明を難しくする**（「たぶん要る」で予備の列を足さない）。
  必要になったら `ensure_column` で後付けできる（062a の `raid_viewer_count` の前例）。
  ⚠ **後付けのコストは増えない**——配布機能そのものが `security-review` 必須なので、
  §9 の追補はそのとき必ず書くことになるため。

### (3) コマンド（§3 最小権限）

- `record_gacha_draw(db, draw: NewGachaDraw) -> AppResult<()>` の **1 本だけ**。
- ⚠⚠ **削除・更新・一括操作のコマンドを作らない**（削除は既存の `delete_viewer` / `clear_viewers` に相乗り＝(4)）。
  アプリ定義コマンドは **ACL を通らず全窓から呼べる**ので、能力を構造側に持たせない（062b の §3 の議論と同じ）。
- 一覧を返すコマンドは **[063i](063i-gacha-summary-view.md) の仕事**（本タスクでは作らない）。
- §8 の検証は **Rust 側で**（frontend の生値を信用しない）:
  - `id` / `session_id` / `viewer_id` / `gacha_id` … `require_non_empty` ＋ `reject_control_chars`
  - `viewer_name` / `gacha_name` / `prize_label` … trim ＋ `reject_control_chars` ＋ **文字数上限**
    （⚠ `chars().count()`。**バイト数ではない**＝062b の穴 I）
  - ⚠ **`prize_label` は「空文字」と `NULL` を区別する**（空文字は trim の結果ありうるので `NULL` へ倒す）
- ログ: 失敗時のみ `log_command_err`（**固定安全文言**）。⚠ **景品名・表示名・件数を出さない**（§9）。

### (4) 削除連動（⚠⚠ FK ではなく**明示 DELETE**）

`viewer_memory::service::delete`（`delete_viewer`）と `clear`（`clear_viewers`）から
`gacha_history::repository::delete_by_viewer` / `delete_all` を呼ぶ。

⚠⚠⚠ **FK CASCADE を張らない理由は 2 つあり、どちらも実コードで確認済み**（穴 B）:

1. **記録の順序が保証できない。** コメントの記録（＝`viewers` 行を作る側）は
   **fire-and-forget** で、`session_id` 未確定なら**バッファに貯まる**。
   ⇒ 抽選の記録が先に走ると **FK 違反で INSERT が落ち、しかも握り潰される**
   ＝「**画面で当たったのに履歴に無い**」が静かに起きる。
2. ⚠⚠ **抽選側で `viewers` 行を先に作ると、038c の初見バッジが点かなくなる**
   （判定は `viewers` 行の**不在**で決まる。上の前提 (c)）。
   ⇒ 「FK を通すために親を作る」という回避策そのものが**別機能の回帰**になる。

⚠ **代わりに必ずやること**: 削除の取り残しゼロを**テストで固定する**
（`delete_viewer` → その視聴者の `gacha_draws` が 0 行 ／ `clear_viewers` → 全件 0 行）。
⚠⚠ **§9 の追補にも「CASCADE ではなく明示 DELETE である」と書く**
（次に一括削除・エクスポートを作る人が、FK に頼って取り残す）。

### (5) frontend の配線

- 発火ブロックで `draws` を回して記録を投げる。⚠ **本線（OBS・演出・チャット）より後に置く**
  （063c / 063f が「順序に意味がある」と書いている規律の 3 段目）。
- ⚠ **`await` しない**（記録の失敗で演出を止めない＝ best-effort。`recordComments` と同じ）。
- **session id 未確定のときは貯めて、確定後に流す**（穴 C）。
  ⚠⚠ **`pendingRecords.ts` を汎用化しない**——あれは 062b の担保（上限・捨てた件数の可視化）を
  持っている現役のコードで、型を広げると**コメント記録側の回帰リスク**を作る。
  ⇒ **同じ構え（上限つき・捨てたら黙らせない）の小さな専用バッファ**を新設する。

### (6) 「何も出ない」の表記の持ち主を 1 か所にする

いま `MISS_LABEL = "何も出ない"` は
[GachaPrizeTable.tsx:82](../../apps/desktop/src/screens/obs-effects/GachaPrizeTable.tsx#L82) の
**ファイル内ローカル定数**で、テスト抽選の表示にしか使われていない。
⇒ **063i がサマリーで同じ言葉を使う**ので、**共有できる場所へ出す**
（`gachaDraw.ts` が候補＝確率と抽選の規則の持ち主）。
⚠ 出すだけで、**文言も既存の使い方も変えない**（063a/063c の表示に差分を出さないこと）。

### (7) `docs` の反転（⚠ 実装と同じ重さの作業）

1. `docs/security.md` §9 に **「追補（063h・ガチャ抽選結果の端末内保存）」**を足す。
   ⚠⚠ **構成は 062b の追補に揃える**（保存するもの／保存しないもの／外部通信ゼロ／§8／§3／
   **削除手段（⚠ 明示 DELETE）**／ログ／既存 DB を壊さない／レビュー必須）。
   ⚠⚠⚠ **全文を提示して承認を得てから書き込む**（063f 段 3 と同じ運用）。
2. [task-board.md:309](../task-board.md#L309) の「永続化しない」を**訂正**（消さずに、いつ何で反転したかを残す）。
3. `effectFire.ts` / `gachaDraw.ts` の該当 JSDoc を訂正（上の表）。
4. 親 [063](063-gacha-effect.md) の状態行に 063g / 063h / 063i を足す。

### (8) テスト

- **frontend（vitest）**
  - 2 レーン: 何も当たらない抽選で **`fires` が空・`draws` が 1 件**／当たりで **両方 1 件**。
  - ⚠⚠⚠ **何も出なかったときに `emitGachaStageResult` も `sendGachaChat` も呼ばれない**
    （`CommentViewerApp` のテスト。**本タスク最大の回帰を直接押さえる**）。
  - ガチャではない発火（条件に OBS ソース直指定）で **`draws` が空**。
  - 記録 id が**同じ入力で同じ値**になる（穴 A）。
  - session 未確定 → 貯まる → 確定後に流れる（穴 C）。
- **Rust（cargo test）**
  - `init` が冪等。
  - 検証（空・制御文字・長さ上限・`prize_label` の空文字→NULL）。
  - `delete_viewer` / `clear_viewers` で `gacha_draws` が残らない（(4)）。
  - 同じ `id` の二重記録で行が増えない。

## このタスクでやらないこと

- **画面表示**（[063i](063i-gacha-summary-view.md)）。⚠ 本タスク完了時点では**どこにも出ない**。
- **期間集計（[062d](062d-stream-history-filter.md)）への合流**——⚠ 申し送りだけ書く。
- **景品の自動配布**——⚠⚠ [063g](063g-gacha-prize-mail-spike.md) が **「やらない」で完了**したので、
  **063j 以降は起票しない**。⇒ 当選者への受け渡しは **[063i](063i-gacha-summary-view.md) の一覧を見て
  配信者が手作業で行う**。⚠ **本タスクはその前提で閉じてよい**（配布のための列も配線も作らない）。
- **実測の相対確率の表示**（`gachaProbabilityText` の本採用）。⚠ 前提は変わるが、
  **穴 D の決定（丸めた％の和を画面に出さない）は不変**。
- **過去の配信への遡及**（記録は遡れない。⚠ 既存の配信のサマリーは**空になる**）。
- エクスポート／CSV。

## ⚠ 先に潰す穴

| 穴 | 中身 | 決め方 |
|---|---|---|
| **A** | **二重記録** | 記録 id を **`${commentId}:${gachaId}:${nth}`** という**決定的な文字列**にし、`INSERT OR IGNORE`。⚠ `nth` は**そのコメントの中で何回目の抽選か**（バッチ内の連番にすると、同じコメントが別のバッチで来たとき値が変わる）。⇒ StrictMode の二重実行でも再送でも増えず、**同じコメントで 2 つの条件が当たった**ケースは潰さない |
| **B** | **FK と初見バッジ** | 上の (4)。⚠⚠ **FK を張らない**・明示 DELETE ＋テスト |
| **C** | **session 未確定** | 貯めて確定後に流す（上の (5)）。⚠ 捨てたら**黙らせない** |
| **D** | **表示名の長さ** | 記録は**切らない生値**。⚠ 20 文字＋`…` は**演出とチャットのための整形**であって、DB に持ち込むと「サマリーの名前だけ末尾が `…`」になる。上限（§8）は Rust 側が別に持つ |
| **E** | **配信していない時の抽選** | テスト抽選（`GachaPrizeTable`）は**記録しない**（`decideFireResults` を通らないので構造的に通らない）。⚠ **テストで固定すること** |
| **F** | **記録が増えすぎる** | キーワード条件を広く張ると毎コメント抽選が起きうる。⚠ **本タスクでは上限を設けない**（記録は 1 行が小さく、削除手段もある）。⇒ **063i 側で件数の多い配信の表示を決める**（申し送り） |
| **G** | **ガチャの改名・削除** | `gacha_name` を**当時の名前**で残す（上の (2)） |
| **H** | **`trigger_comment_id`** | ✅ **解決（2026-08-30）＝入れない。** [063g](063g-gacha-prize-mail-spike.md) が「やらない」で完了し、列の存在理由が消えた（上の (2)）。⚠ **送信済みフラグの類も足さない** |
| **I** | **dev-mock で記録が混ざる** | dev-mock のコメントでも普通に記録される。⚠ **これは既存のコメント記録とまったく同じ性質**（038a）なので**受容**し、追補にも書かない（新しい性質ではない） |

## セキュリティ制約（`docs/security.md` 準拠）

- **§1**: ⚠ **外部通信ゼロ**。新規 egress・宛先・スコープ・capability・依存は**すべて 0**。
  記録するのは**すでに受信済みの値**だけで、Tauri コマンド 1 本が増えるだけ。
- **§9**: ⚠⚠⚠ **端末内保存の限定解禁の 4 つ目**（038a〔SQLite〕・046a〔localStorage〕・062b〔セッション〕に続く）。
  - **保存するもの**: 視聴者 id・**抽選時点の表示名**・ガチャ名・景品名（**ユーザー自身の入力**）・レア判定・時刻。
  - ⚠⚠ **保存しないもの**: **コメント本文・投げ銭金額・アバター**（型として載せる場所を作らない）。
  - **端末外へ送らない・クラウド同期しない**。
  - **削除手段**: `delete_viewer` / `clear_viewers`（⚠ **CASCADE ではなく明示 DELETE**）。
  - **ログに出さない**（景品名・表示名・件数のいずれも）。
- **§8**: 検証は Rust 側（上の (3)）。SQL は**完全な文字列リテラルのみ**——
  ⚠ **`format!` で組み立てない**（062c が実コードで `grep format!` 0 件を担保にしている性質を、新モジュールでも保つ）。
- **§3**: コマンドは 1 本・引数は最小。⚠ **任意の行を消せる／書き換えられるコマンドを作らない。**
- **§10**: 新規依存ゼロ。

## 完了条件

1. 何も当たらなかった抽選が **DB に 1 行残り**、⚠⚠⚠ **演出もチャット投稿も起きない**。
2. 当たった抽選が **DB に 1 行残り**、演出とチャットは**従来どおり**動く（回帰なし）。
3. `delete_viewer` / `clear_viewers` で **`gacha_draws` に取り残しが 0 行**（テストで固定）。
4. session id が未確定の間の抽選が**捨てられない**（確定後に流れる）。
5. `docs/security.md` §9 に追補があり、⚠ **全文の承認を得てから**書き込まれている。
6. 反転させた 3 か所（task-board / `effectFire.ts` / `gachaDraw.ts`）が**訂正済み**。
7. **新規依存ゼロ・capability ゼロ・外部通信ゼロ**（差分で示せる）。
8. `docs/task-board.md` と親 [063](063-gacha-effect.md) が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/desktop check:bindings   # ⚠ 新規 binding は `git add -N` が要る（062b 申し送り 7）
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml

# ゼロ拡大の担保（差分ゼロが期待）
git diff --stat apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/capabilities
git diff --stat apps/desktop/src-tauri/Cargo.toml apps/desktop/package.json

# 実機（pnpm tauri dev ＋ dev-mock）
# ① 何も出ない抽選 → 演出が出ない・チャットに出ない・DB には行が増える
# ② 当たり → 演出とチャットは従来どおり・DB に行が増える
# ③ 視聴者を削除 → その人のガチャ履歴も消える
# ④ 既存 DB（実装前のデータ）で起動してもエラーが出ない
```

## 実装後に必要なレビュー

- ⚠⚠⚠ **`security-review` 必須**（保存ポリシーの変更）。⚠ **未実施のまま出荷しないこと。**
  見どころは ①§9 追補の内容 ②**削除の取り残し**（FK を張らない判断）
  ③**記録レーンに視聴者 id を載せたこと**が発火・演出・チャットへ漏れていないこと。
