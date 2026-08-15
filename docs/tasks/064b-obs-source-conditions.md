# 064b コメントの条件で OBS のソースを鳴らす（**完了・security-review 未実施**・2026-08-15）

> ## 状態: **実装完了 / ⏳ 実機確認と security-review が未実施**
>
> 親: [064](064-obs-source-effects.md)。前段: [064a](064a-obs-source-bridge.md)（**実機確認済み・問題なし**）。
> ⚠ **判断の全文は [`docs/progress.md`](../progress.md) の 064b 節が正。**

## このタスクの範囲

**「条件に当たったコメントが来たら、OBS 側のソースが自動で鳴る」**まで。
⚠ 割り当て UI は **既存の `<select>` に選択肢を足しただけ**（凝った画面は 064c）。

## ⚠⚠ 着手前に依頼者と決めた 3 点

| 論点 | 決定 | 却下した案と理由 |
|---|---|---|
| **何秒出すか** | **OBS に長さを聞く**（`GetMediaInputStatus` の `mediaDuration`） | ①5 秒固定 … **10 秒の動画が必ず途中で切れる**（仕様どおりなのにバグ報告になる形）②条件ごとに秒数を設定 … 設定項目が増え「たぬえさ3 より簡単に」に逆行する |
| **接続の維持** | **見送る**（オンデマンドのまま） | 常時接続は §1 の姿勢変更＋再接続処理を伴う。相手は localhost で往復は数ミリ秒＝**測っていない最適化**になる。⚠ **再修正トリガー＝実機で「遅い」と感じたとき** |
| **UI の範囲** | **最小限だけ 064b に含める** | 含めないと **064b は実機で 1 度も試せない**（条件を作る手段が無い） |

## 作ったもの

| 層 | 追加 |
|---|---|
| sidecar `obs/obs-helpers.ts` | `resolveObsFireDurationMs`（**純関数＝テスト対象**） |
| sidecar `obs/obs-client.ts` | `fireSource` が**メディアの長さを OBS に聞く**（失敗しても止めない） |
| desktop `effectTrigger.ts` | `EffectMatch<T>` / `EffectMatcher<T>` / `decideEffects<T>` へ**総称化**、`EffectObsSource`、`takeFreshComments` / `createSeenEffectIds`（`EffectOverlayApp` から移設） |
| desktop `effectAssignments.ts` | `EffectAssignment` に `{kind:"obs-source"}`、`isEffectObsSourceName`、`createObsSourceMatcher`、走査を `createConditionMatcher` へ集約 |
| desktop `effectSelectValue.ts` | `OBS_SOURCE_PREFIX` / `isObsSourceMissingFromList` / `effectSelectAssignment`（**分解の持ち主**） |
| desktop `CommentViewerApp.tsx` | **OBS レーンの判定と発火**（この窓が持ち主） |
| desktop `EffectAssignmentCard.tsx` | `<select>` に OBS ソースの `<option>` ＋「見つかりません」警告 |
| desktop `overlaySettings.ts` | `OBS_SOURCE_FALLBACK_DURATION_MS`（064a のテスト発火と共有） |

## ⚠⚠ 設計上の要点

### 1. 発火先を `EffectKind` に足さず、`decideEffects` を総称化した

`EffectKind` へ `obs-source` を足すと、`EffectRequest` に**エフェクト窓が描けない kind** が生まれる
（`EffectAssignment` の JSDoc が 061d-2 以来 禁じている形）。⇒ **型引数で分ける**。

⚠⚠ **却下した案＝「OBS レーン用に発火判定をもう 1 本書く」。** `decideEffects` が塞ぐ多重発火の
4 経路（combo 再送 / コミュニティギフト N+1 / バースト / クールダウン）は**すべて OBS レーンでも要る**。
特に N+1 は、別実装にすると **1 回の贈与でソースが 4 回鳴る**。

⚠ **`EffectRequest` は無改変**（8 キーのまま）で、エフェクト窓の `fire()` に分岐は 1 つも増えていない。

### 2. 2 つのレーンは**当たり判定の前**に分かれる

- `createEffectMatcher(output)` … `kind !== "template"` をスキップ（⚠ 旧: `=== "none"`）
- `createObsSourceMatcher()` … `kind !== "obs-source"` をスキップ

⚠⚠ 後ろで捨てる形にすると、**相手のレーンの条件がこのレーンのバースト枠とクールダウンを食う**
（061d-2 穴 γ ／ 061j 穴 η ／ 061k と同型で **4 例目**）。
⚠ **「出ない」だけを見るテストでは殺せない**ので、state の 3 サイズを直接数えるケースを置いた。

### 3. 発火するのはコメビュ窓（構造上の必然）

sidecar と WS で繋がっているのはあの窓だけ。⇒ `screens/comment-viewer/` → `screens/obs-effects/`
という**横参照**が初めて生まれた（モジュールの循環は無い）。
⚠⚠ **本当の整理は 064d**（`screens/obs-effects/` を畳むとき）——**引っ越しを 2 回行わない**。

### 4. 「窓を開く条件」には数えない

`effectConditionCount` は `kind === "template"` だけを数える 1 行がそのまま効く
＝ **OBS ソースだけ設定したユーザーの配信画面に、透過窓が黙って 2 枚生えない**。
⚠ 代償＝前提ステータスの「表示する条件」がユーザーの作った数より少なく見える（**064c で扱う**）。
⚠⚠ **ここに数え足して解決しないこと**（この関数は `EFFECT_OVERLAY_ENABLED_KEY` の値そのもの）。

## ⚠⚠ セキュリティ（docs/security.md §1 の 044a 例外へ追補済み）

**発火の契機が「ユーザーがボタンを押した瞬間」から「第三者のコメントが条件に当たった瞬間」へ広がった。**

- 壁は 064a のまま 2 枚（形式検査 ＋ **`GetInputList` の実在照合**）＋ 操作は 3 つだけ
- ⚠⚠ **第三者のコメント本文は OBS へ 1 バイトも渡らない**——渡るのは
  `sourceName`（＝**ユーザー自身が OBS で付けた名前**）だけ。本文は照合に使って捨てる（型で担保）
- 保存層にも形式検査を置いた（`isEffectObsSourceName`）＝ **多層防御の 1 枚目**。
  ⚠ **sidecar 側と規則を揃えてある**（片方だけ厳しくすると、画面から理由が読めない壊れ方になる）

## 機械で固定したこと（**+58 ケース**）

- sidecar 12 ケース: `mediaDuration` が使えない値（null / 0 / 負 / NaN / Infinity / 文字列）で
  fallback へ倒れること、⚠ **上限・下限で必ずクランプされること**（素通しは「消えない」を作る）
- 割り当て層 25 ケース: 不正なソース名が「出さない」へ倒れること（8 種）／
  ⚠⚠ **2 つのレーンが互いを塞がないこと**／出力先の丸め／窓を開く数に入らないこと／§9
- 発火層 10 ケース: OBS レーンでも N+1 の畳み込み・バースト・`updated` 無視が効くこと／
  **レーンごとに state を分ければ枠を食わないこと**／`takeFreshComments` の移設
- 画面 15 ケース: 一覧が選択肢に出ること／⚠ `:` を含む名前が壊れないこと／
  ⚠⚠ **一覧を 1 度も取っていなければ「見つかりません」と断言しないこと**／出力先が選べないこと
- コメビュ窓 8 ケース: **条件に当たったら鳴る**／条件が無ければ 1 回も鳴らない／
  同じコメントが 2 度届いても 1 回／⚠ **OBS へ渡るのはソース名だけ**

### ⚠ ミューテーションで実際に確かめたこと

| 変異 | 結果 |
|---|---|
| エフェクト窓の matcher を `=== "none"` スキップへ戻す | ✅ 2 ケースがレッド |
| `parseAssignment` のソース名検証を外す | ✅ 8 ケースがレッド |
| `parseOutput` の丸めを `=== "none"` へ戻す | ✅ 1 ケースがレッド |
| `takeFreshComments` の dedup を外す | ✅ 3 ケースがレッド |
| **発火を `setComments` の updater の中へ移す** | ⚠⚠ **生存（下記）** |

⚠⚠ **正直な限界**: 「updater の外に置く」規律は**テストで固定できていない**。
着手時は「StrictMode の二重実行で 2 回鳴る」と考えていたが、**実際に変異させて確かめたところ誤りだった**
——`takeFreshComments` の id 集合が 2 回目を先に落とすため。
⇒ **二重発火を止めているのは id 集合であり、置き場所ではない**（コードのコメントも実態に直した）。
置き場所は「updater の中で別の副作用を起こさない」という 047 / 051 と同じ規律として守る。

## 検証

`pnpm typecheck` / `lint` 緑／`pnpm test` **73 files・1816 tests 緑**
（`check:css` / `check:version` / `check:effect-contract` も OK）／
sidecar `pnpm test` 緑／`cargo test` **358 件緑**（⚠ Rust は 1 バイトも触っていない）。

## ⏳ 実機で確認すること

1. コメントビューアを開いて OBS と接続 → 「OBS のソースを取得」で一覧を取る
2. 「OBSエフェクト」画面 → **条件の `<select>` に「〇〇（OBS）」が出るか**
3. スーパーチャット等の条件に割り当て、**実際にコメントを流して鳴るか**
4. ⚠ **動画が最後まで再生されて消えるか**（＝ OBS に長さを聞けているか）
5. ⚠ **消し忘れが無いか**（配信画面に出しっぱなしにならない）
6. ⚠ OBS 側でソース名を変えたら、画面に「見つかりません」が出るか

## ⏳ 未実施

- **security-review**（⚠ **必須**。観点は docs/security.md の 064b 追補）
- **064c**（画面）／**064d**（取り込み機能の全削除・⚠ 新方式が実機で動いてから）
