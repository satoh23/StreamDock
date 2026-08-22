# 066 配信のチャットへの書き込み（親・⚠⚠⚠ StreamDock 初の「書き込み」）

> 状態: **段 1 完了（2026-08-22）／✅ `security-review` 実施済み・指摘 2 件は修正済み**。
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
> チケット機構の先例 [060c](060c-theme-import-snapshot.md)、
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

| 段 | 内容 | 状態 |
|---|---|---|
| **段 1** | **送信の基盤だけ**（スコープ・チケット・スロットル・**既定 OFF のトグル＋テスト送信**） | ✅ **完了** |
| 段 2 | ガチャの結果をチャットへ書く（文面・当選者名を出すか） | ⚠ [063b](063b-gacha-draw-and-triggers.md) と一緒 |

⚠⚠ **段 1 を単独で通した理由**＝「書き込みが**意図せず起きない**」ことを、
ガチャの話と切り離して固めるため。

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
- ⚠⚠⚠ **段 2（自動送信）に残る宿題＝ `start-session` そのもののチケット化。**
  突き合わせが守るのは「**ユーザーが押した瞬間**、宛先が画面と一致していること」だけで、
  **取得セッションを勝手に差し替えられること自体は塞げていない**
  （自動送信は**ユーザーが画面を見ていないときに走る**ので、押した瞬間の一致では足りない）。
  ⚠ **これを済ませずに [063b](063b-gacha-draw-and-triggers.md) の自動送信を繋がないこと。**

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

## 変更したファイル

**sidecar**: `twitch-config.ts`（`user:write:chat` 追加）／**新規 `src/chat-send/`**
（`chat-send-frame.ts` ＝ ⚠ **判断はすべてここ**／`twitch-chat-sender.ts` ＝ Helix `POST /chat/messages`）／
`index.ts`（フレーム 1 本・チケット受領・**セッション連動の `setChannel`**）／
**新規 `scripts/test-chat-send.mjs`**
**Rust**: `comment_sidecar/mod.rs`（チケットの採番・stdin 送出・取得）／`lib.rs`（`get_chat_send_ticket`）
⚠ **capability は増やしていない**（読み取り専用コマンドが 1 本増えただけ）。
**frontend**: `commentStream.ts`（`sendChat`）／`overlaySettings.ts`（キー）／
**新規 `ChatSendCard.tsx`**（＋テスト）／`SettingsView.tsx`／`CommentViewerApp.tsx`
**docs**: `security.md` §1 の追補（⚠ **本タスクの正**）

## このタスクでやらないこと

- ⚠⚠ **自動送信**（段 2・[063b](063b-gacha-draw-and-triggers.md)）
- ⚠⚠ **YouTube への書き込み**（上記 (1)）
- 文面のテンプレート・当選者名の差し込み（段 2）
- ⚠ **送信履歴の保存**（§9 の重みが跳ね上がる）
- モデレーション操作（削除・タイムアウト等）。⚠ **スコープを増やさない。**

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
pnpm --filter ./apps/comment-sidecar test    # ⚠ chat-send の判断はここで殺す
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

⚠ **段 2 の前にもう一度回すこと。** 特に見るべきは:
- **チケットの fail-closed**（未受領・不一致で送らず、返事もしないこと）
- ⚠⚠ **宛先の突き合わせが生きていること**（`expectedChannel` が**宛先として使われていない**こと・
  画面表示と同じ値が渡っていること）／**`start-session` のチケット化が済んだか**
- **スロットルが sidecar 側にあること**（frontend に移していないこと）＋**枠を送る前に消費**していること
- **§9**（本文・結果・トークンがログにも保存にも出ないこと）
- **既定 OFF** と **自動送信の経路がゼロ本**であること（⚠ 段 2 でここが無くなる）
- ⚠⚠ **`POST /helix/chat/messages` の `is_sent` / `drop_reason` を見ているか**
  （⚠ **未対応**——200 でも AutoMod 等で送られないことがあり、いまは「送信しました」と出る。下記参照）
