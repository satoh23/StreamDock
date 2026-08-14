# 061j キーワード条件（自由テキスト）の追加

> 状態: **実装完了 ＋ 実機確認 12 項目中 11 項目を実施（2026-08-15）／⚠ 残るは⑫ OBS のカクつきだけ**。
> ⚠ **UX 再設計 061h〜061l の 3 本目。** ⚠ **実機確認の結果と観測手法は docs/progress.md の 061j 節が正。**
>
> ⚠⚠ **次に GUI で E2E をする人へ**: **WKWebView に合成キーイベントは入らない**
> （Tab・`AXPress`・座標クリックは効くが、**文字キー・貼り付け・AX の値設定はどれも React に届かない**）。
> テキスト入力を伴う確認は **localStorage へ直接仕込む**しかない。
>
> ## ⚠⚠ 着手前の想定と、実装で判明した事実の差（**先に読むこと**）
>
> 061g の実績（起票時の想定 (1)(2) が実装時に成立しなかった）と同じことが今回も起きた。
> **判断 1〜13 の結論はすべて維持されたが、根拠が 3 か所で違っていた。**
>
> | # | 起票時の想定 | 実装で判明した事実 |
> |---|---|---|
> | 穴 γ の順序 | 「割り当ての解決をバースト検査の**後ろ**へ動かすとレッドになる」 | ⚠⚠ **振る舞い等価＝レッドにならない**（変異④が GREEN）。後続 2 検査は `recentFires.length` と `lastGiftAt.has` を**読むだけ**で、書き込みは発火時だけ。⇒ 守っている不変条件は「順序」ではなく **「非マッチは state に一切触らない」**（変異④' で固定し直した） |
> | 空白の判定 | 「全角スペース `U+3000` は素の `trim()` では消えないので、NFKC の**後**で判定しないと取りこぼす」 | ⚠⚠ **事実ではない。** JS の `trim()` は `Space_Separator` を全部落とすので `U+3000` も `U+00A0` も `U+FEFF` も消える（実測）。⇒ 変異⑮-b は**等価変異**。正規化の後で判定するのは「**判定する値と照合に使う値を 1 つに保つ**」ためであって、取りこぼすからではない |
> | 判断 6 の「載せる」 | 「キーワードの正規化済み文字列は `loadEffectConditions()` が計算して**載せる**」 | ⚠ `EffectCondition` を**保存形そのもの**に保つ方針と衝突する（`JSON.stringify` に混ざる／UI が余計なフィールドを見る）。⇒ 非 export の内部型 `MatchableCondition` に載せ、**空判定と照合が同じ 1 回の正規化を共有**する形にした |
> | やること (5) の期待 | 「`EffectOverlayApp` は resolver の差し替えのみ／他は無改変で済むはず」 | ⚠ **4 か所 ＋ JSDoc**（import 名 2／`loadEffectConditions()`／第 5 引数／**先読み件数が最大 6 → 26 件**になった注記） |
> | やること (6) の期待 | 「`ObsEffectsScreen` は無改変が目標」 | ⚠ **2 行だけ差分**（`effectConditionCount(effectTemplates.conditions)` と deps）。**import は無改変**＝ 061i が「数え方を 1 か所に閉じた」効果は効いた |
> | 判断 7 の状態 | `lastConditionAt: Map<string, number>` を「既存 2 つと同じく時間窓の外を捨てる」 | ⚠ **窓が Map に残っていない**（`cooldownMs` は条件ごと）。⇒ `CONDITION_COOLDOWN_MAX_MS = 60_000` を置き、`KEYWORD_COOLDOWN_MS <= それ` を**定数整合テスト**で固定した |
>
> ⚠ **判断の全文と実測は [docs/progress.md](../progress.md) の 061j 節が正。**
> base は **HEAD = `2808f4d fix:画面をタブ分けし、表示トグルを削除した`**（061i はコミット済み）。
> 全体像・決定事項・着手前に読む制約は [docs/task-board.md](../task-board.md) の
> 「061h〜061l OBSエフェクトの UX 再設計」節が正。⚠ **行番号は書かない**（特定はシンボル名で行う）。
>
> ⚠⚠ **061k / 061l のタスクファイルはまだ書かない**（それぞれの着手直前に書く。理由は
> [061h](061h-builtin-effect-removal.md) 冒頭と同じ＝先の工程ほど前の工程の実測に依存するため）。

## 061i から引き継いだ前提（申し送り ＋ **実測との差**）

- ✅ 画面はタブ 2 枚（「コメントで出すエフェクト」／「配信イベント」＝061l まで枠だけ）
- ✅ 「エフェクトを配信画面に表示する」トグルは廃止。`EFFECT_OVERLAY_ENABLED_KEY` は
  **`useEffectTemplates` だけが書く派生値**（`commitAssignments` ＋ マウント時の再計算の 2 か所・どちらも「割り当てが正」）
- ✅ 窓の invoke は `ObsEffectsScreen` の `runEffectOverlayOp` に集約・直列化されている
- ✅ 「表示する条件」の件数は `effectConditionCount(assignments)` を見ている
  （⚠ **数え方の持ち主は `effectAssignments.ts` 1 か所**——061i が「061j で保存形が変わっても
  直すのはこの関数だけで済むように」と意図して閉じてある）
- ⚠⚠ **061h 申し送り ⑦-c は未解消のまま引き継いでいる**: `EffectAssignmentCard` の `<select>` は
  **`notInList` を消してもブラウザが先頭（＝「エフェクトを出さない」）を選ぶので値のアサーションが偶然通る**。
  061i は「順序を変えない」ことで回避したが、**061j は保存形ごと変えるので回避できない** ⇒ 下記 **やること (0)** で返済する

**⚠ 申し送りと実リポジトリの差（着手前に必ず認識すること）**

| 申し送りの記述 | HEAD の実態 |
|---|---|
| 「コミットはしていない」 | ⚠ **コミット済み**（`2808f4d`）。ワーキングツリーはクリーン |
| 「1548 tests」 | ⚠ **1555 tests / 67 files**（レビュー対応 +6・実機で見つかったガイド文言の回帰 +1） |
| 「実機確認は未確認」 | ⚠ **2026-08-15 に実施済み**（⑪ OBS のカクつきだけ未実施・`docs/progress.md` の 061i 節が正） |

⚠⚠ **ベースラインの件数は申し送りを信じず自分で実測すること**（061i は 1524 と申し送られて実測 1525 だった。
今回も同じ理由で 1548 → 1555 とずれている）。

## この段で解く問題

**条件がイベント種別 6 つに固定されていて、「〇〇という単語を含むコメント」を表現する型が無い。**
`effectEventRows.ts` が `MONETARY_EVENT_TYPES` から行を機械生成し、保存形が
`EffectAssignments = Record<eventType, EffectAssignment>` なので、**イベント種別以外の条件を書く場所が存在しない**。

⚠ **新しいデータ経路は要らない**——エフェクト窓（`EffectOverlayApp`）は 061b から
`connectCommentStream` で `CommentViewDto[]` を**全件**受けている。本文マッチは**窓のメモリ内で完結**でき、
新規 IPC も新規 localStorage 経路も不要。⚠ ただし §9 の線（第三者のコメント本文を localStorage にも画面にも出さない）は
**判断 4 で型として守る**。

---

## ⚠⚠ 設計判断（実装前に読むこと。ここを外すと配信画面が壊れる）

### 判断 1: 保存形は **単一の条件配列**にする（Record を残さない）

```ts
export type EffectConditionWhen =
  | { type: "event"; eventType: string }
  | { type: "keyword"; text: string; match: "contains" | "exact" };

export interface EffectCondition {
  id: string;
  when: EffectConditionWhen;
  /** ⚠ 既存の `EffectAssignment`（`{kind:"none"} | {kind:"template"; templateId}`）をそのまま使う。 */
  effect: EffectAssignment;
}
export type EffectConditions = readonly EffectCondition[];
```

⚠ **却下した案＝ `{ events: Record<eventType, …>, keywords: […] }` の 2 本立て。**
既存のイベント側のロジックとテストがほぼ無改変で済むぶん今回は安いが、**061k で
「条件ごとに出力先（全画面 / コーナー）を選ぶ」**を足すとき **同じフィールドを 2 か所へ書く**ことになる
（061l の配信イベントも同じ表に乗る余地がある）。⚠⚠ **「同じことを 2 通りに書かない」がこのリポジトリの
一貫した規律**（`isEffectTemplateId` を export した理由・`effectConditionCount` を 1 か所に閉じた理由）なので、
配列 1 本を採る。

⚠ **代償**＝ 保存形から「イベント条件は 6 キーちょうど」という不変条件が消える。**判断 2 で作り直す。**
⚠ **ファイル名は `effectAssignments.ts` のまま**（`git log --follow` を切らない・061d-1 の先例）。

### 判断 2: ⚠⚠ **イベント条件は eventType ごとに高々 1 件**を、読み込み時に強制する

配列にすると「スーパーチャットに 2 つのエフェクト」が **表現可能になってしまう**（Record では構造的に不可能だった）。
壊れ方は 2 つあり、どちらも黙って起きる:

1. **1 回の投げ銭で 2 件出る**＝バースト枠を 2 消費し、`EFFECT_MAX_CONCURRENT` の意味が変わる
2. **UI（6 行の `<select>`）では表現できない**＝「保存値にあるのに画面に出ない条件」が生まれる
   （061a 以来の「黙って何かが起きる／起きない状態を作らない」に真っ向から反する）

⇒ `loadEffectConditions()` が**必ず**次を満たす配列を返す:

- **前半＝イベント条件ちょうど 6 件**。`MONETARY_EVENT_TYPES` の**挿入順**（＝`EFFECT_EVENT_ROWS` と同じ並び）で、
  重複は**先勝ち**で潰し、欠けは `{ kind: "none" }` で埋め、**未知の eventType は捨てる**
- **後半＝キーワード条件**（保存順・判断 9 の検証を通ったものだけ）

⚠ **先勝ちにする理由**: 保存関数が正規化済みを書くので重複は通常発生しない。発生するのは
**手で localStorage を編集した場合か、将来のバージョンが書いた場合**だけで、そのとき「後勝ち」だと
**画面の並び（最初の行を描く）と実際に使われる値が食い違う**。先勝ちなら画面と一致する。

⇒ これで **`EffectAssignmentCard` の 6 行は今までどおり `EFFECT_EVENT_ROWS.map` で描ける**（判断 10）。

### 判断 3: 条件 id は「**イベントは固定文字列・キーワードは単調増加の連番**」

- イベント条件 … `id = "event:" + eventType`（採番不要・安定・6 個固定）
- キーワード条件 … `id = "kw:" + n`（`n` ＝ **保存済みの最大 n + 1**。⚠ **削除しても詰めない**）

⚠ **却下した 3 案**:

- **`crypto.randomUUID()`** … ⚠ jsdom / vitest 環境での有無がバージョン依存で**テストが環境で割れる**。
  さらに id が毎回変わると**アサーションが書けない**（クールダウンのテストは id を名指しする必要がある）。
- **条件の内容から導出**（`kw:<正規化済み>:<match>`） … ⚠⚠ **React の key に使うと、キーワードを 1 文字打つたびに
  key が変わって `<input>` が作り直され、フォーカスが飛ぶ**（実装で必ず踏む罠）。
- **配列の index** … 削除・並べ替えで壊れる。⚠ しかも **id はクールダウンのキーでもある**ので、
  1 件消すと**別の条件が消えた条件のクールダウンを引き継ぐ**。

⚠ 単調増加にする理由も同じで、**消した id を再利用しないこと**が
「クールダウンの取り違えが起きない」ことの担保である。

### 判断 4: ⚠⚠ resolver は「**eventType と本文だけ**」を受け、「**当たった条件の id と cooldown**」を返す

```ts
// いま:  export type EffectKindResolver = (eventType: string) => EffectKind | null;
export interface EffectMatchInput { eventType: string; text: string }
export interface EffectMatch { effect: EffectKind; conditionId: string; cooldownMs: number }
export type EffectMatcher = (input: EffectMatchInput) => EffectMatch | null;
```

- ⚠⚠ **`CommentViewDto` をそのまま渡さない**（§9・「必要ないものは持ち回らない」＝ 061b が
  `EffectRequest` に `text` / `avatar` を持たせなかったのと**同じ規律**。043a が `system_message` を
  持ち回らないと決めた先例と同型）。渡すのは判定に要る 2 つだけ。
- ⚠⚠ **戻り値に本文を載せない。** `EffectRequest` は **8 キーのまま無改変**
  ＝ **第三者の本文が発火層より先へ 1 バイトも進まない**ことが型で担保される。
  ⚠ `EffectRequest` のキー集合はテストが固定しているので、足すと落ちる。**足さないこと。**
- ⚠ `conditionId` は**ユーザー自身が作った条件の識別子**で第三者データではない（§9 の対象外）。
  ⚠ **それでも `EffectRequest` には載せない**——クールダウンの判定は `decideEffects` の中で完結するので
  載せる理由が無く、載せると「出すのに要る最小限」という 061b の規律が緩む。

### 判断 5: ⚠⚠ 課金ゲート（`isMonetaryEvent`）を `decideEffects` から resolver 側へ移す

いまの `decideEffects` は先頭で `if (!isMonetaryEvent(c.eventType)) continue;` している。
**キーワード条件は通常チャットで発火するのが目的**なので、このままだと**キーワードが永久に当たらない**。
⇒ ゲートを **イベント条件の判定の中**へ移す（`resolveEffectMatch` が
`isMonetaryEvent(eventType)` のときだけイベント条件を走査する）。

⚠⚠ **移すときの罠 3 つ**:

1. **`isMonetaryEvent(c.eventType)` であって `displayEventType` を通さない。**
   `displayEventType` は superchat＋`currency:"BITS"` を `"bits"` へ振り替えるが、`"bits"` は
   `MONETARY_EVENT_TYPES` に**無い**（あの Set は「ビッツは superchat に含まれる」前提）。
   通すと**ビッツでエフェクトが出なくなる**。061b が踏み、059b も踏み、`effectEventRows.ts` の
   `EFFECT_EVENT_LABEL` の注記が「同じ罠がここにもある」と名指ししている。
2. **穴 γ の順序を崩さない。** 「出さないと決まったものは畳み込みもバースト枠も一切消費しない」＝
   `match === null` の `continue` が **gift 畳み込み・バースト検査より前**にある構造は不変。
   ⚠⚠ **通常チャットが `null` で落ちることも、この同じ構造で守られる**——
   キーワードに当たらないチャットがバースト枠を食うと、**その直後の投げ銭が全部捨てられる**
   （061d-2 の穴 γ とまったく同型の反転。⚠ **今回のほうが遥かに起きやすい**＝通常チャットは常時流れる）。
3. `effectTrigger.ts` から `isMonetaryEvent` の import が消えるが、**`effectAssignments.ts` は既に
   `MONETARY_EVENT_TYPES` を `viewerFormat` から import している**＝ **層の向きは変わらない**。

### 判断 6: 正規化は **NFKC → toLowerCase → trim** の 1 本。**コメント 1 件につき 1 回**

```ts
const normalizeForMatch = (s: string): string => s.normalize("NFKC").toLowerCase().trim();
```

- **NFKC** … 全角英数 → 半角、半角カナ → 全角カナ。⚠ 配信のコメントは全角/半角が混ざるので、
  これが無いと「ＯＢＳ」で登録した条件が「OBS」に当たらない（逆も同じ）。
- **toLowerCase は NFKC の後**（順序を逆にすると一部の文字で結果が変わる）。
- **trim は両側に掛ける** … `exact` で「 草 」が「草」に一致しないと使い物にならないため。
  ⚠ `contains` では無害なので、**片方だけ別規則にしない**（規則を 2 通りに分けない）。
- ⚠⚠ **持ち主は 1 か所**（`effectAssignments.ts` の非 export な内部関数）。
  UI 側でも保存側でも**別の正規化を書かない**。

⚠⚠ **性能の罠（本タスクで最も見落としやすい）**:
キーワード条件が入ると **`resolveEffectMatch` が全コメントで呼ばれる**（いまは課金コメントのときだけ）。

- **本文の正規化はコメント 1 件につき 1 回**にする（resolver の中で 1 回だけ作り、全条件がその 1 つを見る）。
  ⚠ 条件ごとに正規化すると **O(条件数 × コメント数)** になる。
- **キーワード側の正規化済み文字列は `loadEffectConditions()` が計算して載せる**
  （⚠ **保存はしない**——正規化済みを保存すると画面に出す文字が変わってしまう）。
- ⚠⚠ **「発火のたびに localStorage を読み直す」規律は変えない**（061d-2 の判断。キャッシュすると
  「main 窓で変えたのに古い値で判断する」形が復活する）。⚠ **測っていない最適化をしない**——
  毎秒数件〜数十件で数百バイトの `JSON.parse` は問題にならない見込み。
  ⚠ **再修正トリガー＝実機確認④（高頻度コメントでカクつく）が実際に出たとき。** そのときは
  **「`decideEffects` の 1 呼び出しにつき 1 回だけ読む」（バッチ単位のメモ化）**へ寄せること
  ——同じ tick 内で値が古くなることは無いので規律を壊さない。⚠ **窓を跨ぐキャッシュにはしない。**

### 判断 7: クールダウンは **条件 id 単位**。`cooldownMs` は resolver が返す

`EffectTriggerState` に 1 本足す:

```ts
/** 直近にその条件で発火した時刻(ms)。⚠ 既存 2 つと同じく decideEffects の先頭で時間窓の外を捨てる。 */
lastConditionAt: Map<string, number>;
```

判定は `match === null` の直後・**gift 畳み込みより前**（＝「出さないと決まったものは状態に触らない」の一部）:

```ts
if (match.cooldownMs > 0) {
  const last = state.lastConditionAt.get(match.conditionId);
  if (last !== undefined && now - last < match.cooldownMs) continue;
}
```

⚠ **記録は実際に出したときだけ**（`recentFires` / `lastGiftAt` と同じ規律。バーストで捨てた分まで記録すると
「1 度も出ない」が起きる）。

**値＝ `KEYWORD_COOLDOWN_MS = 10_000`（イベント条件は `0` ＝ 無効）**

- 根拠: エフェクトの表示時間は `manifest.durationMs`（500〜15000ms）。同じキーワードに毎回反応すると重なり続ける。
  「同じ単語には 10 秒に 1 回まで」なら、視聴者が連呼しても画面が埋まらず、反応が返っている感覚は残る。
- ⚠ **イベント条件に効かせない理由**: 課金は 1 件ずつが重要（スパチャ 2 連投の 2 件目を落としたくない）。
  連投対策は既存の gift 畳み込み（[043a] の N+1）とバースト上限が既に担っている。
- ⚠ **設定項目にしない**（「たぬえさ3 より簡単に」＝設定を増やさない・061d の (2) と同じ規律）。
  **再修正トリガー＝実機で「反応が鈍い／うるさい」と言われたとき。**
- ⚠⚠ **`BURST_MAX` とは別軸である。** バーストは「**窓全体で** 5 秒に 3 件」、クールダウンは
  「**その条件が** 10 秒に 1 件」。片方だけでは次を止められない:
  - クールダウンだけ … 別々のキーワード 3 つが同時に来て 3 件同時に出る
  - バーストだけ … 同じキーワードが 6 秒おきに来続けて出続ける
- ⚠ **`cooldownMs` を resolver の戻り値に載せる**ことで、`decideEffects` の分岐は 1 つで済む
  （「イベントかキーワードか」を発火層が知らなくてよい＝ 061b の「発火層は割り当てを知らない」の維持）。

### 判断 8: 旧形式（Record）は**読み込み時に 1 回だけ変換する**。キーは同じまま

⚠ 061h は移行コードを書かなかったが、**あれは「未知 kind → 出さない」という前方互換が形として成立していた**から。
今回は**ルートの形が Object → Array** なので、その仕組みが効かない
（`Array.isArray(parsed)` の検査に引っかかって **061i でせっかく設定した条件が全部消える**）。

⇒ `loadEffectConditions()` の入口で「**ルートが配列でない Object なら旧形式**」として変換する。

- ⚠ 変換は**1 本道**（同じ規則を 2 通りに書くことにはならない＝ 061h が移行コードを書かなかった理由に抵触しない）。
- ⚠ **読むだけでは書き戻さない**（読み込みが副作用を持たない）。次に保存したとき新形式になる。
- ⚠⚠ **キーは `EFFECT_ASSIGNMENTS_KEY` のまま。** 新しいキーを作ると旧キーが残骸として残り、
  どちらが正か分からなくなる。同じキーなら**旧ビルドへ戻したときも `Array.isArray` で弾かれて
  「全部出さない」＝安全側**へ倒れる（061h が作った「未知は安全側」と同じ向き）。
- ⚠ 061h が置いた「以前のバージョンで『組み込み（名前と金額）』を…」の `<p>` は**残す**
  （削除の再修正トリガーは 061h が別に持っている）。

### 判断 9: キーワードの制限は **保存時と読み込み時の両方**で掛ける

- ⚠⚠ **空文字・空白のみを保存しない。** `"".includes(…)` は **全コメントに一致する**＝
  配信画面がエフェクトで埋まる。**本タスクで最も危険な失敗モード。**
  ⇒ 保存時に弾き、**読み込み時にも落とす**（手で localStorage を編集された場合の 2 枚目）。
- **長さ上限 32 文字**（正規化前の生テキスト）。根拠＝「キーワード」であって文章ではない。
  ⚠ localStorage を無制限に太らせない。
- **キーワード条件は最大 20 件。** 根拠＝ 6 行のイベント条件と並べて 1 画面で読める上限であり、
  **全コメント × 条件数の走査コストの上限**でもある（判断 6）。
- ⚠ **制御文字を落とす**（`U+0000〜U+001F` と `U+007F`）。表示と保存値の両方が壊れるのを防ぐ。
- ⚠⚠ **正規表現として解釈しない。** 041b が「ユーザー入力は `kind:"text"` 固定＝**任意正規表現を書かせない**」と
  決めた先例と同じ規律（`readingDictionary.ts` の `ReadingRule` の JSDoc が正）。
  ⚠ 使うのは `String.prototype.includes` と `===` **だけ**。
- ⚠⚠ **§9 の線**: キーワードは**ユーザー自身の入力**なので localStorage に保存してよい
  （`docs/security.md`「レビュー必須条件」の当該項が「**ユーザー自身の UI 設定値**（テーマ・フォント・
  トグル・チャンネル名等）を localStorage に置く変更は本項に該当しない」と明示している）。
  ⚠ **ただしエフェクト窓の DOM にも `EffectRequest` にも出さない**——出す理由が無く、出すと
  「条件に書いた単語が配信画面に出る」という予期しない露出になる。

### 判断 10: UI は「**イベント条件（固定 6 行）＋ キーワード条件（可変）**」の 2 ブロック

⚠⚠ **061d の (2)（「条件を追加」ボタンで行を増やさない）は、イベント条件についてだけ維持する。**
キーワードは**本質的に可変長**なので追加ボタンが要る——しかし 061d が避けたかったのは
**「たぬえさ3 のタグをコピペで増やす手作業」**であって、「増やせること」そのものではない。

- **イベント条件の 6 行**は今までどおり**最初から全部並んでいる**（追加も削除もできない）
- **キーワード条件だけ**「条件を追加」で増やす（各行に削除ボタン）

1 行の構成: `[キーワード入力] [含む / 完全一致] [エフェクト <select>] [削除]`

- ⚠ `formLayout.module.css` の `.field input` / `.field select` を使う
  （**新しい px / weight を発明しない**＝ 061a の要件。⚠ `.fieldHelp` も同様）
- ⚠ 新しい CSS が要るのは**行のレイアウトだけ**（`ObsEffectsScreen.module.css` の
  `.assignmentRow` に倣う）。⚠ **生 hex / `rgba()` を書かない**（`theme.css` のトークンのみ）
- ⚠⚠ **`<select>` の選択肢の中身と順序は 1 文字も変えない**（061h ⑦-c ／ やること (0)）

⚠⚠ **1 コメントに出るエフェクトは 1 つだけ**（判断 11）を**画面に書くこと**。

### 判断 11: ⚠⚠ 1 コメントに複数の条件が当たったら **最初の 1 件だけ**出す

1 つのコメントが複数条件にヒットしうる（「草」と「w」の両方を含む・スパチャの本文にキーワードが入っている）。
全部出すと **1 コメントで N 件**＝バースト枠を一瞬で食い尽くす。
⇒ **走査順で最初に当たった 1 件だけ**（＝`EffectMatcher` が `EffectMatch | null` を返す形がそのまま答え）。

走査順は **イベント条件（6 行・固定順）→ キーワード条件（保存順）**。帰結:

- ⚠ **課金コメントにキーワードも当たる場合はイベント条件が勝つ。**
  投げ銭のほうが重要度が高く、ユーザーが**明示的に種別へ割り当てた**ものだから。
- ⚠⚠ **キーワードは種別を問わず当たる**（スパチャ本文の「草」でも当たる）。
  ⚠ **却下した案＝「課金コメントはキーワード判定の対象外」**——「キーワードを設定したのに、
  たまたまスパチャで書かれると出ない」という**説明しづらい穴**を作るため。
- ⚠⚠ **`effect.kind === "none"` の条件は走査でスキップする**（＝「当たった」扱いにしない）。
  そうしないと「スーパーチャットを『出さない』にしている」だけでキーワードが塞がれる。
  ⚠ これは `effectConditionCount` が `kind === "template"` だけ数えているのと**同じ規則**である。

### 判断 12: ⚠⚠ 通常チャットで出すと**文字が出ない**（実コードで確認済み・仕様として受け入れる）

実コードを追った結果（`viewerFormat.ts` / `effectTemplateText.ts`）:

| 値 | 通常チャットのとき |
|---|---|
| `commentAmount(...)` | `monetaryAmount` も `monetary` も無いので **`null`** |
| `composeEventMessage(c)` | `"chat"` は switch の default → **`null`** |
| `eventLabel(displayEventType(c))` | `EVENT_LABEL["chat"]` が無いので **`""`** |

⇒ `effectTemplateLine` は `amountText === null` なので **`templateWithoutAmount`（既定 `"{message}"`）** を使い、
`{message}` が `""` に置換され、**`line.trim() === ""` で `null`＝ 1 行も描かれない**。
⇒ **キーワードで出したエフェクトは「メディアだけ出て文字は出ない」**（既定のテンプレートの場合）。

⚠ **これは仕様として受け入れる**:

- ⚠⚠ **`{text}`（コメント本文）を差し込み変数に足さない。** 061b が `EffectRequest` に `text` を
  持たせなかった §9 の担保そのもので、足すと**第三者の自由入力が配信画面に大写しになる**（荒らし耐性が下がる）。
  ⚠ `docs/security.md` §8 の 061c 節が **「変数を増やすときは §9 の観点で再評価すること」** と要求しており、
  Rust の `ALLOWED_TEMPLATE_VARS` と対で増やす**両側の変更**になる（＝ **本タスクの範囲外**）。
- ⚠ **テンプレート作者側で解決できる**——`templateWithoutAmount` に `{name}` を書けば「〇〇さん」は出る（既存の仕組み）。

⇒ **画面で明示する**（「キーワードで出したときは、金額やイベント名の文字は出ません」）。
⚠ **再修正トリガー＝「キーワードのときも何か文字を出したい」と言われたとき。** そのときは `{text}` ではなく
**条件ごとの固定文言（ユーザーが入力した文字列）**を足す方向で検討すること（**第三者データ面を増やさない**）。

### 判断 13: 削除確認文は「イベント種別」だけでは足りなくなる

`useEffectTemplates.eventTypesUsing(templateId): string[]` を `EffectTemplateCard` が
`EFFECT_EVENT_LABEL` でラベル化して確認ダイアログに出している。
⚠ **キーワード条件がそのテンプレートを指していると、削除しても確認文に出ない**＝
「消したら知らないうちに条件が『表示しない』へ戻っていた」。

⇒ **`conditionLabelsUsing(templateId): string[]`** へ変え、**ラベル化の責務を hook 側へ移す**
（イベント＝`EFFECT_EVENT_LABEL` の値／キーワード＝`「〇〇」を含むコメント` 等）。

- ⚠ キーワードはユーザー自身の入力なので確認ダイアログに出してよい（§9）。
- ⚠ **React のテキストノードとして描く**（`ConfirmDialog` の `details` は既に `ReactNode`）。

---

## やること

### (0) ⚠⚠ 先に `notInList` のテストを実値アサーションへ強化する（061h ⑦-c の返済）

061i 申し送りの引き継ぎ事項:
> 061j で保存形を配列へ変えると UI もほぼ確実に触るので、**先に `notInList` のテストを
> 実値アサーションへ強化してから**順序を動かすこと。

⚠ 本タスクは**順序を変えない**が、**保存形が変わって `value` の組み立てが変わる**以上、
「ブラウザが選択肢の先頭（＝たまたま『エフェクトを出さない』）を選ぶ」偶然に乗ったままにはできない。

⇒ `EffectAssignmentCard.test.tsx` の `notInList` 系ケースを、
**選択肢の先頭が何であっても落ちる形**（＝ `<select>` の `value` が明示的に `NONE_VALUE` であることと、
`missing` の警告文の有無を**別々に**見る形）へ強化する。⚠ **この作業は保存形の変更より前に、単独で緑にすること。**

### (1) `effectAssignments.ts` を条件配列へ

- 型（判断 1）／読み込み時の正規化（判断 2）／id の採番（判断 3）／旧形式の変換（判断 8）／
  キーワードの検証（判断 9）／`normalizeForMatch`（判断 6）
- `resolveEffectKind` → **`resolveEffectMatch`**（判断 4・5・11）
- `effectConditionCount` / `hasEffectConditions` … **配列版へ**（⚠ 呼び出し側は無改変で済むはず）
- `assignedTemplateIds` … 配列を走査する形へ（⚠ **戻り値の意味＝重複を潰した id 集合は不変**）
- `clearAllEffectAssignments` … **すべての条件の `effect` を `{kind:"none"}` へ**。
  ⚠⚠ **キーワード条件そのものは消さない**——これは**復帰導線**であってリセットではない
  （テンプレートを削除しないのと同じ判断。ユーザーが打った文字列を勝手に捨てない）。
  ⚠ 文言は「すべての条件を『表示しない』に戻す」へ。
- `clearEffectAssignmentsForTemplate` … 同様に配列版へ（⚠ **キーワード条件も対象**）
- `saveEffectConditions` の「全部が既定ならキーごと削除」…
  ⚠ **「イベント条件が全部 `none` **かつ** キーワード条件が 0 件」のときだけ削除**
  （キーワード行が 1 件でも在れば、`effect` が `none` でも**ユーザーのデータ**なので消さない）

### (2) `effectTrigger.ts` に本文マッチとクールダウンを載せる

- `EffectKindResolver` → `EffectMatcher`（判断 4）
- 課金ゲートの移動（判断 5・⚠ **罠 3 つ**）
- `EffectTriggerState.lastConditionAt` の追加と、**先頭での時間窓の掃除**（判断 7）
- ⚠ **`EffectRequest` は無改変**（8 キーのまま）

### (3) `EffectAssignmentCard.tsx` に「キーワード条件」ブロックを足す（判断 10）

- イベント条件の 6 行は**現状維持**（⚠ `<select>` の選択肢の中身と順序は 1 文字も変えない）
- キーワード行 ＋「条件を追加」／行ごとの削除
- ⚠ 文言に足すもの: **1 コメントに出るのは 1 つだけ・上から順に最初に当たったものが使われる**（判断 11）／
  **キーワードで出したときは金額やイベント名の文字は出ない**（判断 12）／
  **同じキーワードは少し間隔を空けて反応する**（判断 7・⚠ **秒数を断言しない**＝定数が変わっても嘘にならない書き方）

### (4) `useEffectTemplates.ts`

- `setAssignment(eventType, assignment)` → 条件 API（`setConditionEffect(id, effect)` /
  `addKeywordCondition()` / `updateKeywordCondition(id, when)` / `removeCondition(id)`）
- ⚠⚠ **これら全部が `commitAssignments` を通ること**（061i 判断 2 の「派生値の書き手を 1 か所に閉じる」）。
  ⚠ **`runDelete` 経由が 3 本目**という 061i の注意はそのまま生きている
- `eventTypesUsing` → `conditionLabelsUsing`（判断 13）

### (5) `EffectOverlayApp.tsx`

- `decideEffects` へ渡す resolver を `resolveEffectMatch` へ差し替え
- ⚠ `warmTemplates` / `assignedTemplateIds` / `EFFECT_ASSIGNMENTS_KEY` の `storage` 購読は**無改変で済むはず**
  （関数側が配列を受けるようになるだけ）。**済むはず、で終わらせず実際に確認すること。**

### (6) `ObsEffectsScreen.tsx`

- ⚠ **無改変が目標**（前提ステータスの「表示する条件」は `effectConditionCount` を見ており、
  061i が「保存形が変わってもここは無改変」と意図して閉じてある）。**差分が出たら、なぜ出たかを申し送りに書くこと。**

### (7) docs

- `docs/progress.md` に **061j 節**（判断 1〜13 の根拠・実測・実機確認手順）
- `docs/task-board.md` の 061j を完了化 ＋ **061k への申し送り**

## やらないこと

- **出力先（全画面 / コーナー）の選択** … 061k。⚠ `EffectCondition` に `output` フィールドを**先回りで足さない**
- **配信イベントの中身** … 061l（タブの枠は 061i が用意済み）
- **正規表現・ワイルドカード・NG ワード・複数キーワードの AND/OR** … ⚠ 041b の規律（ユーザーに正規表現を書かせない）
- **金額の閾値による出し分け** … 061d-2 の再修正トリガーのまま（「高額だけ豪華にしたい」と言われたとき）
- **クールダウン秒数の設定 UI** … 判断 7（設定を増やさない）
- **`EffectRequest` に `text` / `conditionId` を足す** … 判断 4・12
- **差し込み変数 `{text}` の追加** … 判断 12（Rust の `ALLOWED_TEMPLATE_VARS` と対の両側変更＋§9 の再評価が要る）
- **`<select>` の選択肢の中身と順序の変更** … 061h ⑦-c（(0) で**テストは強化する**が、順序は動かさない）
- **`EffectAssignmentCard.test.tsx` の弱い待ち合わせ 16 か所の一括置換** … 061i レビュー Q-3 で別タスク化済み

## 対象ファイル

**変更**
- `apps/desktop/src/screens/obs-effects/effectAssignments.ts`（**本タスクの中心**）
- `apps/desktop/src/screens/obs-effects/effectTrigger.ts`
- `apps/desktop/src/screens/obs-effects/EffectAssignmentCard.tsx`
- `apps/desktop/src/screens/obs-effects/useEffectTemplates.ts`
- `apps/desktop/src/screens/obs-effects/EffectTemplateCard.tsx`（判断 13 のラベル化を hook へ移すぶん）
- `apps/desktop/src/screens/obs-effects/EffectOverlayApp.tsx`（resolver の差し替えのみ）
- `apps/desktop/src/screens/obs-effects/ObsEffectsScreen.module.css`（キーワード行のレイアウトだけ）

**差分ゼロ（要件）**
- `apps/desktop/src/screens/obs-effects/effectEventRows.ts`（⚠ 6 行の定義は不変＝判断 2 の成立条件）
- `apps/desktop/src/screens/obs-effects/effectTemplateText.ts` / `EffectTemplateView.tsx`（判断 12）
- `apps/desktop/src/features/comment-viewer/overlaySettings.ts`（⚠ **キーを増やさない**＝判断 8）
- `apps/desktop/src/features/comment-viewer/` の `effectOverlayRestore.ts` / `windowApi.ts` /
  `commentStream.ts` ／ `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx` ／ `App.tsx`
- `apps/desktop/src-tauri/` ／ `capabilities/` ／ `tauri.conf.json` ／ `apps/comment-sidecar/` ／
  `package.json` ／ `pnpm-lock.yaml` ／ **`docs/security.md`** ／ `.github/`

⚠⚠ **`docs/security.md` の差分ゼロは「確認せずに主張しない」こと。** 実装後に §8（ユーザー入力）・
§9（ログ／保存）・「レビュー必須条件」・「コメントビューア方針」を読み直し、**本当に何も増えていないか**を
自分で確かめてから空だと書く。現時点の判定と根拠は次のとおり:

- キーワードは**ユーザー自身の UI 設定値**＝「レビュー必須条件」の保存ポリシー項が**明示的に除外**している
- 新規 egress・新規 capability・新規ファイル操作・新規 IPC は**ゼロ**（本文マッチは窓のメモリ内で完結）
- 差し込み変数は**増やさない**（判断 12）＝ §8 の 061c 節の再評価トリガーを踏まない
- ⚠ **security.md の更新が要る側へ倒れる変更**＝ `{text}` を足す／キーワードを Rust へ渡す／
  本文を localStorage へ書く。**どれかをやりたくなったら、その時点で止まって相談すること。**

⚠ **レビューの重さ**: 上記のとおり `security-review` は**必須条件に該当しない**が、
**第三者のコメント本文が新しい層（`effectAssignments.ts`）を通るようになる**ので、
**軽レビュー＋§9 の観点（本文が戻り値・DOM・localStorage・ログに漏れていないこと）だけは明示的に見ること。**

## テスト

**⚠ ベースライン＝ 67 files / 1555 tests**（2026-08-15 実測・全緑）。⚠ **自分でも実測して確認すること。**

**書き換えが要る既存ケース**

| ファイル | 書き換えの理由 |
|---|---|
| `effectAssignments.test.ts`（23 ケース） | 保存形が変わるので**ほぼ全面**。⚠ 旧形式の変換（判断 8）を**新規に**足す |
| `effectTrigger.test.ts`（28 ケース） | resolver の形が変わる（判断 4）。⚠ **「出さない種別はバースト枠も畳み込み状態も消費しない」は必ず残す**（穴 γ） |
| `EffectAssignmentCard.test.tsx`（17 ケース） | (0) の強化 ＋ キーワードブロックの追加 |
| `EffectTemplateCard.test.tsx` | 削除確認文が `conditionLabelsUsing` 由来になる（判断 13） |
| `EffectOverlayApp.test.tsx`（62 ケース） | resolver の差し替え。⚠ **通常チャットで発火するケースが初めて要る** |
| `ObsEffectsScreen.test.tsx`（37 ケース） | ⚠ **無改変が目標**（判断・(6)）。差分が出たら理由を申し送りに書く |

**⚠⚠ 新規に必ず要るケース**

1. **キーワード「草」を含む通常チャットでエフェクトが出る**（＝課金ゲートの移動が効いている・判断 5）
2. ⚠⚠ **ビッツ（`eventType:"superchat"` ＋ `currency:"BITS"`）でイベント条件が効く**
   （＝`displayEventType` を通していないこと・判断 5 の罠 1）
3. **`exact` で部分一致では出ない／`contains` では出る**
4. **全角・大文字で登録したキーワードが、半角・小文字のコメントに当たる**（判断 6）
5. ⚠⚠ **キーワードに当たらない通常チャットは、バースト枠も gift 畳み込み状態も消費しない**
   （＝**キーワード条件を入れたせいで投げ銭が捨てられる**ことが無い・判断 5 の罠 2）
6. ⚠⚠ **同じ条件は `KEYWORD_COOLDOWN_MS` 内で 1 回だけ出る／別の条件はクールダウンを共有しない**（判断 7）
7. **イベント条件にはクールダウンが効かない**（スパチャ 2 連投で 2 件出る）
8. ⚠⚠ **1 コメントに複数条件が当たっても 1 件しか出ない／イベント条件がキーワードより先に勝つ**（判断 11）
9. ⚠⚠ **`effect.kind === "none"` の条件は走査をスキップする**
   （＝スパチャを「出さない」にしていてもキーワードは当たる・判断 11）
10. ⚠⚠ **空文字・空白のみのキーワードは保存されず、保存値に混ざっていても読み込みで落ちる**
    （＝**全コメントに一致しない**こと。**本タスクで最も危険な失敗モード**・判断 9）
11. **32 文字超・21 件目・制御文字入りが落ちる**（判断 9）
12. ⚠⚠ **旧形式（Record）の保存値が 6 件のイベント条件へ変換される／読んだだけでは書き戻さない**（判断 8）
13. ⚠⚠ **イベント条件が重複した保存値は先勝ちで 1 件に潰れ、欠けは `none` で埋まり、未知 eventType は捨てられる**
    （＝ 6 件ちょうど・`EFFECT_EVENT_ROWS` と同じ並び・判断 2）
14. **キーワード条件の id が単調増加で、削除しても再利用されない**（判断 3）
15. ⚠⚠ **キーワード条件がテンプレートを指しているとき、削除確認文にそのキーワードが出る**（判断 13）
16. ⚠⚠ **キーワード条件を足したとき／消したときも `EFFECT_OVERLAY_ENABLED_KEY` が追従する**
    （＝**061i の「派生値の書き手を 1 か所に閉じる」が新しい経路でも守られている**こと）
17. ⚠⚠ **エフェクト窓の DOM にコメント本文が出ない**（既存の §9 ケースを、**キーワードで発火した場合について**も追加）

## 検証

```bash
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test     # vitest + check:css + check:version + check:effect-contract
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # 無変更（緑が期待）

# ⚠⚠ 差分ゼロ（すべて空が期待）
git diff -M HEAD -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
git diff -M HEAD -- apps/desktop/package.json pnpm-lock.yaml docs/security.md
git diff -M HEAD -- apps/desktop/src/features/comment-viewer/ apps/desktop/src/App.tsx \
  apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx
git diff -M HEAD -- apps/desktop/src/screens/obs-effects/effectEventRows.ts \
  apps/desktop/src/screens/obs-effects/effectTemplateText.ts \
  apps/desktop/src/screens/obs-effects/EffectTemplateView.tsx

# ⚠⚠ §9: 本文が発火層より先へ進んでいないこと（EffectRequest のキーが 8 個のままであること）
grep -rn "text" apps/desktop/src/screens/obs-effects/effectTrigger.ts

# ⚠ 派生値の書き手が 1 か所に閉じたままか（useEffectTemplates 以外から呼ばれていないこと）
grep -rn "saveEffectOverlayEnabled" apps/desktop/src

# ⚠ 正規化の持ち主が 1 か所か（effectAssignments.ts の中だけであること）
grep -rn "normalize(\"NFKC\")\|toLowerCase()" apps/desktop/src/screens/obs-effects

# ⚠ 正規表現化していないこと（ヒットゼロが期待）
grep -rn "new RegExp" apps/desktop/src/screens/obs-effects
```

⚠ **変異検証（実測して progress.md に記録）**

| # | 変異 | 期待 |
|---|---|---|
| ① | 空文字キーワードの検査を外す | レッド（新規 10・⚠ **最も危険な失敗モード**） |
| ② | 課金ゲートを `decideEffects` の先頭へ戻す | レッド（新規 1） |
| ③ | ⚠ ゲートを `isMonetaryEvent(displayEventType(c))` にする | レッド（新規 2・**ビッツで出なくなる**） |
| ④ | resolver の呼び出しをバースト検査の**後ろ**へ動かす | レッド（新規 5・穴 γ） |
| ⑤ | クールダウンの記録を「捨てたときも記録する」に変える | レッド（⚠ 1 度も出なくなる） |
| ⑥ | `cooldownMs > 0` の判定を外して全条件に効かせる | レッド（新規 7） |
| ⑦ | 複数ヒットで全部出すようにする | レッド（新規 8） |
| ⑧ | `kind === "none"` の条件も「当たった」扱いにする | レッド（新規 9） |
| ⑨ | 正規化から NFKC を外す／`toLowerCase` を外す | レッド（新規 4・**別々に試すこと**） |
| ⑩ | イベント条件の重複を後勝ちにする／欠けを埋めない | レッド（新規 13） |
| ⑪ | 旧形式の変換を消す | レッド（新規 12） |
| ⑫ | キーワード条件を `commitAssignments` を通さず直接保存する | レッド（新規 16・061i 判断 2 の維持） |
| ⑬ | id の採番を「配列長 + 1」にする（＝削除で再利用される） | レッド（新規 14） |
| ⑭ | `conditionLabelsUsing` からキーワード条件を落とす | レッド（新規 15） |
| ⑮ | ⚠ **自分で考えた変異も試すこと**（守備範囲の穴の探索） | — |

⚠⚠ **061h の変異⑤／061i の変異⑨-b が生存した教訓を繰り返さないこと**——
**「何も出ない」だけを見るアサーションでは殺せない変異がある。**
`clearFailed` / `missHandledRef` のときと同様、**その操作自身の副作用と、観測したい状態変化を分けて数える**こと
（例: ⑤ は「1 回も出ない」を、**発火回数のカウント**で見る）。

## ⚠⚠ 実機確認（未実施のまま完了にしないこと）

### ⚠⚠ dev-mock の実測（**穴 δ の代替はこの表から作る**・2026-08-15 にコードを追って確認）

`EMIT_INTERVAL_MS = 1800` / `CONNECT_DELAY_MS = 600`。⚠ **YouTube だけ start** すれば `seq` は 1,2,3,… と単調。
⚠⚠ **`MOCK_TEXTS` は provider ごとに固定 6 本で、「草」を部分文字列として含むより長い本文は 1 本も無い**
（`LONG_CHAT_TEXT` / `LONG_SUPERCHAT_TEXT` にも無い）＝ **「草生える」は作れない**。

| seq | 到達 | eventType | 本文 |
|---|---|---|---|
| 2 | 2.4s | chat | ナイスプレイ👏 |
| 4 | 6.0s | chat | スパチャ投げます |
| 5 | 7.8s | **superchat** | **草**（⚠ `seq%5===0` は本文を上書きしない） |
| 6 | 9.6s | chat | こんばんは〜 |
| 11 | 18.6s | chat | **草** |
| 13 | 22.8s | chat | 初見です！ |
| 17 | 29.4s | chat | **草** |
| 18 | 31.2s | chat | こんばんは〜 |

⚠ `seq%20===7`（membership）と `13/14`（gift）は **`text = ""`**（＝穴 ε の実物）。

### 手順

1. キーワード条件を 1 件足すと**窓が自動で開く**（061i の派生値が新しい経路でも効いている）。
   ⚠ **開くのは「エフェクトを選んだ瞬間」**（キーワードを打っただけでは 0 件のまま）
2. ⚠ **通常チャットに「草」と書くとエフェクトが出る**（＝ 061j の本命）。
   ⇒ キーワード **「草」／含む** を 1 件、イベント 6 行は全部「出さない」。
   **7.8s（スパチャ「草」＝ 項目 6 と同時に取れる）と 18.6s（通常チャット「草」）で出る**（間隔 10.8s > クールダウン）
3. ⚠ **完全一致 / 含む** … ⚠⚠ **「草生える」は dev-mock に無いので「こんばん」で代替する**:
   ① 「**こんばん**」／含む → 9.6s の「こんばんは〜」で**出る**
   ② 同じ条件を**完全一致**へ切り替え → 31.2s の「こんばんは〜」では**出ない**
   ③ キーワードを「**こんばんは〜**」／完全一致 へ変更 → 次の「こんばんは〜」で**出る**
   （同型の代替として「初見」/「初見です！」＝ 22.8s も使える）
4. ⚠⚠ **コメントが高頻度で流れる状況でカクつかない**（判断 6 の性能の罠）。
   ⚠⚠ **dev-mock の下限は「2 provider 同時 ＝ 0.9 秒/件」で、それ以上は上げられない**
   （`EMIT_INTERVAL_MS` を触ると `apps/comment-sidecar/` の差分ゼロ要件に触れる／
   実配信につなぐのは外部通信なので避ける）。⇒ **走査コストの最悪ケースで代替する**＝
   **キーワード条件 20 件（上限）を登録**して 0.9 秒/件を流し、項目 12 と**同時に**見る。
   ⚠ **「本当の高頻度は再現できていない」と正直に記録すること。**
   ⚠ カクついたら `resolveEffectMatch` の JSDoc が示す `createEffectMatcher()`（バッチ単位）へ寄せる
5. ⚠⚠ **同じ単語を連呼しても出続けない**（クールダウン・判断 7）／**別々の単語なら続けて出る**。
   ⇒ ⚠ **dev-mock は同じ本文が 10.8 秒周期でしか来ないので、頻出 1 文字で作る**:
   キーワード「**す**」／含む を**1 件だけ**登録（イベント 6 行は全部「出さない」）。
   当たるのは 0.6s / 6.0s / 17.4s / 22.8s / 28.2s / 33.6s の **6 件**だが、
   クールダウン 10 秒なので**出るのは 0.6s / 17.4s / 28.2s の 3 件だけ**
   ＝ **「6 件当たって 3 件しか出ない」**を目視する。
   ⇒ 「別々の単語なら続けて出る」は「**ナイス**」と「**こんばん**」を登録し、
   2.4s と 9.6s で**連続して出る**ことを見る（条件が違うのでクールダウンを共有しない）
6. ⚠ **スーパーチャットを「エフェクトを出さない」にしていても、本文のキーワードでは出る**（判断 11）
7. ⚠ **スパチャ本文にキーワードが入っているとき、イベント条件のほうが出る**（判断 11）
8. ⚠⚠ **キーワードで出したエフェクトは文字が出ない**ことを目で確認する（判断 12）／
   `templateWithoutAmount` に `{name}` を書いたテンプレートなら名前が出る
9. ⚠⚠ **旧形式からの移行**: 061i までの端末の保存値（`…effect-assignments` が Record）のまま
   アプリを開き、**イベント条件 6 行がそのまま残っている**こと（判断 8）。
   ⚠ **dev ビルドは本番と localStorage を共有しない**（オリジンが違う。061i の progress.md 参照）ので、
   値を仕込むときはこの区別が要る
10. ⚠ 全角・大文字で登録したキーワードが、半角・小文字のコメントに当たる（判断 6）。⇒ 2 通り試す:
    - YouTube のみ: 半角カナ「**ﾅｲｽ**」／含む → NFKC で「ナイス」になり「ナイスプレイ👏」（2.4s / 13.2s）に当たる
    - Twitch も start: 全角小文字「**ｇｇｗｐ**」／含む → NFKC ＋ `toLowerCase` で「ggwp」になり「GGWP」に当たる
      （⚠ **NFKC と `toLowerCase` を 1 発で確認できる**のでこちらを主にする）
11. ⚠ テンプレートを削除したとき、**キーワード条件も確認文に出る**（判断 13）
12. ⚠ **061d-2 から持ち越しの実機確認⑧（OBS キャプチャのカクつき）をここで消化してよい**
    （061i でも未実施のまま残っている。⚠ 項目 4 と同時に見られる）
