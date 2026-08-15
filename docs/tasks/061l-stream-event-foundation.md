# 061l 配信イベントの基盤

> 状態: **実装完了 ＋ 実機確認 1〜11 合格（2026-08-15）**。⚠ **12 だけ持ち越し（061n へ）。**
> ⚠ **UX 再設計 061h〜061l の 5 本目（最後）。**
> ⚠⚠ **実装上の帰結・変異 22 件の実測・security-review・実機の観測値は docs/progress.md の 061l 節が正。**
>
> ⚠⚠ **実機で判明した「本ファイルの言い過ぎ」**: 実機確認 9 の
> 「配信画面に第三者のコメント本文・表示名が **1 文字も出ない**」は、**エフェクトが 1 つでも
> 設定されていれば偽**である（`EffectRequest` は 061b の設計として表示名と金額を持ち、
> テンプレートの文面がそれを描く）。**正しくは「イベントの描画には第三者データが出ない」**で、
> それは実測で成立している（イベントカードの文字は件数と残り時間だけ）。

## ⚠⚠ 実装で判明した前提の破れ（着手前に潰した穴 α〜ζ の結論・2026-08-15 追記）

| 穴 | 結論 |
|---|---|
| **α** 書き換える既存テストが挙がっていない | ✅ **追認**。落ちたのは **1 件だけ**（`ObsEffectsScreen.test.tsx` の「配信イベントタブは準備中の案内だけ」）。全 src を再走査して他に無いことを確認した |
| **β** `.eventLayer` を (10-r) へ足すか | ✅ **足した**。⚠⚠ **CSS だけを壊す変異で実測**——`.eventLayer` の `position/inset` を外すと **`check:css` は FAILED / コンポーネントテストは 22 件すべて緑**。＝ (10-r) の主張が `.eventLayer` にもそのまま成り立つ |
| **γ** 件数を `incoming` / `fresh` のどちらで数えるか | ✅ **`fresh`**（043e の combo 再送で二重に数えない）。⚠⚠ **最初のテストでは変異が生存した**——再送だけのバッチは `fresh.length === 0` の早期 return で件数処理に到達しないので、**殺せるのは「再送と新着が混ざったバッチ」だけ** |
| **δ** 件数の永続性 | ✅ **受容（永続しない）＋画面で 1 文説明**。却下＝localStorage に持つ案（**コメントのたびに全窓へ `storage` を撒く**）。⚠ **再修正トリガー＝次タスクで「失うと配信が成立しない状態（スコア）」を持つとき** |
| **ε** 同梱 PNG は要るか | ✅ **絵文字だけ**（`public/stream-events/` は作っていない）。⚠ **やること (6) は判断 3 と食い違っていた**（判断 3 が `thumbnail?` を任意と決めている）。分岐と両分岐のテストは実装済み |
| **ζ** 実機確認 12 の前提 | ❌ ⚠⚠ **前提の記述が誤りで、しかも解けても達成できない**（下記）。⇒ **12 は 061l では実施せず、独立タスク 061n として起票した** |

### ⚠⚠ ζ の訂正（2 件・実測）

1. **`connecting` が返らない原因は sidecar モックではない**——`dev-mock.ts` の `handleControl` は
   **provider 非依存**で必ず `connecting` を送る。返らないのは frontend が
   **「チャンネル名が空なら `start-session` を送らない」**ため（WKWebView に合成キーは入らない）。
   ⇒ **localStorage へ直接仕込めば解ける見込み**。
2. ⚠⚠ **解けても測れない**——`EMIT_INTERVAL_MS = 1800` は **env で変えられない `const`** なので
   **twitch ＋ youtube でも ≒1.11 件/秒**。⑧ の懸念（毎秒 10 件級）に **1 桁足りない**。
   ⇒ **`apps/comment-sidecar/` を触る必要があり、本タスクの差分ゼロ要件に反する。**

### ⚠ その他の訂正（3 件）

- **検証コマンドの `grep -rn "\.text\b\|author" EffectOverlayApp.tsx` は「ヒットゼロ」ではない**——
  ベースラインから **1 件ヒットする**（`text={e.template.record.text}`＝テンプレートの文面定義であって
  コメント本文ではない）。⇒ 期待値は「**既存の 1 件だけ**」。
- **やること (2) の置き場所を変えた**——キー 2 本は `overlaySettings.ts`、**ロジックは
  `features/obs-effects/streamEventRound.ts`**。理由＝`parseRound` が未知 id を落とすためにレジストリを
  参照する必要があり、`overlaySettings.ts`（import ゼロ）へ置くと新しい依存方向が生まれる。
  ⚠ `EFFECT_ASSIGNMENTS_KEY` が明文化している先例（「ここに置くのはキーだけ」）に揃えた。
- ⚠⚠ **「開始」は `docs/security.md` §1 の「取得が続く」状態を作る新しい契機**である（ステージ窓を開くため）。
  **条文は差分ゼロで正しい**が、**タブに「終了しても閉じない／閉じ方はここ」の 1 文**を置いて導線の発見可能性を保った。
> base は **HEAD = `42c437a fix:OBSの出力窓を2つに分割した`**（061k はコミット済み・ツリーはクリーン）。
> 全体像・決定事項は [docs/task-board.md](../task-board.md) の
> 「061h〜061l OBSエフェクトの UX 再設計」節が正。⚠ **行番号は書かない**（特定はシンボル名で行う）。
>
> ⚠⚠ **玉入れ大会そのもののゲーム実装は 061l の次**（本タスクは**器だけ**）。

## ⚠⚠ 着手前に片付けること（061k 申し送り A への回答・実測で確認済み）

| # | 061k 申し送りの記載 | **2026-08-15 の実測** |
|---|---|---|
| A-1 | `capabilities/stage-overlay.json` が未追跡（`git commit -a` で取り込まれない） | ✅ **解消済み**。`git ls-files` に載っており、`42c437a` に含まれている。ワーキングツリーはクリーン |
| A-2 | sidecar バイナリが 061k 前（3 値）のまま。`check:sidecar` は止めない | ⚠⚠ **未解消**。`node apps/comment-sidecar/scripts/check-fresh.mjs` → **`sidecar バイナリは最新です ✓`**（＝止まらない） |

### ⚠⚠ A-2 の訂正——**バイナリ grep では鮮度を判定できない**

061k 申し送りは「バイナリ内の `ステージ` は **0 件**・`エフェクト` は **2 件**」と書いているが、
**手元の実測では 4 つの窓名すべてが 0 件**である:

```
$ for w in ステージ エフェクト 固定コメント コメントオーバーレイ; do
    printf "%s: " "$w"; grep -ac "$w" apps/desktop/src-tauri/binaries/comment-sidecar-aarch64-apple-darwin; done
ステージ: 0 / エフェクト: 0 / 固定コメント: 0 / コメントオーバーレイ: 0
```

⚠ **061k 以前から在る 3 つの窓名も 0 件**なので、これは「新しいエントリが無い」ことの証拠にならない
——Node SEA は JS バンドルを **grep で読めない形**（圧縮 or V8 コードキャッシュ）で抱えている。
⇒ ⚠⚠ **「バイナリを grep して確かめる」手順を 061l の手順書に書かないこと**（誤った安心を与える）。

**⇒ 唯一確実な行動＝着手前に `pnpm --filter ./apps/desktop build:sidecar` を回すこと。**
⚠ 061k 申し送りによれば**本物の資格情報が要る**ので、**依頼者にしか実行できない可能性がある**。
⚠⚠ **回さないまま `pnpm tauri dev` を起動すると、`parseOverlayKind("stage")` が `"comments"` へ落ち、
「StreamDock コメントオーバーレイ」のソースを触りに行く**（静かな誤動作）。
⚠ **`check:sidecar` は mtime 比較なので、`cp` で復元したバイナリは素通りする**（061k 申し送り E-5）。

⚠ **`check-fresh.mjs` を mtime からハッシュ比較へ寄せるかは、061k が「061l 以降の検討事項」と
書いているが、本タスクでは扱わない**（下記「やらないこと」）——鮮度ガードの作り直しは
配信イベントの器とは無関係な独立タスクで、混ぜると CLAUDE.md の
「1 回の作業で複数機能をまとめない」に触れる。⚠ **task-board へ独立項目として起票すること。**

## 061k から引き継いだ前提（申し送り B〜E の要約。⚠ 全文は progress.md の 061k 節が正）

- ✅ **エフェクトの出力窓は 2 本**（`effect-overlay`＝コーナー / `stage-overlay`＝全画面）。
  ⚠ **061l の配信イベントも同じ 2 窓へ出す**（分けた軸は「タブ別」ではなく**用途別**）。
  ⚠⚠ **3 本目の窓は構造的に作れない**（Tauri v2 の capability は静的 JSON で `windows` が固定配列）
- ✅ `EffectCondition` は **3 軸**（`when`＝いつ／`effect`＝何を／`output`＝どこへ）
- ✅ **`EffectRequest` は 8 キーのまま**。絞り込みは **`createEffectMatcher(output)` の中**
  ——⚠⚠ ここを崩すと**もう一方の窓の条件がバースト枠とクールダウンを食う**
  （061j 追加穴 η・061d-2 穴 γ と同型で **3 例目**）。
  ⚠ **「何も出ない」系のアサーションでは殺せない**＝ `recentFires.length` /
  `lastConditionAt.size` / `lastGiftAt.size` を**直接数える**こと
- ✅ **窓名の写しは 3 つ**（Rust の `.title` ／ sidecar の `OBS_OVERLAYS` ／
  frontend の `EFFECT_OUTPUT_WINDOW_TITLE`）。**直書きせず必ず表から引く**
- ✅ `obsState` は **4 種別で 1 本**（061e Q-5 の受容範囲が 3 → 4 へ広がった＝**悪化している**）
- ✅ **OBS 自動反映トグルは 1 つ**で 2 ソースを束ねる
- ✅ 実測値: **vitest 67 files / 1670 tests** ／ **cargo 347 passed** ／ typecheck・lint 警告 0
  （⚠ **件数は自分で実測し直すこと**。061i は 1548→1555、061j は 1625 で申し送りとずれた前科がある）

**⚠⚠ 061k の教訓（E）のうち 061l で必ず効くもの**

| # | 教訓 |
|---|---|
| E-1 | ⚠⚠ **「張る側」を足したら「取り消す側」も同数あるかを機械的に数える。** 061k は `clearObsEnableTimer("stage")` を 1 本落として §1 違反（045c 回帰の再発）を作り、**自前の変異 18 件の表にその変異が入っていなかった** |
| E-2 | ⚠⚠ **「窓は 1 つ」前提の文言はコードの型では捕まらない。** 実機で 3 件・外部レビューで 4 件目。⇒ **実機の前に `grep 'ウィンドウ'` を 1 回回して単数形を洗う** |
| E-3 | ⚠⚠ **段を割ったら、条文・実装・判定記録の 3 つが揃うまでコミットしない** |
| E-4 | ⚠⚠ **変異テストで日本語を置換するとき `perl -CSD` を使わない**（無言で no-op → **緑を「生存」と誤読**）。⇒ **置換ヒット数を数えてから走らせ、当てた直後に `git diff --stat` で 1 ファイル変化を確認** |
| E-6 | ⚠ **返済コメントの中で旧文言をそのまま引用しない**（grep が再びヒットする）。「061i で廃止された旧トグル」のように**言い換える** |

## この段で解く問題

「配信イベント」タブが **061i から枠だけ**（`ObsEffectsScreen` に「この機能は準備中です」の 1 文があるだけ）で、
**視聴者参加型の企画を配信画面へ出す経路が 1 本も無い**。

⇒ **一覧（カード）→ 詳細 → 適用 → 開始／終了**という器をここで通す。
⚠ **中身（玉入れ大会）は次タスク。** 本タスクが作るのは「器が正しいこと」を実証できる最小の見本 1 本まで。

---

## ⚠⚠ 設計判断（実装前に読むこと）

### 判断 1: ⚠⚠ 「セッション」という語を使わない

`session` は**すでに埋まっている**:

- sidecar の wire … `start-session` / `stop-session` / `session.state`（＝**コメント取得**のセッション）
- DB … `viewer_comments.session_id`
- ⚠ **062b が `stream_sessions` テーブルを作る予定**（task-board）

⇒ 配信イベントの 1 回ぶんは **「開催」**、コード上の識別子は **`round`** とする
（`StreamEventRound` / `startRound` / `endRound`）。

⚠⚠ **ここを `session` にすると、062b の着手時に検索も会話も壊れる**
（「セッション」がコメント取得なのかイベントなのか、コードからも文脈からも判別できなくなる）。
⚠ **画面に出す語は「開始」「終了」**（ユーザーに `round` の語は見せない）。

### 判断 2: 一覧 → 詳細は `RakurakuToolsScreen` の形をそのまま借りる

⚠ **リポジトリに既に同じ形がある**（依頼者の要望 (7)「左サムネ・右タイトル/短い説明のカード → 詳細」そのもの）:

- `screens/rakuraku-tools/RakurakuToolsScreen.tsx` … **判別可能ユニオンのローカル state**
  （`{stage:"list"} | {stage:"detail"; id} | …`）で一覧/詳細を切り替え、**`Screen` union を増やさない**
- `features/rakuraku/integrationRegistry.ts` … `id` / `icon` / `title` / `summary` / … を持つ**レジストリ配列**

⇒ **`features/obs-effects/streamEventRegistry.ts`** を同型で新設し、
`screens/obs-effects/StreamEventTab.tsx` が一覧/詳細を持つ。

⚠⚠ **カード部品を `components/` へ出さないこと。** 061g の規律は「画面を跨ぐと分かっているものは
最初から `components/`」だが、**らくらく側の `INTEGRATION_REGISTRY` は現在空配列**（032c-a で撤去）で
`.card` の CSS は 1 度も描画されていない＝**いま跨いでいない**。
⚠ **再修正トリガー＝らくらく側にエントリが復活し、2 画面が同じカードを描くとき。**

### 判断 3: サムネイルは `public/` に置く（`Header.tsx` の先例）

- `apps/desktop/public/stream-events/<id>.png` に置き、レジストリは `"/stream-events/<id>.png"` を持つ
- ⚠ **`src/assets` から `import` しない**——Vite がハッシュ付きファイル名を吐くので、
  **レジストリの値がビルドごとに変わる**（レジストリは「変更しない識別子」の集合であるべき）
- ⚠ 先例＝`Header.tsx` の `<img src="/icon.png">`（コメントで「外部リソースは読み込まない」と明記）と
  `theme.css` の `url("/fonts/Gloock-Regular.woff2")`
- ⚠⚠ **egress はゼロ**（同一オリジン `tauri://localhost`）。`csp: null` の下でも
  security.md の「外部 script/style/image を読み込まない」に 1 バイトも抵触しない
- ⚠ **画像が無いイベントは絵文字へ落とす**（`integrationRegistry` の `icon` が採った形）。
  ⇒ レジストリは **`icon: string`（絵文字・必須）＋ `thumbnail?: string`（`public/` のパス）** を持ち、
  **`thumbnail` があればそれを、無ければ絵文字を描く**。⚠ `<img onError>` の分岐は作らない
  （壊れた画像は取り込みではなく**同梱物**なので、壊れていたら開発時に気づく）

⚠ **import 機能は作らない**（決定事項 4）＝ **Rust のファイル操作も新規 IPC もゼロ**。
061c のテンプレート取り込み（`app_data_dir/effects/`）とは**完全に別系統**で、
`docs/security.md` の 061c 節の判断をやり直す必要は無い。

### 判断 4: ⚠⚠ 同梱する見本は「**コメント数カウンター**」1 本にする

| 案 | 判定 |
|---|---|
| (a) カウントダウンだけ（コメントを読まない） | ❌ **「視聴者参加型の器」であることを 1 ミリも実証しない**——コメント → 画面という経路が通らない |
| (b) 玉入れの簡易版 | ❌ 玉の描画・落下・当たり判定が入る＝**次タスクの前借り**（CLAUDE.md「1 回の作業で複数機能をまとめない」） |
| **(c) コメント数カウンター** | ✅ **採用** |

**(c) の内容**: 開催中に届いたコメントの**件数だけ**を大きく出す（「みんなで 100 コメント！」の器）。

- ⚠⚠ **玉入れとまったく同じ経路を通る**（コメント受信 → 開催中か判定 → 数を増やす → ステージ窓へ描く）
  ＝ **器が正しいことを、次タスクを前借りせずに実証できる唯一の形**
- ⚠⚠ **§9 を 1 バイトも踏まない**（本文も表示名もアバターも金額も持たない・**数だけ**）
- ⚠ 課金判定もキーワード判定も**しない**（エフェクトの発火層とは無関係な経路）

### 判断 5: ⚠⚠ 開催状態は localStorage の 1 キーに持ち、**時計は 1 つにする**

```
STREAM_EVENT_ROUND_KEY = "stream-dock.comment-viewer.stream-event-round"
値: { eventId: string; startedAt: number; endsAt: number }   （未保存＝開催していない）
```

- ⚠⚠ **`endsAt` は絶対時刻（epoch ms）で持つ。** 「残り N 秒」を両窓が別々に数えると**必ずずれる**。
  両窓が**同じ `endsAt`** から `Date.now()` で計算する。
  ⚠ 判定そのものは**純関数**（`now` を引数で受ける）にすること（061b/061j と同じ規律＝テストで時計を偽装しない）。
- ⚠⚠ **061i 判断 4 の「取りこぼし」は起きない。** あれは**ワンショットの旗**（`take*`）だったので
  「窓のリスナー登録前に飛んだ分が消える」問題があったが、開催状態は**永続状態**なので
  **ステージ窓がマウント時に `load*` すれば取りこぼさない**。
  ⚠ `storage` は「**開催中にすでに窓が開いている**ときに即座に反映するため」だけの経路で、
  届かなくても**次のマウントで回復する**（061d-2 の「`storage` は速くするためだけ」と同じ位置づけ）。
- ⚠⚠ **終了は「`endsAt` を過ぎた保存値を『開催していない』と読む」ことで表す**（`parseRound` が落とす）。
  ⚠ **タイマーで `removeItem` する主体を決めないこと**——決めると
  「main 窓が閉じていると消えない」「両窓が競合して 2 回消す」が生まれる。
  ⚠ 掃除（`removeItem`）は **main 窓が画面を開いているときの best-effort** に留める。
- ⚠ **開始でステージ窓を開く**（061i 判断 1「開くのは自動・閉じるのは明示」）。
  ⚠⚠ **終了で窓を閉じないこと**（親 046 の規律＝窓が消えると OBS のウィンドウキャプチャが真っ黒）。
  ⚠ 開く invoke は **`ObsEffectsScreen` の `stage` 用キュー**を通す（061k 判断 11＝キューは窓ごと）。

### 判断 6: ⚠⚠ 「適用」と「開始」を分ける

| 操作 | 意味 | 書くもの | 窓 |
|---|---|---|---|
| **適用**（詳細画面） | このイベントを使う | `STREAM_EVENT_SELECTED_KEY` に id | ⚠ **開かない** |
| **開始**（タブの上部） | 開催を始める | `STREAM_EVENT_ROUND_KEY` | **ステージ窓を開く** |
| **終了**（同上） | 開催を止める | `STREAM_EVENT_ROUND_KEY` を消す | ⚠ **閉じない**（判断 5） |

⚠ 依頼者の要望 (7) は「詳細 → **適用**」まで。⇒ **開始/終了は「適用済みイベント」のカードに置く**。
⚠ 分ける理由＝「**配信前に選んでおく**」と「**配信中に走らせる**」は違うタイミングの操作だから
（混ぜると「詳細画面を開いた瞬間に配信画面へ出る」になる）。

### 判断 7: ⚠⚠ ステージ窓では**イベント層をエフェクト層の下**に置く

- `EffectOverlayApp` に `.eventLayer`（`position: absolute; inset: 0`）を足し、
  **`.templateLayer` より DOM 順で前**に置く（＝**下に描かれる**）。
- ⚠ **エフェクトが前**である理由＝エフェクトは**一瞬出て消える**もので、
  常時出ているイベントに隠れると意味が無い。
- ⚠⚠ **`output === "stage"` のときだけ描く**（コーナー窓にイベントは出さない）。
  061k がステージ窓を「全画面演出用」として分けた軸そのもの。
- ⚠ **`EffectTemplateView.tsx` / `EffectTemplateView.module.css` / `.templateLayer` の 2 ルールは差分ゼロ**
  （`scripts/check-css-guards.mjs` の (10-r) が固定しており、jsdom はレイアウトを解決しないので
  **CSS だけを壊す変更を止められるのはあちらだけ**）。
- ⚠ **生 hex / `rgba()` を書かない**（`theme.css` のトークンのみ）。
  ⚠ `--text-faint` は `:disabled` 専用（(6-b) の走査対象）。

### 判断 8: ⚠⚠ イベントの描画にも §9 の線を**最初から**引く

**イベントの描画関数が受け取ってよいのは `{ count: number; remainingMs: number }` だけ**とする。

- ⚠⚠ **第三者の本文・表示名・アバター・金額を渡さない。**
  061b が `EffectRequest` に `text` / `avatar` を持たせなかったのと**同じ形で、型で書けなくしておく**。
- ⚠ 玉入れで「誰が入れたか」を出したくなったら、**そのとき `EffectRequest` と同じ議論をやり直すこと**
  （伏せ字・長さ制限・NG ワードを先に決める）。**「便利だから」で足さない。**
- ⚠ **`console.*` にも出さない**（`eslint.config.js` の `no-console` が `src/screens/obs-effects/**` に効いている）。
- ⚠ **開催状態を localStorage に書くのはユーザー自身の操作の結果**（`eventId` と時刻 2 つ）＝
  第三者データではない。`docs/security.md`「レビュー必須条件」の保存ポリシー項が明示的に除外している
  「ユーザー自身の UI 設定値」に当たる。

### 判断 9: ⚠ OBS の種別も窓も増やさない（`docs/security.md` は差分ゼロが期待）

イベントは**既存のステージ窓**に出るので、次はいずれも**触らない**:

`ObsOverlayKind` ／ `OBS_OVERLAYS` ／ `SIDECAR_CONSUMER_LABELS` ／ `capabilities/` ／
窓タイトル ／ `obsState` の wire ／ `tauri.conf.json` ／ `open/close/is_*` コマンド

⇒ ⚠ **061k 申し送り F のとおり `security-review` は軽くて済む見込み**。
⚠⚠ **ただし上記のどれかに触るなら必須**。⚠ **「レビュー必須条件」の下位条件で自分を免除しないこと**
（058a / 059a / 046a が 3 度踏んだ誤り）。⚠ **差分ゼロは「確認せずに主張しない」**（061j / 061k の規律）。

⚠ 061e Q-5 の「5 種別目を足すなら wire を種別つきへ広げる」は**発火しない**（種別を足さないため）。

### 判断 10: ⚠ 前提ステータスに「開催中のイベント」行を 1 本足す

061a 以来の規律「**黙って何も起きない状態を作らない**」——
「開始したのにステージ窓が停止中」を**観測できる場所**が要る。

- ⚠ **行は 1 本だけ**（061k で既に 4 行あるので増やしすぎない）。
- 値＝「開催していません」／「〈イベント名〉（残り N 分）」。⚠ **秒まで出さない**（毎秒再描画しない）。
- ⚠ 「開催中なのにステージ窓が停止中」のときは、**すぐ上の「エフェクトのウィンドウ（全画面）」行が
  既に「停止中」を語っている**ので、ここで二重に警告しない。

### 判断 11: ⚠⚠ 061k の教訓 E-1（対称を数える）を開始/終了にも適用する

061k は「張る側（`scheduleObsAutoAdd`）」を足して「取り消す側（`clearObsEnableTimer`）」を 1 本落とし、
**§1 違反（045c 回帰の再発）**を作った。⚠ **自前の変異表にその変異が入っていなかった**のが本質。

⇒ 061l では **「開始する／終了する／画面を離れる」の 3 経路**を機械的に数えること。とくに:

- **開始 → ステージ窓を開く** に対して **終了 → 窓を閉じる** を**作らない**（判断 5・061i 判断 1）
- **開始 → タイマーを張る** なら **終了 → 必ず止める** ＋ **アンマウントでも止める**
  （⚠ 061a 以来「配信中にタイマーを残さない」＝`EffectOverlayApp` の `expireTimersRef` と同じ規律）
- **`storage` リスナーを張ったら必ず外す**

### 判断 12: ⚠ 061k の教訓 E-2（単数形の文言）を先に潰す

⚠⚠ **061l は「配信画面」「ウィンドウ」を語る文言を新しく書く回**である。
061k は実機で 3 件・外部レビューで 4 件目を見つけている。

⇒ **実機確認の前に `grep 'ウィンドウ'` を 1 回回して単数形を洗うこと。**
⚠ 窓名（`EFFECT_OUTPUT_WINDOW_TITLE`）へ寄せられるのはガイド本文と案内文だけで、
**「ウィンドウ」を単数で語る文は表から引きようがない**（＝機械では止まらない）。

---

## やること

### (1) `features/obs-effects/streamEventRegistry.ts` を新設（判断 2・3）

- `StreamEvent` 型（`id` / `icon` / `thumbnail?` / `title` / `summary` / `description` / `defaultDurationMs` / `howTo`）
- `STREAM_EVENT_REGISTRY: readonly StreamEvent[]` … **見本 1 本だけ**（判断 4）
- ⚠ `integrationRegistry.ts` の JSDoc の書き方（「変更しない識別子」「外部読込はしない」）に揃える

### (2) 開催状態（判断 5・1）

- `overlaySettings.ts` に **キー 2 本**（`STREAM_EVENT_SELECTED_KEY` / `STREAM_EVENT_ROUND_KEY`）と
  `load/save/clear` ＋ **`parseRound`（`endsAt` を過ぎていたら「開催していない」へ落とす純関数）**
- ⚠ 判定は `now` を引数で受ける純関数に閉じる

### (3) `screens/obs-effects/StreamEventTab.tsx` を新設（判断 2・6・10）

- 一覧（カード）→ 詳細（判別可能ユニオンのローカル state）→「適用」
- 適用済みイベントのカードに **「開始」「終了」** と残り時間
- ⚠ `Screen` union を増やさない ／ ⚠ `ComingSoonScreen` は流用しない（061i の判断のまま）

### (4) `ObsEffectsScreen` の「配信イベント」タブを差し替え（判断 10）

- 「準備中」の 1 文 → `<StreamEventTab />`
- 前提ステータスに「開催中のイベント」行を 1 本
- ⚠ **共通の下部（配信画面に表示／OBS へ自動で反映／前提ステータス）は両タブの外のまま**（061k で確認済み）
- ⚠ 画面リード文の「配信イベントは準備中」相当の記述があれば**同時に直す**（061k 教訓 E-2）

### (5) ステージ窓の描画（判断 7・8）

- `EffectOverlayApp` に `.eventLayer` と**イベントの描画**（⚠ `output === "stage"` のときだけ）
- 開催状態は**マウント時に読む ＋ `storage` で更新**
- コメント受信で**件数だけ**を数える（⚠ `EffectRequest` の経路とは独立に、`onComments` の中で）
- ⚠ **`decideEffects` / `createEffectMatcher` / `EffectRequest` は差分ゼロが目標**
  （イベントはエフェクトの発火層に相乗りしない＝バースト枠もクールダウンも食わない）

### (6) 同梱アセット（判断 3）

- `apps/desktop/public/stream-events/<id>.png` を 1 枚

### (7) docs

- `docs/progress.md` に **061l 節**／`docs/task-board.md` の 061l 完了化
- ⚠⚠ **`docs/security.md` は差分ゼロが期待**だが、**読み直してから空だと書くこと**（判断 9）
- ⚠ **`check-fresh.mjs` の鮮度ガードを独立タスクとして task-board に起票**する

## やらないこと

- ⚠⚠ **玉入れ大会そのもののゲーム実装**（次タスク。⚠ 玉の描画・落下・当たり判定・スコア表示を一切作らない）
- **イベントの import 機能**（決定事項 4。⚠ **Rust のファイル操作も新規 IPC もゼロ**）
- **3 本目の窓／`ObsOverlayKind` の 5 値目／capability の追加**（判断 9・構造的に不可能なものを含む）
- **`check-fresh.mjs` を mtime からハッシュ比較へ寄せること**（⚠ 独立タスクとして起票する）
- **イベントの描画に第三者データを渡すこと**（判断 8）
- **イベントをエフェクトの発火層（`decideEffects`）に相乗りさせること**
  （⚠ バースト枠とクールダウンを食う＝061j 追加穴 η と同型で **4 例目**になる）
- **終了時にステージ窓を閉じること**（判断 5・061i 判断 1・親 046 の規律）
- **`EffectTemplateCard` の行にボタンを足すこと**（061h Q-4＝**4 個以上でレイアウトが壊れる**。
  ⚠ jsdom はレイアウトを解決しないのでテストは全部緑のまま）
- **らくらく側の `INTEGRATION_REGISTRY` / `RakurakuToolsScreen` への変更**（形を借りるだけ・判断 2）

## 対象ファイル

**新規**
- `apps/desktop/src/features/obs-effects/streamEventRegistry.ts`（＋ `.test.ts`）
- `apps/desktop/src/screens/obs-effects/StreamEventTab.tsx` / `StreamEventTab.module.css`（＋ `.test.tsx`）
- `apps/desktop/public/stream-events/<id>.png`

**変更**
- `apps/desktop/src/features/comment-viewer/overlaySettings.ts`（キー 2 本 ＋ `parseRound`）
- `apps/desktop/src/screens/obs-effects/ObsEffectsScreen.tsx` / `.module.css`
- `apps/desktop/src/screens/obs-effects/EffectOverlayApp.tsx` / `.module.css`

**差分ゼロ（要件）**
- `apps/desktop/src-tauri/` ／ `capabilities/` ／ `tauri.conf.json` ／ `apps/comment-sidecar/` ／
  `package.json` ／ `pnpm-lock.yaml` ／ `.github/` ／ **`docs/security.md`**
- `screens/obs-effects/` の `effectTrigger.ts` / `effectAssignments.ts` / `EffectTemplateView.tsx` /
  `EffectTemplateView.module.css` / `EffectTemplateCard.tsx` / `EffectAssignmentCard.tsx` /
  `effectSelectValue.ts` / `effectEventRows.ts` / `useEffectTemplates.ts`
- `features/comment-viewer/` の `commentStream.ts` / `windowApi.ts` / `effectOverlayRestore.ts`
- `screens/comment-viewer/CommentViewerApp.tsx` ／ `App.tsx` ／ `screens/main/MainScreen.tsx`
- `screens/rakuraku-tools/` ／ `features/rakuraku/`

## テスト

**⚠ ベースライン＝ 67 files / 1670 tests ／ cargo 347 passed**（061k 申し送り）。⚠ **自分で実測すること。**

**⚠⚠ 新規に必ず要るケース**

1. **`parseRound`: `endsAt` を過ぎた保存値は「開催していない」になる**（判断 5・⚠ `now` を引数で渡す）
2. **壊れた保存値（非 JSON / 非オブジェクト / 未知 eventId / 非数値の時刻）はすべて「開催していない」へ**
3. **一覧 → 詳細 → 一覧へ戻れる**／**未知 id の詳細は一覧へフォールバックする**（`RakurakuToolsScreen` と同型）
4. **「適用」は選択キーだけを書き、開催キーを書かず、窓も開かない**（判断 6）
5. ⚠⚠ **「開始」は開催キーを書き、ステージ窓を開く**（⚠ **コーナー窓は開かない**＝IPC の呼び出し先を見る）
6. ⚠⚠ **「終了」は開催キーを消すが、窓を閉じない**（判断 5・⚠ **`close` 系 IPC が 1 度も呼ばれないこと**）
7. **ステージ窓はマウント時に開催状態を読む**（⚠ `storage` が届かなくても出る＝判断 5）
8. **`storage` で開始/終了が反映される**
9. ⚠⚠ **コーナー窓ではイベントを描かない**（判断 7・`output` で分岐）
10. ⚠⚠ **開催中のコメントで件数が増える／開催していないときは増えない**
11. ⚠⚠ **イベントの描画にコメント本文・表示名が 1 文字も出ない**（§9・判断 8。
    ⚠ 既存の `EffectOverlayApp.test.tsx` の §9 ケースと**同じ形**で、**イベント経由についても**足す）
12. ⚠⚠ **イベントはエフェクトのバースト枠・クールダウンを消費しない**
    （判断 8・⚠ **`recentFires.length` / `lastConditionAt.size` を直接数える**）
13. **タイマーと `storage` リスナーがアンマウントで必ず外れる**（判断 11）
14. **前提ステータスの「開催中のイベント」行**（開催していない／開催中の 2 状態）
15. **レジストリの `thumbnail` があれば `<img>`、無ければ絵文字**（判断 3）

## 検証

```bash
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test     # vitest + check:css + check:version + check:effect-contract
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # 無変更（緑が期待）
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # 無変更（緑が期待）

# ⚠⚠ 着手前（判断 A-2）——⚠ 依頼者の実行が要る可能性がある
pnpm --filter ./apps/desktop build:sidecar
node apps/comment-sidecar/scripts/check-fresh.mjs

# ⚠⚠ 差分ゼロ（すべて空が期待）
git diff -M HEAD -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/
git diff -M HEAD -- apps/desktop/package.json pnpm-lock.yaml docs/security.md
git diff -M HEAD -- apps/desktop/src/features/comment-viewer/commentStream.ts \
  apps/desktop/src/features/comment-viewer/windowApi.ts \
  apps/desktop/src/features/comment-viewer/effectOverlayRestore.ts \
  apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx \
  apps/desktop/src/App.tsx apps/desktop/src/screens/main/MainScreen.tsx
git diff -M HEAD -- apps/desktop/src/screens/obs-effects/effectTrigger.ts \
  apps/desktop/src/screens/obs-effects/effectAssignments.ts \
  apps/desktop/src/screens/obs-effects/EffectTemplateView.tsx \
  apps/desktop/src/screens/obs-effects/EffectTemplateView.module.css \
  apps/desktop/src/screens/obs-effects/EffectTemplateCard.tsx
git diff -M HEAD -- apps/desktop/src/screens/rakuraku-tools/ apps/desktop/src/features/rakuraku/

# ⚠⚠ 教訓 E-2: 「窓が 1 つ」前提の単数形を洗う（⚠ **実機確認の前に 1 回**）
grep -rn "ウィンドウ" apps/desktop/src --include=*.tsx --include=*.ts | grep -v "\.test\."

# ⚠ 窓名を直書きしていないこと（表から引く・061k 申し送り B）
grep -rn "StreamDock ステージ演出\|StreamDock エフェクト" apps/desktop/src

# ⚠⚠ §9: イベントの描画に本文が渡っていないこと
grep -rn "\.text\b\|author" apps/desktop/src/screens/obs-effects/EffectOverlayApp.tsx

# ⚠ 外部 URL / 新規 IPC を足していないこと（ヒットゼロが期待）
grep -rn "https\?://" apps/desktop/src/features/obs-effects/streamEventRegistry.ts
grep -rn "invoke" apps/desktop/src/screens/obs-effects/StreamEventTab.tsx
```

⚠ **変異検証（実測して progress.md に記録）**

⚠⚠ **教訓 E-4: 日本語を置換する変異で `perl -CSD` を使わないこと**——入力は UTF-8 デコードされるが
スクリプト中のパターンは生バイトのままで**無言で no-op** になり、**「緑＝生存」と誤読する**。
⇒ **置換ヒット数を数えてから走らせ、当てた直後に `git diff --stat` で 1 ファイル変化を確認する。**

| # | 変異 | 期待 |
|---|---|---|
| ① | `parseRound` の `endsAt` 判定を外す（期限切れも開催中と読む） | レッド（新規 1） |
| ② | 「終了」でステージ窓も閉じる | レッド（新規 6・判断 5） |
| ③ | 「適用」で開催キーも書く／窓も開く | レッド（新規 4・判断 6） |
| ④ | 「開始」でコーナー窓も開く | レッド（新規 5） |
| ⑤ | ステージ窓の**マウント時読み出し**を消し `storage` だけにする | レッド（新規 7・061i 判断 4 の同型） |
| ⑥ | `output` の分岐を外してコーナー窓にもイベントを描く | レッド（新規 9・判断 7） |
| ⑦ | 開催していなくても件数を数える | レッド（新規 10） |
| ⑧ | ⚠⚠ イベントの描画にコメント本文（`c.text`）を渡す | レッド（新規 11・§9） |
| ⑨ | ⚠⚠ イベントを `decideEffects` に相乗りさせる | レッド（新規 12・⚠ **サイズを数えるアサーションでないと生存する**） |
| ⑩ | アンマウント時のタイマー／リスナー解除を消す | レッド（新規 13・判断 11） |
| ⑪ | `.eventLayer` を `.templateLayer` の**後ろ**へ置く（前後関係の反転） | ⚠ **DOM 順は観測できるが見え方は観測できない**——落ちなければ**受容として記録する**（CSS の実効はテストで固定できない） |
| ⑫ | 未知 id の詳細でクラッシュさせる（フォールバックを消す） | レッド（新規 3） |
| ⑬ | `thumbnail` があっても絵文字を描く | レッド（新規 15） |
| ⑭ | ⚠ **自分で考えた変異も試すこと**（守備範囲の穴の探索） | — |

## ⚠⚠ 実機確認（未実施のまま完了にしないこと）

⚠ **観測手法は 061j / 061k の progress.md が正**（透過窓は `CGWindowListCreateImage` の窓単位キャプチャで
alpha>0 の画素数と bbox を数値化／文面は `AXStaticText`／⚠ **WKWebView に合成キーイベントは入らない**ので
テキスト入力を伴う確認は localStorage へ直接仕込む／⚠ **dev ビルドは本番と localStorage を共有しない**）。

1. 「配信イベント」タブにカードが出て、**左サムネ・右タイトル/説明**で読める（要望 (7)）
2. カード → **詳細** → 「適用」→ タブへ戻ると「適用済み」になる（⚠ **窓は開かない**＝判断 6）
3. ⚠⚠ **「開始」でステージ窓が開き、配信画面にイベントが出る**（⚠ **コーナー窓は開かない**）
4. ⚠⚠ **視聴者のコメントで件数が増える**（＝器が「視聴者参加型」として通っている・判断 4）
5. ⚠⚠ **終了時刻を過ぎるとイベントの表示が消える**が、**ステージ窓は開いたまま**（判断 5）
6. ⚠ **「終了」を押しても窓は閉じない**／⚠ **アプリを再起動しても開催が復活しない**（期限切れ）
7. ⚠⚠ **イベントとエフェクトが同時に出ても、エフェクトが前に出る**（判断 7）
8. ⚠ **イベント表示中もエフェクトのバースト枠が減っていない**（判断 8・⚠ 連続の投げ銭で確認）
9. ⚠⚠ **配信画面に第三者のコメント本文・表示名が 1 文字も出ない**（§9・判断 8）
10. ⚠ 前提ステータスの「開催中のイベント」行が 2 状態とも正しい（判断 10）
11. ⚠⚠ **`grep 'ウィンドウ'` で洗った単数形の文言が、画面上でも正しい**（教訓 E-2）
12. ⚠⚠ **親 061 のクローズ条件 ⑧（OBS キャプチャのカクつき）を「高頻度」で再測する。**
    061k で測れたのは **2 窓同時・30 秒・発火 5 件で `Δskipped` 0・fps 60.0 固定**までで、
    dev-mock の **≒0.55 件/秒**は ⑧ の元の懸念（**毎秒 10 件級**）の負荷帯に届いていない。
    ⚠ **前提＝twitch 側モックの `start-session` に `connecting` が返らない問題**が解けること（061k とは無関係）。
    ⇒ ⚠⚠ **これが親 061 のクローズ条件の最後の 1 つ**である。

⚠ **後始末**（061j / 061k と同じ規律）: DB・localStorage・クリップボードをバックアップから復元し、
**`shasum` のバイト一致を確認**する。⚠ **本番オリジンには触れないこと。**
