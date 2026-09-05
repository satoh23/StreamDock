# 059b 投げ銭通知音（コメント音とは別音）

> 状態: **実装済み（2026-08-04・[058s](058s-audio-output-device-spike.md) の結論「②-軽」に沿って
> 全面的に書き直したうえで実装）。⚠ 実機確認（`tauri dev` での耳での確認・デバイス抜き差し）は本人が行う。**
> 分割・線引きは親 [059](059-notification-sounds.md) を正とし、**再生方式に関する記述は
> [058s](058s-audio-output-device-spike.md) の「スパイク結果」節と [058a](058a-audio-routing-foundation.md) が上書きする**。
>
> ⚠ **本ファイルは 2026-08-04 に書き直されている。** 旧版は **Web Audio 前提**で
> 「2 つ目の音源を用意して同梱し、ライセンスを確認する」計画だったが、058s の実測で
> **webview では出力デバイスを選べない**ことが確定して再生層が Rust（`rodio`）へ移り、
> 059a が **音を Rust で合成する**道を採ったため、同梱もライセンスも論点ごと消えた。
> 失効した記述の一覧は下記「⚠ 旧版から失効した記述」。
>
> **必読前提**: 親 [059](059-notification-sounds.md)、**方式決定 [058s](058s-audio-output-device-spike.md)**、
> **基盤 [058a](058a-audio-routing-foundation.md)**、**直接の土台 [059a](059a-comment-notification-sound.md)
> （`notificationSound.ts` / `soundPrefs.ts` の正・末尾のレビュー節まで）**、
> 課金判定 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)
> （`isMonetaryEvent` / `MONETARY_EVENT_TYPES` / `displayEventType`）、
> 課金の扱いの先例 [043b](043b-monetary-emphasis-in-viewer.md) / [047](047-superchat-ticker.md) / [049](049-monetary-event-speech.md)、
> Jewels combo 再送 [043e](043e-youtube-jewels-combo-fidelity.md)、
> 差分検出 [`mergeComments.ts`](../../apps/desktop/src/features/comment-viewer/mergeComments.ts)、
> 設定画面の書式規則 [054](054-comment-viewer-settings-readability.md)、
> [`docs/security.md`](../security.md)（§3 / §4 追補〈058a〉/ §8 / §9 追補 / §10 / **レビュー必須条件**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示した**。
> ⚠ **レビュー区分は security-review 必須**（理由は末尾）。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

依頼者の要望④のうち音の部分「**課金チャットを検知したとき、コメント検知とは別の音**が鳴るようにしたい。
これも ON/OFF を決められる」を実装する。

## ⚠ 旧版から失効した記述

| 旧版の記述 | 現在の正 |
| --- | --- |
| (1) 2 つ目の**音源を用意して同梱**・**ライセンス確認**・base64 定数 | **音は Rust で合成する**（`service::tone_spec` に 1 アーム）。同梱ファイルが存在しないのでライセンスの論点が発生しない |
| (4) `sound-monetary-stream-output`（配信に載せるか） | **作らない。** ②-軽では「通知音＝選んだ実デバイス＝載らない」で固定済みで、トグルにする余地が無い（切替先＝OS 既定は載る側なので fail-closed が壊れる） |
| (4) 音量は 059a の `sound-volume` を共有する | **音量キーは存在しない**（059a が作らないと決めた）。振幅は Rust の `PEAK_AMPLITUDE` 固定。理由と再修正トリガーは `soundPrefs.ts` の JSDoc |
| 「現在の前提」の ⚠ 節「`CommentList` は `displayEventType(c)` で chat/課金を分岐している。**表示側と同じ関数を使うこと**」 | ⚠⚠ **これが本タスク最大の罠だった。** `CommentList` には分岐が **2 つ**あり、本体一覧（`renderDefaultItem`）は `isMonetaryEvent(c.eventType)`、オーバーレイ（`renderOverlayItem`）だけが `displayEventType(c) !== "chat"`。旧版はオーバーレイ側だけを見て書かれていた。**採ったのは `isMonetaryEvent(c.eventType)`**（下記 (2) の 3 案表） |
| (3)「投げ銭音のクールダウン値は**コメント音より短くてよい**（投げ銭は連投されにくい）」 | ⚠ **反転した。** Twitch コミュニティギフトの N+1 件をクールダウンで凌ぐ以上、**コメント音より長い**必要がある（下記 (3)） |
| セキュリティ制約「再生は既存の Web Audio API で完結」「**Rust・依存はすべて差分ゼロ**」 | 再生は Rust。**`src/audio/` に差分が出る**（`Monetary` variant ＋ `tone_spec`）。**依存・capabilities・`tauri.conf.json`・sidecar は差分ゼロ**のまま |
| 完了条件「音源のライセンスが記録されている」 | 不要。**「同梱音源ではなくアプリ内合成である」ことを progress.md に記録する**に置換 |
| 確認コマンドの `git status -- apps/desktop/src-tauri/`（差分ゼロ期待） | `src/audio/` に差分が出る。ゼロ期待は `capabilities/` と `tauri.conf.json` に限定する |
| 実装後のレビュー「**軽レビュー**」 | ⚠ **security-review 必須**（059a のレビューで判定基準が是正され、`src-tauri/src/audio/` の本番コードに差分が出る変更は下位条件に当たらなくても該当すると security.md に明記された） |

## 現在の前提（調査結果・実コード）

- **058a（`122ebd6`）と 059a（`e437a57`）は実装済み・コミット済み。** 059b は
  **既存の基盤に 2 音目を足すだけ**で、基盤を作り直さない。すでに存在するもの:
  - Rust: `NotificationSound { Test, Comment }`、`tone_spec`（`frequency_hz` / `duration` / `decay_tau`）、
    `samples_for`、**同時再生 1 本の上限**（`PLAYING` / `PlaybackGuard`。競合したら鳴らさず `Ok(())`）
  - frontend: `requestNotificationSound(sound, deviceId) → "played" | "skipped" | "failed"`（**reject しない**）、
    **音源 ID ごとに独立した `COOLDOWN_MS`**、`soundPrefs.ts`、`audioOutputPrefs.ts`（未選択＝鳴らさない）
  - 設定の「通知音」カード（トグル＋試聴＋未選択時の赤字）、ツールバーの**継続表示 indicator**
- **音を増やすのは `NotificationSound` に variant を足し `tone_spec` に 1 アーム足すだけ。** ts-rs が
  frontend の型を自動追従させ、`ALL_SOUNDS` / `sound_label` / `COOLDOWN_MS` は
  **variant を足すとコンパイルエラーになる**設計なので追加漏れを起こせない。
- ⚠ **`added` は「新規コメント」ではなく「`prev` に無い id」**（`mergeComments` の既知性質 Q-1）。下記 (2) で判断した。
- ⚠ **既知の二重計上**（043a 以前からの既存挙動）: Twitch のコミュニティギフト N 件は
  `community_sub_gift(total=N)` と個別 `sub_gift`×N の**両方**が届き、gift 行が **N+1 個**生成される。
  **ここでは解消せずクールダウンで凌ぐ**（下記 (3)）。

## このタスクでやったこと

### (1) 音は **Rust でトーン合成する**（`Monetary` variant を 1 つ足すだけ）

| 音 | 周波数 | 長さ | 減衰時定数 |
| --- | --- | --- | --- |
| `Test`（058a） | 880 Hz (A5) | 180 ms | 60 ms |
| `Comment`（059a） | 660 Hz (E5) | 140 ms | 23 ms |
| **`Monetary`（059b）** | **440 Hz (A4)** | **300 ms** | **90 ms** |

**3 音を続けて鳴らしても聞き分けられる**ことが唯一の設計目標で、そのために**音高・長さ・余韻の 3 軸すべて**で離した。

- **音高**: A4 は Test のちょうど 1 オクターブ下・Comment の完全 5 度下。3 音が別のレジスタに並ぶ。
  低いほうへ外したのは「軽い通知」ではなく「重み」として聞こえるため。
- **長さ**: Comment の 2.1 倍。音高を聞き取れなくても「短い打点」対「長く伸びる 1 音」で判別できる。
- **余韻**: Comment(23ms) の約 4 倍。Comment が「ポッ」ならこちらは「ポーン」と残る。

⚠ **倍音は足していない。** 重みの和を 1 以下にすれば `every_sound_never_clips` は保てるが、
`every_sound_decays_with_its_declared_time_constant` が「1 周期窓の最大値 ≒ 包絡」という前提で下限 0.90 を
切っているため、**倍音の位相干渉で下振れしてレッドになりうる**。1 音足すために契約テストの許容帯を緩めるのは
順序が逆。**再修正トリガー＝実機で「区別はつくが安っぽい」と感じたとき**（倍音とテスト側の前提をセットで見直す）。

⚠ **「区別できる」はテストで担保できない**ので、実機確認の項目にしてある（下記 ①）。
既存の波形不変条件テスト 5 本は `ALL_SOUNDS` に 1 つ足すだけで自動適用される（新規テストは追加していない）。

### (2) 課金判定と発火（`CommentViewerApp` の `playBatchNotification`）

⚠ **`playCommentNotification` から改名した。** 2 音のどちらを鳴らすかを決める関数になったので、
旧名だと「コメント音を鳴らす関数」に読め、**この関数の一番大事な責務（排他）が名前から消える**。

#### ⚠⚠ 課金判定に使う述語 —— **`isMonetaryEvent(c.eventType)`**

旧版の申し送り（「表示側と同じ `displayEventType` を使うこと」）に**そのまま従うとビッツで鳴らない**。
3 案を実コードで検証した:

| ケース（届く値） | **採用**: `isMonetaryEvent(c.eventType)` | `displayEventType(c) !== "chat"` | `isMonetaryEvent(displayEventType(c))` |
| --- | --- | --- | --- |
| **ビッツ** `eventType:"superchat"` + `currency:"BITS"` | `superchat` ∈ SET → **true ✅** | `"bits"` ≠ chat → true ✅ | `"bits"` ∉ SET → **false ❌ 鳴らない** |
| スパチャ `eventType:"superchat"` + JPY | true ✅ | true ✅ | true ✅ |
| **未知種別**（上流が `raid` 等を足したとき） | false（コメント音）✅ | **true ❌ 投げ銭音が誤爆** | false ✅ |
| 通常 chat | false ✅ | false ✅ | false ✅ |

**採用理由**:

1. `MONETARY_EVENT_TYPES` の JSDoc が「ビッツは event_type=superchat（currency=BITS）で届くため
   **superchat に含まれる**」と明記しているとおり、`isMonetaryEvent` は**生の `eventType` に適用する前提**の述語。
   `displayEventType` の出力（表示ラベル用の語彙）を食わせるのは**カテゴリエラー**。
2. **「判定を 2 実装に分裂させない」を実際に満たす唯一の案。** 本番の既存呼び出しは
   `isMonetaryEvent(c.eventType)` が **4 か所**（`CommentViewerApp` の読み上げ優先キュー〔049〕/
   `monetaryFeed`〔047〕/ `CommentList` の本体一覧〔043b〕/ `PinnedCommentBar`）。
   `displayEventType(c) !== "chat"` に一致するのは `CommentList` のオーバーレイ〔043c〕**1 か所だけ**。
   `MONETARY_EVENT_TYPES` に種別が増えたとき自動追従するのも採用案だけ。
3. オーバーレイの「chat 以外は課金カードで描く」は**見た目が違うだけの安全な劣化**だが、
   音で同じことをすると**未知の種別に「投げ銭が来た」と嘘をつく**ことになり、劣化の向きが逆になる。

⚠ **旧版の申し送りは誤り**なので、本ファイルと [`docs/task-board.md`](../task-board.md) の両方で訂正した。
コード側にも「なぜ申し送りどおりにしないのか」を注記してある。

#### 排他（親 059 の決定）

- 課金が 1 件以上 → **投げ銭音だけ 1 回**／課金 0 件でコメントが 1 件以上 → **コメント音だけ 1 回**。
- ⚠ **排他は ON/OFF より先に効く**（本人決定・2026-08-04）。バッチの代表音を先に決め、**その音の ON/OFF だけ**を見る。
  ＝課金 1 件＋通常 5 件のバッチで投げ銭音が OFF なら、コメント音へフォールバックせず**そのバッチは無音**。
  「投げ銭音を OFF にしたのにスパチャでコメント音が鳴る」を避けるため。sidecar は `comments.append` を
  1 件ずつ送るので混在バッチ自体が稀。**再修正トリガー＝実機で「スパチャのときだけ無音になるのが不便」と感じたとき。**
- ⚠ **`updated`（043e の combo 更新）では鳴らさない**／⚠ **1 バッチ 1 回**（059a の規律を維持）／
  ⚠ **未選択なら invoke しない**（fail-closed）／⚠ ON/OFF は音ごとに独立（`*Ref` 経由で読む既存作法）。

#### ⚠ `added` の既知性質 Q-1 —— **受容した**

`MAX_COMMENTS` のクランプで表示から落ちた jewels 行に後から combo 更新が届くと `added` に載るため、
排他判定を `added` の中身で行う 059b では「200 件前のスパチャの投げ銭音が鳴り直す」。受容した理由:

1. **鳴っても嘘ではない**——combo 更新は実際に追加のジュエルが贈られたイベントで、「200 件前」なのは
   表示行の話であって金銭の発生は今である。
2. 発生条件は「jewels の初報と combo 更新の間に 200 件流れる」で、043e が
   「combo 更新は数秒以内に届くため実運用では稀」と実測済み。
3. `ttsQueue.seenIds` 相当の Set を通知音のためだけに持つと、**無限に増える集合**を抱えるうえ、
   059a の冪等化（クールダウン）と防波堤が 2 系統になって「どちらが効いたか」が読めなくなる。

**再修正トリガー＝`MAX_COMMENTS` を大幅に下げる／combo 更新が数十秒後に届く実データを観測したとき。**

### (3) クールダウンと、Rust の「同時再生 1 本」への譲り

#### `monetary` のクールダウン＝**1500ms**（⚠ 旧版の「短くてよい」を反転）

1. **下限は Rust の占有時間で決まる。** 投げ銭音は 300ms ＋ `PLAYBACK_TAIL`(80ms) にデバイス再列挙・
   ストリーム open・ポーリング粒度が乗り、実占有は概ね **400〜550ms**。1500ms はその約 3 倍で、
   「クールダウンは通ったのに Rust に黙って捨てられる」帯に入らない。**実機で下げるときも 600ms は下回らないこと。**
2. **上限は「凌ぐ」対象で決まる（旧版と逆になる理由）。** Twitch のコミュニティギフトの N+1 件は
   600ms だと到着のばらつきで 2〜3 回鳴る。**1500ms なら 1 回に潰れる。**
   ⚠ **この依存はテストで明示的に固定した**（値を縮めるとレッドになる）。
3. **体験上の上限。** スパチャは連投されにくく、1.5 秒に 1 回鳴れば「見逃さない」目的は満たす。
   これ以上伸ばすと「別の視聴者からの 2 件目に気づけない」側が効き始める。
4. コメント音（600ms）とは**独立**なので、この 1500ms がコメント音を間引くことはない（逆も同様）。

#### ⚠⚠ クールダウンの独立だけでは「必ず鳴る」は成立しない（本タスクの一番の設計判断）

058a の `PLAYING` は音の種類に関係なく**全体で 1 本**で、競合した呼び出しを**鳴らさずに `Ok(())`** で返す
＝frontend からは `"played"` に見えて**検出できない**。コメント音の占有は 150〜350ms、コメント音が鳴りうる
最短間隔はクールダウンの 600ms なので、**コメントが流れ続けている配信では占有率 25〜58%**。
そこへスパチャが無相関に到着する＝**2〜4 回に 1 回、投げ銭音が黙って捨てられる**計算になる。

**採った対策＝飛行中の再生 Promise に連結する**（`notificationSound.ts` の `WAITS_FOR_IN_FLIGHT`）。

| 案 | 判定 | 理由 |
| --- | --- | --- |
| ① 受容して文書化 | 見送り | 25〜58% は「たまに」では済まず、本タスクの核心を諦めることになる |
| ② 固定遅延で 1 回だけ再試行 | 見送り | 成否が分からないので**盲目的**（成功していたら二重に鳴る）。Rust の占有時間を frontend が推測する二重管理になり、`PLAYBACK_TAIL` を変えると静かに壊れる |
| **③ 飛行中の Promise に連結** | **採用** | 推測ではなく **Rust が既に返している完了通知**を使う。`play_notification_sound` は鳴り終わってから resolve し、`PlaybackGuard` は `play_on_device` の末尾で drop される＝**IPC 応答より先に `PLAYING` が false になる**ので、待った先ではほぼ確実にガードを取れる（⚠ **「必ず」ではない**——レビュー S-2 で訂正。解決から再 invoke が Rust へ届くまでの窓に試聴／テスト再生や同時刻のコメント音が割り込めば取り損ねる。劣化先は 059a が受容済みの「黙って捨てられる」で fail-closed は壊れない）。上限は Rust 側（`PLAYBACK_GRACE` 1 秒）が持つので無限待ちにならない |

- ⚠ **`PLAYING` / `PlaybackGuard` は 1 行も触っていない**（レビュー必須条件が名指し）。上流で譲るだけ。
- ⚠ **`comment` は待たせない**（059a の挙動を変えない）。結果として「投げ銭音の再生中に来たコメント音は
  Rust に落とされうる」が、**落ちてよいのはコメント音の側**なので優先順が正しい向きに出る。
- ⚠ 連結先が解決した**同じマイクロタスク**で invoke が走るので、その隙間に別のコメント音が割り込む余地は無い
  （コメント受信は WS メッセージ＝マクロタスク）。
- ⚠ **設定画面の試聴／テスト再生はこの関数を通らない**ので追跡対象外（配信中の経路ではないので受容）。

### (4) 設定（`soundPrefs.ts` / `SettingsView.tsx`）

- **`sound-monetary-enabled`（既定 OFF）の 1 キーだけ**。既定 OFF の理由は 059a と同じ
  （アップデート直後にユーザー操作ゼロで音が鳴り始めるのを避ける）。
  ⚠ **コメント音と別キー**にしたのは、「コメント音は要らないが投げ銭だけは気づきたい」が
  一番ありそうな使い方だから。
- **「通知音」カードにトグル＋説明＋試聴を 1 組追加**（054 の規則どおり・**既存クラスのみ＝CSS 差分ゼロ**）。
- ⚠ **試聴の state（`soundPreviewState`）は 2 音で共有する。** 059a が `audioTestState` と分けた理由は
  **別カードだから**であって、こちらは同じカード・同じデバイス・同じ復旧手順＝失敗の案内文が音種で変わらない。
  むしろ共有だと**片方の再生中はもう片方も disabled** になり、**Rust の同時再生 1 本と一致する**
  （分けると再生中にもう片方を押せてしまい、Rust に黙って捨てられて「押したのに鳴らない」になる）。
- ⚠ **未選択の赤字は 2 音の OR で 1 本だけ**（同じ状態を 2 つの言葉で二重に叱らない。059a が 058a のカードと
  重複させなかったのと同じ判断）。文言は音種を名指ししていないのでそのまま流用した。
- ⚠ **試聴ボタンを「コメント音を試聴 ▶」「投げ銭音を試聴 ▶」へ改名した。** 3 つ目を足す前に改名したのは、
  ①どちらの音か画面から読めなくなる ②**034c の話者試聴ボタンも「試聴 ▶」で、実機では同じアクセシブル名が
  並んでいた**（既存の取り違えもここで解消した）。
- **ツールバーの継続表示 indicator のゲートを 2 音の OR に広げた。** 片方だけ ON の状態でデバイスを抜いたときに
  黙って鳴らなくなるのを防ぐ＝この indicator の存在理由そのもの。

### (5) テスト

| 対象 | 追加内容 |
| --- | --- |
| `notificationSound.test.ts` | `monetary` のクールダウン（1500ms・コメント音より長いこと）／**コメント音の直後の投げ銭音が鳴る**（両方向）／**飛行中 Promise への連結**（待つ・失敗でもチェインが切れない・`comment` は待たない） |
| `soundPrefs.test.ts` | 未保存 / 不正値 6 種 / 例外のフォールバック／往復／このキー以外を書かない／**2 キーが互いに干渉しない** |
| `CommentViewerApp.notificationSound.test.tsx` | 排他 3 ケース／**ビッツ**／課金 5 種別／**未知種別はコメント音**／`updated` 無音／排他が ON/OFF より先／ON/OFF の独立（両方向）／fail-closed／**N+1 ギフト**／indicator ゲートの OR／永続化・WS 非再接続／§9 |
| `SettingsView.audio.test.tsx` | 投げ銭トグル（既定 OFF・配線）／2 トグルの独立／**2 つの試聴が別ハンドラ**／未選択で両方 disabled／再生中は両方 disabled／赤字が OR かつ 1 本 |
| Rust | `ALL_SOUNDS` に 1 つ足すだけ＝**波形の不変条件テスト 5 本が自動で新しい音にも適用される** |

⚠ モックの位置と形は 059a と同じ（`notificationSound` を**記録専用 spy**にして実装は毎回 `actual` を呼ぶ・
`beforeEach` は `mockClear()`）。排他は**クールダウンより手前**で数える。

#### ⚠ 途中で見つけた 2 つの空振り（記録として残す）

1. **059a の「`updated` では鳴らさない」テストが空振りになっていた。** combo 再送を起こす種別は jewels だけで、
   jewels は課金＝059b 以降は**投げ銭音の経路**になる。059a のセットアップ（コメント音だけ ON）のままだと
   「投げ銭音が既定 OFF だから鳴らなかった」で緑になる。**両方の音を ON にする形へ書き直して 059b の describe へ移した。**
2. **N+1 ギフトのテストがクールダウン値に依存していなかった。** 6 バッチを連続して `receive` すると全部が
   同一 tick に入り、**クールダウンが 1ms でも 1 回に潰れて緑**になる（ミューテーション④で実測）。
   `Date.now` を差し替えて**到着の広がり（1 件 250ms・6 件で 1250ms）を再現**する形へ書き直した。

#### ミューテーションで実効性を確認（実施済み・2026-08-04）

| # | 変異 | 結果 |
| --- | --- | --- |
| ① | 排他の分岐を「両方鳴らす」に書き換え | **レッド 5 件** |
| ② | `COOLDOWN_MS` を共有カウンタに書き換え | **レッド 6 件** |
| ③ | 課金判定を `isMonetaryEvent(displayEventType(c))` へ | **レッド 1 件**（ビッツ） |
| ③b | 課金判定を `displayEventType(c) !== "chat"` へ | **レッド 1 件**（未知種別） |
| ④ | `monetary` のクールダウンを 300ms／600ms へ短縮 | **レッド 3 件／3 件** |
| ⑤ | 飛行中 Promise への連結を外す | **レッド 1 件** |
| ⑥ | `lastPlayback` を「置き換え」に戻す（レビュー Q-1 の修正前） | **レッド 1 件** |
| ⑦ | `playBatchNotification` の未選択ガードを削除（レビュー Q-2 の修正前） | **レッド 2 件** |

⚠ **④ の 600ms は当初「レッド 1 件」と記録していたが実測 3 件**（レビューでの再現時に訂正）。
落ちるのは `クールダウン内の 2 回目` / `コメント音より長い` / `N+1 ギフト` の 3 本で、**下限 600ms
ちょうどでも通らない**＝「600ms は下回らないこと」という注記より強い防御が実際には効いている。
⚠ **⑥⑦ はレビューで追加した固定**。修正前はどちらも**全件緑のまま通っていた**（＝空振り）。

## このタスクでやらないこと

- **金額による音の出し分け**（親 059 の決定で**一律 1 種類**）。金額ティアは [061](061-obs-effects.md) のエフェクト側。
  ⚠ **再修正トリガー＝「高額だけ別の音にしたい」と言われたら**、`monetaryTone()`（既存のティア判定）を
  音にも使う形で拡張する（`NotificationSound` の variant がティアぶん増えるので security-review が要る）。
- **課金判定そのものの変更**（`MONETARY_EVENT_TYPES` は触らない）。
- **Twitch コミュニティギフトの二重計上の解消**（043a から残る既存課題。ここでは凌ぐだけ）。
- **出力デバイスの選択・列挙**（058a）。`audioOutputApi.ts` / `audioOutputPrefs.ts` は無改変。
- **同時再生 1 本の上限の変更**（外さない・緩めない）。
- **音量**（キーを作らない。振幅は `PEAK_AMPLITUDE` 固定＝別タスク）。
- **「配信に載せる」トグル**（②-軽では成立しない）。
- **読み上げ（VOICEVOX）の変更**。`ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` は**差分ゼロ**。
- 視覚エフェクト（[061](061-obs-effects.md)）／ユーザーが音源ファイルを差し替える機能（将来タスク）／新規依存。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。`csp: null` 不変・capability 追加ゼロ・`tauri.conf.json` / sidecar / 依存は**差分ゼロ**。
- 音を指定する経路は `NotificationSound` enum のみ（§3 / §4 追補）。⚠ **`Monetary` はペイロードなしの unit variant**。
  パス・バイト列・URL を渡せる形にしない。
- **既定デバイスへのフォールバックを作らない**（fail-closed）。未選択なら invoke しない。**4 経路すべてで守る**
  （コメント音・投げ銭音・コメント音試聴・投げ銭音試聴）。
- **入力デバイス（マイク）に触れない**。`audio` の契約テストを 1 本も緩めない。
- 追加した localStorage キーは**ユーザー自身の UI 設定値**（bool 1 つ）＝§9 追補（046a）の対象外。
  ⚠ **投げ銭の金額・投稿者名・コメント本文を保存しない・ログに出さない・画面の警告文に出さない**（鳴らすのに要らない）。
- `src-tauri/src/audio/` に `unwrap()` / `expect()` を持ち込まない。
- ⚠ **`docs/security.md` は §4 追補〈058a〉の 1 行のみ更新した**（鳴らせる音の列挙を 2 音→3 音へ事実追随。
  ポリシー・レビュー必須条件は無改変）。

## 完了条件

- 課金コメントで投げ銭音が鳴り、通常コメントではコメント音が鳴る。**混在バッチでは投げ銭音だけ**鳴る。
- **ビッツでも投げ銭音が鳴る**（`isMonetaryEvent(c.eventType)` を採ったことの帰結）。
- クールダウンが**音源 ID ごとに独立**していて、かつ**コメントが流れている最中のスパチャでも必ず鳴る**
  （＝Rust の同時再生 1 本にも譲る）。
- `updated`（Jewels combo）では鳴らない。**N+1 ギフトで鳴りっぱなしにならない。**
- 設定ビューで投げ銭音の ON/OFF と試聴ができる。**既定は OFF。** ON/OFF は 2 音で独立。
- **3 つの音が実機で聞き分けられる**（耳で確認・本人の手番）。
- 音が**アプリ内合成**であることが [`docs/progress.md`](../progress.md) に記録されている（ライセンス確認は対象外）。
- 新規テストが通り、**ミューテーションで実効性を確認**している。
- **依存 / capabilities / `tauri.conf.json` / sidecar / CSS は差分ゼロ**・`csp: null` 不変。
  `ttsQueue.ts` / `voicevox.ts` / `voicevoxPreview.ts` / `audioOutput*.ts` / `viewerFormat.ts` /
  `mergeComments.ts` / `CommentList.tsx` も差分ゼロ。
- `cargo check` / `cargo test` / `typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # ts-rs bindings がここで出る
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/capabilities/ apps/desktop/src-tauri/tauri.conf.json \
  apps/comment-sidecar/ .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock \
  apps/desktop/package.json pnpm-lock.yaml package.json
# 読み上げ経路・058a の面・課金判定を触っていないことの担保（差分ゼロが期待）
git status --short -- apps/desktop/src/features/comment-viewer/ttsQueue.ts \
  apps/desktop/src/features/comment-viewer/voicevox.ts \
  apps/desktop/src/features/comment-viewer/voicevoxPreview.ts \
  apps/desktop/src/features/comment-viewer/audioOutputApi.ts \
  apps/desktop/src/features/comment-viewer/audioOutputPrefs.ts \
  apps/desktop/src/screens/comment-viewer/viewerFormat.ts \
  apps/desktop/src/screens/comment-viewer/CommentList.tsx \
  apps/desktop/src/features/comment-viewer/mergeComments.ts \
  apps/desktop/src/screens/comment-viewer/CommentViewerApp.module.css
# 契約テストが緩んでいないことの担保（削除行を目視。⚠ 期待は 4 行だけ＝doc コメント 2 行 ＋ ALL_SOUNDS 2 行）
git diff -- apps/desktop/src-tauri/src/audio/service.rs | grep "^-"
# PLAYING / PlaybackGuard / find_output_device が無改変であることの担保
git diff -U0 -- apps/desktop/src-tauri/src/audio/service.rs \
  | grep -E "^[+-].*(PLAYING|PlaybackGuard|find_output_device|is_selectable_device_id)"
# panic 経路が無いことの担保（⚠ ヒットする 2 件は 058a 由来の doc コメントと #[cfg(test)] 内）
grep -rn "unwrap()\|\.expect(" apps/desktop/src-tauri/src/audio/ || echo "OK: panic 経路無し"

pnpm --filter ./apps/desktop tauri dev
# ① 「通知音」カードに投げ銭音の ON/OFF と試聴が並ぶ（既定 OFF）／テスト再生 ▶ → コメント音を試聴 ▶ →
#    投げ銭音を試聴 ▶ を続けて鳴らし、**3 音を聞き分けられる**
# ⚠⚠ 2026-09-05 訂正（投げ銭頻度の削減）: 以下の周期は**旧周期**。投げ銭は seq % 20 === 0 の 1 枠だけに
#    集約され（20 件に 1 件・種別は周ごとのローテーション）、seq%5===0 と seq%20===11 はもう投げ銭ではない。
#    ⇒ ②は「seq=20（約 36 秒後）の 1 件目の投げ銭」、④のビッツは Twitch 単独接続の seq=20 で出る。
#    周期表は apps/comment-sidecar/src/dev-mock.ts の makeComment 冒頭が正。
# ② dev-mock でスパチャを流す（YouTube・seq % 5 === 0）→ 投げ銭音が鳴り、コメント音は鳴らない
# ③ 通常コメントを流し続けている最中にスパチャを差し込む → **必ず投げ銭音が鳴る**（(3) の連結が効いているか）
# ④ **ビッツ**（Twitch・seq % 20 === 11 / seq % 5 === 0）で投げ銭音が鳴る
# ⑤ dev-mock の Jewels combo（YouTube・seq % 20 === 12 ＝同一 id 再送）ではどちらも鳴らない
# ⑥ Twitch のコミュニティギフト（N+1 件）で鳴りっぱなしにならない
# ⑦ 片方だけ ON にしたとき、もう片方が鳴らない
# ⑧ デバイスを抜く → 継続表示 indicator が出る／選び直す・どちらかの試聴が成功すると畳まれる
#    （**投げ銭音だけ ON の状態でも indicator が出ること**を含む）
# ⑨ ライト／ダーク両テーマで設定 UI が破綻しない
```

## 実装後に必要なレビュー

**⚠ security-review 必須**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）**＋品質レビュー。**

理由＝`NotificationSound::Monetary` の追加は `src-tauri/src/audio/` の本番コードに差分が出る変更で、
[`docs/security.md`](../security.md) の「レビュー必須条件」の
**「`src-tauri/src/audio/` の本番コードに差分が出る変更は下位条件に当たらなくても該当する」**にそのまま当たる
（059a のレビューでこの判定基準が是正された）。**この区分は着手時点で確定済みで、論点にしない。**

下位条件 5 つは「**何に触れていないか**」のチェックリストとして使う:

| 下位条件 | 該当 | 根拠 |
| --- | --- | --- |
| 列挙対象を**出力デバイス以外へ広げる**（＝マイクに触れる） | **✕** | `list_output_devices` 差分ゼロ。`never_touches_input_devices` も無改変 |
| 再生できる音を **enum 以外**（パス・バイト列・URL）で指定できるようにする | **✕** | 指定経路は `NotificationSound` のまま。`accepts_no_file_path_from_the_frontend` 無改変 |
| **既定デバイスへフォールバックする**向きの変更 | **✕** | `find_output_device` 差分ゼロ。frontend も 4 経路すべてで未選択なら呼ばない |
| **同時再生の上限を外す・緩める** | **✕** | `PLAYING` / `PlaybackGuard` / `only_one_playback_runs_at_a_time` すべて無改変（**上流で譲るだけ**） |
| `NotificationSound` の variant に**ペイロードを持たせる** | **✕** | `Monetary` は unit variant |

レビューで必ず確認すること:
①`audio` の契約テストが 1 本も緩んでいない（`git diff` の削除行が 4 行だけであることを実測）
②`PLAYING` / `PlaybackGuard` が無改変
③`Monetary` が unit variant のまま
④fail-closed が **4 経路**（コメント音・投げ銭音・両試聴）すべてで守られている
⑤§9（投げ銭の金額・投稿者名・本文を保存もログも画面表示もしない）。
