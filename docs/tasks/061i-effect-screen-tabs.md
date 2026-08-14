# 061i 画面をタブに分け、表示トグルを消す

> 状態: **未着手（2026-08-14 起票）**。⚠ **UX 再設計 061h〜061l の 2 本目。**
> base は **HEAD = `3b6ab7f fix:組み込みエフェクトの廃止`**（061h はコミット済み）。
> 全体像・決定事項・着手前に読む制約は [docs/task-board.md](../task-board.md) の
> 「061h〜061l OBSエフェクトの UX 再設計」節が正。⚠ **行番号は書かない**（特定はシンボル名で行う）。
>
> ⚠⚠ **061j〜061l のタスクファイルはまだ書かない**（それぞれの着手直前に書く。理由は
> [061h](061h-builtin-effect-removal.md) 冒頭と同じ＝先の工程ほど前の工程の実測に依存するため）。

## 061h から引き継いだ前提（申し送りより）

- ✅ 既定は `{ kind: "none" }`＝**未設定なら何も出ない**。組み込みは完全に消えた
- ✅ `EffectKind` は `{ kind: "template"; templateId: string }` の 1 本
- ✅ 「投げ銭でエフェクトを出す」トグルと `EFFECT_MONETARY_ENABLED_KEY` は廃止済み
- ✅ 「配信画面でテスト表示」は `EffectTemplateCard` の各行にあり、`effectWindowOpen: boolean | null` を prop で受けて
  停止中の注記を出す。wire は `EFFECT_TEST_FIRE_KEY = "<nonce>:<templateId>"`
- ⚠⚠ **061h 申し送りの引き継ぎ事項**: `EffectAssignmentCard` の `<select>` は
  **`notInList` を消してもブラウザが先頭（＝「エフェクトを出さない」）を選ぶので値のアサーションが偶然通る**。
  **061i で選択肢の順序を変えるとこの偶然の一致が崩れる。** ⇒ 下記「やらないこと」で**順序は変えない**と決めた

## この段で解く問題

**トグルが二度手間**。条件を設定した時点で「配信画面に出したい」ことは自明なのに、
`ObsEffectsScreen` の「エフェクトを配信画面に表示する」を別に ON にしないと何も出ない。
⚠ しかも 061h で既定が「出さない」になったので、**いま初めてこの自動化が成立する**
（既定が組み込みのままだと「条件が 1 つでも有効」が常に真になり、トグルを消しても意味が無かった）。

あわせて、用途の違う 2 種類（コメント条件に反応する演出／視聴者参加型の配信イベント）を
**タブで分ける器**をここで用意する（配信イベントの中身は 061l）。

---

## ⚠⚠ 設計判断（実装前に読むこと。ここを外すと OBS のソースが壊れる）

### 判断 1: 窓は「**開くのは自動・閉じるのは明示**」にする

⚠ **「条件が全部無くなったら自動で閉じる」は作らない。** 親 046 の規律
（`effectOverlayRestore.ts` の JSDoc「自動 close は作らない。窓が消えると OBS ソースが壊れる」）を守る。
配信中に窓が消えると **OBS のウィンドウキャプチャが真っ黒**になり、配信者は原因に気づけない。

| 契機 | 挙動 |
|---|---|
| 条件が **0 件 → 1 件以上**になった | **窓を開く**（＝トグルの代わり） |
| 条件が 1 件以上のままアプリを起動した | **窓を復元する**（`restoreEffectOverlayWindow` は無改変で成立する。下記 判断 2） |
| 条件が **全部「出さない」**になった | ⚠ **窓は閉じない**。OBS 側の表示だけ止まる（下記 判断 2 の副作用） |
| ユーザーが明示的に閉じたいとき | **前提ステータスの行に「ウィンドウを閉じる」ボタン**を置く（トグルではなくアクション） |

⚠ ユーザーの不満は「**毎回の**二度手間」であって「閉じられること」ではない。脱出路は残す。

### 判断 2: `EFFECT_OVERLAY_ENABLED_KEY` は**残し、割り当ての保存時に派生で立てる**

⚠⚠ **このキーは 3 か所から読まれている**（061i の最大の罠）:

| 読み手 | 用途 |
|---|---|
| `features/comment-viewer/effectOverlayRestore.ts` | アプリ起動時の窓復元 |
| `screens/comment-viewer/CommentViewerApp.tsx` | `storage` 購読 → `enableObs("effects")` / `hideObs("effects")` の代行（045c/061e の規律） |
| `screens/obs-effects/ObsEffectsScreen.tsx` | トグルの初期値（061i で消える） |

**採る案 = (a) 派生値を書く。**`useEffectTemplates` の保存経路で
`saveEffectOverlayEnabled(条件が 1 件以上か)` を呼ぶ。

⇒ **`effectOverlayRestore.ts` / `CommentViewerApp.tsx` / `windowApi.ts` / `App.tsx` は差分ゼロ**にできる。

⚠ **却下した案 (b)＝キーを廃止して「割り当てから導出する」**: 真実が 1 つになるので理屈は綺麗だが、
`CommentViewerApp` の `storage` 購読は**キー名で分岐**している（`e.key === EFFECT_OVERLAY_ENABLED_KEY`）ため、
購読先の変更＝ **045c/061e が固めた OBS 反映の契機の実装に手を入れる**ことになる。
061i のスコープ（画面の再構成）を超えるので採らない。
⚠ **再修正トリガー**＝ 061k で出力窓が 2 本になり、窓ごとに「開くべきか」を持つ必要が出たとき。
そのとき (b) へ寄せるか、窓ごとにキーを持つかを決め直すこと。

⚠ **案 (a) の弱点＝「2 つの真実」が同期を外しうる。** 塞ぎ方:
- **書き手を `useEffectTemplates` の 1 か所に閉じる**（`setAssignment` / `clearAllAssignments` /
  テンプレート削除に伴う `clearEffectAssignmentsForTemplate` の**すべて**が同じ関数を通ること）
- ⚠ **テストで固定する**（下記「テスト」の必須ケース）

⚠⚠ **判断 1 の表にある副作用**: 条件が全部「出さない」になるとフラグが false になり、
`CommentViewerApp` の既存分岐が `hideObs("effects")` を送って **OBS 側のソースが非表示**になる（窓は残る）。
これは**意図した新しい挙動**（条件が無いのに OBS に映り続けるほうが筋が悪い）。docs に明記すること。

### 判断 3: セットアップ用ガイドの旗の起点を「OBS の位置合わせ」へ移す

`EFFECT_OVERLAY_GUIDE_PENDING_KEY` は 061a レビュー Q-1 で
「**旗を立ててよいのは表示トグル ON＝明示操作だけ**（起動時復元では立てない。立てると配信直前の起動で
ガイドが 30 秒 OBS に映る）」と決まっている。⚠ **トグルを消すと起点が消える。**

⇒ 新しい起点＝**「配信画面でテスト表示」で窓を開いたとき**（＝明示操作）。
⚠ **条件を編集して自動で窓が開いたときは立てない**（編集のたびにガイドが映るのを避ける＝Q-1 の規律の維持）。

### 判断 4: ⚠⚠ テスト表示が窓を開くときの**取りこぼし**を「保留旗」で塞ぐ

条件 0 件でも OBS の位置合わせができるよう、テスト表示は窓が停止中なら**開いてから**出す。

⚠⚠ **素直に「open を await → nonce を書く」と書くと取りこぼす。**
`open_effect_overlay_window` の解決は**窓生成の完了**であって、
**エフェクト窓の React がマウントして `storage` リスナーを登録し終えたこと**ではない。
`storage` イベントは登録前に飛んだ分を後から拾えないので、**押しても何も出ない**が確率的に起きる。

⇒ **保留旗方式を採る**（`EFFECT_OVERLAY_GUIDE_PENDING_KEY` と**同じ idiom**＝旗を立てる →
窓がマウント時に読んで倒す。実績のある形なので新しい仕組みを発明しない）。

- 新キー `EFFECT_TEST_FIRE_PENDING_KEY`（値＝`templateId` のみ）
- **窓が停止中のとき**: 旗を立てる → 窓を開く（`storage` は使わない）
- **窓が開いているとき**: 従来どおり `requestEffectTestFire(templateId)` で `storage` 発火（旗は使わない）
- **エフェクト窓**: マウント時に旗を 1 回だけ読み、**読んだら消す**。
  ⚠ 値は `isEffectTemplateId()` で検証してから使う（061h が作った検証を再利用。正規表現の持ち主を増やさない）
- ⚠ §9: 載るのは **Rust が採番した uuid v4** だけ＝ 061h で決着済みの判断の延長（新しい種類のデータは増えない）

### 判断 5: ⚠⚠ 「壊れて何も出ない」の観測手段は**安い分だけ**取る（061h レビュー Q-1 への回答）

061h は組み込みを廃止したので、**壊れたときに配信画面で異常が見えなくなった**。
`EffectOverlayApp.tsx` の `fire()` の JSDoc が無音になる 5 経路を列挙しており、
**警告が出るのは (a) だけ**である:

| | 経路 | 警告 |
|---|---|---|
| (a) | 割り当て先が削除済み／一覧に無い | ✅ `EffectAssignmentCard` が出す |
| (b) | 一覧には在るが `safeEffectMedia` に弾かれる | ❌ 無音・`failed` に載る |
| (c) | `get_effect_template_media` が一時的に失敗 | ❌ 無音・`failed` に載る |
| (d) | 描画時のデコード失敗（`handleMediaError`） | ❌ 無音・`markFailed` |
| (e) | 先読み前の初回発火 | ❌ 無音。⚠ **2 件目から出る**（自己回復する） |

⚠ 061h の JSDoc は「**どちらも 061i の『条件が 1 つでも有効なら窓を開く』と同時にやるのが安い**」と
再修正トリガーを書いているが、**2 つある案のうち安いのは片方だけ**なので分ける。

**採る（061i の内側）**
1. ⚠⚠ **テスト表示を受け取ったら `failed` と `missHandledRef` を解除する**——2 行で、
   「一度失敗したテンプレートを**明示操作で再試行できる**」になる。いまは
   `warmTemplates`（割り当ての `storage` か窓のマウント）まで固着したまま
2. **判断 4 の導線が、そのまま観測手段になる**——テスト表示は窓が停止中でも押せて「そのテンプレートを出す」ので、
   **壊れていればその場で「出ない」と分かる**。⚠ しかも保留旗経由では窓がマウントし直されるので
   `failed` も一緒に空になる。⇒ `EffectAssignmentCard` の注記に
   **「割り当てる前に『配信画面でテスト表示』で確かめられる」**を書く

**採らない（別タスクへ）**
- ⚠ **main 窓で割り当て済みテンプレートのメディアを自動検証して警告に載せる案**は採らない。
  割り当て済み全件の data URI を**自動で取りに行く**ことになり、**新規の IPC とメモリ負荷**が生まれる
  （`EffectTemplatePreview` は「プレビューを押したときだけ」取りに行く設計）。
  「画面構成を直す」という 061i の性格から外れ、CLAUDE.md の「1 回の作業で複数機能をまとめない」に触れる
- ⚠ **エフェクト窓 → main 窓へ「壊れた」を返す逆向きの wire も作らない**。
  061a/061e が「OBS 連携の結果は main 窓には出せない・欲しくなったら別タスク」と慎重に避けてきた線と同型
- ⇒ **残る穴＝「割り当て済みのテンプレートが**あとから**壊れた場合、テスト表示を押すまで気づけない」**。
  受容し、**再修正トリガー＝実機で「割り当てたのに出ない」が実際に起きたとき**として盤面に残す

### 判断 6: タブ部品は `components/Tabs.tsx` に新設する

⚠ 061g の規律「**画面を跨ぐ部品は最初から `components/` に置く**」に従う。061l で配信イベントの
一覧／詳細が入ると確実に生き続けるので、`screens/obs-effects/` に置いて後から移すことはしない。

- 既存 idiom は `screens/add-tool/AddToolScreen.tsx` の `role="tablist"` / `role="tab"` /
  `aria-selected` ＋ active クラス（`.kindToggle` / `.kindOption` / `.kindActive`）。**a11y の形はこれに倣う**
- ⚠ **`AddToolScreen` の `.kindToggle` は置き換えない**（あれは「コンテンツの切替」ではなく
  「値の選択」で意味論が違う。統合は別タスク）
- 意匠は `components/Tabs.module.css`。⚠ 生 hex 禁止・`theme.css` のトークンのみ
- ⚠ `--text-faint` は `:disabled` 専用（`scripts/check-css-guards.mjs` の (6-b) が
  **`components/` 配下を再帰で全部走査している**ので、可読テキストに使うと落ちる）

---

## やること

### (1) `components/Tabs.tsx` / `Tabs.module.css` を新設

`{ id, label }[]` と `activeId` / `onChange` を受ける表示専用部品。状態は呼び出し側が持つ。

### (2) `ObsEffectsScreen` をタブ 2 枚に再構成

| タブ | 中身 |
|---|---|
| **コメントで出すエフェクト** | `EffectTemplateCard`（取り込み・一覧・プレビュー・テスト表示）＋ `EffectAssignmentCard`（条件） |
| **配信イベント** | ⚠ **061l まで枠だけ**（準備中の案内 1 段落）。⚠ `ComingSoonScreen` は画面まるごと用なので流用しない |

- ⚠ **「配信画面に表示」section からトグルだけを外す**。OBS のセットアップ案内（ウィンドウキャプチャの手順）は
  **残す**——あれは「どうやって OBS に取り込むか」の唯一の説明で、トグルとは独立した情報
- ⚠ 「OBS へ自動で反映」section と前提ステータスは**両タブの外**（画面下部の共通領域）に置く。
  どちらのタブで使うエフェクトも同じ窓・同じ OBS ソースに出るため（⚠ 061k で 2 本になったら見直す）
- 画面のリード文を実態に合わせる（「投げ銭などに合わせて…」はもう狭い）

### (3) 表示トグルを消し、窓の開閉を判断 1・2 のとおりにする

- `ObsEffectsScreen.tsx` … `enabled` state・`handleEnabledToggle`・`ToggleSwitch` を削除
  ⚠ **`effectOverlayOpRef` の直列化は残す**（「ウィンドウを閉じる」ボタンと自動 open が競合しうるため。
  046b レビューの連打レース対策と同じ理由）
- `useEffectTemplates.ts` … 割り当てを保存する**すべての経路**で
  `saveEffectOverlayEnabled(条件が 1 件以上か)` を呼び、**0 → 1 件になったときだけ窓を開く**
  ⚠ 「1 件以上のまま別の条件を変えた」ときに毎回 open を投げない（無駄な invoke を出さない）
- 前提ステータスに **「表示する条件」行**を足す（0 件なら「設定されていません」）
  ⚠ 061a 以来の規律「**黙って何も起きない状態を作らない**」の維持
- 前提ステータスの「エフェクトのウィンドウ」行に **「ウィンドウを閉じる」** ボタン（表示中のときだけ）

### (4) テスト表示が窓を開く（判断 3・4）

- `overlaySettings.ts` … `EFFECT_TEST_FIRE_PENDING_KEY` と load/save を追加
  （⚠ **読んだら消す**関数にする。`loadEffectOverlayGuidePending` / `saveEffectOverlayGuidePending` と同じ形）
- `EffectTemplateCard.tsx` … 窓が停止中なら「旗を立てる → 窓を開く」、開いていれば従来どおり
  ⚠ 窓を開く操作を伴うので `EFFECT_OVERLAY_GUIDE_PENDING_KEY` も**ここで立てる**（判断 3）
  ⚠ `effectWindowOpen === false` のときの注記を「何も表示されません」から
  「**ウィンドウを開いてから表示します**」へ書き換える（挙動が変わるので文言が嘘になる）
- `EffectOverlayApp.tsx` … マウント時に保留旗を読んで 1 回発火（`isEffectTemplateId` で検証）
  ⚠ 既存のガイド旗を倒す effect と**同じ場所**に置く（旗を読む処理を 2 か所に散らさない）

### (4-b) テスト表示で「失敗の固着」を解除する（判断 5）

- `EffectOverlayApp.tsx` … **テスト表示を受け取ったら発火の前に `failed` と `missHandledRef` を解除**する
  （`storage` 経由・保留旗経由の**両方**）。⚠ `effectMediaCache` に
  `markFailed` の対称形（`clearFailed(templateId)`）を足して、`failed` を触る場所をあちらへ寄せること
  （`EffectOverlayApp` から `Set` を直接いじらない＝ 061d-2 が引いた線）
- `EffectAssignmentCard.tsx` … 注記に
  **「割り当てる前に、上の一覧の『配信画面でテスト表示』で実際に出るか確かめられます」**を足す
  ⚠ これが (b)(c)(d) に対する**唯一の実用的な観測手段**なので、`missing` の警告文とは別に常時出す

### (5) 見出しと文言

| いま | 061i 後 |
|---|---|
| `EffectAssignmentCard` の `<h3>` 「イベントごとのエフェクト」 | **「エフェクトを表示する条件」** |
| 同カードのリード文「種類ごとにどのエフェクトを出すかを選べます。」 | 条件という語に合わせて調整 |
| `ObsEffectsScreen` のリード文「投げ銭などに合わせて…」 | タブ 2 種を踏まえた文へ |

### (6) docs

`docs/progress.md` に 061i 節（判断 1〜5 の根拠・実測・実機確認手順）／`docs/task-board.md` の 061i を完了化。
⚠ **`docs/security.md` は差分ゼロ**（外部通信・OS 操作・ファイル操作・プロセス操作・依存は動かない）。

---

## やらないこと

- **キーワード条件（自由テキスト）** … 061j。⚠ 本タスクは `EffectAssignments` を**読むだけ**で、
  形（`Record<eventType, …>`）も値の意味も変えない
- **出力窓の 2 本化** … 061k
- **配信イベントの中身** … 061l（タブの枠だけ用意する）
- ⚠⚠ **`EffectAssignmentCard` の `<select>` の選択肢の順序を変えない。**
  061h 申し送り ⑦-c のとおり、`notInList` のテストは「ブラウザが先頭を選ぶ」偶然に乗っている。
  順序を変えるなら**先にテストを実値アサーションへ強化**すること（本タスクではやらない）
- `AddToolScreen` の `.kindToggle` を `Tabs` へ置き換える（意味論が違う・別タスク）
- `CommentViewerApp` / `effectOverlayRestore` / `windowApi` / `App.tsx` への変更（判断 2 により**差分ゼロ**が要件）

## 対象ファイル

**新規**
- `apps/desktop/src/components/Tabs.tsx` / `Tabs.module.css`（＋ `Tabs.test.tsx`）

**変更**
- `apps/desktop/src/screens/obs-effects/ObsEffectsScreen.tsx` / `.module.css`
- `apps/desktop/src/screens/obs-effects/EffectAssignmentCard.tsx`
- `apps/desktop/src/screens/obs-effects/EffectTemplateCard.tsx`
- `apps/desktop/src/screens/obs-effects/EffectOverlayApp.tsx`
- `apps/desktop/src/screens/obs-effects/useEffectTemplates.ts`
- `apps/desktop/src/features/comment-viewer/overlaySettings.ts`

**差分ゼロ（要件）**
- `apps/desktop/src/features/comment-viewer/effectOverlayRestore.ts` / `windowApi.ts`
- `apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx` / `apps/desktop/src/App.tsx`
- `apps/desktop/src-tauri/` ／ `capabilities/` ／ `tauri.conf.json` ／ `apps/comment-sidecar/` ／
  `package.json` ／ `pnpm-lock.yaml` ／ **`docs/security.md`** ／ `.github/`

## テスト

**書き換えが要る既存ケース**（`ObsEffectsScreen.test.tsx` の 23 ケース中）
- 「既定は 2 つのトグルとも OFF」→ 自動反映トグル 1 つだけになる
- 「表示トグル ON で窓を開き、設定を永続化する」／「表示トグル OFF で窓を閉じる」→ **削除**し、
  **条件経由の open** と **「ウィンドウを閉じる」ボタン**のケースへ差し替え
- 「⚠ 表示トグルの連打は直列化され、最後の意図（OFF）が実窓に勝つ」→ 直列化は残すので**経路を差し替えて維持**
- 「⚠ セットアップ用ガイドの旗は表示 ON のときだけ立つ」→ **判断 3 の新しい起点**へ差し替え
- `EffectTemplateCard.test.tsx` … 停止中の注記の文言／窓を開く経路

**⚠⚠ 新規に必ず要るケース**
1. **条件を 0 → 1 件にすると窓が開き、`EFFECT_OVERLAY_ENABLED_KEY` が true になる**
2. **1 件以上のまま別の条件を変えても open を重ねて投げない**
3. **条件を全部「出さない」に戻すとフラグが false になる**（＝`CommentViewerApp` の `hideObs` 経路が生きる）
4. ⚠⚠ **テンプレート削除で条件が 0 件になったときもフラグが false になる**
   （`clearEffectAssignmentsForTemplate` 経由＝**書き手を 1 か所に閉じた**ことの担保）
5. **「ウィンドウを閉じる」で窓が閉じるが、フラグは false にならない**（設定と窓を混ぜない）
6. **窓が停止中のテスト表示は「保留旗を立てて窓を開く」**／**開いているときは `storage` で発火**
7. **エフェクト窓はマウント時に保留旗を読んで 1 回だけ発火し、旗を消す**
8. **形の壊れた保留旗の値では発火せず、IPC も起こさない**
   （⚠ 061h の変異⑤が最初に生存した理由＝「何も出ない」だけでは観測できない。**IPC の呼び出し回数を見ること**）
9. ⚠⚠ **一度 `failed` に載ったテンプレートが、テスト表示で再試行される**
   （`storage` 経由・保留旗経由の**両方**。判断 5）
10. `Tabs` … タブ切替でパネルが入れ替わる／`role="tab"` と `aria-selected` が付く

## 検証

```bash
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test     # vitest + check:css + check:version + check:effect-contract
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # 無変更（緑が期待）

# 差分ゼロ（すべて空が期待）
git diff -M HEAD -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
git diff -M HEAD -- apps/desktop/package.json pnpm-lock.yaml docs/security.md
git diff -M HEAD -- apps/desktop/src/features/comment-viewer/effectOverlayRestore.ts \
  apps/desktop/src/features/comment-viewer/windowApi.ts \
  apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx apps/desktop/src/App.tsx

# 表示トグルの残骸ゼロ（ヒットゼロが期待）
grep -rn "エフェクトを配信画面に表示する\|handleEnabledToggle" apps/desktop/src

# ⚠ 派生値の書き手が 1 か所に閉じているか（useEffectTemplates 以外から呼ばれていないこと）
grep -rn "saveEffectOverlayEnabled" apps/desktop/src
```

⚠ **変異検証（実測して progress.md に記録）**

| # | 変異 | 期待 |
|---|---|---|
| ① | `useEffectTemplates` の派生値の書き込みを消す | レッド |
| ② | ⚠ **テンプレート削除の経路だけ**派生値の書き込みを消す | レッド（新規ケース 4） |
| ③ | 「0 → 1 件のときだけ開く」を「保存のたびに開く」に変える | レッド（新規ケース 2） |
| ④ | 「ウィンドウを閉じる」でフラグも false にする | レッド（新規ケース 5） |
| ⑤ | 保留旗の `isEffectTemplateId` 検証を外す | レッド（⚠ **IPC 回数を見るアサーションで殺す**） |
| ⑥ | 保留旗を「読んでも消さない」に変える | レッド（次に窓を開くたび発火する） |
| ⑦ | ⚠ 条件の自動 open でガイド旗も立てる | レッド（判断 3・061a Q-1 の再発） |
| ⑧ | テスト表示の `failed` / `missHandledRef` 解除を消す | レッド（新規ケース 9・判断 5） |
| ⑨ | ⚠ **自分で考えた変異も試すこと**（守備範囲の穴の探索） | — |

## ⚠⚠ 実機確認（未実施のまま完了にしないこと）

1. タブが 2 枚出て切り替わる／「配信イベント」は準備中の案内が出る
2. ⚠ **条件を 1 つ設定すると、トグルを触らずにエフェクト窓が開く**
3. 条件をもう 1 つ足しても窓が二重に開かない・ちらつかない
4. ⚠ **条件を全部「出さない」に戻しても窓は開いたまま**で、OBS 側のソースだけ非表示になる
5. ⚠ 「ウィンドウを閉じる」で閉じ、**アプリを再起動すると（条件が残っていれば）また開く**
6. ⚠⚠ **条件 0 件の状態で「配信画面でテスト表示」を押すと、窓が開いてエフェクトが出る**
   （＝ OBS の位置合わせが条件を作らずにできる。**判断 4 の取りこぼしが起きていないこと**を、
   窓を閉じた状態から**5 回以上**繰り返して確認する）
7. ⚠ そのときセットアップ用ガイドが出る／**条件を編集して自動で開いたときは出ない**（判断 3）
8. 見出しが「エフェクトを表示する条件」になっている
9. ⚠ 前提ステータスに「表示する条件」行が出て、0 件のとき「設定されていません」になる
10. ⚠⚠ **壊れたテンプレートでテスト表示 → 出ない → 取り込み直す → もう一度テスト表示で出る**
    （判断 5 の「明示操作で再試行できる」。⚠ **アプリを再起動せずに回復すること**を確認する）
11. ⚠ **061d-2 から持ち越しの実機確認⑧（OBS キャプチャのカクつき）をここで消化してよい**
    （先読みの話で 061i と独立だが、OBS を触る回なのでついでに見られる）
