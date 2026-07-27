# 043e YouTube Jewels の combo 更新に対応（同一 id 再送の取り込み）

> 状態: **フェーズ1 実装済み（2026-07-27）・独立レビュー（セキュリティ＋品質）指摘反映済み／フェーズ2 は実データ待ちで未了**。
> レビュー判定は自己 security-review が「問題なし」、その後の**独立レビューが「軽微な懸念あり」**（実装本体の脆弱性はゼロ・
> 指摘は「二重ロックの各層に単独で効くテストが無い」1 点が主）。指摘はすべて apply-review で反映済み（progress.md 参照）。
> 実装記録は progress.md「2026-07-27 (043e YouTube Jewels の combo 更新に対応＝同一 id 再送の取り込み・フェーズ1 実装)」節。
> 043d の実装差分に対する独立レビューで判明した**既知の未解決課題**を独立タスクにしたもので、
> 043d は「wire/Rust 変更ゼロ」を要件としていたため対応を見送っていた（本タスクでその制約を外した）。
>
> **実装時に本ファイルの記述から変えた点（いずれも計画段階で合意済み）**:
> 1. **(1) の対象ファイルが 3 つ足りなかった**。`comboCount` を wire まで通すには 043a の `monthCount` と同じ経路
>    （`entities/comment/comment.ts` / `shared/comment-view.dto.ts` / `comment-to-view.converter.ts`）が必須で、
>    無いと**コンパイルは通るのに値だけ静かに消える**。
> 2. **(3) の `updated` は `eventType === "jewels"` 限定にした**（本ファイルは種別条件を書いていなかった）。
>    これで jewels 以外の同一 id は表示も invoke も 0＝**3 層すべてで従来と挙動不変**になる。
> 3. **変化判定に `text` を足した**（本ファイルは「`monetary?.amount` と `comboCount` で足りる」としていた）。
>    Rust の UPDATE 対象に `text` が含まれるため、**比較キー ⊇ 更新列**を不変条件にして取りこぼしを防いだ。
> 4. **`comboCount` を画面に出した**（本ファイルは (1)〜(6) に描画を書いていなかった）。現状 jewels は
>    `composeEventMessage` が null を返すため、通しただけでは**どこにも表示されず**下記フェーズ2 の
>    「コメントビューアで目視」が成立しなかった。本体コメント行の金額バッジ隣に「×N」を出す（オーバーレイには出さない）。
> 5. **dev-mock に combo 更新の合成発行を追加した**（範囲拡大のため計画時に個別合意）。実データが無いため、
>    3 層の貫通を実機で目視する唯一の手段になる（`seq % 20 === 12` で `seq % 20 === 9` と同一 id を再送）。
>
> **フェーズ2 の残条件（未了）**: `jewels_amount` が「単価」か「累計」かは**今も未確定**（自チャンネル未収益化・
> 協力配信者の Jewels 終了により実データを入手できていない）。下記「フェーズ 2」節の再開トリガーを満たしたら着手する。

## 目的

YouTube の Jewels ギフト（`GIFT_EVENT`）で **連続ギフト（combo）が発生したとき、金額が最初の 1 回ぶんのまま
更新されない**問題を解消する。公式仕様上 combo は「同一 message id の**更新**」として届くが、現行の
stream-dock は 3 層すべてで id 重複を**破棄**しているため、更新が一切反映されない。

## 現在の前提（調査結果・実コード）

### 公式仕様（一次情報）

出典（043d レビュー時に一次情報から再取得済み）:

- proto 全文: `https://developers.google.com/youtube/v3/live/streaming-live-chat`
- REST リソース: `https://developers.google.com/youtube/v3/live/docs/liveChatMessages`

確定している記述:

| 項目 | 公式の記述 |
| --- | --- |
| `LiveChatMessage.id`（= 101） | 「The ID that YouTube assigns to uniquely identify the message. **Note: For giftEvents, the same ID may be reused to update the combo count.**」 |
| `jewels_amount`（= 3・int32） | 「The amount of Jewels **redeemed for the gift**.」 |
| `combo_count`（= 8・int32） | 「The combo count of the gift; **0 if not a combo**.」 |

補足: REST 表現では `snippet.giftEventDetails.giftMetadata.{jewelsAmount, comboCount, ...}` と入れ子だが、
gRPC proto では `LiveChatGiftDetails` にフラットに並ぶ（番号は 043d で全項目照合済み・不一致ゼロ）。
**つまり combo は「別メッセージが N 件届く」のではなく「同じ 1 件が N 回更新される」。**

### 現行実装（id 重複を捨てている 3 層）

| 層 | 箇所 | 現在の挙動 |
| --- | --- | --- |
| frontend 表示・記録の入口 | [mergeComments.ts:27](../../apps/desktop/src/features/comment-viewer/mergeComments.ts#L27) `if (seen.has(c.id)) continue;` | **2 件目以降を完全に捨てる**。`added` に載らないため Rust へも渡らない |
| TTS | [ttsQueue.ts:119](../../apps/desktop/src/features/comment-viewer/ttsQueue.ts#L119) `seenIds` | 同 id は再読み上げしない（**この挙動は維持したい**） |
| 保存 | [repository.rs:168](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L168) `INSERT OR IGNORE INTO viewer_comments` | 既存 id は 0 行・集計も触らず `RecordResult{false,false}` |

呼び出し経路は [CommentViewerApp.tsx:486](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L486)
の `setComments` 内で `mergeComments(prev, incoming)` → `enqueueForSpeech(added)` → `recordComments(added, ...)`。
**`recordComments` に渡るのは `added` だけ**なので、combo 更新は Rust に到達すらしない。

### 影響範囲の正確な評価（重要・過大に見積もらないこと）

- **ロールアップ列で JEWELS を合計している列は現時点で存在しない。**
  [repository.rs:204-220](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L204-L220) の再計算 SQL は
  `bits_amount` が `currency = 'BITS'`、`superchat_amount` が `event_type = 'superchat'` を条件にしており、
  `event_type='jewels' / currency='JEWELS'` はどちらにも入らない（043a のテスト
  [repository.rs:486-489](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L486-L489) で固定済み）。
- したがって実害は **(a) コメント行の金額バッジ表示**と **(b) `viewer_comments.amount` に残る値**の 2 点。
  視聴者一覧の集計値が壊れているわけではない。`total_comments` は 1 件のまま（combo は論理的に 1 ギフト）で正しい。
- **`GIFT_EVENT` 以外は影響なし。** `MEMBERSHIP_GIFTING_EVENT`（贈与側）に combo の概念は無く、
  受領側 `GIFT_MEMBERSHIP_RECEIVED_EVENT` は 043d 決定1 で取り込んでいない。
- レビュー初報にあった「`key={c.id}` が重複して React が警告する」は**誤り**。`mergeComments` が先に
  弾くため重複キーは発生しない（本タスクでは考慮不要）。

### 未解決の論点（本タスクの核心）

**`jewels_amount` が「1 回ぶんの単価」なのか「combo 累計」なのかが公式に明記されていない。**

- 「The amount of Jewels redeemed for the gift」は単数の gift を指すが、combo 全体を 1 gift と読むこともできる。
- `combo_count` が「0 if not a combo」である点は重要で、**単価読みなら合計は
  `jewels_amount × max(combo_count, 1)`** になる（単発で `combo_count = 0` のため素の乗算は不可）。
- 043d 実装時に実データ検証ができていない（自チャンネル未収益化・協力配信者の Jewels 終了）ため、**推測で
  換算式を入れてはいけない**（043d の「推測ゼロ」原則）。

## 決定事項（2026-07-27）

1. **2 フェーズで進める。** 実データが無くても安全に進む部分（フェーズ 1）と、実データが要る部分
   （フェーズ 2）を分離する。フェーズ 1 だけで完了扱いとし、フェーズ 2 は実データ入手時に再開する。
2. **フェーズ 1 の換算は「最新の `jewels_amount` をそのまま採る」**（乗算しない）。
   - `jewels_amount` が累計なら**これで完全に正しくなる**。
   - 単価なら**今日と同じ値**になるだけで、**過大計上には絶対にならない**（安全側）。
   - どちらに転んでも今より悪くならないことを保証する。
3. **`combo_count` は受信して表示まで通すが、金額計算には使わない**（フェーズ 1 では）。
   これは「どちらの意味論か」を実機で判別するための観測手段を用意するのが目的。
   数値属性のみで個人情報を含まないため §9 上の新論点は生まない。
4. **同一 id の更新を許すのは `event_type = 'jewels'` のみに限定する。**
   他種別は既存の冪等契約（`INSERT OR IGNORE`・`RecordResult{false,false}`）を**一切変えない**。
5. **TTS は再読み上げしない。** combo 更新は「新規コメント」ではないので `added` には載せず、
   専用の `updated` バケット経由で記録のみ行う。

## このタスクでやること

### (1) sidecar: `combo_count` を受信面に追加

- `stream-list-proto.ts` の `LiveChatGiftDetails` に `optional int32 combo_count = 8;` を宣言する
  （番号・型は 043d で公式照合済み）。同ファイルの `LiveChatMessage.id` に置いた既知課題コメントを
  「043e で対応」へ更新する。
- `raw.dto.ts` の `YouTubeGiftDetailsDto` に `combo_count?: number` を追加。
- `comment.mapper.ts`:
  - `mapJewelsAmount` は**現状のまま**（`amount <= 0` を `undefined`・乗算しない）。
    「フェーズ 2 でここに `× max(combo_count, 1)` を足す」旨と再修正トリガーをコメントで残す。
  - `Comment` に `comboCount` を通す（`combo_count` が 0/未設定なら `undefined` へ劣化。
    `mapGiftCount` と同じ「0 以下は落とす」方針に揃える＝「combo 0 回」という文言を作らない）。

### (2) wire / Rust / binding: `comboCount` を表示用に通す

既存の `monthCount` / `giftCount` / `tier`（043a）と**完全に同じ扱い**にする＝表示用途で通すのみ・**端末保存しない**。

- `apps/comment-sidecar/src/wire.ts`: `CanonicalComment` に `comboCount?: number` を追加し
  `toCanonicalComment` で素通し。
- `apps/desktop/src-tauri/src/comment_viewer/model.rs`: `CommentViewDto` に `combo_count: Option<u32>`
  （serde rename は既存フィールドの慣行に合わせる）。
- ts-rs binding を再生成し `CommentViewDto.ts` に `comboCount?: number` が出ることを確認。

### (3) frontend: `mergeComments` に「更新」バケットを足す

[mergeComments.ts](../../apps/desktop/src/features/comment-viewer/mergeComments.ts) の戻り値を
`{ next, added, updated }` へ拡張する。

- 同一 id が既にある場合、**payload が変化しているときだけ** `updated` に積み、`merged` 内の該当要素を
  差し替える（表示行は 1 行のまま金額バッジだけ更新される）。
- 変化判定は `monetary?.amount` と `comboCount` の比較で足りる（過剰比較はしない。StrictMode の
  updater 二重実行で無駄な UPDATE が飛ばないようにするのが目的）。
- 変化が無ければ**従来どおり完全にスキップ**（`continue`）。
- `added` の意味は変えない（＝TTS の単一注入点は新規行のみのまま）。

呼び出し側 [CommentViewerApp.tsx:486](../../apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx#L486) で
`recordComments(added, ...)` を `recordComments([...added, ...updated], ...)` 相当へ変更する
（`enqueueForSpeech` は `added` のまま **変更しない**）。`OverlayApp` は `next` のみ使うので変更不要。

### (4) Rust: `jewels` に限って同一 id を更新する

[repository.rs](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs) の `record_comment` の
`if inserted == 0` 分岐（現在は即 return）に、**`event_type = 'jewels'` のときだけ**通る更新経路を足す。

- `UPDATE viewer_comments SET amount = ?, currency = ?, monetary_amount = ?, text = ?
   WHERE id = ? AND event_type = 'jewels'` を実行する。
  - `published_at` / `session_id` / `viewer_id` は**書き換えない**（first/last 集計と 038c 判定の基準を動かさないため）。
- 更新が 1 行でも起きたら**既存の再計算 SQL をそのまま再実行**する（`viewer_comments` から毎回全再計算する
  recompute-on-write なので、増分ドリフトは起きない。`total_comments = COUNT(*)` は変わらない）。
- 戻り値は **必ず `RecordResult{ first_time: false, long_absence: false }`**（更新でバッジを再点灯させない）。
- `event_type` が `jewels` 以外の重複 id は**現行どおり 0 行・集計非更新・即 return**。既存の冪等テスト
  [repository.rs:398 `duplicate_comment_id_is_idempotent`](../../apps/desktop/src-tauri/src/viewer_memory/repository.rs#L398)
  が緑のままであることを退行検知に使う。

### (5) テスト

- **sidecar** `scripts/test-youtube-mapper.mjs`（現在 51 アサート）に追加:
  - `combo_count` を宣言したことで公式番号 8 と一致すること（セクション A 形式）。
  - combo 更新の 2 通（同一 id・`combo_count` 1→3）を往復させ、`comboCount` が通り
    `monetaryAmount` は**乗算されない**こと（フェーズ 1 の仕様固定）。
  - `combo_count = 0`（単発）で `comboCount` が `undefined` へ劣化すること。
- **frontend** `mergeComments` の**新規テストファイルを作る**（現在テストが存在しない）。
  - 新規 id は `added`、同一 id かつ payload 同一は**どちらにも載らない**、同一 id かつ金額変化は
    `updated` に載り `next` 内の行が差し替わる、`MAX_COMMENTS` クランプが従来どおり効く。
- **Rust** `viewer_memory/repository.rs` のテストに追加:
  - `jewels` の同一 id 再送で `amount` が更新され、`total_comments` は 1 のままで、戻り値が
    `{false,false}` であること。
  - `superchat` など**他種別**の同一 id 再送では `amount` が更新されないこと（限定の担保）。

### (6) docs

- `docs/security.md` 方針⑪ の 043d 節にある「⚠ 既知の未解決課題」を **043e で対応済み**へ更新し、
  受信面に `combo_count`（数値のみ）を足したこと・`viewer_comments` の**既存行 UPDATE を jewels 限定で
  解禁**したことを明記する（列追加は無し・個人情報は増えない）。
- `docs/progress.md` に実装記録、`docs/task-board.md` の 043 系に 043e を追加。
- 本ファイル冒頭に実装済み注記とフェーズ 2 の残条件を書く。

## このタスクでやらないこと

- **`jewels_amount × combo_count` の換算を入れること**（＝フェーズ 2）。実データで意味論が確定するまで禁止。
  確定したら本ファイルのフェーズ 2 節を起こして再開する。
- `gift_url` / `gift_name` / `alt_text` 等のギフト資産情報の受信（043d で除外した判断を維持。
  `gift_url` は画像取得＝CSP・§9 の新論点を生む）。
- JEWELS 用のロールアップ列（`jewels_count` / `jewels_amount`）を `viewers` に追加すること。
  現状どの集計列にも入らないのは 043a の設計どおりで、本タスクの範囲外。
- `MEMBERSHIP_GIFTING_EVENT`（贈与側）や受領側イベントの扱いの変更（043d 決定1 を維持）。
- `jewels` 以外の種別で同一 id の更新を許すこと（既存の冪等契約を壊さない）。
- TTS の再読み上げ挙動の変更。

## セキュリティ制約（docs/security.md 準拠）

- **§1 外部通信**: 新規宛先・新規 OAuth スコープ・新規依存は**ゼロ**。既存 gRPC ストリームで既に届いている
  メッセージのフィールドを 1 つ多く読むだけ。`part` / `profile_image_size` は不変＝**追加リクエスト・
  クォータ影響なし**（方針⑧）。二層 fail-closed（env ピン留め＋gRPC チャネルガード
  `www.googleapis.com:443` のみ）・`csp: null`・capabilities も**不変**であること。
- **§9 非ログ・非外部送信・受贈者/贈与者名の非保持**: 新たに受信するのは `combo_count`（整数）のみで
  個人情報を含まない。受領側 `gift_membership_received_details`（= 32）は**引き続き proto に宣言しない**
  （043d 決定1 を維持＝受贈者情報はそもそもデコードしない）。追加コードにログ出力を入れない。
- **保存範囲（要記載）**: 本タスクで **`viewer_comments` の既存行を UPDATE する経路が初めて入る**。
  列は増やさず、更新するのは `amount` / `currency` / `monetary_amount` / `text` のみ、対象は
  `event_type = 'jewels'` に限定する。`published_at` / `viewer_id` / `session_id` は不変。
  この変更は security.md 方針⑪に明記すること（レビュー必須条件「取得コメントの端末保存」に該当）。
- **§10 依存を増やさない**: 新規ライブラリなし。

## 完了条件

- 実データが無い状態でも、**combo 更新が Rust まで到達し `viewer_comments.amount` が最新値に置き換わる**
  ことが Rust テストで固定されている。
- `jewels` 以外の種別で同一 id 再送の挙動が**現行と 1 バイトも変わらない**ことがテストで固定されている。
- TTS が combo 更新で再読み上げしない（`added` に載らない）ことが `mergeComments` テストで固定されている。
- 表示行が combo 更新で**増えない**（1 行のまま金額だけ更新）ことが `mergeComments` テストで固定されている。
- `combo_count = 8` が公式番号と一致することが sidecar テストで固定されている。
- 下記「確認コマンド」がすべて PASS。
- security-review 通過（受信面拡張＋保存挙動変更のため必須）。

## 確認コマンド

```bash
pnpm --filter @stream-dock/comment-sidecar typecheck
pnpm --filter @stream-dock/comment-sidecar test              # host-guard / obs / youtube-mapper 一括
pnpm --filter ./apps/desktop typecheck && pnpm --filter ./apps/desktop lint && pnpm --filter ./apps/desktop test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml viewer_memory

# 通信面がゼロ拡大であることの実測（043d と同じ手順）
pnpm --filter @stream-dock/comment-sidecar build:bundle
grep -oE 'https?://[a-zA-Z0-9.*-]+|wss?://[a-zA-Z0-9.*:-]+' apps/comment-sidecar/build/sidecar.cjs | sort -u
git status --short -- apps/comment-sidecar/src/host-guard.ts \
  apps/comment-sidecar/src/comment-fetcher/register-youtube-deps.ts \
  apps/desktop/src-tauri/capabilities/ apps/comment-sidecar/package.json   # 差分ゼロが期待

# ts-rs binding の再生成漏れ検知（生成物が差分に含まれること）
git status --short -- apps/desktop/src/features/comment-viewer/bindings/
```

## フェーズ 2（実データ入手後・本タスクでは着手しない）

**再開トリガー**: Jewels の combo が実際に発火する配信で生メッセージを観測できたとき。

1. 同一 id の連続到着で `jewels_amount` が**変化するか**を確認する。
   - 変化する（累計）→ フェーズ 1 の実装で**既に正しい**。本節を「対応不要」として閉じる。
   - 変化しない（単価）→ `mapJewelsAmount` に `× max(combo_count, 1)` を入れる（1 行）。
     `combo_count = 0`（単発）で 0 倍にならないよう `max(..., 1)` は必須。
2. 変更後は金額が変わるため **再度 security-review**（方針⑪の集計・保存への影響）を通す。
3. 観測は本タスクで通した `comboCount` の表示で足りる（コメントビューアで combo 値と金額の変化を目視）。
   - ⚠ **dev-mock の見え方を根拠にしないこと**（独立レビュー指摘 Q-3）。`seq % 20 === 12` の合成は金額 ×3＝
     **「累計で届く」世界を模した値**なので、フェーズ1 では常に「30 → 90 に正しく更新される」ように見える。
     単価で届く世界なら同一 id の再送で**金額は変化せず `×N` だけが増える**のが正しい。判別は実データのみで行う。
4. **`×N` 表示の残置判断**（独立レビュー指摘 Q-11）: 本表示は観測用の仮設として入れたが、combo を使う視聴者にとって
   「×3」は元々有用な情報でもある。フェーズ2 をクローズする時点で **残置するか撤去するかを UX 判断で明示的に決める**
   （無言で常設化させない）。撤去する場合の対象は `CommentList.tsx` の `.combo` 描画・`CommentViewerApp.module.css` の
   `.combo`・`CommentList.test.tsx` の 043e 3 件。**受信面（`combo_count`）と wire は撤去しない**（フェーズ2 の金額計算で使う）。

## 実装後に必要なレビュー

- **security-review 必須**（受信面の拡張＋`viewer_comments` の UPDATE 解禁）。
- 品質レビューは `/code-review`（effort high）。とくに (3) の `mergeComments` は
  **表示・TTS・保存の 3 系統が同時にぶら下がる単一注入点**なので、`added` / `updated` の切り分けを重点的に見る。
