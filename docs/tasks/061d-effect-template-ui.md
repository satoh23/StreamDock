# 061d エフェクトテンプレート適用 UI（一覧・割り当て・プレビュー）

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、器 [061a](061a-effect-overlay-window.md)（`obs-effects` 画面の枠）、
> 発火層 [061b](061b-monetary-effect-builtin.md)（`effectTrigger.ts` / `EffectRequest` の正）、
> 取り込み基盤 [061c](061c-effect-template-import.md)（コマンドと `manifest` の正）、
> テーマ管理 UI の先例 [060d](060d-css-theme-management-ui.md)（一覧・切替・削除・復帰導線の作法）、
> 設定の保存作法 [`overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> [`docs/security.md`](../security.md)（§1／## CSP方針／§9）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **着手条件＝[061c](061c-effect-template-import.md) 完了**。

## 目的

取り込んだテンプレートを**選んで、イベントに割り当てて、実際に配信へ出す**ところまでを繋ぐ。
[061b](061b-monetary-effect-builtin.md) の組み込みエフェクトと、[061c](061c-effect-template-import.md) の
テンプレートを、**同じ一覧から選べる**状態にするのがゴール。

## 現在の前提（調査結果・実コード）

- [061a](061a-effect-overlay-window.md) で `obs-effects` 画面の枠（表示トグル・OBS 自動反映・ステータス）ができている。
- [061b](061b-monetary-effect-builtin.md) の `effectTrigger.decideEffects()` が `EffectRequest[]` を返し、
  `EffectOverlayApp` が組み込み意匠で描いている。
- [061c](061c-effect-template-import.md) の `list_effect_templates` / `get_effect_template_media` が使える。
  ⚠⚠ **061c からの申し送り（着手前に必ず読むこと。詳細は [`docs/progress.md`](../progress.md) の 061c 節）**:
  - **差し込み変数は 4 つ**（`{name}` / `{amount}` / `{event}` / **`{message}`**）。
    `text.template` は「金額**あり**」、`text.templateWithoutAmount`（既定 `"{message}"`）は「金額**なし**」に使う。
    ⚠ **`amountText` と `message` は同時に null になりうる**ので、両方が空文字へ落ちた行は**描かないこと**。
  - **DTO にファイル名は 1 つも載らない**（`dir_name` / `media` / `sound` は返らない）。
    音の有無は `hasSound` だけで判断する。
  - ⚠⚠ **音は 061d が鳴らす。Rust では鳴らせない**——`rodio` は `features = ["playback"]` のみで、
    058a が `wav` を**意図的に落としている**（symphonia デコーダ一式が入るため）。
    ⇒ **webview の `<audio>` ＋ data URI**。出力は **OS 既定＝配信に載る**。
    059b の通知音（Rust・実デバイス指定・**配信に載せない**）とは**別系統**で、同時に鳴りうる
    （畳むかどうかは本タスクで決める）。音量は 059a の `sound-volume` と共有しないほうが素直
    （`HTMLAudioElement.volume`）。⚠ **`rodio` にデコーダ feature を足さないこと**（`docs/security.md` §10）。
  - ⚠ **data URI は「割り当て時／画面表示時」に先読みし、発火の瞬間に `get_effect_template_media` を
    呼ばないこと**（最大 5MiB → base64 約 6.7MB。同時表示 3 件ぶんが載りうる）。
  - **描画ガードは `src/screens/obs-effects/effectMedia.ts`**（061c が用意済み）。
    `safeEffectMedia` は**メディアが弾かれたら `undefined`**（組み込みへフォールバック）、
    **音源だけ弾かれたらメディアは出す**（音が鳴らないことは配信を壊さない）。
  - **`kind` の拡張点** = `{ kind: "builtin-monetary" } | { kind: "template"; templateId: string }`。
    061c は `effectTrigger.ts` に 1 バイトも触っていない。
  - ⚠⚠ **`docs/security.md` の Capabilities 方針 061a 節「外部コンテンツを踏む経路ゼロ」の失効条件を、
    本タスクでもう一度見ること。** 061c の再評価は「**経路ができた**」までで、
    **実際に第三者由来のバイト列を踏むのは 061d** である（061c の再評価をもって免除しない）。
  - ⚠⚠ **取り込み UI に「テンプレート専用のフォルダを選んでください」の案内を必ず置き、
    取り込み直後にプレビューを出すこと**（061c security-review S-3 の緩和策）。
    `manifest.media` は「**選ばれたディレクトリ直下に既に在る別のファイル**」も名指しできる——
    フォルダ包みでない zip を `~/Downloads` へ直接展開して `~/Downloads` を選ぶと、
    ユーザーの私的な画像が配信画面に出る。⚠ Rust 側では**構造的に塞げない**
    （ディレクトリを列挙しない設計上、どれが同梱ファイルかを区別する材料が無い）ので、
    **UI の案内とプレビューが唯一の緩和策**である。省略しないこと。
- [060d](060d-css-theme-management-ui.md) で「一覧・切替・削除・**壊れたときの復帰導線**」の作法が
  1 度作られている。**同じ形をなぞる。**
- 設定は localStorage の `stream-dock.*` 名前空間（`load*` / `save*` ペア・不正値は既定へフォールバック）。

## このタスクでやること

### (1) invoke ラッパ（`features/obs-effects/effectTemplateApi.ts`）

- [061c](061c-effect-template-import.md) の 4 コマンドを包む薄いラッパ（ts-rs 生成の型を使う）。
- **コンポーネントから `invoke` を直接呼ばない**（既存の作法）。

### (2) イベント → エフェクトの割り当て

- ⚠ **ここが「たぬえさ3 より簡単に」の分かれ目**。[063s](063s-tanuesa-gacha-spike.md) の調査対象でもあるが、
  061d の時点で**割り当ての形**を決めてしまう（063 はここに乗る）。
- **割り当ての単位はイベント種別**。行は最初から全部並んでいて、各行にエフェクトを選ぶだけ:

| イベント | エフェクト |
|---|---|
| スーパーチャット / ビッツ | （なし / 組み込み / テンプレート名…） |
| サブスク | 〃 |
| メンバーシップ | 〃 |
| ギフト | 〃 |
| ドネーション | 〃 |
| Jewels | 〃 |

- ⚠ **「条件を追加」ボタンで行を増やす形にしない。** 種別は `MONETARY_EVENT_TYPES` で固定されているので、
  **行は最初から全部ある**のが最も簡単。たぬえさ3 の「タグをコピペで増やす」の逆をやる。
- ⚠ **金額の閾値による出し分けは、この時点では作らない。**
  作るなら「スーパーチャット」の行を**金額帯で 3 行に割る**（`monetaryTone` のティアをそのまま使う）形だが、
  **まず種別だけで動かして実機の手応えを見る**。⚠ **再修正トリガー＝「高額だけ豪華にしたい」と言われたとき**。
- 保存は localStorage（`stream-dock.obs-effects.assignments`・JSON）。
  ⚠ **テンプレート id を保存するので、削除されたテンプレートを指す割り当てが残りうる**。
  **読み込み時に実在しない id は「なし」へフォールバック**する（黙って何も出ないのではなく、
  UI で「テンプレートが見つかりません」と出す）。

### (3) テンプレート一覧 UI（`ObsEffectsScreen.tsx`）

- **インポート**: `@tauri-apps/plugin-dialog` の `open({ directory: true })` でディレクトリ選択 →
  `import_effect_template`。⚠ **capability は main 窓の既存 `dialog:allow-open` で足りる**（追加不要）。
- **一覧**: 名前・プレビュー・削除。
- **削除**: 確認を挟む（既存の `ConfirmDialog` を再利用）。
  ⚠ **割り当てに使われているテンプレートを消すときは、その旨を確認文に出す。**
- **プレビュー**: テンプレートを選ぶとダミーの `EffectRequest`（「テスト太郎さんが ¥1,000」）で
  **実際に再生して見せる**。
  - ⚠ **プレビューは `obs-effects` 画面内で再生する**（エフェクト窓ではなく）。
    エフェクト窓で再生すると**配信中に出てしまう**。
  - ⚠ **音も鳴らす**（`manifest.sound`）。音量は [059a](059a-comment-notification-sound.md) の
    `sound-volume` を共有するか独立させるかを決めてコメントに残す。

### (4) エフェクト窓での描画（`EffectOverlayApp.tsx` の拡張）

- `EffectRequest` に「どのエフェクトで出すか」（組み込み / テンプレート id）を載せ、
  テンプレートなら `get_effect_template_media` で data URI を取って `<img>` / `<video>` で描く。
- ⚠ **描画側のガード**（[061c](061c-effect-template-import.md) の (5)）を必ず通す＝`data:` 始まり以外は描画しない。
- `manifest.layout` の `anchor` / `offset` / `width` / `height` を適用する。
- `manifest.text.template` の `{name}` / `{amount}` / `{event}` を `EffectRequest` の値で差し替える。
  ⚠ **差し替えは文字列置換で、テキストノードとして描く**（`dangerouslySetInnerHTML` を使わない）。
  ⚠ **投稿者名は第三者の自由入力**なので、HTML として解釈させない（React のテキスト描画なら自動で安全）。
- ⚠ **メディアの読み込みに失敗したら組み込み意匠へフォールバックする**。
  配信中にエフェクトが出ない（＝無反応）より、素の表示でも出るほうがマシ。

### (5) 復帰導線

- ⚠ [060d](060d-css-theme-management-ui.md) と同じ問題がある。壊れたテンプレート（巨大・真っ黒・
  画面全体を覆う）を割り当てると配信画面が壊れる。
- → **「すべての割り当てを解除」ボタン**を置く。1 クリックで全行「なし」へ。
- ⚠ **これはテストで固定する。**

### (6) テスト

- 割り当ての load/save（未保存 / 不正 JSON / 例外 → 既定＝全「なし」）
- **実在しないテンプレート id を指す割り当てが「なし」へフォールバック**し、UI に警告が出ること
- テンプレート削除時に、それを使っている割り当てが解除されること
- `EffectOverlayApp` がテンプレートを描くこと・**`data:` 以外を弾く**こと・
  **メディア読み込み失敗で組み込みへフォールバック**すること
- `{name}` に HTML（`<img src=x onerror=...>`）を入れても**テキストとして出る**こと
- 「すべての割り当てを解除」ボタンの存在と動作
- **ミューテーションで実効性を確認**する。最低限、`data:` ガードを外したときにレッドになること。

## このタスクでやらないこと

- **テンプレートの取り込み・検証**（[061c](061c-effect-template-import.md)）。本タスクは呼ぶだけ。
- **発火条件の判定**（[061b](061b-monetary-effect-builtin.md)）。本タスクは「どのエフェクトで出すか」だけ。
- **ガチャ**（[063](063-gacha-effect.md)）。⚠ ただし割り当ての形（イベント → エフェクト）は
  ガチャも使うので、**063 が乗れる形にしておくこと**。
- **金額閾値による出し分け**（上記 (2) の判断）。
- **チャンネルポイント連携**（新規 OAuth スコープが要るため別タスク）。
- テンプレートのアプリ内編集。
- 複数エフェクトの同時再生・重ね合わせ。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。メディアは data URI のみ（[061c](061c-effect-template-import.md) が保証）。
- ⚠ **描画側のガードを必ず通す**（`data:` 始まり以外は描画しない）。036a と同型の最終防波堤。
- **`dangerouslySetInnerHTML` を使わない。** `{name}` などの差し替えは**テキストノード**として描く
  （投稿者名は第三者の自由入力）。
- **capability の追加ゼロ**（main 窓の既存 `dialog:allow-open` で足りる）。
- 追加する localStorage キーは**ユーザー自身の設定値**（割り当ての JSON＝テンプレート id とイベント種別のみ）で、
  第三者の個人データを含まない（§9）。
- ログにテンプレート名・投稿者名・金額を出さない（§9）。
- **frontend のみ**。Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ。`csp: null` 不変。
- 生 hex を書かない（トークンのみ）。

## ⚠⚠ 061c から移管された実機確認（**本タスクの完了条件に含める**）

061c の確認①〜⑦は **UI が無いと 1 つも実行できない**ので、コマンドを呼ぶ UI を作る本タスクへ移した
（060b → 060d の申し送り⓪と同じ形。⚠ **061c 側に置いたままだと忘れられる**）。
⚠ **⑧はそもそも 061c の範囲外**（061c は描画層を持たない）なので、移管ではなく**新設**である。

1. 正常なテンプレートを取り込む → 一覧に出て、`app_data_dir/effects/<uuid v4>/` に
   **`manifest.json` が参照するファイルだけ**（`media.<拡張子>` / `sound.<拡張子>`）が入る。
   ⚠ **`manifest.json` 自体は入らない**（検証済み JSON は DB にある）。
2. `media` に `"../../evil.png"` を書いたテンプレート → **取り込みが拒否される**。
3. テンプレート内の `main.png` を**管理ディレクトリ外へのシンボリックリンク**にする → **拒否される**。
   ⚠ 一方、**テンプレートのフォルダ自体がシンボリックリンク**の場合は**取り込める**
   （Dropbox / iCloud 構成を壊さないための意図的な非対称。061c の (4) が正）。
4. `.html` を同梱したテンプレート → **`.html` はコピーされない**。
5. **4MB 超のメディア**（または 2MB 超の音源／合計 5MB 超）→ 拒否される。
6. `text.template` に `{ipaddr}` など未知の変数 → 拒否される。
   ⚠ `{text}` / `{avatar}` も拒否される（**型でも渡せない**が、取り込み時にも落ちる）。
7. 削除するとディレクトリ実体も消える。
8. ⚠⚠ **新設**: **エフェクト窓が開いた状態で大きめのメディア（4MB 近く）を割り当てて発火させ、
   OBS のキャプチャがカクつかないこと。** 061c は描画層を持たないので、ここでしか測れない。
   ⚠ カクつく場合の対処は ①`get_effect_template_media` を**先読み**にする（発火の瞬間に呼ばない）
   ②061c の上限を下げる、の順。**`EFFECT_MAX_CONCURRENT = 3` は触らない。**
9. （061c 側で実施済み）`lsof -i` で外部 ESTABLISHED が増えないこと。

## 完了条件

- **上記の移管された実機確認①〜⑧が通る。**
- テンプレートのディレクトリをインポートでき、一覧に並び、**プレビューで再生できる**。
- イベント種別ごとにエフェクト（なし / 組み込み / テンプレート）を割り当てられる。
- 実際に課金コメントが来ると、**割り当てたテンプレートが配信画面に出る**。
- **実在しないテンプレート id の割り当てが「なし」へフォールバックし、警告が出る。**
- **メディア読み込み失敗で組み込み意匠へフォールバックする**（無反応にならない）。
- **`{name}` に HTML を入れてもテキストとして出る。**
- **「すべての割り当てを解除」で必ず復帰できる。**
- プレビューが `obs-effects` 画面内で再生され、**配信には出ない**。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **Rust / sidecar / capabilities / `tauri.conf.json` / 依存は差分ゼロ**・`csp: null` 不変・生 hex ゼロ。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test   # check:css も含む

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json

pnpm --filter ./apps/desktop tauri dev
# ① テンプレートをインポート → 一覧に出る → プレビューで再生される（**エフェクト窓には出ない**）
# ② スーパーチャットにテンプレートを割り当て → dev-mock でスパチャ → 配信画面にそのテンプレートが出る
# ③ 名前に <img src=x onerror=alert(1)> を含むダミーで発火 → **テキストとして表示される**（実行されない）
# ④ 割り当て中のテンプレートを削除 → 割り当てが解除され、警告が出る
# ⑤ manifest の media を壊す（削除する）→ 組み込み意匠で出る（無反応にならない）
# ⑥ 「すべての割り当てを解除」で全部「なし」に戻る
# ⑦ OBS 側で実際にテンプレートエフェクトが合成されて映る
```

## 実装後に必要なレビュー

- **軽レビュー**（[`code-review-light`](../../.claude/skills/code-review-light/SKILL.md)）。
- ⚠ ただし次は軽レビューでも必ず確認する:
  - **`data:` ガードを通っている**こと（描画シンクの最終防波堤）
  - **`dangerouslySetInnerHTML` / `innerHTML` を使っていない**こと（`{name}` は第三者の自由入力）
  - **プレビューがエフェクト窓に出ない**こと（配信への漏れ）
  - **復帰導線**（「すべての割り当てを解除」）が動くこと
