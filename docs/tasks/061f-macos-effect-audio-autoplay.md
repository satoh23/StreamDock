# 061f（条件付き）macOS でエフェクトの音が鳴らない場合の対応

> ## ⚠⚠ 状態: **起票理由は解消した（2026-08-12）。本タスクは着手不要。**
>
> **`<audio>` は macOS のエフェクト窓で実際に鳴った**——実機 E2E ＋ 依頼者の実機確認の両方で確認済み
> （検証方法と結果は [`docs/progress.md`](../progress.md) の 061d-2 節「実機 E2E 実施結果」が正）。
> ＝ **[061d](061d-effect-template-ui.md) の実機確認⑪は合格**で、着手条件は満たされなかった。
> ⚠⚠ **当初の対処案（`WKWebViewConfiguration` を触る）は、そもそも成立しなかった**——
> **wry が既定で autoplay policy を無効化している**（下記「現在の前提」）。
>
> ### ⚠ それでもこのファイルを残す理由（＝残っている唯一の宿題）
>
> ⚠⚠ **確認できたのは `audio/wav` だけである。** 許可している音源は **3 種**
> （`audio/wav` / `audio/mpeg` / `audio/ogg`）で、**`audio/mpeg`（mp3）と `audio/ogg` は未確認**。
> ⚠ **`audio/ogg` は macOS の AVFoundation にデコーダが無く、WKWebView で鳴らない可能性が高い**
> （Safari が ogg を再生しないのと同じ理由）。そうだとすると
> **「取り込めたのに macOS でだけ無音」**という 061c の約束（取り込めた＝使える）のほころびが残る。
> ⚠ **fail する向きとしては安全**（音が鳴らないだけでエフェクトは出る）ので急がない。
>
> **⇒ 新しい着手条件＝ 次のどちらか**:
> 1. **mp3 / ogg の音源を持つテンプレートで実機確認し、鳴らないものがあったとき**
> 2. 利用者から「音ありのはずが鳴らない」と報告が出たとき
>
> 以降の本文は**そのときの切り分け手順**として残してある（(1) の順に見れば原因が付く）。
> ⚠ **(3) の分岐は反証済み**なので入らない——読み飛ばさず、**なぜ入らないか**だけ確認すること。
>
> 分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、器 [061a](061a-effect-overlay-window.md)（**窓の生成条件＝`focused(false)`**）、
> テンプレート適用 [061d](061d-effect-template-ui.md)（**`<audio>` の設計と実機確認⑪**）、
> 取り込み [061c](061c-effect-template-import.md)（**許可 MIME＝`audio/wav` / `audio/mpeg` / `audio/ogg`**）、
> 音の系統分離 [058a](058a-audio-routing-foundation.md)（**`rodio` にデコーダを入れないと決めた**）と
> [059b](059b-monetary-notification-sound.md)（**Rust・実デバイス指定・配信に載せない側**）、
> [`docs/security.md`](../security.md)（§1／§9／§10／**Tauri Permissions / Capabilities 方針の 061a 節**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> ⚠⚠ **Rust に触り 5 窓すべてに影響しうるので security-review 必須**（着手する場合）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **旧・着手条件（061d-2 の実機確認⑪が fail すること）は 2026-08-12 に不成立が確定した。**
> 新しい着手条件は冒頭の「残っている唯一の宿題」を見ること。

## 目的

**エフェクトテンプレートの音が、エフェクト窓（`effect-overlay`）で実際に鳴る状態にする。**

061d-2 は音を **webview の `<audio>` ＋ data URI** で鳴らす設計にした（Rust の `rodio` は
`features = ["playback"]` だけでデコーダを持たないため、そもそも Rust では鳴らせない・058a の判断）。
出力は **OS 既定＝OBS で「デスクトップ音声」を取り込んでいれば配信に載る**——これが要望どおりの挙動である。

⚠ 懸念は「エフェクト窓は `focused(false)` で生成される非フォーカス窓なので、
ブラウザの autoplay policy が**音付き再生を拒否する**のではないか」だった。
**jsdom は再生を実装しないのでテストでは検出できない**（061d-2 が「固定できていないもの」として申告済み）。

## 現在の前提（調査結果・実コード）

### ⚠⚠ 起票時の前提は**誤り**だった（2026-08-12 の調査で判明）

task-board の起票文は
「Windows / WebView2 は `SHARED_BROWSER_ARGS` の `--autoplay-policy=no-user-gesture-required` で対策済みだが、
**macOS / WKWebView には対応する設定が無い**」と書いていた。**後半は事実と違う。**

- **wry 0.55.1（`Cargo.lock` で確認）の `WebViewAttributes` は `autoplay: bool` を持ち、既定が `true`。**
- macOS 実装（`wry/src/wkwebview/mod.rs`）は `attributes.autoplay` が true のとき
  **`config.setMediaTypesRequiringUserActionForPlayback(WKAudiovisualMediaTypes::None)` を呼んでいる**
  ＝ **「再生にユーザー操作を要求するメディア種別は無し」**＝ 音付き autoplay が許可される。
- **`tauri-runtime-wry` 2.11.4 は `autoplay` に一切触っていない**（grep で不在を確認）
  ＝ **wry の既定 `true` がそのまま効く**。
- ＝ **StreamDock の 5 窓すべてで、macOS の autoplay policy は既に無効化されている。**
  Windows 側の `--autoplay-policy=no-user-gesture-required`（`SHARED_BROWSER_ARGS`）と**同じ状態**である。

⚠⚠ **したがって「⑪が fail したら `WKWebViewConfiguration` を触る」という当初の計画は成立しない。**
既に設定されているものをもう一度設定しても何も変わらない。
（そもそも `WKWebViewConfiguration` は webview 生成後には実質変更できず、
`webview.with_webview(...)` から後追いで直す方針も採れない。）

### 「鳴らない」と報告が出たときに疑う順番（⚠ ④は 2026-08-12 に反証済み）

| 候補 | 見分け方 | 見込み |
|---|---|---|
| **①音源のデコード失敗** | main 窓のプレビュー（`EffectTemplatePreview`）で**同じテンプレートの音が鳴るか**。鳴らなければデコード側 | ⚠⚠ **最有力・かつ唯一の未検証**。許可 MIME は `audio/wav` / `audio/mpeg` / `audio/ogg` の 3 種だが、**実機で確認できたのは `wav` だけ**。**Safari / WKWebView は `audio/ogg`（Vorbis / Opus）を再生できない**（AVFoundation にデコーダが無い） |
| **②data URI の長さ** | 小さい wav（数十 KB）で鳴るか。大きい mp3 で鳴らないなら長さ側 | 低（`<img>`/`<video>` は同じ経路で動いている） |
| **③出力デバイス** | 059b の通知音（Rust 側）は鳴るか。両方鳴らないならデバイス設定 | 低 |
| **④非フォーカス窓の制約** | プレビュー（main 窓・フォーカスあり）では鳴り、エフェクト窓でだけ鳴らない | ⚠⚠ **反証済み（2026-08-12）**。実機で**エフェクト窓（`focused(false)`）でも鳴った**（`pmset` の coreaudiod コンテキストが発火直後に増えることで確認）。**ここを疑い直さないこと** |
| **⑤`<audio>` が DOM に出ていない** | エフェクト窓に `data-testid="effect-sound"` の要素が出るか（＝ `safeEffectMedia` が音源を弾いていないか） | 低（テストで固定済み） |

⚠⚠ **④が消えたので、実質①だけが残っている。** ＝ **「どの拡張子の音源か」を最初に聞くこと**
（wav なら別の原因、ogg なら①でほぼ確定）。

### その他の前提

- **`onError` は付いていない**（061d-1 レビュー P-3 の判断）。＝ **デコード失敗を frontend は検知していない**。
  ①を確定させるには、このタスクで**一時的に**検知手段を足すか、別フォーマットで試すかのどちらかが要る。
  ⚠ §9 と `no-console` により、この窓は**計測ログを 1 バイトも出せない**（観測手段は画面と耳だけ）。
- **`rodio` にデコーダ feature を足すのは禁止**（§10・058a）。「Rust で鳴らす」は選択肢ではない。
- **fail する向きとしては安全**——`effectMedia.ts` が「音が鳴らないことは配信を壊さない／
  エフェクトが出ないことは壊す」と線を引いており、音だけが鳴らなくても配信は成立する。

## このタスクでやること

⚠ **順番に意味がある。**（1）で原因が確定するまで（2）以降へ進まない。

### (1) 原因の切り分け（**コード変更なし**）

⚠⚠ **これが最初の一手であり、いまはここだけが未了である。**

1. ⚠⚠ **mp3 / ogg の音源を持つテンプレートを作って鳴らす**（wav は 2026-08-12 に確認済み）。
   `manifest.json` の `sound` を `sound.mp3` / `sound.ogg` にして取り込み、
   **main 窓のプレビュー**と**エフェクト窓のテスト表示**の両方で聴く。
   - **wav だけ鳴る → ①確定**（macOS のデコーダに無い形式）。(2) へ。
   - **どれも鳴らない → ②か③**。059b の通知音が鳴るかで③を切り分ける。
   - **全部鳴る → 本タスクは完全にクローズしてよい**（盤面からもファイルからも消してよい）。
2. ⚠ **利用者から報告が来て着手する場合は、まず「どの拡張子か」を聞く**
   （ogg ならほぼ①で確定するので、この手順を全部走らせなくてよい）。
   ⚠ 次に **main 窓のプレビューで鳴るか**を聞く——プレビューとエフェクト窓の違いは
   **窓のフォーカス状態だけ**なので、これで④の再燃かどうかが分かる
   （④は反証済みなので、ここが割れたら前提から調べ直すこと）。

### (2) ①（デコード不可のフォーマット）だった場合＝**取り込み時に伝える**

⚠⚠ **許可 MIME を狭める（`audio/ogg` を落とす）のは「取り込めるのに描けない」の逆を作る変更**なので、
`effectMedia.ts` と Rust の `AssetKind::mime()` の**両方**を触ることになる
（`scripts/check-effect-template-contract.mjs` が突き合わせているので片方だけは通らない）。
＝ **docs/security.md の「CSP方針 → 061c」と「レビュー必須条件 → 外部コンテンツの埋め込み」の対象**である。

採りうる案は 2 つ。**実機の結果を見てから決める**:

- **(a) 許可のまま、UI で「この形式は環境によっては鳴りません」と伝える**（frontend のみ・軽い）
  ⚠ 061c の「取り込めた＝使える」という約束は弱まるが、**Windows では鳴る**ので許可を落とすのは過剰。
- **(b) `audio/ogg` を両層から落とす**（Rust ＋ TS ＋ contract ガード）
  ⚠ **既に ogg で取り込み済みのテンプレートが「取り込めているのに音が出ない」状態になる**
  （レコードは残り、`get_effect_template_media` が音を返さなくなる）。移行の扱いを決める必要がある。

⚠ **どちらを採っても「音が鳴らないことは配信を壊さない」の線は維持する**（音が無いだけでエフェクトは出る）。

### (3) ④（非フォーカス窓）だった場合＝**Rust に触る唯一の分岐**（⚠⚠ **反証済み・通常は入らない**）

⚠⚠ **2026-08-12 の実機確認で「非フォーカス窓でも鳴る」ことが分かったので、この分岐は死んでいる。**
それでも入るとしたら、**別 OS バージョン・別の音声出力構成で再燃した**ときだけである。
⚠⚠ **その場合もまず「wry が既に policy を無効化している」事実と矛盾しないかを疑うこと。**
矛盾するなら、原因は autoplay policy ではなく別（OS の集中モード・音声出力の切替・
OBS 側のミキサ設定）である可能性が高い。

それでも窓側の設定が要ると判明した場合の手段は、`open_effect_overlay_window` の
`WebviewWindowBuilder` に**この窓だけ**の設定を足す形になる。⚠ 制約:

- **`SHARED_BROWSER_ARGS` は 1 バイトも変えない**（`tauri.conf.json` の `additionalBrowserArgs` と
  **バイト単位で一致**させる契約があり、崩すと Windows で**窓生成そのものが失敗する**・033f 追修正③）。
- **5 窓すべてに効く変更にしない**（コメビュ窓・main 窓の挙動を変える理由が無い）。
- **capability / `tauri.conf.json` / 依存は増やさない。**

### (4) 最低限の逃げ道（**どの原因でも、直せないなら必ずこれをやる**）

`ObsEffectsScreen`（または割り当てカード）に **「お使いの環境では音が鳴らないことがあります」の 1 文**を出す。

⚠⚠ **これは体裁ではなく 061d-2 security-review S-1 と同じ性質の要件**である——
ユーザーは「音があるテンプレートを選べば音が出る」と理解して割り当てるので、
**鳴らないことを知らせないと「壊れている」と誤解する**（そして原因を探して時間を溶かす）。
⚠ そのぶんだけなら **frontend のみ＝軽レビューで済む。**

### (5) テスト

- **(2)(a) / (4)**: 文言が出ていることを回帰として固定する（061c/061d の案内文と同じ扱い）。
- **(2)(b)**: 許可 MIME を落とすなら `effectMedia.ts` のテストと Rust の `AssetKind` テスト、
  および `check-effect-template-contract.mjs` の突き合わせが**同時に**動くこと。
- ⚠⚠ **「鳴ること」そのものはテストで固定できない**（jsdom は再生を実装しない）。
  **実機確認だけが検証手段**である——この事実を progress.md に必ず残す。

## このタスクでやらないこと

- ⚠⚠ **`rodio` にデコーダ feature を足すこと**（§10・058a の判断）。「Rust で鳴らす」は選択肢に入れない。
- **`SHARED_BROWSER_ARGS` の変更**（上記のとおり Windows の窓生成が壊れる）。
- **音量スライダーの新設**（061d ⑦で「作らない」と決定済み）。
- **059b の通知音と畳むこと**（出力系統が別・配信に載るのはエフェクト側だけ・親 061 の「音とエフェクトは独立」）。
- **エフェクト窓に `focused(true)` を与えること**（配信中に窓がフォーカスを奪う＝OBS 操作を妨げる。
  061a の窓生成条件を崩さない）。

## セキュリティ制約（docs/security.md 準拠）

- **§1**: 音源は**ローカル取り込みのバイト列を Rust が data URI にしたもの**だけ。外部 URL を作らない。
- **§9**: 原因調査で `console.*` を足さない（`eslint.config.js` の `no-console` が
  `src/screens/obs-effects/**` と `src/features/obs-effects/**` に効いている）。
  ⚠ **一時的に足して消す**運用も取らない（消し忘れが配信画面に残る）。
- **§10**: 依存を増やさない。
- **Capabilities 方針 061a 節**: (3) に入る場合、**窓の生成条件を変える**＝ この節の受容根拠
  （「実行文脈が生まれる 3 経路が閉じていること」）に影響しないかを必ず再確認する。
- **CSP方針 061c 節**: (2)(b) に入る場合、**許可 MIME は Rust と TS の対**である。片方だけ変えない。

## 完了条件

⚠ **「音が鳴る」ことが完了条件とは限らない。** 環境の制約で鳴らないと分かった場合は、
**その事実がユーザーに伝わっていること**が完了条件になる。

- ⚠⚠ **`audio/wav` / `audio/mpeg` / `audio/ogg` の 3 種すべてについて、macOS で鳴るか鳴らないかが判明している**
  （＝ 許可 MIME の一覧と実際に鳴る形式が食い違ったままにしない）。
- **原因が (1) で特定され、progress.md に記録されている**（どれを試して何が起きたか）。
- 直せる原因だった場合: **エフェクト窓でテンプレートの音が実際に鳴る**（実機）。
- 直せない原因だった場合: **(4) の 1 文が出ており、ユーザーが「鳴らないことがある」と知れる**。
- ⚠ **`rodio` は `features = ["playback"]` のまま**・**`SHARED_BROWSER_ARGS` はバイト一致のまま**。
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / （Rust を触ったなら）`cargo check` が緑。

## 確認コマンド

```bash
git status --short
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ⚠ 起票時の前提が崩れた根拠（着手前にもう一度自分で確かめること）
grep -n -A2 '^name = "wry"' apps/desktop/src-tauri/Cargo.lock
grep -rn "autoplay" ~/.cargo/registry/src/*/wry-*/src/wkwebview/mod.rs      # setMediaTypesRequiringUserActionForPlayback
grep -rn "autoplay" ~/.cargo/registry/src/*/tauri-runtime-wry-*/src/lib.rs  # ヒットゼロ＝ wry の既定が効く

# 禁止事項の担保
grep -n "rodio" apps/desktop/src-tauri/Cargo.toml                 # features = ["playback"] のまま
grep -n "SHARED_BROWSER_ARGS" apps/desktop/src-tauri/src/lib.rs   # 文字列を変えていない
grep -n "additionalBrowserArgs" apps/desktop/src-tauri/tauri.conf.json  # 上とバイト一致

pnpm --filter ./apps/desktop tauri dev
# ⚠ wav は 2026-08-12 に「プレビュー・エフェクト窓の両方で鳴る」ことを確認済み。残りはこれ:
# ① mp3 の音源を持つテンプレートで鳴るか（プレビュー／エフェクト窓の両方）
# ② ogg の音源を持つテンプレートで鳴るか（← 鳴らない見込みが高い＝(2) の判断へ）
# ③ 059b の通知音が鳴るか（出力デバイス側の切り分け・上が両方鳴らないときだけ）
# ④ 直せない場合: 「鳴らないことがある」旨の 1 文が画面に出ている
```

## 実装後に必要なレビュー

- **(1) だけで終わった場合**（原因が判明し、コード変更なし）＝ **レビュー不要**。
  progress.md への記録と、必要なら (4) の 1 文だけ（軽レビュー）。
- **(4) だけの場合** ＝ **軽レビュー**（frontend の文言のみ）。
- ⚠⚠ **(2)(b) または (3) に入った場合＝ `security-review` 必須**。
  - (2)(b): **許可 MIME は Rust と TS の対**（`check-effect-template-contract.mjs`）。
    docs/security.md の「CSP方針 → 061c」と「レビュー必須条件 → 外部コンテンツの埋め込み」に該当する。
  - (3): **窓の生成条件を触る**＝ Capabilities 方針 061a 節の受容根拠に影響しないかを見る。
    ⚠ **5 窓すべてに効く変更になっていないこと**を必ず確認する。
