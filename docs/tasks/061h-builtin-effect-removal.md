# 061h 組み込みエフェクトの廃止と、既定「出さない」への反転

> 状態: **実装完了（2026-08-14）／⚠ 実機確認は未実施**。⚠ **実機で UX が破綻していることが分かって立てた再設計 061h〜061l の 1 本目。**
> 全体像と決定事項は下記「親計画」を参照。⚠ **行番号は書かない**（特定はシンボル名で行う）。
>
> ⚠⚠ **判断と根拠・実測結果は [docs/progress.md](../progress.md) の 061h 節が正**（本ファイルは着手前の計画）。
> **着手前の計画と実装で判明した事実の差**は下記 3 点:
>
> 1. ⚠ **`scripts/check-css-guards.mjs` に手が入った**（計画では「差分ゼロ」の外だが挙げていなかった）——
>    (10-r) が `.effectStack` の `position: relative` / `z-index: [1-9]` を**必須として検査していた**ので、
>    `.effectStack` を消すと `pnpm check:css` が落ちる。2 期待値を落とし注記を実態へ書き換えた。
> 2. ⚠ **変異②は「レッド」ではなく「型エラー」になった**——`ShownEffect.template` を非 null にしたので
>    `showEffect(request, null)` が型として書けない。型を戻した版（②'）を別途実測してレッドを確認した。
> 3. ⚠⚠ **変異⑤（テスト表示の id 検証を外す）が最初に生存した**——形の壊れた id はどのみち
>    一覧に無いので「何も出ない」だけでは観測できなかった。**IPC を起こさないこと**を見る 1 行を足して塞いだ。

## 親計画のなかでの位置

061a〜061g で機能は揃ったが、実機確認で **UX が破綻している**ことが判明した。再設計を 5 本（061h〜061l）に割り、
**依存順にこの 061h から始める**。全体像・決定事項・着手前に読む制約は
[docs/task-board.md](../task-board.md) の「061h〜061l OBSエフェクトの UX 再設計」節が正。

⚠⚠ **061i〜061l のタスクファイルは、それぞれの着手直前に書く**（いま 5 本まとめて書かない）。
理由は [061g](061g-shared-primitives-extraction.md) の実績——あれは起票時に書いたタスクファイルの
**想定 (1)(2) が実装時に成立しないことが判明**し（`.confirm*` の 5 中 4 が共有だった／`.btn` 系が 25 箇所あった）、
冒頭に「着手前の想定と実装で判明した事実の差」表を追記する羽目になった。
**先の工程ほど、前の工程の実測結果に依存する**ので、確定していないことを完成品として書かない。

⚠⚠ **なぜ 061h が最初か**: 061i は「**条件が 1 つでも有効なら窓を開く**」へ変えて表示トグルを消すが、
いまの既定は `DEFAULT_EFFECT_ASSIGNMENT = { kind: "builtin-monetary" }` なので**その条件が常に真**になり、
トグルを消しても何も改善しない。**壊れ方の方針を先に反転させないと後続が成立しない。**

## 背景（なぜ組み込みを廃止するのか）

061d-2 は「⑪ 壊れたら組み込みへ倒す」を**意図的に**選んだ。理由は当時のリリース事情で、
「061d のリリースで既存ユーザーの組み込みエフェクトが黙って止まる」を避けるためだった
（[docs/task-board.md](../task-board.md) の 061d-2 ⑪）。

⚠ **その前提は本人の運用方針が固まったことで消えた**。完成形は「エフェクトは各々が使いたいものを import して使う。
組み込みは不要。既定は非表示」であり、いまの倒れ先は**運用と真逆**になっている。

実害:

- 条件を設定していない状態で投げ銭が来ると、**頼んでいない演出が配信画面に出る**
- テンプレートを割り当てたのに壊れていた場合、**組み込みが出て「動いている」ように見える**（気づけない）
- 「出さない」を選ばない限り必ず何か出るので、**エフェクトを一時的に止める手段が実質無い**

## やること

### (1) `EffectKind` から組み込みを削る

- `screens/obs-effects/effectTrigger.ts`
  - `EffectKind` の union から `{ kind: "builtin-monetary" }` を削除 ⇒ `{ kind: "template"; templateId: string }` の 1 本に
  - `BUILTIN_KIND` を削除
  - `decideEffects` の第 5 引数 `resolveKind: EffectKindResolver = () => BUILTIN_KIND` の**既定値を外し必須にする**
    ⚠⚠ **061d-2 が「既定つきにしたので 061b までの 21 ケースが 1 文字も書き換わらない」と書いた担保を、
    ここで意図的に捨てる。** 既定が無くなる以上、呼び出し側は必ず resolver を渡すことになる（＝
    「割り当てを引かずにエフェクトが出る」経路が**型として消える**）。これは今回の目的そのもの。
  - `EffectRequestBase` は**触らない**（`name` / `amountText` / `message` / `eventLabel` / `tone` は
    テンプレートの差し込み文面 `effectTemplateText.ts` が使うので全部残る）

### (2) 倒れ先を「出さない」へ反転

- `screens/obs-effects/effectAssignments.ts`
  - `DEFAULT_EFFECT_ASSIGNMENT` を `{ kind: "none" }` へ
  - `parseAssignment` … 未知 kind・形不正・非オブジェクトの倒れ先を全部「出さない」へ
    ⚠ 既存 localStorage の `"builtin-monetary"` は**未知 kind として「出さない」へ倒れる**（下記「移行」）
  - `saveEffectAssignments` の「全部が既定ならキーごと削除」は**そのまま**（既定の値が変わるだけ）
  - `clearAllEffectAssignments` … 名前と意味は「**すべて『表示しない』に戻す**」へ
  - `clearEffectAssignmentsForTemplate` … 削除されたテンプレートを指す行の戻し先を「出さない」へ
  - ⚠ JSDoc の「## 壊れ方の方針（⑪）」の節を**丸ごと書き直す**（旧方針が正だと読めるまま残さない）

### (3) エフェクト窓から組み込み描画を消す

- `screens/obs-effects/EffectOverlayApp.tsx`
  - `fire()` … テンプレートの材料が揃わないときの `showEffect(request, null)` を**やめる**。
    `handleCacheMiss(templateId)` で次回に備えて温めるところは残し、**この 1 件は出さない**
    ⚠⚠ **061d-2 の「穴 β 案 (c)＝無反応にしない」を反転する判断**。根拠は「頼んでいない演出が出る」ほうが
    今の運用では害が大きく、かつ**出ないことは main 窓の警告 (5) で見える**ようにするため
  - `handleMediaError()` … `{ ...e, template: null }`（＝組み込みへ落とす）を**その 1 件の撤去**へ
  - `onComments` の先頭にある `if (!loadEffectMonetaryEnabled()) return;` を**削除**
    （ゲートは `resolveEffectKind` が `null` を返すことに一本化。二重の関門を残さない）
  - 組み込み描画の JSX（`.effectStack` / `.effectLabel` / `.effectName` / `.effectParticle` /
    `.effectAmount` / `.effectLine` / `.effectMessage`）を削除
- `screens/obs-effects/EffectOverlayApp.module.css` … 上に対応するルールを削除
  ⚠ **削除であって移動ではない**（061g のような移設ではないので、跡地コメントは残さず消す）

### (4) 「投げ銭でエフェクトを出す」トグルを消す

組み込み演出の ON/OFF が本体だったので、(1)(3) と同時に消えるのが自然。

- `screens/obs-effects/ObsEffectsScreen.tsx` … 当該 `<section>` ごと削除（見出し「投げ銭でエフェクトを出す」・
  トグル・注記 2 本）。⚠ **「テスト表示」はこの section の中にあるので (6) の新しい置き場へ移す**
- `features/comment-viewer/overlaySettings.ts` … `EFFECT_MONETARY_ENABLED_KEY` /
  `loadEffectMonetaryEnabled` / `saveEffectMonetaryEnabled` を削除
- ⚠ `screens/obs-effects/EffectTemplatePreview.tsx` の JSDoc が
  「`EFFECT_MONETARY_ENABLED_KEY` が既定 false である規律」を引用しているので、**参照先を書き換える**
  （規律自体は生きる＝「配信画面に出るものは既定で出さない」。むしろ 061h で徹底される）

### (5) 「見つからない」警告を実態に合わせる

警告そのものは既に `EffectAssignmentCard.tsx` にある（`missing` ＝ `notInList && listState === "ready"`）。
⚠ **文言が嘘になる**ので直す。

| いま | 061h 後 |
|---|---|
| 「割り当てていたテンプレートが見つかりません。いまは組み込みのエフェクトで表示されます。」 | 「割り当てていたエフェクトが見つかりません。**いまは何も表示されません。**」 |
| `<option value={BUILTIN_VALUE}>組み込み（名前と金額）</option>` | **削除** |
| 「すべての割り当てを解除（組み込みに戻す）」 | 「**すべて「表示しない」に戻す**」 |
| 注記「「組み込み」は名前と金額を出す標準のエフェクトです。…」 | 組み込みの説明を落とし、取り込んだエフェクトの話だけにする |

⚠⚠ `notInList` の判定（選択肢に無い id を `BUILTIN_VALUE` として表示する）は**`NONE_VALUE` 表示へ変える**。
`<select>` の value が選択肢に無いとブラウザが勝手に先頭を選ぶ、という元の理由はそのまま生きているので、
**明示的に「表示しない」を選ばせる**（＝ 061d-2 の対処の向きだけを反転する）。

### (6) テスト表示を「選んだエフェクトを 1 回出す」へ

いまの実装は `EffectOverlayApp` 内の固定ダミー `TEST_FIRE_REQUEST_BASE` ＋
`resolveEffectKind("superchat") ?? { kind: "builtin-monetary" }` で、**組み込みが消えると成立しない**。

- **置き場を移す** … `EffectTemplateCard` の各テンプレート行に「**配信画面でテスト表示**」を置く
  （⚠ いまの「テスト表示」は投げ銭 section にあり、(4) で消える。かつ「どのエフェクトの位置合わせか」が
  選べないのが元の設計の弱点だった）
- **wire** … `EFFECT_TEST_FIRE_KEY` の値を `` `${nonce}:${templateId}` `` へ
  - ⚠⚠ **§9 の線は維持される**。載るのは nonce と **Rust が採番した uuid v4** だけで、
    第三者の個人データは 1 バイトも入らない。`EFFECT_ASSIGNMENTS_KEY` が既に同じ id を保存しているので
    **新しい種類のデータは増えない**
  - ⚠ 窓側は受け取った id を `effectAssignments.ts` の `EFFECT_TEMPLATE_ID_RE` と**同じ形で検証**してから使う
    （localStorage は他窓から書ける＝多層防御の 1 枚目。実際には Rust 側の `is_template_id` も弾く）
- **`TEST_FIRE_REQUEST_BASE`** … 固定ダミーの本文はそのまま使う（差し込み文面の見本として要る）
- ⚠ **窓が停止中なら何も起きない**のは現状どおり（画面の注記も現状どおり残す）。
  「テスト表示が窓を開く」は **061i** の担当（表示トグルを消すのがあちらなので、そこで一緒にやる）

### (7) docs

- `docs/progress.md` に 061h 節（判断と根拠・移行の扱い・変異検証・実機確認）
- `docs/task-board.md` の 061h を完了化
- ⚠ **`docs/security.md` は差分ゼロ**（外部通信・OS 操作・ファイル操作・プロセス操作・依存は 1 つも動かさない）

## ⚠ 移行（既存の保存値をどうするか）

`EFFECT_ASSIGNMENTS_KEY` に `{"superchat":{"kind":"builtin-monetary"}}` のような値が残っている場合、
`parseAssignment` は **未知 kind として「出さない」へ倒す**。

⇒ **アップデート後、組み込みに割り当てていた種別は「表示しない」になる。**
これは**意図した仕様変更**（組み込みそのものを廃止するので、他に倒しようがない）。
⚠ 変換コードは書かない——「未知 kind は安全側へ倒す」という既存の前方互換の仕組みが**そのまま正しく働く**ので、
移行専用の分岐を足すのは同じことを 2 通りに書くことになる。docs に「そうなる」と明記して済ませる。

## やらないこと

- **タブ化・表示トグルの削除・「エフェクトを表示する条件」への改名** … 061i
- **キーワード条件（自由テキスト）** … 061j。⚠ 本タスクは `EffectAssignments` の**値**を変えるだけで、
  `Record<eventType, …>` という**形**は変えない（形を変えるのは 061j）
- **出力窓の 2 本化** … 061k
- **配信イベント** … 061l
- `EffectRequestBase` のフィールド削減（テンプレートの差し込み文面が使うので減らない）
- 音まわり（061f で決着済み）・`effectMediaCache` の LRU・先読み

## 対象ファイル

**変更**
- `apps/desktop/src/screens/obs-effects/effectTrigger.ts`
- `apps/desktop/src/screens/obs-effects/effectAssignments.ts`
- `apps/desktop/src/screens/obs-effects/EffectOverlayApp.tsx`
- `apps/desktop/src/screens/obs-effects/EffectOverlayApp.module.css`
- `apps/desktop/src/screens/obs-effects/ObsEffectsScreen.tsx`
- `apps/desktop/src/screens/obs-effects/ObsEffectsScreen.module.css`（`.testFire` の移動先に応じて）
- `apps/desktop/src/screens/obs-effects/EffectAssignmentCard.tsx`
- `apps/desktop/src/screens/obs-effects/EffectTemplateCard.tsx`（(6) のボタン追加）
- `apps/desktop/src/screens/obs-effects/EffectTemplatePreview.tsx`（JSDoc の参照先のみ）
- `apps/desktop/src/screens/obs-effects/effectMedia.ts`（「弾かれたら組み込みへ」の JSDoc）
- `apps/desktop/src/features/comment-viewer/overlaySettings.ts`

**テスト（⚠ 書き換えが要る）**
- `effectTrigger.test.ts`（`builtin-monetary` 参照 4 箇所・resolver 既定引数のケース）
- `effectAssignments.test.ts`（`BUILTIN` 定数・「resolver: 「組み込み」は builtin-monetary」）
- `EffectOverlayApp.test.tsx`（`builtin-monetary` 3 箇所・`EFFECT_MONETARY_ENABLED_KEY` 4 箇所・
  ⚠ 「`?? { kind: "builtin-monetary" }` を外す変異をレッドにする」ケースは**役目が変わる**）
- `ObsEffectsScreen.test.tsx`（投げ銭トグルの 2 ケース）
- `effectTemplateText.test.ts`（`kind: "builtin-monetary"` の 1 箇所）
- `EffectAssignmentCard.test.tsx`（選択肢と警告文言）

**差分ゼロ（要確認）**: `apps/desktop/src-tauri/` ／ `capabilities/` ／ `tauri.conf.json` ／
`apps/comment-sidecar/` ／ `package.json` ／ `pnpm-lock.yaml` ／ **`docs/security.md`** ／ `.github/`

## 検証

```bash
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test     # vitest + check:css + check:version + check:effect-contract
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # 無変更（緑が期待）

# ゼロ拡大（すべて空が期待）
git diff -M HEAD -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
git diff -M HEAD -- apps/desktop/package.json pnpm-lock.yaml docs/security.md

# 組み込みの残骸ゼロ（ヒットゼロが期待）
grep -rn "builtin-monetary\|BUILTIN_KIND\|EFFECT_MONETARY_ENABLED" apps/desktop/src
```

⚠ **変異検証（実測して記録すること）**

| # | 変異 | 期待 |
|---|---|---|
| ① | `parseAssignment` の倒れ先を `{kind:"template",…}` に戻す | レッド |
| ② | `fire()` に `showEffect(request, null)` を戻す | レッド |
| ③ | `decideEffects` の resolver に既定値を復活させる | ⚠ 型エラー（＝**構造で防げている**ことの確認） |
| ④ | `handleMediaError` を「撤去しない」に変える | レッド |
| ⑤ | テスト表示の templateId 検証を外す | レッド |

## ⚠⚠ 実機確認

1. **条件を未設定のまま**投げ銭が来ても**何も出ない**こと（＝組み込みが出ない）
2. テンプレートを割り当てた種別では、そのテンプレートが出ること
3. **壊れたテンプレートを割り当てたとき**、組み込みではなく**何も出ない**こと
4. ⚠ そのとき main 窓に「見つかりません／いまは何も表示されません」の警告が出ること
5. 「すべて「表示しない」に戻す」で全部止まること
6. テンプレート行の「配信画面でテスト表示」が、**そのテンプレート**を 1 回出すこと
7. ⚠ エフェクト窓が停止中のときは何も起きず、その旨が画面に出ていること
8. ⚠⚠ **061d-2 から持ち越した実機確認⑩（金額なしの経路）をここで消化する**——
   サブスク等の金額なしイベントに割り当てたテンプレートで、`amountText` と `message` が
   同時に null のとき**行ごと描かれない**こと。⚠ 061d-2 のときと**確認内容が変わっている**
   （組み込みの経路が消えたので、テンプレートの差し込み文面 `template_without_amount` 側の確認になる）

⚠ **061d-2 の実機確認⑧（OBS のカクつき）は本タスクの対象外**（先読みの話で、組み込み廃止と無関係）。
親 061 のクローズ条件に残す。
