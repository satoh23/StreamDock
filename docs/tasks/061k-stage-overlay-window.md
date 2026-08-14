# 061k 出力窓を用途別 2 本へ

> 状態: **未着手（2026-08-15 起票）**。⚠ **UX 再設計 061h〜061l の 4 本目。**
> base は **HEAD = `f9b6332 fix:キーワード条件の追加`**（061j はコミット済み）。
> 全体像・決定事項は [docs/task-board.md](../task-board.md) の
> 「061h〜061l OBSエフェクトの UX 再設計」節が正。⚠ **行番号は書かない**（特定はシンボル名で行う）。
>
> ⚠⚠ **061j の申し送りは出力されていない。** 本タスクファイルの「061j から引き継いだ前提」は、
> **`git show f9b6332` の差分と `docs/progress.md` の 061j 節を読んで再構成したもの**である
> （progress.md 側は判断・実測・実機確認まで揃っており、実質の申し送りとして機能する）。
> ⚠ 実装者は着手前に **`docs/progress.md` の 061j 節を通読すること**（本節は要約にすぎない）。
>
> ⚠⚠ **061l のタスクファイルはまだ書かない**（着手直前に書く）。

## ⚠⚠ この回は性格が違う——**security-review 必須**

061h / 061i / 061j は 3 本とも frontend 完結で、`docs/security.md` は差分ゼロだった。
**061k は違う。** `docs/security.md` 自身が名指しで再評価を要求している:

1. **§1「取得の停止条件」の末尾**
   > ⚠ **この導線を消す／`SIDECAR_CONSUMER_LABELS` に窓を足して sidecar をさらに延命する変更は、
   > 「ユーザーが知らないうちに外部通信が続く」を広げる方向なので本例外の再評価が必要**
   > （レビュー必須条件の「外部通信」）。

   ⇒ 判断 3 でまさにこれを行う。
2. **「レビュー必須条件」の「Tauri capabilities」** … `capabilities/stage-overlay.json` を新設する。
3. **「レビュー必須条件」の「process停止処理」の下位条件**
   > ⚠ **コメント取得 sidecar の停止条件**（どの窓が生きている間は落とさないか・…）を変える変更も本項に該当する。
   > **§6 の下位条件に当てはまらないことを理由に自分を免除しないこと。**

⚠⚠ **058a / 059a / 046a が 3 度踏んだ「下位条件の当てはめで自分を免除する」誤りを繰り返さないこと。**

## 061j から引き継いだ前提（⚠ 差分と progress.md から再構成）

- ✅ **コミット済み**（`f9b6332`）。ワーキングツリーはクリーン。**67 files / 1625 tests 緑**
- ✅ 保存形は**条件の配列** `EffectCondition[] = { id, when, effect }[]`
  - `when` … `{type:"event"; eventType}` ／ `{type:"keyword"; text; match:"contains"|"exact"}`
  - `id` … `event:<eventType>`（6 個固定）／ `kw:<単調増加の連番>`
  - ⚠ **イベント条件は `parseConditions` が読み込み時に必ず 6 件ちょうどへ作り直す**
    （`MONETARY_EVENT_TYPES` の挿入順・重複は先勝ち・欠けは `none`・未知 eventType は捨てる）
- ✅ **課金ゲート（`isMonetaryEvent`）は matcher 側にある**。`effectTrigger.ts` から import は消えた
- ✅ `resolveEffectMatch(input: {eventType, text}) → {effect, conditionId, cooldownMs} | null`
  - ⚠ **走査順＝イベント条件 → キーワード条件。最初に当たった 1 件だけ**
  - ⚠ `effect.kind === "none"` の条件は**スキップ**（当たった扱いにしない）
- ✅ `EffectTriggerState.lastConditionAt` ＋ `CONDITION_COOLDOWN_MAX_MS = 60_000`（掃除の上限）
- ✅ **`EffectRequest` は 8 キーのまま無改変**（第三者の本文が発火層より先へ進まない担保）
- ✅ 語彙の線＝**「条件＝いつ出すか」／「割り当て＝何を出すか」**
  （`EffectCondition(s)` / `loadEffectConditions` … は「条件」語彙、`EffectAssignment` は据え置き）
- ✅ `effectSelectValue.ts`（新規・`<select>` の値の組み立て）— 061h 申し送り ⑦-c は**返済済み**
- ⚠ **`effectAssignments.ts` の `EffectConditionWhen` の JSDoc に予約席がある**:
  「⚠ **061k の「出力先（全画面 / コーナー）」を先回りで足さないこと**（あちらの着手時に足す）」
  ⇒ **本タスクがその「あちら」である**（⚠ ただし置き場所は `when` ではない＝判断 4）

**⚠⚠ 061j が残した、061k で発火する再修正トリガー**

| 出所 | トリガー |
|---|---|
| **061i 申し送り §9** | 差分ゼロだったせいで直せなかった残骸 JSDoc 4 件 …「**次にあの 4 本を触るとき、ついでに直す**」⇒ **本タスクで 4 本とも触る**（判断 7） |
| **061i レビュー S-2** | `EFFECT_OVERLAY_ENABLED_KEY` の持ち方 …「**再修正トリガー＝061k で出力窓が 2 本になるとき**」⇒ 判断 6 |
| **061i レビュー S-2（§1）** | 「**061k で `SIDECAR_CONSUMER_LABELS` を触る＝条文側の変更になる**」⇒ 判断 3・12 |
| **061j 判断 6 / 穴 ζ** | matcher を factory（`createEffectMatcher()`）へ寄せる …⚠ **理由は別だが形は同じ**（判断 5） |
| **061h レビュー Q-4** | `.templateRow > button` の nowrap …「**再修正トリガー＝ボタンが 4 個以上になるとき**」⇒ 判断 8 で**踏まない**方を選ぶ |
| **061e レビュー Q-5** | `obsState` が種別共有 …⚠ 061k で **3 種別 → 4 種別**になる（受容の範囲が広がる・判断 10） |

## この段で解く問題

**出力窓が 1 本しかない。** `open_effect_overlay_window` は **960×360 固定**で、`anchor` は
*その箱の中*の 9 分割（`EffectTemplateView` の `ANCHOR_CLASS`）。OBS ソースが 1 つなので
**「全画面に出す演出」と「右下に小さく出す投げ銭」を同時に成立させられない**。
これが依頼者の言う「画面がぐちゃぐちゃ」の直接原因である。

⇒ **用途別に固定 2 窓**（コーナー用＝既存／全画面用＝新設）。
⚠ **動的 N 窓は不可能**（Tauri v2 の capability は静的 JSON で `windows: ["label"]` が固定配列）。

---

## ⚠⚠ 着手前に必ず知っておく制約（すべて実コードで確認済み・2026-08-15）

### 制約 1: ⚠⚠ **既存の窓タイトル "StreamDock エフェクト" は 1 バイトも変えない**

`lib.rs` の `.title(...)` と sidecar の `OBS_OVERLAYS[kind].windowTitle` は**バイト一致**が要件。
壊れたときの失敗モードが最悪で、`ensureOverlaySource` の **M2 フォールバックが
「既存ソース＋窓名不一致」を `"reused"`＝成功として返す**——**UI は成功表示・OBS のソースは真っ黒**、
という切り分け困難な壊れ方になる（046d が名指しした最悪ケース）。

### 制約 2: ⚠⚠ **4 つの窓名が互いに部分文字列であってはいけない**

sidecar の候補一致は `includes`。⇒ **"StreamDock エフェクト（全画面）" は不可**（既存を含む）。
⚠ **実測済み**（2026-08-15）:

| 候補 | 既存 3 つとの相互包含 |
|---|---|
| `StreamDock ステージ演出` | **衝突なし ✅** |

⚠ `lib.rs` の `#[cfg(test)] mod overlay_window_contract` が **`OVERLAY_TITLES` を回す総当たりループ**で固定しており、
**足すのは配列の 1 行だけ**で 4 テストすべてが自動追随する（061a が意図してそう作った）。

### 制約 3: ⚠ 契約テストは「窓を足す」ことを既に想定している（ほぼ自動追随する）

| テスト | 窓を足したときの挙動 |
|---|---|
| `titles_do_not_contain_each_other` | ✅ 自動（総当たり） |
| `titles_are_used_by_the_window_builders` | ✅ 自動 |
| `titles_match_sidecar_obs_overlays_table` | ✅ 自動（**逆方向＝エントリ数の一致も見ている**） |
| `shared_browser_args_match_all_windows` | ✅ 自動（`RUST_WINDOWS_WITH_SHARED_ARGS = OVERLAY_TITLES.len() + 1`） |
| `obs_overlay_kind_union_matches_between_sidecar_and_desktop` | ✅ 自動（**値の数と `OVERLAY_TITLES.len()` も突き合わせる**） |
| `every_consumer_window_registers_the_guard` | ✅ 自動（`SIDECAR_CONSUMER_LABELS.len()`） |
| `consumer_labels_are_windows_that_actually_exist` | ✅ 自動 |
| `window_commands_used_by_the_frontend_are_registered` | ⚠⚠ **`found >= 12` の下限は手で上げる**（12 → **15**） |

⚠⚠ **下限を上げないと「抽出が壊れて 0 件でも緑」の検出力が落ちたまま**になる
（このテスト自身が「抽出そのものが壊れて 0 件になったら何も検証しないまま緑になる」と書いている）。

### 制約 4: ⚠ `decorations(false)` では手動リサイズが実質できず、**サイズは永続化されない**

⇒ **既定値がすべて**（046c の教訓・`open_effect_overlay_window` の JSDoc が明記）。

### 制約 5: ⚠ macOS は**完全に画面外**の窓でウィンドウキャプチャが凍結しやすい（033f）

⇒ 位置は**画面内**であることが機能要件。`tauri.conf.json` の `main` は **1280×800**
（＝本アプリが前提にする最小デスクトップ）。

### 制約 6: ⚠⚠ **2 つの窓はそれぞれ独立に全コメントを受ける**

`EffectOverlayApp` は `connectCommentStream` を**窓ごとに 1 本**張り、`decideEffects` も
**窓ごとの `EffectTriggerState`** で回す。⇒ **バースト枠もクールダウンも窓ごとに独立**になる（判断 5）。

---

## ⚠⚠ 設計判断（実装前に読むこと。ここを外すと OBS のソースが黙って壊れる）

### 判断 1: 新窓の label / タイトル / サイズ / 位置

| 項目 | 値 | 根拠 |
|---|---|---|
| label | **`stage-overlay`** | 既存 4 窓と重複しない。⚠ capability の `windows` 配列とバイト一致させる |
| タイトル | **`StreamDock ステージ演出`** | 制約 1・2（既存語を含まず、既存に含まれない） |
| サイズ | **1280×720** | `main` の既定幅 1280 ＝前提とする最小デスクトップ幅に収まり、**16:9＝配信画面と同じ比** |
| 位置 | **(0, 0)** | 制約 5（完全に画面内）。⚠ 1280×800 の画面で y 0..720 は画面内 |
| min_inner_size | **320×180** | 既存窓（320×120）と同じ趣旨で 16:9 |

⚠ **その他はすべて `open_effect_overlay_window` を完全踏襲**（透過 / `decorations(false)` /
`always_on_bottom` / `focused(false)` / `shadow(false)` / `background_throttling(Disabled)` /
`SHARED_BROWSER_ARGS` / `WINDOW_OPEN_LOCK` / `#[tauri::command(async)]` / 既存窓の再利用は `show()` のみ）。
⚠⚠ **`SHARED_BROWSER_ARGS` を渡し忘れると Windows で WebView2 生成が `ERROR_INVALID_STATE` で失敗し、
この窓が開けない**（033f 追修正③の回帰）。契約テストが数を見ているので落ちる。

⚠ **既存窓と重なるが意図的**（061a と同じ判断＝OBS の対象特定は窓タイトルなので重なっても取り違えない）。

### 判断 2: ⚠⚠ **UI 上の呼び方だけ変え、窓タイトルは触らない**

既存窓は 960×360 で `(160,60)` にあり、名前も「StreamDock エフェクト」で「コーナー」とは書いていない。
⚠ **改名は制約 1 により禁止**。⇒ **画面での呼び方を「コーナー（小さめ）」「全画面（ステージ）」にし、
OBS のソース名は実際の窓名をそのまま案内する**。

⚠⚠ **案内文に出す窓名を絶対に間違えないこと**——ユーザーは OBS の一覧から**その文字列で探す**。
⚠ 061i の実機確認で「ガイド本文の残骸」を実際に踏んでおり、**ガイド本文だけは OBS のキャプチャに
数十秒そのまま映る＝視聴を見ている人にも読める**。窓ごとに正しい窓名を出すこと（判断 9）。

### 判断 3: ⚠⚠ ステージ窓も `SIDECAR_CONSUMER_LABELS` に入れる（＝§1 の再評価が要る）

```rust
const SIDECAR_CONSUMER_LABELS: [&str; 3] = ["comment-viewer", "effect-overlay", "stage-overlay"];
```

**入れない場合の壊れ方**: 「ステージ窓だけ開いてコメビュ窓を閉じる」で sidecar が落ち、
**ステージのエフェクトが黙って止まる**（061b がエフェクト窓について解いた問題と同一）。

⚠⚠ **代償＝「ユーザーが知らないうちに外部通信が続く」窓が 1 つ増える。**
これは §1 が**自分で名指しした再評価対象**なので、次の 3 つを**同時に**直すこと:

1. **`docs/security.md` §1「取得の停止条件」の条文**（`comment-viewer` / `effect-overlay` の 2 点 → **3 点**）
2. **`ObsEffectsScreen` の前提案内**（061i の S-1 で書き換えた文言。「ウィンドウを閉じる」が **2 つある**ことになる）
3. **`MainScreen` の停止フィードバック** … ⚠⚠ **`is_effect_overlay_open` を見て分岐している**ので、
   **`is_stage_overlay_open` も見る**必要がある。⚠ 061i レビュー S-1 が「§1 が導線として名指ししているのは
   **2 か所ある**・片方だけ直さないこと」と書いた、その 2 か所である。

⚠ 窓イベント（`CloseRequested` / `Destroyed` の**両方**）の登録を忘れると
`every_consumer_window_registers_the_guard` が落ちる（✅ 機械の保護がある）。
⚠ **`ensure_started` は呼ばない**（起動契機はコメビュ窓の 1 箇所のまま＝061a/061b の規律）。

### 判断 4: ⚠⚠ 出力先は `EffectCondition` の**第 3 のフィールド**に持たせる

```ts
export type EffectOutput = "corner" | "stage";
export interface EffectCondition {
  id: string;
  when: EffectConditionWhen;   // いつ出すか
  effect: EffectAssignment;    // 何を出すか
  output: EffectOutput;        // ⚠ 061k: どこへ出すか（第 3 の軸）
}
```

- ⚠ **`when` に入れない**（061j の JSDoc が「061k の出力先を先回りで足すな」と書いた場所だが、
  あれは**置き場所の指定ではない**）。「いつ出すか」と「どこへ出すか」は独立した軸で、
  混ぜると `{type:"keyword"; text; match; output}` のように**条件の種類ごとに output を複製**することになる。
- ⚠ **`effect` に入れない**。`{kind:"none"}` には出力先が無い＝**描けない kind** と同型の不能ケースが生まれる
  （061j が `EffectAssignment` に `"none"` を足して `EffectKind` に入れなかったのと同じ理由）。
- ⇒ **061j の語彙の線に 3 本目を足す**: 条件＝いつ／割り当て＝何を／**出力先＝どこへ**。

**⚠⚠ 移行（判断 4-b）: `output` が無い保存値は全部 `"corner"` へ倒す**

- ⚠ **既定を `"corner"` にする理由＝既存ユーザーの見え方が 1 ミリも変わらないから**
  （`"corner"` ＝ 061j までの唯一の窓）。
- ⚠ `parseConditions` が**未知の値も `"corner"` へ落とす**。⚠ 061j の「未知は安全側へ倒す」と同じ形だが、
  ここでの「安全側」は**「出さない」ではなく「既存の挙動」**である（**意味が違うので混同しないこと**）。
- ⚠ **移行コードは書かない**——061j の `parseConditions` が既に「フィールドが無ければ既定」を
  1 本道でやっているので、**分岐を 1 つ足すだけ**で済む（061h の「同じことを 2 通りに書かない」の維持）。
- ⚠ **キーは `EFFECT_ASSIGNMENTS_KEY` のまま**（旧ビルドへ戻しても `output` は未知フィールドとして無視され、
  061j の挙動＝全部コーナーに出る、へ倒れる＝安全）。
- ⚠⚠ **`saveEffectConditions` の「キーごと削除」条件も同時に見直すこと**（061j 申し送りが名指し）。
  061j は「イベント条件が全部 `none` **かつ** キーワード条件が 0 件」なら `removeItem` している。
  ⚠ **`output` は既定が `"corner"` なので、「イベント条件の output だけ `stage` に変えた」状態は
  「全部 `none`」の条件を満たしたまま**＝ **ユーザーが変えた出力先が黙って消える**。
  ⇒ **削除条件に「すべての条件の `output` が既定である」を足す**か、
  **`effect.kind === "none"` の条件の `output` を保存時に既定へ丸める**かのどちらかを選ぶこと。
  ⚠ **推奨は後者**（「何も出さない条件の出力先」に意味が無く、状態の組み合わせを増やさないため）。

### 判断 5: ⚠⚠ 出力先の絞り込みは **matcher の中**で行う（`EffectRequest` に載せない）

2 つの窓がそれぞれ全コメントを受けて `decideEffects` を回す（制約 6）。素直に思いつく
「`EffectRequest` に `output` を載せ、窓側で自分宛てでなければ捨てる」は **誤りである**:

⚠⚠ **`decideEffects` は発火時に `recentFires.push` / `lastConditionAt.set` を書く。**
捨てるのは**その後**なので、**コーナー窓のバースト枠がステージ用エフェクトに食われる**。
⇒ 「別の窓へ出す条件が 3 件続いただけで、直後の投げ銭が捨てられる」が起きる。

⚠ これは **061j の追加穴 η が守った不変条件「出さないと決まったものは state に一切触らない」の裏返し**であり、
さらに遡れば 061d-2 の穴 γ と同型である。⚠ **同じ罠を 3 回目で踏まないこと。**

⇒ **matcher が自分の output 以外の条件をスキップする**:

```ts
// 061j: export function resolveEffectMatch(input: EffectMatchInput): EffectMatch | null
export function createEffectMatcher(output: EffectOutput): EffectMatcher
```

- ⚠⚠ **061j が JSDoc に残していた寄せ先（factory）と形は同じだが、理由は違う。**
  あちらは「localStorage の読み回数を減らす最適化」で、**061j は「いま 1 バイトも節約しないので作らない」と
  却下している**。⇒ **factory にはするが、読み直しの規律は変えないこと**——
  `createEffectMatcher(output)` が返す関数は **呼ばれるたびに `readConditions()` する**。
  ⚠ **「ついでに最適化」をしない**（測っていない最適化を、別の理由の変更に紛れ込ませない）。
- ⚠ `EffectMatch` は無改変（`{effect, conditionId, cooldownMs}`）。**`EffectRequest` も 8 キーのまま無改変**。
- ⚠ 帰結: **バーストもクールダウンも窓ごとに独立**。条件の `output` は 1 つなので二重発火は起きない。

### 判断 6: ⚠⚠ 「窓を出すか」のフラグは**窓ごとに 2 本**にする（061i 再修正トリガーへの回答）

061i が残した宿題:
> 再修正トリガー＝061k で窓が 2 本になり、窓ごとに「開くべきか」を持つ必要が出たとき
> （そのとき「割り当てから導出する」案 (b) へ寄せるか、窓ごとにキーを持つかを決め直す）

| 案 | 判定 |
|---|---|
| **(a) キーを 2 本**（`…effect-overlay-enabled` ＋ 新 `…stage-overlay-enabled`） | ✅ **採用** |
| (b) 1 本のキーに JSON を入れる | ❌ `CommentViewerApp` は値を **`=== "true"`** で読む＝**値の形を変えると読み手が壊れる** |
| (c) 割り当てから導出（キー廃止） | ❌ `CommentViewerApp` の `storage` 購読は**キー名で分岐**（061i が明示的に却下した案） |

**(a) の理由**: `CommentViewerApp` の既存分岐（`e.key === EFFECT_OVERLAY_ENABLED_KEY`）が**そのまま残り**、
stage 用に**同型の分岐を 1 本足すだけ**で済む。値の形（`"true"` / `"false"`）も同じ。

- ⚠ **書き手は引き続き `useEffectTemplates` の 2 か所**（保存経路の `commitConditions` ＋ マウント時の再計算）で、
  **その 2 か所が 2 キーを書く**。⚠ **hook の外から書かない**という 061i の不変条件は変えない。
- ⚠ 数え方の持ち主も 1 か所のまま: **`effectConditionCount(conditions, output?)`** へ**引数を 1 つ足す**
  （省略時は合計＝既存の呼び出しが壊れない）。

### 判断 7: ⚠⚠ 差分ゼロの 4 本を**解除し、061i の残骸を返済する**

061i / 061j は `effectOverlayRestore.ts` / `windowApi.ts` / `CommentViewerApp.tsx` / `App.tsx` の
**差分ゼロが要件**だったが、**061k では 4 本すべてに差分が出る**（窓が増えるので構造的に不可避）。

⚠⚠ **061i 申し送り §9 が「再修正トリガー＝次にあの 4 本を触るとき、ついでに直す」と書いた残骸を、
ここで全部返済すること**（廃止済みの表示トグルを名指しした JSDoc）:

- `App.tsx`「『エフェクトを配信画面に表示する』が ON なのに窓が無ければ開き直す」
- `effectOverlayRestore.ts`「ユーザーが表示トグルを OFF にしたとき」／
  「旗を立てるのは `ObsEffectsScreen` の表示トグル ON」
- `windowApi.ts`「`obs-effects` 画面の表示トグル OFF 用」
- `effectOverlayRestore.test.ts` のコメント 3 か所

⚠ **これは「ついで」ではなく、061i が明示した再修正トリガーの発火である**（061h の bindings と同じ扱い）。

### 判断 8: ⚠⚠ テスト表示は **両方の窓へ出す**（wire も UI も据え置き）

| 案 | 判定 |
|---|---|
| (i) wire に output を足す（`<nonce>:<templateId>:<output>`）＋ 行に出力先の選択を置く | ❌ 下記 |
| (ii) キーと旗を窓ごとに分け、UI で選ばせる | ❌ (i) と同じ UI コスト ＋ キーが増える |
| **(iii) 両方の窓へ出す** | ✅ **採用** |

**(i)(ii) を却下した理由**: `EffectTemplateCard` のテンプレート行は**既にボタンが 3 個**
（プレビュー・削除・配信画面でテスト表示）で、**061h レビュー Q-4 が
「⚠ 再修正トリガー＝ボタンが 4 個以上になるとき」**と明記している
（`.templateRow > button` の `flex: none` / `white-space: nowrap` は 3 個前提で、
⚠⚠ **jsdom はレイアウトを解決しないのでテストは全部緑のまま**壊れる）。
⇒ 出力先の選択を行へ足すと、**行を 2 段にする作業が本タスクに付いてくる**。

**(iii) を採る理由**:

- テスト表示の目的は **OBS の位置合わせ**で、**061k のあとは合わせる対象が 2 ソースある**。
  **同時に出るほうが目的に合っている**（セットアップでは 2 つとも OBS に追加するのだから）。
- **UI 追加ゼロ**（061h Q-4 のトリガーを踏まない）／**wire の形は据え置き**（`<nonce>:<templateId>`）。
- ⚠ `storage` は**全窓へ飛ぶ**ので、**061j までの実装のまま両窓が拾う**
  ＝差分は「保留旗を窓ごとに 2 本にする」ことだけ。

⚠ **代償＝ステージ窓を使う気が無いユーザーでも、テスト表示で窓が開く。**
緩和＝ 061i が作った「ウィンドウを閉じる」で閉じられ、前提ステータスに 2 行出る（判断 11）。
⚠ **再修正トリガー＝「片方だけ出したい」と言われたとき**——そのとき (i) へ寄せ、
**同時に `.templateRow` を 2 段レイアウトへ変えること**（Q-4 のトリガーを一緒に消化する）。

**⚠⚠ 保留旗は窓ごとに 2 本**（`EFFECT_TEST_FIRE_PENDING_KEY` ＋ stage 版）:

- ⚠ 各窓は**自分の旗だけ**を `take*`（読んだら消す）する。**相手の旗を消さないこと**
  （消すと「片方の窓が先にマウントして両方の旗を食う」＝もう片方が無反応になる）。
- ⚠⚠ **061i 判断 4 の取りこぼしは 2 窓ぶん起きる**——`open_*_overlay_window` の解決は
  **窓生成の完了**であって、**その窓の React が `storage` リスナーを登録し終えたこと**ではない。
- ⚠ **061i レビュー S-4 の楽観更新（前提ステータスを開く側だけ楽観的に倒す）も 2 窓ぶん要る**
  （stale-false の隙間に押すと、既存窓は `show()` されるだけで再マウントせず**旗が残骸になる**）。

### 判断 9: ステージ窓の描画は `EffectOverlayApp` を**そのまま使い回す**

- `output: EffectOutput` の prop を 1 つ足すだけ。⚠ **省略可にしない**（061i / 061h の規律＝
  渡し忘れが「黙って片方の窓に出ない」へ倒れる）。
- ⚠ **`EffectTemplateView.tsx` / `EffectTemplateView.module.css` / `EffectOverlayApp.module.css` は
  差分ゼロが目標**（`check-css-guards.mjs` の (10-d)(10-r) が見ている領域）。
- ⚠ `warmTemplates` は **自分の output の条件だけ**温める（20MiB の予算を相手の窓のぶんで使わない）。
  ⚠ `assignedTemplateIds(conditions, output)` へ引数を足す形にすること。
- ⚠⚠ **テンプレートの `layout.width/height` / `offsetX/Y` / `text.fontSize` は絶対 px** なので、
  コーナー用（960×360）に作ったテンプレートをステージ（1280×720）へ出すと**相対的に小さく見える**。
  ⚠ **これは受容する**（061d-1 レビュー Q-1 が既に「比率が同じでも枠の実寸が違えば見え方が変わる」を
  受容し、`ObsEffectsScreen.module.css` の `.previewStage` に判断の全文がある）。⇒ **画面で 1 文説明する。**
  ⚠ **`fitScale` / `transform: scale()` を持ち込まないこと**（あれは `.previewStage` の再修正トリガー側の話）。
- ⚠⚠ **セットアップ用ガイドの文言は窓ごとに正しい窓名を出す**（判断 2）。

### 判断 10: OBS 自動反映トグルは **1 つのまま**（2 窓を束ねる）

- `EFFECT_OBS_AUTO_ADD_KEY` は 1 本のまま＝「エフェクトのウィンドウを OBS へ自動で追加する」が
  **2 ソースを束ねる**。⚠ 理由＝「たぬえさ3 より簡単に」（設定を増やさない・061d の (2) と同じ規律）。
  片方だけ自動追加したいという要求は出ていない。
- ⚠ ただし `CommentViewerApp` の `scheduleObsAutoAdd` / `requestObsHide` は **`ObsOverlayKind` ごと**なので、
  **呼び出しは 2 本**になる（`"effects"` と `"stage"`）。
- ⚠⚠ **`obsState` は comments / pinned / effects / **stage** の 4 種別で 1 本のまま**
  ——061e レビュー Q-5 が「設定カードを見てもどの種別の結果か分からない」を受容しており、
  **その受容の範囲が 3 → 4 へ広がる**。⚠ **広がったことを progress.md に明記すること**
  （再修正トリガーは 046d / 061a Q-2 と同じ＝wire を種別つきへ広げるとき）。

### 判断 11: 前提ステータスは「エフェクトのウィンドウ」を **2 行**にする

- 「エフェクトのウィンドウ（コーナー）」／「エフェクトのウィンドウ（全画面）」の 2 行。
  各行に「ウィンドウを閉じる」／「ウィンドウを開く」（061i レビュー Q-2 の非対称の埋め合わせも 2 組）。
- ⚠ **「表示する条件」は合計 1 行のまま**（ユーザーが最初に確かめたいのは「条件を作ったか」）。
  ⚠ ただし**窓を開く判定は output ごと**（`effectConditionCount(conditions, "stage") > 0`）。
- ⚠⚠ **開閉の直列化キュー（`effectOverlayOpRef`）は窓ごとに 1 本ずつ持つこと。**
  1 本に混ぜると **片方の窓の open が、もう片方の close の完了を待つ**（061i がこのキューを作った理由は
  「同じ窓への close と open の順序が入れ替わる」であって、**別の窓を直列化する理由は無い**）。
  ⚠ `runEffectOverlayOp(output, op)` の形にして ref を 2 本持つ。

### 判断 12: ⚠⚠ `docs/security.md` の更新は **5 か所**（差分ゼロではない）

| # | 箇所 | 変更 |
|---|---|---|
| 1 | **§1「取得の停止条件」** | `comment-viewer` / `effect-overlay` の**2 点 → 3 点**。⚠ 「窓を足して延命する変更は再評価が必要」と書いた条文の**当事者になる**ので、**再評価した結果をその場に書く** |
| 2 | Capabilities 方針 061a 節「**sidecar の停止条件**」 | 同上（⚠ 「`comment-overlay` / `pinned-overlay` はこの判定に含めない」の隣に stage の扱いを書く） |
| 3 | Capabilities 方針 061a 節「**窓タイトル**」 | 「**3 つの窓名**が互いに部分文字列にならない」→ **4 つ** |
| 4 | Capabilities 方針 061a 節「**`ObsOverlayKind` は固定 union のまま**」 | `"comments" \| "pinned" \| "effects"` → **`\| "stage"` を足した 4 値** |
| 5 | Capabilities 方針 | **新窓 1 行**（`capabilities/stage-overlay.json`・`core:default` のみ・⚠ **既存 5 枚は不変**） |

⚠ 「レビュー必須条件」への追記が要るかも**自分で判定すること**
（`SIDECAR_CONSUMER_LABELS` の条文は既に一般形なので追記不要と見込むが、**確認せずに省かない**）。
⚠⚠ **061a 節の「失効条件の最終判定」（第三者由来のバイト列を webview の `src` へ載せる 3 経路）は
再確認だけして差分ゼロのはず**——ステージ窓は同じ `EffectOverlayApp` / 同じ `safeEffectMedia` を通る。
**「同じはず」で済ませず、読み直してから空だと書くこと**（061j がそうした）。

---

## やること

### (1) Rust — 窓 1 本と 3 コマンド

- `open_stage_overlay_window` / `close_stage_overlay_window` / `is_stage_overlay_open`
  （⚠ `open_effect_overlay_window` を手本に、判断 1 の値で。**窓イベント登録を忘れない**＝判断 3）
- `generate_handler!` へ 3 本追加
- `SIDECAR_CONSUMER_LABELS` を 3 値へ（判断 3）
- `OVERLAY_TITLES` に 4 行目（⚠ **これだけで契約テスト 5 本が自動追随する**）
- ⚠ `window_commands_used_by_the_frontend_are_registered` の **`found >= 12` を 15 へ**（制約 3）

### (2) capability

- `apps/desktop/src-tauri/capabilities/stage-overlay.json` 新設
  （⚠ `effect-overlay.json` と同型＝`windows: ["stage-overlay"]` / `permissions: ["core:default"]` のみ）
- ⚠ **既存 5 枚は 1 バイトも触らない**

### (3) sidecar

- `ObsOverlayKind` に `"stage"`／`OBS_OVERLAYS` に 1 エントリ（`sourceName === windowTitle === "StreamDock ステージ演出"`）
- `scripts/test-obs-client.mjs` の期待値（**3 種 → 4 種**・ソート済み配列・相互部分文字列の総当たり）
- ⚠ **`obs-helpers.ts` は差分ゼロ**（044a/046d の fail-closed 層に手を入れていないことの担保が続く）

### (4) frontend の型と窓 API

- `commentStream.ts` の `ObsOverlayKind` を 4 値へ（⚠ **sidecar と人手同期・契約テストが突き合わせる**）
- `windowApi.ts` に 3 本
- `overlaySettings.ts` に **2 キー**（stage の enabled ＋ stage の test-fire-pending。⚠ 判断 6・8）

### (5) 条件の保存形と matcher

- `effectAssignments.ts` … `EffectOutput` / `EffectCondition.output` / `parseConditions` の既定と検証（判断 4）／
  ⚠ **`saveEffectConditions` の「キーごと削除」条件**（判断 4-b）／
  **`createEffectMatcher(output)`**（判断 5）／`effectConditionCount(conditions, output?)` ／
  `assignedTemplateIds(conditions, output?)` ／ 変更 API に**出力先の更新を 1 本**
  （⚠⚠ 061j 申し送り: 条件を書き換える経路は **3 本 → 6 本**になっており、
  **全部 `commitConditions` を通すことが不変条件**。本タスクで **7 本目**になるので、
  ⚠ **新しい経路も必ず `commitConditions` を通すこと**——通さないと派生値 2 キーが追従しない）
- ⚠ **`effectTrigger.ts` は差分ゼロが目標**（`EffectMatcher` の形は変わらない）

### (6) 窓の描画とライフサイクル

- `EffectOverlayApp` に `output` prop（判断 9）／`App.tsx` のルーティングに 1 分岐
- `effectOverlayRestore.ts` … **2 窓を独立に復元**（⚠ 「`isOpen()` の解決を待ってから設定を読む」順序を
  **窓ごとに**守ること。片方の結果でもう片方を判断しない）

### (7) コメビュ窓の OBS 連携

- `CommentViewerApp` … stage キーの `storage` 分岐 1 本 ＋ マウント時 reconcile の 2 本目（判断 6・10）
- ⚠ `clear()`（`e.key === null`）の扱いは既存 effects 側と**同じ形**にすること（061a Q-4 の受容を割らない）

### (8) 画面

- `EffectAssignmentCard` … 条件の行に**出力先の `<select>`**（⚠ `Select` を使う・イベント行とキーワード行で 1 実装）
- `ObsEffectsScreen` … 前提ステータス 2 行 ＋ 開閉キュー 2 本（判断 11）＋ 案内文
- `MainScreen` … 停止フィードバックが **stage も見る**（判断 3・§1 の導線）

### (9) 061i 残骸の返済（判断 7）

### (10) docs

- `docs/security.md` **5 か所**（判断 12）／`docs/progress.md` に **061k 節**／`docs/task-board.md` の完了化と 061l への申し送り

## やらないこと

- **配信イベントの中身** … 061l（タブの枠は 061i が用意済み）
- **3 本目以降の窓** … ⚠ 動的 N 窓は capability が静的 JSON なので**構造的に不可能**
- **ステージ窓のサイズ・位置をユーザーに設定させる** … ⚠ `decorations(false)` で永続化されない（制約 4）
- **`EffectTemplateView` の描画・`fitScale` / `transform: scale()`** … 判断 9（受容して 1 文で説明する）
- **OBS 自動反映トグルを 2 つに割る** … 判断 10
- **`obsState` を種別ごとに分ける** … 061e Q-5 の受容を維持（wire を広げる別タスク）
- **テスト表示の出力先選択 UI** … 判断 8（＝`.templateRow` の 2 段化も本タスクではやらない）
- **`EffectRequest` に `output` を足す** … 判断 5（バースト枠を食う）
- **既存の窓タイトル・label・`EFFECT_ASSIGNMENTS_KEY` の変更** … 制約 1 / 判断 4

## 対象ファイル

**新規**
- `apps/desktop/src-tauri/capabilities/stage-overlay.json`

**変更（Rust / sidecar）**
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/comment-sidecar/src/obs/obs-client.ts` ／ `apps/comment-sidecar/scripts/test-obs-client.mjs`

**変更（frontend）**
- `features/comment-viewer/` の `commentStream.ts` / `windowApi.ts` / `overlaySettings.ts` / `effectOverlayRestore.ts`
- `screens/obs-effects/` の `effectAssignments.ts` / `EffectOverlayApp.tsx` / `EffectAssignmentCard.tsx` /
  `ObsEffectsScreen.tsx` / `.module.css` / `useEffectTemplates.ts`
- `screens/comment-viewer/CommentViewerApp.tsx` ／ `App.tsx` ／ `screens/main/MainScreen.tsx`

**変更（docs）**
- `docs/security.md`（**5 か所**・判断 12）／`docs/progress.md` ／ `docs/task-board.md`

**差分ゼロ（要件）**
- `apps/desktop/src-tauri/tauri.conf.json`（⚠ `SHARED_BROWSER_ARGS` を契約テストが突き合わせる）
- 既存 capability **5 枚**
- `apps/comment-sidecar/src/obs/obs-helpers.ts`
- `screens/obs-effects/` の `effectTrigger.ts`（目標）/ `EffectTemplateView.tsx` / `EffectTemplateView.module.css` /
  `EffectOverlayApp.module.css` / `effectEventRows.ts` / `effectTemplateText.ts` / `effectSelectValue.ts` /
  `EffectTemplateCard.tsx`（判断 8 で触らないと決めた）
- `apps/desktop/package.json` ／ `pnpm-lock.yaml` ／ `.github/`

## テスト

**⚠ ベースライン＝ 67 files / 1625 tests**（`f9b6332` 時点）。⚠ **自分で実測して確認すること**
（061i は 1524 と申し送られて実測 1525、061j は 1548 と申し送られて実測 1555 だった）。

**Rust（`cargo test`）** — ⚠ 制約 3 のとおり**ほぼ自動追随する**が、緑になることを実測する:
`titles_do_not_contain_each_other` ／ `titles_are_used_by_the_window_builders` ／
`titles_match_sidecar_obs_overlays_table` ／ `shared_browser_args_match_all_windows` ／
`obs_overlay_kind_union_matches_between_sidecar_and_desktop` ／
`window_commands_used_by_the_frontend_are_registered`（⚠ 下限を 15 へ）／
`every_consumer_window_registers_the_guard` ／ `consumer_labels_are_windows_that_actually_exist`

**sidecar**: `node apps/comment-sidecar/scripts/test-obs-client.mjs`（4 種・相互部分文字列・`parseOverlayKind`）

**⚠⚠ 新規に必ず要るケース（TS）**

1. ⚠⚠ **corner の matcher は stage 条件を返さない／その逆**。
   **かつ、当たらなかった側は `recentFires` / `lastConditionAt` のサイズが増えない**
   （判断 5。⚠ **「出ない」だけを見ると変異②が生存する**＝061j 追加穴 η と同じ形。**サイズを直接数えること**）
2. **`output` の無い保存値は `corner` へ倒れる**（＝既存ユーザーの見え方が変わらない・判断 4-b）
3. **未知の `output` も `corner` へ**（`"none"` へ倒さない＝意味が違う）
4. `effectConditionCount(conditions, "stage")` が output ごとに数える／**省略時は合計**
5. **stage 条件を 0 → 1 件にすると stage のキーが true になり stage 窓が開く**／
   ⚠ **corner のキーと窓は触られない**
6. **corner 条件だけのとき stage 窓は開かない**（＝「開いたのに何も出ない窓」を作らない）
7. **テスト表示で 2 窓ぶんの保留旗が立ち、2 窓とも open が投げられる**（判断 8）
8. ⚠⚠ **各窓は自分の旗だけ読んで消す**（相手の旗を消さない＝片方が無反応にならない）
9. `CommentViewerApp` が stage キーの `storage` で `enableObs("stage")` / `hideObs("stage")` を出す
   （⚠ **`"effects"` 側を巻き添えにしない**）
10. `restoreEffectOverlayWindow` が **2 窓を独立に復元**する（片方だけ ON なら片方だけ開く）
11. ⚠⚠ **開閉キューが窓ごとに独立**（corner の close 中に stage の open が待たされない・判断 11）
12. `MainScreen` の停止フィードバックが **どちらかの窓が開いていれば**「取得が続く」側の文言になる（§1 の導線）
13. `warmTemplates` が**自分の output の条件だけ**温める（判断 9）

## 検証

```bash
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test     # vitest + check:css + check:version + check:effect-contract
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # ⚠⚠ 本タスクでは必須（契約テスト）
node apps/comment-sidecar/scripts/test-obs-client.mjs           # ⚠⚠ 本タスクでは必須

# ⚠⚠ 差分ゼロ（すべて空が期待）
git diff -M HEAD -- apps/desktop/src-tauri/tauri.conf.json \
  apps/desktop/src-tauri/capabilities/comment-overlay.json \
  apps/desktop/src-tauri/capabilities/comment-viewer.json \
  apps/desktop/src-tauri/capabilities/default.json \
  apps/desktop/src-tauri/capabilities/effect-overlay.json \
  apps/desktop/src-tauri/capabilities/pinned-overlay.json
git diff -M HEAD -- apps/comment-sidecar/src/obs/obs-helpers.ts
git diff -M HEAD -- apps/desktop/package.json pnpm-lock.yaml .github/
git diff -M HEAD -- apps/desktop/src/screens/obs-effects/EffectTemplateView.tsx \
  apps/desktop/src/screens/obs-effects/EffectTemplateView.module.css \
  apps/desktop/src/screens/obs-effects/EffectOverlayApp.module.css \
  apps/desktop/src/screens/obs-effects/effectTrigger.ts \
  apps/desktop/src/screens/obs-effects/EffectTemplateCard.tsx

# ⚠⚠ 既存の窓タイトルが 1 バイトも変わっていないこと（制約 1・ヒットすることが期待）
grep -rn '"StreamDock エフェクト"' apps/desktop/src-tauri/src/lib.rs apps/comment-sidecar/src/obs/obs-client.ts

# ⚠ 4 つの窓名が互いに部分文字列でないこと（Rust の契約テストと二重に確かめる）
python3 -c "
t=['StreamDock コメントオーバーレイ','StreamDock 固定コメント','StreamDock エフェクト','StreamDock ステージ演出']
print([(a,b) for a in t for b in t if a!=b and b in a] or 'なし ✅')"

# ⚠ 派生値の書き手が hook に閉じたままか（2 キーとも useEffectTemplates だけであること）
grep -rn "saveEffectOverlayEnabled\|saveStageOverlayEnabled" apps/desktop/src

# ⚠ §9: EffectRequest が 8 キーのまま（output を載せていないこと）
grep -rn "output" apps/desktop/src/screens/obs-effects/effectTrigger.ts

# ⚠ 061i 残骸の返済（ヒットゼロが期待・判断 7）
grep -rn "表示トグル\|エフェクトを配信画面に表示する" apps/desktop/src
```

⚠ **変異検証（実測して progress.md に記録）**

| # | 変異 | 期待 |
|---|---|---|
| ① | matcher の output 絞り込みを外す | レッド（新規 1） |
| ② | ⚠⚠ `EffectRequest` に `output` を載せて**窓側で捨てる**形にする | レッド（新規 1・**サイズを数えるアサーションでないと生存する**） |
| ③ | 移行の既定を `"stage"` にする | レッド（新規 2） |
| ④ | `SIDECAR_CONSUMER_LABELS` から stage を落とす | レッド（Rust 契約テスト・判断 3） |
| ⑤ | stage 窓の窓イベント登録を消す／片方のイベントだけにする | レッド（`every_consumer_window_registers_the_guard`） |
| ⑥ | stage 窓の停止ガードを `"effect-overlay"` のラベルで呼ぶ（取り違え） | レッド（同上・M1 相当） |
| ⑦ | タイトルを `"StreamDock エフェクト（全画面）"` にする | レッド（`titles_do_not_contain_each_other`） |
| ⑧ | `ObsOverlayKind` を **desktop 側だけ** 4 値にする | レッド（union 契約テスト） |
| ⑨ | `OBS_OVERLAYS` に stage を足さずタイトルだけ増やす | レッド（`titles_match_sidecar_obs_overlays_table` の**逆方向**） |
| ⑩ | 開閉キューを 1 本に戻す | レッド（新規 11） |
| ⑪ | 保留旗を 1 本に戻す／相手の旗も消す | レッド（新規 7・8） |
| ⑫ | stage の enabled を corner と同じキーにする | レッド（新規 5） |
| ⑬ | `warmTemplates` が相手の output も温める | レッド（新規 13） |
| ⑭ | `MainScreen` の停止フィードバックが stage を見ない | レッド（新規 12） |
| ⑮ | `.additional_browser_args(SHARED_BROWSER_ARGS)` を新窓で省く | レッド（`shared_browser_args_match_all_windows`） |
| ⑯ | ⚠ **自分で考えた変異も試すこと**（守備範囲の穴の探索） | — |

⚠⚠ **061h ⑤ / 061i ⑨-b / 061j ④ の教訓**——**「何も出ない」「順序を入れ替える」だけを見る
アサーションでは殺せない変異がある。** 本タスクでは **②** がその筆頭で、
**`recentFires` / `lastConditionAt` の `size` を直接数える**形でないと生存する。

## ⚠⚠ 実機確認（未実施のまま完了にしないこと）

⚠⚠ **本タスクは OBS を起動しないと確認できない唯一の回である。**
061i / 061j は「OBS のシーンにソースを自動追加する＝依頼者の配信設定を書き換える」ことを理由に
⑫（カクつき）を未実施のまま残している。⇒ ⚠ **着手前に依頼者へ「OBS を起動して実機確認してよいか」を
確認すること**（ソースが 1 本増える／既存ソースが再利用される）。

1. ⚠⚠ **OBS に 2 つのソースが別々に追加され、独立に配置できる**
2. ⚠⚠ **既存の「StreamDock エフェクト」ソースが壊れずに再利用される**
   （制約 1 の失敗モード＝`"reused"` を返して真っ黒、が起きていないこと）
3. **全画面の演出とコーナーの投げ銭が同時に出ても衝突しない**（＝061k の本命）
4. 条件の出力先を切り替えると、**次の発火から相手の窓に出る**
5. ⚠ corner 条件だけのとき stage 窓は開かない／stage 条件だけのとき corner 窓は開かない
6. ⚠⚠ **コメビュ窓を閉じても、ステージ窓が開いていればエフェクトが出続ける**（判断 3・sidecar 延命）
7. ⚠⚠ **両方の窓を閉じると sidecar が落ちる**（孤児が残らない・§6。⚠ `ps` で実測する）
8. ⚠ ツール管理の停止フィードバックと OBSエフェクト画面の前提案内が **stage も見て**分岐する（§1 の導線）
9. テスト表示で **2 窓とも**出る（判断 8）／ガイドが**それぞれ正しい窓名**を出す（判断 2）
10. アプリ再起動で **2 窓が独立に復元**される（片方だけ条件があるなら片方だけ）
11. ⚠ コーナー用に作ったテンプレートを全画面へ出すと**小さく見える**（判断 9 の受容の確認）
12. ⚠⚠ **061d-2 から 061i / 061j へ持ち越されている実機確認⑧（OBS キャプチャのカクつき）を
    ここで消化する。** ⚠ **OBS を触る回はここが最後**（061l は配信イベントの器で OBS 設定に触らない）。
    ⇒ **親 061 のクローズ条件の片方がここで解消する。**

⚠ **観測手法は 061j の progress.md が正**（透過窓は `CGWindowListCreateImage` の窓単位キャプチャで
alpha>0 の画素数と bbox を数値化／差し込み文面は `AXStaticText`／dev-mock の時刻表と突き合わせる／
⚠ **dev ビルドは本番と localStorage を共有しない**）。
⚠ **WKWebView に合成キーイベントは入らない**ので、テキスト入力を伴う確認は localStorage へ直接仕込むこと。
