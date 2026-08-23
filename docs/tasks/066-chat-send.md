# 066 配信のチャットへの書き込み（**能力**・⚠⚠⚠ StreamDock 初の「書き込み」）

> 状態: ✅ **完了（段 1 = 2026-08-22 ／ 段 2 = 2026-08-23）**。`security-review` は段 1 で 2 回・段 2 で 1 回実施済み。
>
> ⚠⚠⚠ **2026-08-23: 旧「段 3（ガチャの結果をチャットへ書く）」を [063f](063f-gacha-chat-output.md) へ切り出した。**
> ⇒ **066 は「チャットへ書き込む能力」で閉じた**。⚠ **番号は 066 のまま据え置く**（判定は下記）。
>
> ⚠⚠ **security-review で自分の実装から修正必須が 2 件出た**（どちらも修正済み・下記 (3)(5)）:
> **S-1**＝テスト送信 1 回で**強制ログアウトしうる**トークン取得の誤り／
> **S-2**＝「宛先を viewer から受け取らない」という**記述が言い過ぎ**だった。
>
> ⚠⚠⚠ **これは機能追加ではなく、姿勢の変更である。** StreamDock はこれまで
> **コメントを「読むだけ」**のアプリだった（Twitch `user:read:chat` / YouTube `youtube.readonly`）。
> ⚠ 失敗も全部「**出ない・鳴らない**」で済んでいた。**書き込みは視聴者に見えて、あとから消せない。**
>
> **必読前提**: [`docs/security.md`](../security.md) の **§1「例外（066）」**（⚠ **本タスクの正**）、
> チケット機構の先例 [060c](060c-external-css-snapshot.md)、
> スコープ拡大の先例 [043a](043a-monetary-ingestion-fidelity.md)（`bits:read` の非致命化）、
> 出力の型の調査 [063t](063t-gacha-output-types-spike.md)（⚠ **本タスクの発端**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的・発端

[063t](063t-gacha-output-types-spike.md) が **ガチャの出力の型は 4 つあり、StreamDock は 1 つしかできない**
ことを確定させた。できない 3 つ（**チャット完結型 / 併用型 / 景品配布型**）の原因は 1 つで、
**チャットに書き込む経路が 1 本も無い**ことだった。⇒ 依頼者の判断で**書き込みに踏み込む**。

## ⚠⚠ 段の割り方（CLAUDE.md「1 回の作業で複数機能をまとめて実装しない」）

| 段 | 内容 | 層 | 状態 |
|---|---|---|---|
| **段 1** | **送信の基盤だけ**（スコープ・チケット・スロットル・**既定 OFF のトグル＋テスト送信**） | 全層 | ✅ **完了（2026-08-22）** |
| ⚠⚠⚠ **段 2** | **`start-session` のチケット化**（＝ 自動送信の**前提**・下記「段 2」節が正） | **Rust ＋ sidecar ＋ frontend** | ✅ **完了（2026-08-23）** |
| ~~段 3~~ | ~~ガチャの結果をチャットへ書く~~ ⇒ ⚠⚠ **[063f](063f-gacha-chat-output.md) へ移した**（2026-08-23） | frontend | ⚠ **未着手**（✅ 着手条件の段 2 は完了＝**着手できる状態**） |

> ⚠⚠⚠ **2026-08-23: 段を割り直した。** それまで段 2 は「ガチャの結果をチャットへ書く」1 本で、
> 状態欄が **「⚠ [063b](063b-gacha-draw-and-triggers.md) と一緒」**だった。
> ⚠⚠ **ところが 063b はそれを「やらない」と決めた**（着手条件が未達・[`docs/progress.md`](../progress.md) の
> 「063b 段 1-a」節の決定 6）。⇒ **状態欄が「もう引き受け手のいないタスク」を指したまま宙に浮いていた。**
> さらに ⚠ **前提である `start-session` のチケット化には、タスクファイルも task-board の項目も無く、
> `security.md` と本ファイルの警告文の中にしか存在しなかった**。
> ⇒ **前提を段 2 として実体化し、自動送信を段 3 へ送った**（依頼者の指摘・2026-08-23）。

⚠⚠ **前提を 066 が引き取る理由**＝ `start-session` のチケット化が守っている実害は
**「未認証の loopback ページが宛先を差し替え、ユーザーの名前で別チャンネルへ投稿させる」**ことであり、
**書き込み（066）の門そのもの**だからである。⚠ **別番号を切ると、門 3 枚の話が 2 ファイルに割れる。**

⚠⚠ **段 1 を単独で通した理由**＝「書き込みが**意図せず起きない**」ことを、
ガチャの話と切り離して固めるため。

### ⚠⚠ 番号の判定（2026-08-23・依頼者の指示「066 も 063 に関連するタスクなら 063 系に振り直して」）

**結論＝段によって違ったので、段 3 だけを [063f](063f-gacha-chat-output.md) へ移し、066 は据え置いた。**

| 段 | 063 の子か | 理由 |
|---|---|---|
| 段 1 | ❌ | ガチャが無くても成立する**アプリの能力**（配信開始の告知などにも使える） |
| 段 2 | ❌ | ⚠⚠ **最も違う**。守っているのは**コメント取得パイプライン**そのもの |
| 段 3 | ✅ | **ガチャ固有** ⇒ 移した |

⚠ 発端が [063t](063t-gacha-output-types-spike.md) なのは事実だが、
**044a（OBS 連携）も 060c（テーマ取り込み）も、特定機能が動機で生まれて独立番号を持っている**。
「動機が 063」と「063 の子」は別である。
⚠⚠ 加えて `066` の参照は**実測 30 ファイル・239 箇所**あり、その多くは Rust / sidecar / frontend の
**根拠を書いた JSDoc の中**（[`docs/security.md`](../security.md) §1 の 066 節を含む）。
⇒ 機械置換すると**根拠の文章の意味がずれる**ので、**番号は据え置くのが安い**と判断した。

## ⚠⚠⚠ 段 2: `start-session` のチケット化（自動送信の前提）

### なぜ要るのか（実害）

sidecar の **loopback WS は未認証**である。送信の宛先（`broadcaster_id`）は sidecar が
「いま取得しているセッション」から決めるが、⚠⚠⚠ **その取得セッションを作る `start-session` フレームは
viewer から来ており、チケットで守られていない**。
⇒ **ブラウザで開いた悪意あるページが `start-session` を送って宛先を差し替えられる。**

⚠ **段 1 の対処（`expectedChannel` の突き合わせ）では足りない**——あれが守るのは
**「テスト送信ボタンを押した瞬間に、画面に出ている宛先と sidecar の宛先が一致していること」**だけである。
⚠⚠ **自動送信はユーザーが画面を見ていないときに走る**ので、突き合わせる相手（見ている画面）が存在しない。
（[`docs/security.md`](../security.md) §1 の 066 節が正。⚠ **task-board の「チケット化 *か* 突き合わせ」は失効している。**）

### 実装（⚠ **既存のチケット 2 本とまったく同じ形で 3 本目を足すだけ**）

⚠⚠ **新しい機構を発明しない。** 060c（テーマ取り込み）と 066 段 1（チャット送信）が
**同じ経路を 2 回作っており**、本段はその 3 例目である:

| 層 | 既存（2 本） | 足すもの |
|---|---|---|
| Rust | `THEME_TICKET_PREFIX` / `CHAT_TICKET_PREFIX`（`comment_sidecar/mod.rs`）＋ uuid v4 採番 ＋ **stdin private pipe** へ書く | `SESSION_TICKET_PREFIX` 1 本 |
| Rust | `get_theme_import_ticket` / `get_chat_send_ticket`（`lib.rs` の `invoke_handler`） | `get_start_session_ticket` 1 本 |
| sidecar | `themeImportTicket` / `chatSendTicket`（`index.ts`）＋ **長さ上限つきの形式検査** ＋ 定数時間比較 | `startSessionTicket` 1 本 |
| frontend | `commentStream.ts` が送信直前に `invoke` で取り直す | `start-session` の送信直前に同じことをする |

⚠ **新規 capability はゼロ**（既存 2 本も `capabilities/` に列挙が無く `core:default` で通っている＝実コードで確認済み）。
⚠ **新規依存ゼロ・新規 egress 先ゼロ**（uuid は既存 crate）。

### ⚠⚠ 先に潰しておく穴

- **A. dev-mock を壊さないこと** … `COMMENT_SIDECAR_MOCK=1` のとき `mockSource.handleControl(frame)` が
  制御フレームを引き取る。⚠ **チケット検査を `mockSource` の分岐より前に置くか後に置くかで、
  モックが動かなくなる**。⇒ **検査は前**（モックでもチケットを要求する）が筋だが、
  ⚠ **モックの起動経路がチケットを取れるか**を実装時に確認すること。
- **B. `stop-session` はどうするか** … ⚠ **止める側は乗っ取られても実害が小さい**（送信できなくなるだけ）が、
  **嫌がらせで配信中に取得を止められる**。⇒ **`start-session` と同じチケットを要求するのが素直**。実装時に決めること。
- **C. ⚠⚠ 失敗時の壊れ方** … チケットが取れない／一致しないときは **`start-session` を送らない**
  （fail-closed）。⚠ **そのとき画面に理由を出すこと**（061a Q-1「黙って効かない、を作らない」）——
  ⚠⚠⚠ **ここを黙らせると「コメントが取れなくなった、原因不明」になり、本機能で最も重い回帰**になる。
- **D. 既存ユーザーへの影響ゼロ**（スコープも保存形も変わらない・再ログイン不要）。

### 完了条件（段 2）

- ✅ チケットを持たない `start-session` フレームを **sidecar が受け付けない**（fail-closed・テストで固定）。
- ✅ ⚠ **正規の経路（コメビュ窓）では従来どおり取得が始まる**（回帰させない）。
- ✅ ⚠ 取れなかったときに **画面に理由が出る**（`CommentViewerApp.session.test.tsx` の「穴 C」3 本）。
- ✅ ⚠⚠ **`security-review` 実施済み**（門の 1 枚目の適用範囲を広げる変更）。

### ✅ 実装（段 2・2026-08-23）

| 層 | 足したもの |
|---|---|
| Rust | `SESSION_TICKET_PREFIX`（`COMMENT_SIDECAR_SESSION_TICKET=`）／`CommentSidecar.session_control_ticket`／`session_control_ticket()`／`get_session_control_ticket` コマンド |
| Rust（テスト） | **新規 `sidecar_ticket_contract`（5 本）**——⚠ 言語をまたぐ契約を機械で止める（下記） |
| sidecar | **新規 `src/session-control/session-control-frame.ts`**（⚠ **判断はすべてここ**）／`index.ts` は配線のみ（stdin 受領・形式検査・**dev-mock より前**の照合） |
| sidecar（テスト） | **新規 `scripts/test-session-control.mjs`**（⚠ `package.json` の `test` に 1 本追加） |
| frontend | `commentStream.ts` の `startSession` / `stopSession` が `Promise<SessionControlResult>` を返すようになった（**送る直前にチケットを取り直す**）／`CommentViewerApp` が失敗理由を「状態」欄へ出す |
| frontend（テスト） | **新規 `commentStream.sessionControl.test.ts`（11 本）**／`CommentViewerApp.session.test.tsx` に「穴 C」3 本 |

⚠ **新規 capability ゼロ・新規依存ゼロ・新規 egress 先ゼロ・`tauri.conf.json` / `csp: null` 不変**（実測で差分ゼロを確認）。

#### ⚠ 決めたこと（本文の予定から変えた点）

1. **`stop-session` にも同じチケットを要求した**（穴 B の結論）。取得セッションの開始と停止は同じ能力で、
   片方だけ誰でも叩ける形は説明が付かない。⚠ 「止められなくなる」は起きない
   （チケットが取れないのは sidecar 未起動のときだけ＝止める対象も無い）。
2. ⚠ **コマンド名は `get_start_session_ticket` ではなく `get_session_control_ticket`**。
   1 の結果、`start_session` を名乗ると**名前が嘘になる**ため。
3. ⚠⚠ **`start-login` は対象外**（残る穴として記録）。乗っ取られたときの実害は
   「Device Code の取得が走る／同意画面のブラウザが開く」で、**宛先の乗っ取りではない**
   （発行されるトークンはユーザー自身の sidecar に入る）。⚠ 嫌がらせにはなるので、
   **次にこの節を触るときに 4 本目として検討すること。**

#### ⚠⚠⚠ 穴 C（黙って効かない）の分担 — ここが本段でいちばん壊れやすい

sidecar は**チケット不一致を黙殺する**（返事もしない＝総当たりの手掛かりを与えない・060c と同じ判断）。
⇒ 黙殺が**正規の窓に当たらない**ことを、別の層で担保している:

1. **frontend が送る前に自分で気づく** … `startSession` / `stopSession` はチケットを `invoke` で取り直し、
   **取れなければ送らずに理由を返す**。`CommentViewerApp` がそれを「状態」欄へ出す。
2. **sidecar 側の不一致は黙殺でよい** … ここへ来るのは Rust が採番した値と違う値を持っている者だけ。
   ⚠ 理屈上の例外（sidecar が stdin のチケット行をまだ読んでいない）は、
   **Rust が spawn 直後（ポート報告より前）に書き、sidecar はポートを stdout へ書くのと
   同じ同期ブロックで stdin ハンドラを登録する**ため、frontend がポートを取得（1 秒ポーリング）して
   WS を張り**人間がボタンを押す**までには必ず読み終わっている。

#### ⚠⚠ 言語をまたぐ契約（`lib.rs` の `sidecar_ticket_contract`・5 本）

⚠⚠⚠ **prefix・採番・配線はすべて「両側にただの文字列／別々の行」として存在し、
ずれても `cargo check` も `pnpm typecheck` も通る。** そして sidecar は fail-closed なので、
壊れ方は **「コメントの取得が黙って始まらない」**——本段で最も重い回帰である。

- `sidecar_ticket_stdin_prefixes` … Rust の prefix と sidecar の prefix が**バイト一致**
- `sidecar_ticket_stdin_prefixes_do_not_shadow_each_other` … ⚠ 互いに**前方一致もしない**
  （`startsWith` の `else if` 連鎖なので、接頭辞だと先に書いたほうが両方を食う）
- `each_ticket_is_issued_and_piped_independently` … ⚠⚠ **3 本が独立に採番され、それぞれ stdin へ書かれ、
  取得関数が自分のフィールドを返すこと**（⚠ **実測ミューテーションで 2 件が生き残ったので足した**）
- `each_ticket_command_returns_its_own_accessor` … コマンド → 取得関数の対応と `generate_handler!` 登録
- `session_ticket_check_precedes_the_dev_mock_branch` … ⚠⚠ **穴 A**（照合が dev-mock の分岐より前）

#### ✅ 実機確認（依頼者・2026-08-23）

⚠⚠ **[063b](063b-gacha-draw-and-triggers.md) のガチャ発火をモックで確認した際に、同時に通った。**
`COMMENT_SIDECAR_MOCK=1` でコメントが流れた＝**取得が始まった**ということなので:

| 項目 | 結果 |
|---|---|
| ① コメビュ窓で「コメント取得開始」→ 従来どおり取得が始まる（回帰なし） | ✅ |
| ④ ⚠⚠ **dev-mock（`COMMENT_SIDECAR_MOCK=1`）でも取得が始まる**（**穴 A** の実機確認） | ✅ |

⚠ **穴 A が実機で通ったことの意味**＝チケット照合は **`mockSource.handleControl` より前**にあるので、
モックでコメントが流れたということは、**モック経路でもチケットが正しく発行・受領・照合されている**。
（⚠ 逆に照合が壊れていれば、モックでも `start-session` が黙殺されて**1 件も流れなかった**）。

⚠⚠ **まだ確認していない項目**（依頼者が実施していない・**未確認のまま記録する**）:
② YouTube 側の取得開始／停止 ／ ③ 実 sidecar（非モック）での取得開始 ／
⑤ `lsof -i` で外部 ESTABLISHED が増えないこと。
⚠ ⑤ は**本段が egress を 1 つも足していない**（`host-guard.ts` 差分ゼロ）ので理屈上は自明だが、
**実測していない**ことを「確認済み」と書かない。

#### ⚠ ミューテーション（19 件・全滅）

純関数 4／sidecar の配線 4／frontend 5／Rust 6。
⚠⚠ **Rust の 2 件（`session_control_ticket = chat_send_ticket.clone()` ／ stdin への `child.write` を落とす）は
最初の実装では生き残った**。どちらも `AppHandle` が要るので実行時にしか現れず、
⇒ **`each_ticket_is_issued_and_piped_independently` を足して形を固定した。**

## ⚠⚠ 段 3 は [063f](063f-gacha-chat-output.md) へ移した（2026-08-23）

⚠ 本ファイルに**内容を残さない**（2 か所に書くと片方だけ古くなる）。⇒ **[063f](063f-gacha-chat-output.md) が正。**

⚠⚠⚠ **066 側から 063f へ申し送る制約は 4 つ**（あちらの本文に展開済み・ここは索引）:

1. ⚠⚠ **門の 3 枚目（自動送信の経路が 1 本も無い）が無くなる** ⇒ **`security-review` 必須**
2. ⚠ **スロットルの `CHAT_MIN_INTERVAL_MS = 3_000` は「手動しか無いから」で置いた値** ⇒ **決め直す**
   （⚠ ガチャは 5 秒に最大 3 件発火しうるので、3 秒間隔だと 3 件目が落ちる）
3. ⚠⚠ **トークン取得（`getValidAccessToken`）は「アクセストークンが生きている間は非破壊」でしかない**
   ⇒ 画面を見ていないときに走る自動送信では、**期限切れなら交換せず終わるラッパ**を検討する
4. ⚠⚠⚠ **当選者名を出すかは §9 の面が変わる独立した判断**
   （第三者の表示名が「端末内で持ち回る」から「**配信のチャットへ公開する**」へ移る）

## 決定（段 1）

### (1) ⚠⚠⚠ Twitch だけ（YouTube は対象外）

依頼者の決定（2026-08-22）。理由は 2 つ:

1. ⚠ `youtube.readonly` → **`youtube.force-ssl`** は**同意画面が「YouTube の管理」相当**になり、
   読み取り専用より明確に**拒否されやすい**
2. ⚠⚠ **クォータ**——書き込み系は 1 回 **50 units**・既定 **10,000 units/日**で **1 日およそ 200 通**。
   ⚠⚠ **しかも取得（streamList / search / videos）と同じ枠**を食う
   （⚠ 公式の表に `liveChatMessages` の行が無く、「書き込み系＝50」からの推定。**実測は未実施**）

⇒ **`YOUTUBE_SCOPES` は 1 文字も変えていない**＝ **YouTube だけの利用者に再ログインは発生しない。**
⚠⚠ **代償**: **YouTube 配信者はチャット完結型のガチャを使えない**。
⇒ 画面に**そう書いてある**（黙って効かない、を作らない・061a Q-1）。

### (2) ⚠⚠⚠ 門は 3 枚

1. **チケット**（`get_chat_send_ticket` → stdin private pipe → sidecar が定数時間比較）
   ——⚠⚠ **sidecar の loopback WS は未認証**なので、これが無いと
   **ブラウザで開いた悪意あるページがユーザーの名前で投稿できる**。**これが壁である。**
   ⚠ 060c とまったく同じ機構だが**守っている被害はこちらが重い**。
   ⚠⚠ **テーマ取り込みのチケットとは別に採番する**（能力ごとに被害範囲を分ける）。
2. **既定 OFF のトグル**（`CHAT_SEND_ENABLED_KEY`）——同意。⚠ **これは壁ではない。**
3. ⚠⚠⚠ **自動送信の経路が 1 本も無い**——送信を起こせるのは**テスト送信ボタンだけ**。

### (3) 宛先は送信フレームに載せない（⚠⚠⚠ **ただし「viewer から来ない」ではない**）

`broadcaster_id` は **sidecar が「いま取得しているセッション」から決める**
（`setChannel` が唯一の入口・**取得を止めると `null` に戻って送れなくなる**）。
⚠ 064a はソース名を「実在照合」で壁にしたが、**こちらは壁を作れない**——
他人のチャンネルへの投稿要求は**形式的には完全に正当に見える**。

⚠⚠⚠ **security-review S-2（訂正）: 当初「宛先を viewer から受け取らない」と書いたが、言い過ぎだった。**
宛先の元になる `channel` は **`start-session` フレーム由来＝ viewer から来ており、
しかも `start-session` はチケットで守られていない**。
⇒ **未認証の loopback WS に繋いだページが宛先を差し替え、ユーザーが次に押した送信を別チャンネルへ飛ばせる。**

- ~~**段 1 の対処＝「見える」ようにした**（`ChatSendCard` が**送信先を常時表示**する）~~
  ⚠⚠⚠ **security-review 2 巡目 S-2b: これは対処になっていなかった。**
  画面に出していたのは **frontend 自身が持っている入力値**（`CommentViewerApp` の `channel` state）で、
  **sidecar が実際に握っている宛先ではない**。⇒ 差し替えられても**表示は一切変わらず、気づけない**。
  ⚠ 「見せる」対処は、**見せる値が実際の状態に由来していて初めて成立する**。
- ✅ **段 2 の着手条件だった「送信時の突き合わせ」を段 1 へ前倒しした**（S-2b の対処）。
  - `chat-send` フレームに **`expectedChannel`**（＝ `ChatSendCard` が画面に出しているのと**同じ値**）を載せる。
  - ⚠⚠⚠ **これは「宛先」ではなく「宛先の期待値」である。** sidecar は**宛先として一切使わず**、
    `setChannel` が握っている実際の宛先との**等値検査にしか使わない**（不一致なら送らず、理由を返す）。
    ⚠ **宛先として使った瞬間、S-2 の穴がそのまま戻る。**
  - ⚠ 比較は `trim().toLowerCase()`（Twitch のログイン名は大文字小文字を区別しない）。
  - ⚠ **チケットと違い、不一致には返事をする**——黙ると「押したのに何も起きない」になり、
    **差し替えに気づけない**（チケットを黙殺するのは総当たり対策で、こちらには守るべき秘密が無い）。
  - ⚠ **表示に使う値と `expectedChannel` に渡す値を必ず一致させること**（ずれると検査の意味が消える）。
    固定しているのは `CommentViewerApp.session.test.tsx` の「066 S-2b」の 1 本。
- ✅ **宿題だった `start-session` そのもののチケット化は段 2 で完了した**（2026-08-23・上記「段 2」節）。
  突き合わせが守るのは「**ユーザーが押した瞬間**、宛先が画面と一致していること」だけで、
  **取得セッションを勝手に差し替えられること自体**はチケットのほうが塞いでいる。
  ⚠⚠ **2 つは守っているものが違うので、どちらも外さないこと**（門を 1 枚に減らす変更である）。

### (4) スロットル（**sidecar 側にしか置かない**）

最短間隔 **3 秒**／30 秒あたり **5 通**／⚠⚠ **直前と同じ本文を拒否**。
⚠ Twitch の制限（20 通/30 秒）より**十分低く**取り、**BAN 側へ倒れない**ようにしている。
⚠ frontend に置くと未認証 WS から直接叩かれる経路で回避される。

### (5) 旧トークンの扱い（043a の先例）

401/403 は**非致命化**し、**本線（コメント取得）を止めない**。
返すのは「**Twitch にログインし直してください**」という短文だけ。

⚠⚠⚠ **security-review S-1（修正済み）: トークンの取得に `authClient.refresh` を使ってはいけない。**
`RefreshAccessTokenUsecase` は ①**毎回 refresh token を無条件で交換**し
②**失敗すると `tokenStore.clear(provider)`** を呼ぶ＝ `COMMENT_SIDECAR_TOKEN_CLEAR` →
**Rust が keychain を削除＝完全ログアウト**になる。
⇒ **一時的なネットワークエラーや、取得パイプライン側の refresh との競合で、
テスト送信 1 回がユーザーをログアウトさせ、コメント取得ごと止める。**
⚠ 使うのは **`authClient.getValidAccessToken`**（期限切れのときだけ交換する非破壊のアクセサ）。
⚠⚠ **この配線は `scripts/test-chat-send.mjs` の静的検査が固定している**
（`index.ts` は import できないので、**ソース文字列を直接読んでいる**）。

## 変更したファイル（段 1）

**sidecar**: `twitch-config.ts`（`user:write:chat` 追加）／**新規 `src/chat-send/`**
（`chat-send-frame.ts` ＝ ⚠ **判断はすべてここ**／`twitch-chat-sender.ts` ＝ Helix `POST /chat/messages`）／
`index.ts`（フレーム 1 本・チケット受領・**セッション連動の `setChannel`**）／
**新規 `scripts/test-chat-send.mjs`**
**Rust**: `comment_sidecar/mod.rs`（チケットの採番・stdin 送出・取得）／`lib.rs`（`get_chat_send_ticket`）
⚠ **capability は増やしていない**（読み取り専用コマンドが 1 本増えただけ）。
**frontend**: `commentStream.ts`（`sendChat`）／`overlaySettings.ts`（キー）／
**新規 `ChatSendCard.tsx`**（＋テスト）／`SettingsView.tsx`／`CommentViewerApp.tsx`
**docs**: `security.md` §1 の追補（⚠ **本タスクの正**）

## 変更したファイル（段 2）

⚠ 一覧と表は上の「✅ 実装（段 2・2026-08-23）」節が正。ここでは**繰り返さない**。

## このタスクでやらないこと

- ⚠⚠ **自動送信** ⇒ **[063f](063f-gacha-chat-output.md)**（旧「段 3」）
- ⚠⚠ **YouTube への書き込み**（上記 (1)）
- 文面のテンプレート・当選者名の差し込み ⇒ **[063f](063f-gacha-chat-output.md)**
- ⚠ **送信履歴の保存**（§9 の重みが跳ね上がる）
- モデレーション操作（削除・タイムアウト等）。⚠ **スコープを増やさない。**
- ⚠⚠ **`start-login` のチケット化**（段 2 が対象外にした**残る穴**。実害は「Device Code の取得が走る／
  同意画面が開く」で**宛先の乗っ取りではない**が、嫌がらせにはなる。⚠ **次に本ファイルを触るときに検討**）

## 完了条件（段 1）

- ✅ 既定 OFF で、**トグルを ON にしてテスト送信を押したときだけ** 1 通送る。
- ✅ **チケットが一致しないフレームは送らず、返事もしない**（fail-closed）。
- ✅ **宛先を viewer から受け取らない**（取得を止めたら送れない）。
- ✅ スロットル（間隔・窓・**同一文面**）が効き、落ちた分は **API を叩かない**。
- ✅ 401/403 で**本線が止まらず**、再ログインを促す文が出る。
- ✅ **§9**: 本文も結果も保存せず、ログにも出さない。
- ✅ **新規 egress 先ゼロ**・**capability 追加ゼロ**・`csp: null` 不変・**新規依存ゼロ**。
- ✅ **`security-review` 実施済み**（指摘 2 件は修正・静的検査とテストで固定）。

## 確認コマンド

```bash
pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/comment-sidecar test    # ⚠ chat-send / session-control の判断はここで殺す
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml

# ⚠ ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json .github/
git status --short -- apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml
# ⚠⚠ YouTube のスコープを変えていないこと
git diff -- apps/comment-sidecar/src/youtube-config.ts
```

## ⚠ 実機確認（依頼者の環境で行う）

1. **設定画面の末尾に「チャットに書き込む」カードがあり、既定 OFF**
2. OFF のまま「テスト送信」が**押せない**
3. ON にして押す → ⚠ **初回は「Twitch にログインし直してください」**が出る（旧トークン）
4. Twitch にログインし直す → もう一度押す → **配信のチャットに 1 通流れる**
5. ⚠ **すぐもう一度押す** → 「送信の間隔が短すぎます」（**送られない**）
6. ⚠⚠ **コメントの取得を停止してから押す** → 「配信に接続していません」（**送られない**）
7. ⚠ **YouTube だけに接続して押す** → 送られない（YouTube 非対応の旨が画面にある）
8. ⚠ `lsof -i` で **`api.twitch.tv` 以外の外部 ESTABLISHED が増えない**こと

## 実装後に必要なレビュー

✅ **`security-review` を 2 回実施済み**（[.claude/skills/security-review](../../.claude/skills/security-review/SKILL.md)）。

- **1 巡目（実装者自身）**: S-1（`authClient.refresh` が失敗時に keychain を消す＝**テスト送信 1 回で強制ログアウト**）と
  S-2（宛先が `start-session` 由来＝ viewer から来ている）を検出し、修正。
- **2 巡目（別セッション）**: ⚠⚠⚠ **1 巡目の修正 2 件がどちらも不完全だった**ことを検出:
  - **S-1b**: `getValidAccessToken` は「**非破壊**」ではない——**期限切れ＋ refresh 失敗なら
    `tokenStore.clear` を呼ぶ経路が残っている**。⇒ 記述を訂正（`refresh` より明確に良いが、無害ではない）。
  - **S-2b**: 「画面に送信先を出す」対処が**成立していなかった**（出していたのは frontend 自身の入力値）。
    ⇒ **段 2 の「送信時の突き合わせ」を前倒しして実装**（上記 (3)）。
  - **Q-066-1**: スロットルの「**送る前に枠を消費する**」が**テストで守られていなかった**
    （`commit` を `await` の後ろへ移してもテストが全通した）。⇒ 並行させて固定するテストを追加。

✅ **段 2 でもう 1 回回した（2026-08-23・3 巡目）。** 特に見たのは:
- **チケットの fail-closed**（未受領・不一致で送らず、返事もしないこと）
- ⚠⚠ **宛先の突き合わせが生きていること**（`expectedChannel` が**宛先として使われていない**こと・
  画面表示と同じ値が渡っていること）／✅ **`start-session` のチケット化（段 2 で完了）**
- **スロットルが sidecar 側にあること**（frontend に移していないこと）＋**枠を送る前に消費**していること
- **§9**（本文・結果・トークンがログにも保存にも出ないこと）
- **既定 OFF** と **自動送信の経路がゼロ本**であること（⚠ 段 2 でここが無くなる）
- ⚠⚠ **`POST /helix/chat/messages` の `is_sent` / `drop_reason` を見ているか**
  （⚠ **未対応**——200 でも AutoMod 等で送られないことがあり、いまは「送信しました」と出る。下記参照）
