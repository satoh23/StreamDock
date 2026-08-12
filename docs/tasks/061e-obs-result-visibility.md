# 061e OBS 連携の結果を観測できるようにする

> 状態: **未着手（2026-08-12 起票）**。⚠ **061a から移設したもの**——実装済み（✅）のタスクに
> 「未完了の宿題」としてぶら下がっていた 3 点を、独立したタスクとして立て直した
> （✅ に未完了を紐づけると盤面が「終わっているのか」分からなくなり、閉じ忘れの温床になる）。
> 分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、器 [061a](061a-effect-overlay-window.md)（**この 3 点の出所**）、
> OBS 自動追加の元設計 [044a](044a-obs-auto-source-impl.md)、
> 結果表示の設計 **045c**（⚠ **専用のタスクファイルは無い**＝親 [045](045-obs-overlay-clarity.md) の実機 E2E 回帰修正として実施された。
> 判断の全文は [`CommentViewerApp.tsx`](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx) の
> ツールバー赤字まわりのコメントと [`docs/progress.md`](../progress.md) の 045c 節が正）、
> 2 種別化 [046d](046d-pinned-overlay-obs-auto-add.md)（**`obsState` を種別で共有すると決めた**）、
> 通知音インジケータ [059b](059b-monetary-notification-sound.md)（**「OR ゲート＋文言は変えない」の先例**）、
> [`docs/security.md`](../security.md)（§1／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件なし**（061d-2 とは独立。ただし親 061 のクローズ条件に含まれる）。

## 目的

**OBS 連携の結果（追加できた／できなかった）が、ユーザーの居る画面で正しく読み取れる状態にする。**

現状は 3 つの理由でこれが成立していない。いずれも 061a のレビューと実装で判明したまま
**「未完了の宿題」として ✅ のタスクにぶら下がっていた**もので、内容は当時の記録から 1 文字も変えていない。

| # | 症状 | 何が起きるか |
|---|---|---|
| **(A)** | `ObsEffectsScreen` の案内文「追加や失敗の結果はコメントビューアの画面上部に表示されます。」が**事実と違う** | ツールバーに出るのは**失敗の赤字だけ**で、成功は出ない。全状態が見えるのは ⚙設定 →「OBSに表示」カード。ユーザーは「成功したはずなのに何も出ない」＝**壊れていると誤解する** |
| **(B)** | その赤字が `obsAutoAdd`（**コメント側のトグル**）で絞られている | 「コメント側 OFF ／ エフェクト側 ON」の構成だと、**エフェクトの OBS 追加に失敗しても赤字が 1 文字も出ない**（＝黙って反映されない） |
| **(C)** | 成功文言が「OBSにコメントを表示しました。」 | `obsState` は 3 種別（comments / pinned / effects）で**共有**されているので、**エフェクトの成功でもこの文が出る**（嘘になる） |

## 現在の前提（調査結果・実コード）

- **`obsState` は 3 種別で 1 つ**（`CommentViewerApp` の `useState<string>("idle")`）。
  `enableObs("comments")` / `("pinned")` / `("effects")` の結果がすべてここへ流れ込む。
  046d が「状態表示は 1 つ」と決め、061a レビュー Q-2 が「effects はその受容条件から外れている」と
  指摘したまま**要監視**で据え置かれている。
- **種別を区別するには wire の変更が要る。** sidecar の `obs.state` フレームの payload は
  `{ state, reason? }` だけで **`overlay` を運んでいない**（`index.ts` の `createObsClient` コールバック →
  `broadcastMessage`）。frontend 側の `CommentStreamHandlers.onObsState` も `(state, reason)` の 2 引数。
- **`ObsOverlayKind` は `"comments" | "pinned" | "effects"`**（sidecar の `obs/obs-client.ts`）。
  `enable(port, overlay)` / `hide(port, overlay)` は overlay を受け取っているので、
  **`onState` へ渡す材料は既に手元にある**（＝ wire に載せる改修自体は小さい）。
- **ツールバーの赤字のゲートは `obsAutoAdd && obsState === "failed"`**（`CommentViewerApp`）。
  045c がこの形にした根拠は「**連携 OFF 時に必ず `obsState` を idle へ戻す**」という不変条件で、
  ⚠⚠ **その不変条件は effects 側では成立していない**——`EFFECT_OBS_AUTO_ADD_KEY` が false になる
  `storage` 分岐は `clearObsEnableTimer("effects")` を呼ぶだけで、**`setObsState("idle")` を呼ばない**
  （`EFFECT_OVERLAY_ENABLED_KEY` が false になる分岐だけが idle へ戻している）。**これが (B) の真因の半分**である。
- **エフェクト側の設定は localStorage 直読み**（`loadEffectObsAutoAdd()` / `loadEffectOverlayEnabled()`）。
  `CommentViewerApp` は state にミラーしていない（「持ち主は main 窓なので stale を作らない」という規律）。
- **成功文言と全状態表示は `SettingsView` の「OBSに表示」カード**（`connecting` / `added`・`reused` / `failed` の 3 分岐）。
  ここは `obsAutoAdd` で絞っていない。
- ⚠ **コメビュ窓が閉じている間は `obs-enable` を誰も送れない**（WS ハンドルの持ち主がコメビュ窓だけ）。
  ＝ **どんな表示を足しても、コメビュ窓が無ければ結果は発生しない。** `ObsEffectsScreen` の前提ステータスが
  この事実を既に出している（061a）。

## このタスクでやること

⚠⚠ **frontend の表示だけで直す。** wire（`obs.state` に `overlay` を載せる）には**触らない**——
理由は「やらないこと」に書く。

### (1) (B) の真因を潰す＝「連携 OFF なら必ず idle」を effects 側でも成立させる

`CommentViewerApp` のエフェクト連携 effect、`EFFECT_OBS_AUTO_ADD_KEY` が false になった分岐へ
**`setObsState("idle")` を足す**（表示 OFF 側の分岐と同じ後始末）。

⚠ これは 045c の不変条件（「連携 OFF 時に必ず `obsState` を idle へ戻す」）を**両側で成立させる**変更であって、
新しい規則を作るものではない。⚠ **`clearObsEnableTimer("effects")` は残す**（順序も変えない）。

### (2) (B) 本体＝ツールバーの赤字ゲートから `obsAutoAdd &&` を外す

`obsState === "failed"` だけで出す。**(1) がゲートの代わりになる**——連携が OFF なら `obsState` は
必ず idle なので、「OFF にしたのに赤字が残る」は起きない。

⚠ **`obsAutoAdd || effectObsAutoAdd` の OR にはしない。** そのためには main 窓が持つ設定を
`CommentViewerApp` の state へミラーする必要があり、`storage` の窓跨ぎ伝播（ベストエフォート）に
**表示の可否**を委ねることになる＝ 伝播が届かないと**失敗が黙って出ない**（いま直そうとしている症状そのもの）。
不変条件で担保するほうが、状態を増やさずに強い。

⚠ **文言は変えない**（「OBSに接続できませんでした」）。どの種別で失敗しても
**ユーザーが取る行動は同じ**（OBS が起動しているか確認する）——059b の通知音インジケータが
「失敗の中身で文言を変えない」と決めたのと同じ理由。

### (3) (C) 成功文言を種別に依存しない文へ

`SettingsView` の「OBSに表示」カードの `added` / `reused` の文言を
**「OBSにコメントを表示しました。」→「OBSに表示しました。」**へ変える。

⚠ **「コメント」を消すだけ**で、`connecting` / `failed` の文はそのまま（既に種別非依存）。
⚠ カードの見出し・トグルの label は**触らない**（あちらはコメント用トグルの説明として正しい）。
⚠ 表記は「OBSに」で統一されている（045b で揃えた）ので、それを崩さない。

### (4) (A) 案内文を事実に合わせる

`ObsEffectsScreen` の「OBS へ自動で反映」カードの注記を、**実際に起きることだけ**を書いた文へ差し替える。
必要な要素は 3 つ:

1. **失敗したときだけ**コメントビューアの画面上部に赤字が出る（成功時は何も出ない）
2. **追加できたかどうか**はコメントビューアの ⚙設定 →「OBSに表示」で確認できる
3. ⚠ **コメントビューアを開いていないと反映そのものが行われない**（061a の事実。前提ステータスと重複するが、
   この注記だけを読む人がいるので 1 節に閉じて書く）

⚠ **061a の教訓（Q-1）と同じ規律＝約束できることだけ書く。** 「表示されます」と書けるのは
実際に表示される条件のときだけ。

### (5) テスト

- **(1)**: エフェクトの自動反映 OFF（`storage`）で `obsState` が idle に戻ること
  （＝ 赤字が消えること）。⚠ **`setObsState("idle")` を消す変異でレッド**になること。
- **(2)**: **コメント側の自動反映 OFF ＋ `obsState === "failed"` で赤字が出る**こと
  （＝ 現状の `obsAutoAdd &&` を戻す変異でレッドになる）。
- **(3)**: `added` / `reused` で「OBSに表示しました。」が出て、**「コメント」を含まない**こと。
- **(4)**: `ObsEffectsScreen` の注記 3 要素が出ていること（061c/061d の案内文と同じく**回帰として固定**する）。
- ⚠ **既存の `SettingsView.obs.test.tsx` は文言を assert している**ので、(3) で一緒に直す
  （＝ 文言を変えたのにテストが緑のまま、という形を残さない）。

## このタスクでやらないこと

- ⚠⚠ **`obs.state` フレームに `overlay` を載せること（wire の変更）。**
  これは 046d と 061a Q-2 が共有している再修正トリガー
  （「**どちらのオーバーレイが OBS に出ていないか分からない**」という問い合わせが実際に出たら）の領分で、
  sidecar・`commentStream`・`CommentViewerApp`（`obsState` を `Record<ObsOverlayKind, ObsState>` へ）・
  `SettingsView`（種別ごとの表示）の 4 層に同時に手が入る。
  **本タスクは「結果が読み取れない」を直すのが目的**で、「どちらの結果か区別する」はその上位互換だが別問題。
  ⚠ **再修正トリガーは 046d / 061a の記述をそのまま引き継ぐ**（本タスクで消さない）。
- **main 窓（`ObsEffectsScreen`）に結果そのものを出すこと。**
  061a が「main 窓でも成否を見たい」となったら **コメビュ窓が `obs.state` を localStorage へ書く 1 キーを足す**、
  という再修正トリガーを残している。本タスクは (4) で**どこを見ればよいか**を正しく案内するに留める
  （＝ 新しい localStorage キーも新しい窓跨ぎ経路も増やさない）。
- **`connecting`（進行）の表示を増やすこと。** 045c が実機 E2E で「チラつきにしかならない」と撤回済み。
- **成功をツールバーへ出すこと。** 045c の「配信中のツールバーを騒がしくしない」を維持する。

## セキュリティ制約（docs/security.md 準拠）

- **§1**: 外部通信を増やさない。触るのは**既存の loopback WS の受け皿と表示だけ**で、
  新規の宛先・フレーム・プロトコルはゼロ。
- **§9**: 表示するのは**固定文言のみ**。`reason`（sidecar からのエラー理由）を画面に出さない・
  `console.*` にも出さない（現状も出していない＝この性質を崩さない）。
- **ゼロ拡大**: `src-tauri/` / `capabilities/` / `tauri.conf.json` / `apps/comment-sidecar/` / 依存は**差分ゼロ**。
- **localStorage**: 新規キーを増やさない。

## 完了条件

- **「コメント側の自動反映 OFF ／ エフェクト側 ON」で OBS 追加に失敗したとき、赤字が出る。**
- **エフェクトの自動反映を OFF にすると、その赤字が消える**（残らない）。
- **成功文言が種別に依らず正しい**（エフェクトの成功で「コメントを表示しました」と出ない）。
- **`ObsEffectsScreen` の案内文が事実と一致している**（成功時に何も出ないこと・確認場所・
  コメビュ窓が要ることの 3 つが読み取れる）。
- 新規テストが通り、**(1)(2) は変異で殺せている**。
- `pnpm typecheck` / `pnpm lint` / `pnpm test` が緑。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ。**

## 確認コマンド

```bash
git status --short
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json
# wire を触っていないことの担保（差分ゼロが期待）
git diff -- apps/desktop/src/features/comment-viewer/commentStream.ts

pnpm --filter ./apps/desktop tauri dev
# ① コメント側の自動反映 OFF ／ エフェクト側 ON ／ OBS を起動しない
#    → エフェクトの表示 ON → **ツールバーに赤字が出る**（現状は出ない）
# ② その状態でエフェクトの自動反映を OFF → **赤字が消える**
# ③ OBS を起動して自動反映 → ⚙設定 →「OBSに表示」に「OBSに表示しました。」（「コメント」を含まない）
# ④ OBSエフェクト画面の案内文が①〜③の実際の挙動と一致している
# ⑤ コメントビューアを閉じた状態で自動反映 ON → **何も起きない**ことが前提ステータスと案内で読み取れる
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
  frontend の表示のみで、OS 操作・ファイル操作・プロセス操作・外部通信のいずれも増やさないため。
- ⚠ ただし次は軽レビューでも必ず確認する:
  - **045c の不変条件が両側で成立している**こと（連携 OFF → 必ず `obsState` が idle）。
    ここが崩れると (2) のゲート撤去が「OFF なのに赤字が残る」に化ける
  - **`reason` を画面にも `console.*` にも出していない**こと（§9）
  - **wire（`obs.state`）と sidecar に差分が無い**こと
