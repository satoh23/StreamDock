# 067 配信先ごとの映像・コメント出し分け（Twitch / YouTube 同時配信・親／設計・方針確定）

> 状態: ⛔ **撤回（2026-09-12）。実装はすべて削除済み。**
> ⚠⚠⚠ **本ファイルの §1〜§24 は「やろうとしたこと」の記録であって、実装の指示ではない。**
> 撤回の理由・残したもの・再検討の条件は **[§25](#25-撤回2026-09-12)** が正で、**先にそこを読むこと**。
> ⚠ 段 0（[067s](067s-branch-output-spike.md)）の実測だけは**事実として生きている**（OBS の挙動そのものなので）。
> ⚠⚠ 代わりに提供するもの＝**コメント一覧に出す配信元をユーザーが選ぶ**（§25-6）。実装は 067a の
> `overlayCommentFilter.ts` に残してある。
> ⚠⚠⚠ **実機に後始末が残っている**（keychain 2 本／OBS の 3 ソース／**平文の配信キー 4 箇所**／
> **配信キーの再生成**）。コードは消えたが**書き込んだものは消えていない**——手順は **[§25-7b](#25-7b--実機に残るものコードは消えたが書き込んだものは消えていない)**。
>
> **必読前提**:
> [044s](044s-obs-websocket-spike.md)（⚠ **方式 B＝ブラウザソースを実測で落とした記録**・本タスクの要望⑥に直結）／
> [044a](044a-obs-auto-source-impl.md)（obs-websocket 連携の実装本体）／
> [046d](046d-pinned-overlay-obs-auto-add.md)（オーバーレイ種別の allow-list 化）／
> [061k](061k-stage-overlay-window.md)（4 窓目を足したときの手順の先例）／
> [066](066-chat-send.md)（⚠ **スコープ拡大と「書き込み」の姿勢**・チケット機構の 3 例目）／
> [`docs/security.md`](../security.md) の **§1（外部通信）・§4（Shell 実行）・§5（ファイル操作）・§9（機密のログ/保存）・§10（依存）**
> ＋「レビュー必須条件」。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。
> ⚠ **外部仕様の調査日は 2026-09-08〜09**（⚠ **Twitch ToS §11 は 2026-09-09 に本文を直接確認済み**）。プラットフォーム規約と OBS/プラグインのバージョンは**動く**ので、
> 着手時に「一次ソース」節の全項目を**引き直してから**実装すること。

---

## ⚠⚠⚠ 結論（先に書く）

| 問い | 答え |
|---|---|
| Plugin なしで「配信先ごとに違う映像」を同時配信できるか | ❌ **できない**（OBS 32.2.1／2026-07-24 時点でも stream output は 1 本きり） |
| Branch Output で「共通 Base を参照する Twitch 用 / YouTube 用シーンを別 RTMP で同時配信」できるか | ✅ **できる**。⚠ **プラグインの README_ja が本要件を名指しで用例に挙げている**（後述） |
| StreamDock から**設定まで**自動化できるか | ✅ **できる**。Branch Output の設定は**まるごとフィルタ設定（obs_data）**なので、obs-websocket の汎用 `CreateSourceFilter` / `SetSourceFilterSettings` / `SetSourceFilterEnabled` だけで完結する（⚠ **専用 API は要らない**） |
| StreamDock から**プラグインの導入まで**自動化するか | ❌ **MVP ではやらない**。§5「登録された外部アプリの設定ファイルを勝手に上書きしない／任意パスへの書き込み禁止」に**真正面から当たる**（OBS の plugin ディレクトリへ書く行為）。⇒ **MVP は「導入判定＋案内」まで**。DL＋SHA-256 照合は**段 4**（[19](#19-実装ステップimplementation-steps)）。⚠ **インストーラの実行は常にユーザー** |
| 出力の稼働状態を obs-websocket で取れるか | ❌ **取れない**（Branch Output に obs-websocket vendor API は無い＝ソース実測）。⇒ **プラットフォーム API で「実際に配信中か」を見る**（既存の宛先・既存スコープで足りる） |

**採用（MVP）＝ C＋A**: ユーザーに **Branch Output を 1 回だけ導入してもらい**、
**シーン・ソース・フィルタ・RTMP 設定・開始/停止は全部 StreamDock が obs-websocket でやる**。
**長期＝ D**（StreamDock 専用 OBS プラグイン）。**B（自動導入）は C の上に後から足せる**（順序を逆にしない）。

---

## 1. 背景（Background）

- StreamDock は既に **Twitch / YouTube のコメントを同時取得して 1 つのリストにマージ表示**できる（[035](035-simultaneous-youtube-twitch-comments.md)・実装済み）。
  ⇒ 要望のうち **「アプリ内で統合して配信者本人が閲覧できる」は既に満たしている**（本タスクの新規実装対象ではない）。
- OBS への表示は **透過オーバーレイ窓 → OBS のウィンドウキャプチャ**で行っている（[033f](033f-obs-transparent-overlay.md) / [044a](044a-obs-auto-source-impl.md)）。
  現在 OBS に自動追加できる窓は 3 種（`comments` / `pinned` / `stage`）。
- ⚠ **いま OBS に出しているコメントオーバーレイは「取得中の全プラットフォーム混在」**である
  （[035b](035b-viewer-overlay-simultaneous-display.md)＝viewer もオーバーレイも mixed 表示）。
  ⇒ **Twitch と YouTube へ同時配信すると、Twitch の配信画面に YouTube のコメントが載る。**

## 2. 問題（Problem）

### 2-1. 規約（⚠ 本タスクの存在理由）

⚠⚠⚠ **一次ソースを直接確認した（2026-09-09・`legal.twitch.com` の Terms of Service 本文・Last modified 08/12/2026）。**
**§11 Simulcasting** の 3 条件のうち 3 番目は、**現在もこの文言のまま**である:

> You do not use **third-party services that combine activity from other platforms or services on your Twitch stream**
> during your Simulcast, **such as merging chat** or other features, to ensure the Twitch community is included in the
> entirety of the experience of your livestream.

（他 2 条件＝①Twitch 視聴者の体験が他サービス以上であること ②他サービスの同時配信へ誘導しないこと）

⚠⚠ **2026 年 2 月に Twitch は「統合チャットの画面表示にエンフォースを行わない」と述べた**（3 月以降ペナルティ停止と報じられている）。
⚠⚠⚠ **しかし ToS はその後 2026-08-12 に改訂されており、それでもこの条文は残っている**
（＝「まだ更新が追いついていない」ではなく、**改訂の機会があったうえで文言が維持された**）。
⇒ **StreamDock は成文に従う**（発言・報道と契約書が食い違うときは契約書を採る）。
⚠ StreamDock は**配信者に規約違反をさせうる道具**なので、判断は「エンフォースされるか」ではなく「契約に違反しないか」で行う。
⇒ ⚠ **この判断が変わる条件**＝ Twitch の Simulcasting Guidelines / ToS §11 の**本文**が改訂されたとき。
そのときも「解禁する」ではなく「[15. 規約違反防止ロジック](#15-規約違反防止ロジックpolicy-enforcement)の表を変えて `security-review` を通す」手順を踏む。

### 2-2. 技術

やりたいことは「**ほぼ同じシーンを、配信先によって最終合成だけ分岐させる**」だが、
**OBS 本体は同時に 1 つの配信サービスへしか送れない**（Multitrack Video は「同一宛先への複数画質」で別物）。
⇒ **プラグインが要る**、というのが出発点。

### 2-3. UX

配信者に **OBS のシーン / Branch Output / RTMP / ストリームキー**という語を見せたくない。
理想は「☑Twitch ☑YouTube → [配信開始]」の 2 クリック。

## 3. 目的（Goal）

1. **Twitch 出力＝Twitch コメントのみ／YouTube 出力＝Twitch＋YouTube コメント**、を **StreamDock が自動で構成する**。
2. 配信者は StreamDock で**配信先を選んで「配信開始」を押すだけ**。OBS の概念を見せない。
3. **規約違反の構成を、UI だけでなく「作れない構造」として禁止する**（fail-closed）。
4. **配信キーを平文で SQLite / localStorage / ログに置かない**。

## 4. やらないこと（Non-Goals）

- ❌ **プラグインの StreamDock 同梱・サイレントインストール**（§5・GPL-2.0 の再配布義務。⇒ [9-B](#9-b-方式-bstreamdock-がプラグインを自動導入する)）。
- ❌ **StreamDock 側での再エンコード・映像合成**（[9-E](#9-e-方式-eplugin-なしで実現する)）。
- ❌ **配信の予約・タイトル/カテゴリ設定・サムネイル**（＝配信そのものの管理。別タスク）。
- ❌ **OBS のシーン切り替えを配信者が自由に行える運用**（MVP は「ベースシーン 1 枚」。理由は [12](#12-obs-シーン構成)／将来は [10-2](#10-2-長期に採用すべき方式)）。
- ❌ **3 プラットフォーム目（Kick 等）**。ただし表は 2 個に決め打ちしない（[15](#15-規約違反防止ロジックpolicy-enforcement)）。
- ❌ **OBS の設定ファイル（`service.json` / `outputStatusDock.json` / シーンコレクション JSON）を StreamDock が直接書くこと**（§5）。
  ⚠ **obs-websocket 経由で OBS 自身に書かせるのは可**（044a からの既定路線）。
- ❌ **Twitch / YouTube の配信キーを API で自動取得すること**（MVP。理由は [18-3](#18-3-配信キーの入手経路mvp-は手入力)）。

---

## 5. 現在の StreamDock 実装の調査結果（実コード・2026-09-08〜09）

### 5-1. OBS 連携（[`apps/comment-sidecar/src/obs/obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts)）

| 事実 | 実装場所 | 本タスクへの含意 |
|---|---|---|
| obs-websocket v5 で **オンデマンド接続**（enable のたびに connect → 操作 → disconnect）。常時接続は張らない | `createObsClient` | ⚠ **配信中は状態監視が要るので、ここは常時接続 or 定期ポーリングへ変える必要がある**（[17](#17-エラーリカバリerror--recovery)） |
| 宛先は **`ws://127.0.0.1:<port>` にホストピン留め**＋接続直前に `assertAllowedObsUrl()`（fail-closed 二層） | `obs-client.ts` ／ [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) | **そのまま流用する**（新しい宛先ガードを発明しない） |
| ポートは **read-only 検出**（OBS の `plugin_config/obs-websocket/config.json` を読むだけ・**書かない**・`server_password` は読まない） | [`src-tauri/src/obs_config.rs`](../../apps/desktop/src-tauri/src/obs_config.rs) | `auth_required` も取れる ⇒ [18-4](#18-4-obs-websocket-の認証を必須にする決定) の前提になる |
| パスワードは **keychain 保存＋sidecar へ stdin private pipe**（loopback WS に載せない・非ログ） | `set_obs_websocket_password`（`lib.rs`）／`comment_sidecar::set_obs_password` | ⚠⚠ **配信キーはこの経路を 1 対 1 で真似る**（[18-2](#18-2-配信キーの取り回し既存の-obs-パスワード経路を-1-対-1-で真似る)） |
| 既にできる OBS 操作 | `GetSceneList` / `GetInputList` / `CreateInput` / `SetInputSettings` / `GetInputPropertiesListPropertyItems` / `GetSceneItemId` / `SetSceneItemEnabled` | **シーン作成・シーンのネスト・フィルタ操作は未実装**（本タスクで足す） |
| **ソースの作成先は「現在のプログラムシーン」固定** | `ensureOverlaySource` の `currentProgramSceneName` | ⚠ **本タスクで「StreamDock が作ったシーンへ入れる」に変える必要がある**（既存挙動の変更＝回帰注意） |

### 5-2. オーバーレイ窓（Rust）

- `open_comment_overlay_window` / `open_pinned_overlay_window` / `open_stage_overlay_window`（[`src-tauri/src/lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)）。
  透過・装飾なし・**最背面**・非フォーカス・`background_throttling(Disabled)`・`SHARED_BROWSER_ARGS`（Windows の occlusion 対策）。
- ⚠⚠ **窓タイトルは Rust と sidecar の「バイト一致契約」**で、`#[cfg(test)] mod overlay_window_contract` が
  `include_str!` で TS 側を読んで総当たり検証している。
  **⚠ 候補一致は `includes` なので、窓タイトルは互いに部分文字列であってはならない。**
  ⇒ **4 本目の窓を足すときの手順は 061k が踏んだとおり**（`OVERLAY_TITLES` に 1 行 ＋ `OBS_OVERLAYS` に 1 行 ＋ capability JSON 1 枚 ＋ Rust コマンド 1 本 ＋
  `window_commands_used_by_the_frontend_are_registered` の下限を 1 上げる）。

### 5-3. コメントの取得・配送

- sidecar が **loopback WS サーバ**（未認証）で viewer / overlay 窓へ配る。**HTTP サーバは存在しない**。
- コメントは `CommentViewDto` に **`source: "twitch" | "youtube"`** を持っている（[`bindings/CommentSource.ts`](../../apps/desktop/src/features/comment-viewer/bindings/CommentSource.ts)）。
  ⇒ ⚠ **プラットフォーム別の絞り込みは「新しい情報」を要さない**（表示側で捨てるだけ）。
- **先例がある**: [035c](035c-tts-source-filter.md) が `speak-twitch` / `speak-youtube` の 2 キーで**読み上げだけを source 別に絞っている**
  （表示は絞らない）。⇒ 本タスクは**同じ考え方を「窓ごと」に適用する**。

### 5-4. 認証・秘密

- Twitch: Device Code OAuth・スコープは `user:read:chat` / `bits:read` / `user:write:chat` / `channel:read:redemptions`（[`twitch-config.ts`](../../apps/comment-sidecar/src/twitch-config.ts)）。
- YouTube: PKCE・スコープは **`youtube.readonly` のみ**（[`youtube-config.ts`](../../apps/comment-sidecar/src/youtube-config.ts)）。
- トークンは **OS キーチェーン**（Rust の `keyring` crate・provider 別 account）。sidecar は SEA なので native addon を持てず、**keychain の所有は Rust 側**。
  ⇒ **配信キーもこの持ち方に揃える**（[18-2](#18-2-配信キーの取り回し既存の-obs-パスワード経路を-1-対-1-で真似る)）。
- ⚠ **スコープを増やすと既存ユーザーは再ログインするまで新機能が効かない**（043a / 066 / 063e が 3 回踏んでいる）。
  ⇒ MVP で**新規スコープを増やさない**理由のひとつ。

### 5-5. 配信セッション

- [`features/stream-session/sessionBoundary.ts`](../../apps/desktop/src/features/stream-session/sessionBoundary.ts) に
  **`StreamPlatform = "twitch" | "youtube"`** と「配信の境界」判定が既にある（[062b](062b-stream-session-recording.md)）。
  ⇒ **新しいプラットフォーム型を作らない**（この型を使う）。

### 5-6. 画面構成

- main 窓のヘッダー導線は [`components/headerSections.ts`](../../apps/desktop/src/components/headerSections.ts) の `HEADER_SECTIONS` で決まる（現在「ツール管理」「OBSエフェクト」の 2 本）。
- **OBS 連携の設定 UI はコメビュ窓の `SettingsView` にある**（`SettingsView.obs.test.tsx`）。
  ⇒ 本タスクの「配信」画面は **main 窓に新設**するのが筋（[16](#16-ui--ux)）。

---

## 6. OBS 側の現状調査（一次ソース・2026-09-08〜09）

| 事実 | 出典 | 含意 |
|---|---|---|
| **OBS 32.2.1（2026-07-24）でも、1 つの OBS から異なる 2 サービスへ同時配信する機能は無い** | OBS 32.2 リリースノート（2026-07-21）／第三者検証 | **[9-E](#9-e-方式-eplugin-なしで実現する)（プラグインなし）は不成立** |
| Multitrack Video は **同一宛先への複数画質**（Twitch の Enhanced Broadcasting） | 同上 | 本要件とは無関係 |
| **Canvas（複数キャンバス）の内部 API は入っているが、プラグイン向け**。ユーザー向けの複数宛先機能ではない | OBS 32.2 リリースノート・PR #11833 | ⇒ **[9-D](#9-d-方式-dstreamdock-専用-obs-plugin-を作る)（自作プラグイン）の将来性を上げる材料** |
| obs-websocket は **RPC v1** ／ `CreateSourceFilter`(`sourceName`,`filterName`,`filterKind`,`filterSettings`) ／ `SetSourceFilterSettings` ／ `SetSourceFilterEnabled` ／ `CreateScene` ／ `CreateSceneItem` ／ `GetSceneItemList` ／ `SetSceneItemEnabled` ／ `CurrentProgramSceneChanged` イベント **すべて存在** | obs-websocket `protocol.md` | ⚠⚠ **フィルタ設定を外から書けることが本タスクの成立条件**。⇒ [9-A](#9-a-方式-abranch-output-を利用する) |
| `GetSceneList` は `canvasUuid` を受ける | 同上 | obs-websocket 側も Canvas に追随し始めている |

### 6-1. ⚠⚠ OBS 操作の自動化 — できること / できないこと（16 項目）

⚠ **すべて obs-websocket v5（RPC v1）＋ Branch Output 1.0.9 前提**。「△」は**条件つき**の意味で、条件を必ず書いてある。

| # | やりたいこと | 可否 | 手段 / 条件 |
|---|---|---|---|
| 1 | **OBS 接続** | ✅ | `ws://127.0.0.1:<検出ポート>`（既存 044a）。パスワードは stdin pipe |
| 2 | **Scene の存在確認** | ✅ | `GetSceneList` |
| 3 | **Scene 自動作成** | ✅ | `CreateScene`（⚠ 既存名なら作らない＝べき等） |
| 4 | **Base Scene 作成** | ❌ **やらない** | ⚠ **ユーザーの既存シーンを選ばせる**（配信の中身を StreamDock が作る筋合いが無い・§12） |
| 5 | **Twitch 出力 Scene 作成** | ✅ | `CreateScene` ＋ `CreateSceneItem`（ベースをネスト＋Twitch オーバーレイ） |
| 6 | **YouTube 出力 Scene 作成** | ✅ | 同上（＋統合オーバーレイ） |
| 7 | **Browser Source 自動追加** | ❌ **やらない** | ⚠ [044s](044s-obs-websocket-spike.md) が実測で落とした方式（§14-1）。**ウィンドウキャプチャを使う** |
| 8 | **Browser Source の URL 設定** | ❌ **やらない** | 同上（API 自体は `SetInputSettings` で可能だが採らない） |
| 9 | **Source の表示/非表示** | ✅ | `GetSceneItemId` → `SetSceneItemEnabled`（既存 044a） |
| 10 | **配信先ごとの Output 設定** | ✅ | ⚠⚠ **Branch Output のフィルタ設定として書ける**（`CreateSourceFilter` / `SetSourceFilterSettings`・§9-A-3） |
| 11 | **Twitch の RTMP 設定** | ✅ | 同上（`server` / `key`）。URL は**同梱の定数表**から（新規 egress を作らない） |
| 12 | **YouTube の RTMP 設定** | ✅ | 同上（`rtmps://a.rtmps.youtube.com:443/live2`） |
| 13 | **配信開始** | ✅ | ⚠ **`StartStream` ではない**。`SetSourceFilterEnabled(filterEnabled:true)`（§9-A-3） |
| 14 | **配信停止** | ✅ | `SetSourceFilterEnabled(filterEnabled:false)` |
| 15 | **Output の状態取得** | ❌ **取れない** | ⚠⚠⚠ **Branch Output に obs-websocket vendor API が無い**（実コードで確認）。`GetStreamStatus` は **OBS 本体の出力**しか見ない ⇒ **プラットフォーム API で「実際に配信中か」を見る**（§17） |
| 16 | **エラー表示** | △ | ⚠ obs-websocket の**要求単位のエラー**は取れる（作成失敗など）。**送出中のエラー（RTMP 切断）は取れない**（15 と同じ理由）⇒ 15 と同じ手段で補う |

**補足（自動化できない周辺）**:
- ❌ **obs-websocket サーバーの有効化**（OBS 側の設定）… §5 により StreamDock は OBS の設定ファイルを書かない ⇒ **手順を案内する**。
- ❌ **Branch Output の「インターロック」設定**… `outputStatusDock.json` に保存され obs-websocket から触れない（§9-A-3）。
- ❌ **プラグインのインストール**… §5（§9-B）。
- ❌ **OBS の起動・終了**… §6（自 spawn PID 限定）に反するので**やらない**。⚠ 起動誘導だけ行う。

---

## 7. 技術方式の候補（A〜E）

| 記号 | 方式 | 一言 |
|---|---|---|
| **A** | **Branch Output（OPENSPHERE-Inc）を使う** | フィルタ設定＝obs-websocket で全部書ける |
| **B** | **StreamDock がプラグインを自動導入する** | §5 に当たる。DL/検証まで止める |
| **C** | **ユーザーが 1 回だけ導入する（StreamDock は検出・案内・検証）** | **MVP** |
| **D** | **StreamDock 専用 OBS プラグインを作る** | 長期。§5 も GPL も「自分の問題」になる |
| **E** | **プラグインなしで実現する** | ❌ 不成立（縮退案のみ） |

⚠ **比較のために `obs-multi-rtmp` も同格で調べた**（[9-A-4](#9-a-4-対抗馬-obs-multi-rtmp-を落とした理由重要)）。

---

## 8. 比較表（Comparison）

⚠ 数値は**相対**。実測は 067s（スパイク）で埋める。

| 観点 | **A: Branch Output** | **B: 自動導入** | **C: 1 回だけ手動導入** | **D: 専用プラグイン** | **E: プラグインなし** |
|---|---|---|---|---|---|
| 映像の出し分け | ✅ シーン単位で可 | ＝A | ＝A | ✅ 完全に自由 | ❌ **不可** |
| 実装難易度（StreamDock 側） | 中（obs-websocket の呼び分けのみ） | **大**（DL/検証/権限/更新/rollback） | **小**（検出＋案内） | **特大**（C++/libobs・2 OS のビルドと署名） | 中〜大（どの縮退案でも） |
| 安定性 | 中（第三者プラグイン依存） | ＝A ＋ 導入失敗の面 | ＝A | 高（自分で直せる） | 低〜中 |
| GPU 負荷 | **+1 エンコード/出力**（シーン合成は増えるが軽い） | ＝A | ＝A | ＝A | 複数 OBS＝**2 倍** |
| CPU 負荷 | 同上 | ＝A | ＝A | ＝A | 再エンコード方式は**特大** |
| VRAM | +texrender 1 枚/出力 | ＝A | ＝A | ＝A | 複数 OBS＝2 倍 |
| 上り帯域 | **宛先ぶん線形**（不可避） | ＝A | ＝A | ＝A | ＝A |
| 配信遅延 | 影響ほぼ無し | ＝A | ＝A | ＝A | 再エンコード/NDI 経由は**増える** |
| OBS 互換性 | **OBS >= 30.1.0** 要 | ＝A | ＝A | 自分で追随 | — |
| Windows 導入 | 署名済み `.exe` インストーラ／`.zip` あり | UAC・書込権限 | **ユーザーが 1 回押すだけ** | 自前で署名が要る | — |
| macOS 対応 | `.pkg`（universal） | 管理者権限が要る | **ユーザーが 1 回押すだけ** | 自前で notarize が要る | — |
| 保守コスト | 中（上流追随） | **大** | 中 | **大** | 大 |
| プラグイン更新追従 | ⚠ **プラグイン自身の版は取れない**（[Q-3](#24-未解決open-questions)）＝OBS 版の互換だけ見る | 更新も面倒を見る | ＝A | 該当なし | 該当なし |
| **StreamDock からの自動操作** | ✅✅ **フィルタ設定＝obs_data なので obs-websocket で全部書ける** | ＝A | ＝A | ✅✅ 専用 IPC | — |
| `docs/security.md` への影響 | §1（RTMP egress）追補 | ⚠ **§5 の例外が要る**（2 例目） | §1 のみ | §1＋§4＋§10 | 方式による |

---

## 9. 各方式の詳細

### 9-A. 方式 A（Branch Output を利用する）

**リポジトリ**: `OPENSPHERE-Inc/branch-output`・**GPL-2.0**・最新 **1.0.9（2026-04-12）**・**OBS Studio >= 30.1.0（Qt6, x64/ARM64/AppleSilicon）**。
**配布物**: `osi-branch-output-1.0.9-macos-universal.pkg` ／ `...-windows-x64-Installer-signed.exe` ／ `...-windows-x64.zip` ／ `.deb` ／ source。
⚠ **リリースに `.sha256` 等のチェックサムファイルは無い**（あるのは GitHub のリリース署名のみ）。⇒ [18-5](#18-5-プラグイン配布物の検証)。

#### 9-A-1. ⚠⚠⚠ 本要件が README に名指しで載っている

`README_ja.md` の TIPS 2 に、**そのままの文で**こう書かれている:

> また、複数の配信用シーンを作成して、追加のソースを重ねれば、配信プラットフォームごとに内容を変更することができます。
> **例えば Twitch には Twitch のコメント、YouTube には YouTube のコメントを表示したい、という要件が該当します。**

⇒ **「できるか？」は解決済み**。以降は「**StreamDock からどこまで自動化できるか**」だけが論点。

#### 9-A-2. ⚠⚠ 非アクティブシーンでも配信する（＝本設計が成立する根拠）

- ソース `src/video/filter-video-capture.hpp` / `.cpp` に
  **「シーンが非アクティブのとき、親シーンを trigger-render してテクスチャを更新する」実装がある**（実コードで確認）。
- README も「Branch Output はシーンがアクティブでなくとも配信を行います」と明記。
- ⚠ **ただし `obs_source_inc_showing` / `inc_active` は呼んでいない**（実コード grep でヒット 0）。
  ⇒ **「非表示なら止まる」タイプのソース（ローカルメディアソース等）は非アクティブシーンで止まる**（README も明記）。
  ⇒ ✅ **067s S-1 で実測済み（2026-09-09）: `window_capture` は止まらない。**
  ⚠ ただし正確には「非アクティブでも動く」のではなく「**Branch Output が有効な間だけ trigger-render が回る**」。
  ⚠⚠ 出力を止めると**そのシーンのソースは止まる**（誰もレンダリングしないため）。これは正常な挙動。
  現時点の見立て＝ **止まらない可能性が高い**（`window_capture` は自前の tick/キャプチャスレッドで取り込むため）が、**断定しない**。

#### 9-A-3. ⚠⚠⚠ 設定は「フィルタ設定」なので obs-websocket で全部書ける（本方式の決定打）

`filterKind` は **`osi_branch_output`**（`src/plugin-main.cpp` の `#define FILTER_ID`）。
⚠ 下記は **067s（2026-09-09）で実機確認済み**の最小設定（当初のソース読みから 5 件訂正が入っている）:

```jsonc
// ✅ 2026-09-09 に実機で動作確認した最小設定（067s S-2/S-4）
{
  "streaming_enabled": true,          // グループ有効（既定 false）
  "service_count": 1,                 // ⚠ 既定値が無い。0 のままだと index 0 が無効扱いで何も出ない
  "server": "rtmp://live-tyo.twitch.tv/app",
  "key": "<stream key>",
  "streaming_output_enabled_0": true, // ⚠ 実測では既定 true。**既定に依存せず明示する**

  "recording_output_enabled": false,  // ⚠⚠⚠ 実測で**既定 true**。書かないと ~/Movies へ勝手に録画される
  "replay_buffer": false,
  "stream_recording": false,

  // ⚠⚠ シーンに付けたフィルタは「音声を持たない」ので、カスタム音声が必須（README 明記・実測でも確認）
  "custom_audio_source": true,        // ⚠⚠ これが無いと **mean -91dB＝完全な無音**になる
  "audio_source": "master_track",
  "audio_track": 1,                   // OBS の音声ミキサー トラック 1
  "audio_dest": "both"                // ⚠ 既定は "both"。"streaming" 決め打ちにしない
}
```

⚠ **`multitrack_audio` は 1.0.9 に存在しない**（当初の記述は誤り。067s で削除）。
⚠ **`video_encoder` の既定は `obs_x264`（ソフトウェア）**。指定しないと**出力 1 本あたり CPU が +50pt**（067s S-7）。

#### 9-A-3-b. ⚠⚠⚠ obs-websocket で作ったフィルタは、OBS を再起動するまで動かない（067s 実測）

`CreateSourceFilter` → 設定書込 → `SetSourceFilterEnabled(true)` としても**送出が始まらず、ログも出ない**。
**OBS を再起動すると、同じフィルタが起動直後に動き出す**（以後は enable/disable が正しく効く）。

⇒ **067c は「構築」と「配信開始」を別の操作に分ける**。
セットアップの最後は「**OBS を再起動してください**」で締める（⚠ プラグイン導入の再起動と**同じ 1 回で済む**）。
⚠ 副産物として、**`filterEnabled: false` は再起動をまたいで守られる**ことも実測できた
（再起動直後、有効だった側だけが自動開始し、無効の側は開始しなかった）。

⚠⚠ **開始/停止は `SetSourceFilterEnabled` で行う**（`streaming_output_enabled_0` ではない）。
理由＝ソース実測: `streamingUserEnabled[]` は**フィルタ生成時（コンストラクタ）とドックのチェックボックスからしか書かれない**ので、
あとから `SetSourceFilterSettings` で変えても**効かない**。
一方 `obs_source_enabled(filterSource)`（＝`SetSourceFilterEnabled`）は**毎 tick 評価される**。

⚠⚠⚠ **インターロック（「OBS 本体の配信に連動して開始」等）は obs-websocket から設定できない。**
ドックの設定で、`outputStatusDock.json`（プラグインの config パス）に保存されるため。
**既定は「Always On」**＝ **フィルタが有効かつ server が入っていれば、その瞬間から送信が始まる**。
⇒ **StreamDock の設計上の絶対条件**:
- **フィルタは必ず `filterEnabled: false` で作る**。
- **配信キーを書き込む操作と、有効化する操作を分ける**（キーを入れた瞬間に配信が始まってはならない）。
- ⚠ ユーザーがドックでインターロックを別の値にしていると `SetSourceFilterEnabled(true)` だけでは始まらない
  ⇒ **開始の成否はプラットフォーム側で確認する**（[17](#17-エラーリカバリerror--recovery)）。

#### 9-A-4. ⚠ 対抗馬 `obs-multi-rtmp` を落とした理由（重要）

`sorayuki/obs-multi-rtmp`（GPL-2.0・star 5045・2026-08 更新）も調べた。**出力ごとのシーン指定機能を持ち**、
`obs_view_create` ＋ **`obs_source_inc_active(scene)`** を呼ぶので **非アクティブシーンのソース停止問題が原理的に起きない**（実コードで確認）。
**技術的にはこちらの方が堅い。**

⚠⚠ **それでも落とす**。理由は 1 つ:
**設定がプラグイン自身の JSON（`SaveMultiOutputConfig`）に保存され、obs-websocket からも proc からも外部制御の口が無い**（実コード grep で `vendor` / `websocket` / `hotkey` いずれもヒット 0）。
⇒ StreamDock が自動設定するには **プラグインの設定ファイルを直接書く**しかなく、**§5 に当たる**。
⇒ 本タスクの目的は「配信者に OBS を触らせないこと」なので、**自動化できない方式は目的を満たさない**。

⚠ **再検討トリガー**＝ obs-multi-rtmp に obs-websocket vendor API が入ったとき／
Branch Output の非アクティブシーン問題が 067s で**実際に起きたとき**（そのときは A と天秤にかけ直す）。

### 9-B. 方式 B（StreamDock がプラグインを自動導入する）

**やるとしたら**: 公式リリース URL からの DL → ハッシュ照合 → OBS のインストール先検出 → plugin ディレクトリへ展開 → 版チェック → OBS 再起動誘導 → 更新 → アンインストール/ロールバック。

**⚠ 要素ごとの可否（依頼の候補リストへの答え）**:

| 要素 | 技術的に可能か | MVP でやるか | 備考 |
|---|---|---|---|
| インストーラの自動ダウンロード | ✅ | ⚠ **段 4** | Node の `fetch`（新規依存ゼロ）。宛先は固定 URL の allow-list |
| 公式配布物の取得（同梱ではなく DL） | ✅ | ⚠ **段 4** | ⚠ **同梱は GPL-2.0 の再配布 ⇒ 採らない** |
| checksum 検証 | ✅ | ⚠ **段 4** | ⚠ **公式にチェックサムファイルが無い** ⇒ 版ごとの SHA-256 を StreamDock に焼き込む（§18-5） |
| 署名検証 | △ | ❌ | Windows の Authenticode 検証は OS API が要る（`.exe` は署名済み）。macOS の `.pkg` は `pkgutil --check-signature`＝**外部コマンド実行（§4）** |
| OBS のインストール先検出 | △ | ❌ | ⚠ **やらない**。OBS には**聞ける**（`GetVersion`）ので、ファイルを探し回る必要が無い（§7） |
| plugin ディレクトリ検出 | △ | ❌ | OS 別の既定パスは既知だが、**書く予定が無いので検出しない** |
| plugin のインストール | ✅ | ❌ | ⚠⚠ **§5 に当たる**（下記 1.） |
| plugin の版チェック | ❌ | ❌ | ⚠ **obs-websocket から取る方法が見つかっていない**（[Q-3](#24-未解決open-questions)） |
| OBS 版の互換チェック | ✅ | ✅ | `GetVersion.obsVersion >= 30.1.0` |
| 導入状態の検出 | ✅ | ✅ | ✅ **`GetSourceFilterDefaultSettings("osi_branch_output")` が `code 607`**（067s S-5 で確定・⚠ **非破壊なので `CreateSourceFilter` を使わない**） |
| OBS 再起動の誘導 | ✅ | ✅ | ⚠ **文言だけ**。StreamDock は OBS を落とさない（§6） |
| plugin の更新 | ✅ | ❌ | 段 4 以降。⚠ **更新のたびに StreamDock のリリースが要る**（焼き込み SHA-256 のため） |
| アンインストール / rollback | ✅ | ❌ | 入れないので**戻す責任も負わない** |
| Windows の権限（UAC） | — | — | ⚠ インストーラを起動しないので**昇格しない** |
| macOS 対応 | — | — | 同上（`.pkg` はユーザーがダブルクリック） |

⚠⚠ **MVP では採らない**。理由:

1. **§5 に真正面から当たる**。§5 は「任意パスへの書き込み」「登録された外部アプリの設定ファイルを勝手に上書きする」を**禁止**しており、
   §5 の「### 例外」は **055d（StreamDock 自身の置換）1 件だけ**である。
   **他人のアプリのディレクトリへ書く例外は前例が無い**（＝新設するなら本タスク単体で `security-review` を通す重い判断になる）。
2. **GPL-2.0**。ダウンロードは再配布ではないので同梱よりは軽いが、**同梱は再配布**（ソース提供義務・ライセンス同梱）。
   ⇒ **同梱は採らない**。
3. **検証の質**。リリースに配布物のチェックサムファイルが無い（[9-A](#9-a-方式-abranch-output-を利用する)）。
   ⇒ StreamDock 側で**版ごとの SHA-256 を自分で焼き込む**しかない（[18-5](#18-5-プラグイン配布物の検証)）。**新版が出るたび StreamDock のリリースが要る**。
4. **権限**: Windows は Program Files 配下（**UAC**）、macOS は `.pkg`（**管理者権限**）。
   ⇒ 昇格が要る。055d は macOS の昇格に `osakit`/AppleScript を使う例外を既に持っているが、**あれは自分自身の置換**である。
5. **途中失敗の後始末**（半分展開された plugin ＝ OBS が起動しなくなる）まで面倒を見る必要がある。

⇒ **MVP（段 3 まで）は「導入判定 ＋ 公式リリースへの案内」だけ**。
⇒ **段 4（任意）で「DL ＋ SHA-256 照合まで StreamDock、インストーラの実行はユーザー」**（＝ C の強化版）へ進む。
⚠ **将来 B へ進むときも、`.zip` を展開して置くのではなく「公式インストーラを起動する」形を先に検討すること**
（署名済み `.exe` / `.pkg` を OS のインストーラに任せる＝ StreamDock が任意パスへ書かない）。

### 9-C. 方式 C（ユーザーに 1 回だけ導入してもらう）＝ **MVP 採用**

StreamDock がやること:

1. **導入済み判定**（⚠ ファイルを探しに行かない）: obs-websocket の `GetSourceFilterList` などで
   **`osi_branch_output` という filterKind が使えるか**を試し、失敗＝未導入と判定する（**read-only・OBS に聞くだけ**）。
   ✅ **067s S-5 で確定**: `GetSourceFilterDefaultSettings("osi_branch_output")` の **`code 607`** を根拠にする
   （⚠ **非破壊**。`CreateSourceFilter` は導入済み環境で成功してしまうので使わない）。
2. **バージョン確認**: `GetVersion` の `obsVersion` が **30.1.0 以上**か。
3. **案内**: 「OBS に 1 回だけ拡張を入れてください」＋ **公式リリース URL をコピー/ブラウザで開く**（既存の `tauri-plugin-opener` 経路・host 検証つき）。
4. **（⚠ 段 4・MVP には入れない）** **DL とハッシュ照合まで StreamDock が行い、ダウンロードフォルダに置いてから「これを実行してください」と出す**。
   ⚠ **StreamDock は実行しない**（§4：ユーザー入力を結合したコマンド実行はしない／ダウンロードした実行ファイルを起動しない）。
5. **OBS 再起動の誘導**（StreamDock は OBS を kill しない。§6 は自 spawn PID 限定）。

### 9-D. 方式 D（StreamDock 専用 OBS Plugin を作る）

**MVP では過剰**。ただし**長期では有力**。

| 良い点 | 悪い点 |
|---|---|
| §5 も GPL も「自分の問題」になる（同梱・自動導入が正当化しやすい） | **C++ / libobs**。この repo に C++ ビルドの土台が無い |
| StreamDock ⇔ OBS の**専用 IPC** が持てる（状態取得・開始/停止・エラー） | Windows / macOS の**ビルド・署名・notarize** を自前で持つ（[099a](099a-windows-code-signing.md) の話が 2 系統に増える） |
| **Canvas API**（OBS 32.x）を使えば、シーンのネストではなく**本物の別キャンバス**にできる | OBS のメジャー更新のたびに追随（プラグイン ABI は版で壊れる） |
| オーバーレイをウィンドウキャプチャ経由にせず**プラグイン内で直接描ける**（窓ゼロ） | 攻撃面が増える（OBS プロセス内で動くコード） |

⚠⚠ **A から D への移行は可能**、かつ**移行しやすい形で A を作れる**:
StreamDock 側の抽象を **「配信出力（`StreamOutput`）」**にして、`branch-output` は**その 1 実装**にする。
⇒ [13-1](#13-1-streamdock-の責務) の `outputDriver` 境界。

### 9-E. 方式 E（Plugin なしで実現する）

| 案 | 判定 | 理由 |
|---|---|---|
| OBS frontend API / Output API を obs-websocket から叩く | ❌ | **obs-websocket に「出力を作る」API は無い**。`StartStream` は設定済みサービス 1 本を開始するだけ |
| libobs を StreamDock から使う | ❌ | libobs をリンクする＝**実質プラグイン開発**（＝D）。しかも OBS 本体とは別プロセスになり GPU 資源を二重取りする |
| **複数 OBS インスタンス** | ❌ | GPU/CPU/VRAM がほぼ 2 倍。ゲームキャプチャ・音声デバイスの競合。**配信者の PC を壊しに行く** |
| **NDI / 仮想カメラで中間出力 → もう 1 本で再合成** | ❌ | 遅延と画質劣化。仮想カメラは**1 本しか無い**（OS 単一デバイス） |
| **StreamDock 側で再エンコード（FFmpeg）** | ❌ | ①CPU/GPU の二重消費 ②**FFmpeg の同梱＝§10 の重い依存追加とライセンス** ③配信の生命線を StreamDock のバグに乗せる |
| **OBS から clean feed を受けて StreamDock 側で合成** | ❌ | 同上＋合成品質が OBS に劣る |
| **Browser Source 単位の出し分け**（＝1 本の配信の中で切り替える） | ❌ | **同時配信ではない**。時間で切り替えるだけ |
| **縮退案: 1 プラットフォームずつ配信する** | ⚠ **これだけが唯一プラグイン無しで成立する** | Twitch 配信中は Twitch オーバーレイのみ表示。**同時配信はできない**が、**規約違反は起きない** |

⇒ ⚠⚠ **縮退案は「プラグイン未導入時のフォールバック」として実装する**（[17](#17-エラーリカバリerror--recovery) の「未導入」行）。
＝**プラグインが無い人でも、規約違反にならない状態で使える**ようにする。

#### ⚠⚠⚠ 実装時の訂正（2026-09-10）: 縮退モードは **OBS の設定を 1 バイトも書き換えない**

当初は `SetStreamServiceSettings`（配信サーバー・配信キー）を書いて `StartStream` を叩く想定だった。
**採らなかった**——それは **ユーザーが自分で OBS に入れた配信設定を上書きする破壊的操作**であり、
StreamDock が落ちれば元に戻せない（[R-8](#20-リスクrisks) 「勝手に構成を壊さない」）。
配信キーは OBS のシーンコレクション JSON に残るので、**他人のキーで上書きした痕跡も残る**。

⇒ **採った形**:

| StreamDock がやること | StreamDock がやらないこと |
|---|---|
| 規約に沿った出力シーンを作る（Twitch なら Twitch のコメントだけ） | ❌ OBS の配信サーバー / 配信キーの書き込み |
| 出力シーンを**番組シーン**にする | ❌ `StartStream` / `StopStream` |
| `GetStreamStatus.outputActive` で**動いているかを読む** | ❌ 配信キーを預かること（`needsStreamKey: false`） |

⚠ 開始は **OBS 本体の「配信開始」ボタンをユーザーが押す**。
⚠⚠ 皮肉だが、**状態は Branch Output より正確に取れる**（`GetStreamStatus` があるため）。
⚠ 実体は `apps/comment-sidecar/src/obs/output-driver.ts` の `OBS_NATIVE_DRIVER`。

---

## 10. 推奨アーキテクチャ（Recommended Architecture）

### 10-1. MVP で採用する方式

```
[ StreamDock main 窓「配信」画面 ]
   ☑ Twitch   ☑ YouTube      [ 配信開始 ]
        │
        │ invoke（配信キーは frontend を通らない）
        ▼
[ Rust ]  keychain（stream-key/twitch, stream-key/youtube）
        │  stdin private pipe（既存の OBS パスワードと同じ経路）
        ▼
[ Node sidecar ]  obs/obs-client.ts（＋新規 obs/stream-output.ts）
        │  ws://127.0.0.1:4455（assertAllowedObsUrl で fail-closed）
        ▼
[ OBS Studio ]
   │
   ├─ [ベースシーン]（⚠ ユーザーの既存シーン。StreamDock は作らない・中身を触らない）
   │      ├ ゲーム / 立ち絵 / 枠 / 共通オーバーレイ …
   │
   ├─ [StreamDock Twitch出力]  ← ⚠⚠ **これをプログラムシーンにする**
   │      ├ [ベースシーン]（ネスト参照）
   │      ├ ソース「StreamDock Twitchコメント」   ← Twitch のコメントだけ
   │      └ filter「StreamDock 配信出力」(osi_branch_output) → rtmp://live-tyo.twitch.tv/app
   │
   └─ [StreamDock YouTube出力]  ← 非アクティブ（Branch Output が trigger-render する）
          ├ [ベースシーン]（ネスト参照・⚠ Twitch 出力シーンと同じシーンを参照する）
          ├ ソース「StreamDock コメントオーバーレイ」← ⚠ 統合窓 1 本だけ（Twitch＋YouTube を 1 リストで描く）
          └ filter「StreamDock 配信出力」(osi_branch_output) → rtmps://a.rtmps.youtube.com:443/live2
```

⚠⚠ **オーバーレイ窓は出力シーン 1 枚につき 1 本だけ置く。** Twitch 出力＝Twitch 専用窓、YouTube 出力＝統合窓。
**両方を同じシーンに置くと Twitch のコメントが二重に出る**（統合窓が既に Twitch のコメントを含んでいるため）。
⇒ [14-3](#14-3-出力シーンとオーバーレイ窓の対応-1-対-1) が正。

⚠⚠⚠ **プログラムシーンを「Twitch 出力シーン」にするのが本設計の要点**。理由は 2 つ:

1. **fail-safe の向き**。配信者が誤って **OBS 本体の「配信開始」ボタン**を押しても、出て行くのは
   **Twitch に出してよい映像（部分集合）**である。逆（YouTube 側＝上位集合をプログラムにする）にすると、
   誤操作が**そのまま規約違反**になる。
2. **説明が単純**。「あなたが OBS で見ている画面＝ Twitch に出ている画面」と言い切れる。

⚠ **Twitch を選ばない（YouTube 単独）ときはプログラム＝YouTube 出力シーン**。＝**「最も制約の強い出力をプログラムにする」**という 1 つの規則で書ける。

### 10-2. 長期に採用すべき方式

| 段階 | 方式 | 引き金 |
|---|---|---|
| いま | **C＋A**（手動導入 ＋ Branch Output を obs-websocket で全自動設定） | — |
| 次 | **B'（半自動導入）**: StreamDock が DL＋SHA-256 照合し、**公式インストーラの実行だけユーザー** | 「導入が難しい」という実ユーザーの声が出たとき |
| 次 | **シーン切り替えの解禁** | ✅ **条件を満たした**（067s S-1 で確認済み・2026-09-09） |
| 長期 | **D（StreamDock 専用プラグイン）** | ①Branch Output が更新を止めた ②OBS の Canvas API が安定して外から使える ③配信機能が StreamDock の主機能になった |

⚠ **A→D の移行コストを下げるため、MVP の時点で `outputDriver` の境界を切っておく**（[13-1](#13-1-streamdock-の責務)）。

### 10-3. 優先順位（依頼者の問い A〜E への答え）

**C ＞ A ＞ B ＞ D ＞ E**
（C と A は同時採用＝「1 回だけ入れてもらい、あとは全部自動」。B は C の後段。D は長期。E は縮退用途のみ）

---

## 11. データフロー（Data Flow）

```
Twitch EventSub ─┐
                 ├→ sidecar（既存・取得）→ loopback WS ─┬→ コメビュ窓（統合表示・既存）
YouTube LiveChat ┘                                      ├→ 「StreamDock コメントオーバーレイ」窓（統合・既存）
                                                        └→ 「StreamDock Twitchコメント」窓（⚠ 新規・source==="twitch" だけ描く）
                                                                    │
                                              （OS のウィンドウとして存在するだけ）
                                                                    ▼
                                        OBS の window_capture ソース（044a の既存経路で自動追加）
                                                                    ▼
                                        StreamDock が作った出力シーン（10-1 の図）
                                                                    ▼
                                        Branch Output フィルタ → RTMP(S) → Twitch / YouTube

配信開始:  main 窓 ─invoke→ Rust（keychain）─stdin→ sidecar ─ws→ OBS（フィルタ設定書込→有効化）
配信状態:  sidecar ─https→ Twitch Helix `GET /streams` ／ YouTube Data API（既存の生存監視）→ 「実際に配信中か」
```

⚠⚠ **オーバーレイの中身（コメント本文）は 1 バイトも OBS へ渡らない**。OBS が取り込むのは**窓の画像**だけである
（044a からの構図。§9 の担保がそのまま効く）。

---

## 12. OBS シーン構成

| 名前 | 種別 | 作る人 | 中身 |
|---|---|---|---|
| （ユーザーのシーン） | scene | **ユーザー** | ⚠ StreamDock は**作らない・中身を触らない**。セットアップで 1 枚選ばせる |
| `StreamDock Twitch出力` | scene | StreamDock | ①ベースシーン（ネスト）②`StreamDock Twitchコメント` |
| `StreamDock YouTube出力` | scene | StreamDock | ①ベースシーン（ネスト）②`StreamDock コメントオーバーレイ`（統合・⚠ **Twitch 専用窓は置かない**＝二重表示になる） |
| `StreamDock 配信出力` | **filter**（`osi_branch_output`） | StreamDock | 上の各出力シーンに **1 枚ずつ** |

**規則**:
- ⚠ **べき等**。`GetSceneList` / `GetSceneItemList` / `GetSourceFilterList` で存在確認してから作る（044a の `ensureOverlaySource` と同じ作法）。
- ⚠ **削除しない**。使わなくなった出力シーンは**残す**（044a が「ソースを削除せず非表示」にした判断と揃える）。
- ⚠ **両出力シーンが共有するのはベースシーンだけ**。`CreateSceneItem` で**同じシーンを両方から参照**する（**複製しない**＝デバイス競合を避ける・Branch Output の README も「貼り付け（参照）」を推奨）。
- ⚠ **オーバーレイ窓のキャプチャソースは、出力シーンごとに別のものを 1 本だけ**（[14-3](#14-3-出力シーンとオーバーレイ窓の対応-1-対-1)）。
- ⚠ **ベースシーンのネストは OBS が自己参照を拒否する**。StreamDock 側でも「ベースシーンに StreamDock の出力シーンを選ばせない」ガードを入れる。

### 12-1. ⚠⚠ シーン切り替えについて（MVP の割り切り）

MVP は **ベースシーン 1 枚固定**。配信者が OBS でプログラムシーンを切り替えると構成が崩れる。

- **MVP の扱い**: セットアップ時に「配信の中身が入っているシーン」を 1 つ選ばせ、**プログラムシーンは StreamDock が握る**。
  `CurrentProgramSceneChanged` を監視し、**StreamDock の出力シーン以外に変わったら画面に警告を出す**（⚠ 自動で戻さない＝ユーザーと綱引きしない）。
- **将来**: StreamDock の「配信」画面に**シーン選択**を出し、両出力シーンの中の「ベース」ネスト項目を
  `SetSceneItemEnabled` で 1 つだけ有効にする（全ユーザーシーンを無効状態でネストしておく）。
  ⇒ **OBS のシーン切り替えを StreamDock 側に持ってくる**。これなら「OBS を見せない」目的とも整合する。

---

## 13. 責務の分割

### 13-1. StreamDock の責務

| 層 | 責務 |
|---|---|
| **main 窓（React）** | 配信先の選択・配信開始/停止・状態表示・セットアップウィザード。⚠ **配信キーの値には触らない**（入力欄 → `invoke` に渡して即捨てる） |
| **Rust** | 配信キーの keychain 保存/削除／sidecar への stdin private pipe／obs-websocket 設定の read-only 検出（既存）／⚠ **チケット発行**（[18-6](#18-6-loopback-ws-の未認証問題新しいチケットが-1-本要る)） |
| **sidecar（新規 `obs/stream-output.ts`）** | **判断はここに閉じる**: ポリシー表の適用・シーン/ソース/フィルタのべき等構築・開始/停止・状態の取りまとめ |
| **sidecar（既存 `obs/obs-client.ts`）** | 接続・ホストガード・オーバーレイ窓のソース自動追加（**流用**） |
| **`outputDriver` 境界（新規）** | `ensureOutputs()` / `start(platforms)` / `stop(platforms)` / `probe()` の 4 メソッド。実装は `branchOutputDriver` 1 本。⚠ **将来 D へ移るときの差し替え点** |

### 13-2. OBS の責務

- 映像の合成・エンコード・RTMP 送出・**再接続**（Branch Output は `obs_output_set_reconnect_settings` を設定している＝実コードで確認）。
- **シーンコレクションの永続化**（⚠ **配信キーもここに保存される**。[18-1](#18-1-配信キーが-obs-の設定ファイルに平文で残ることの明示同意)）。
- ⚠ **StreamDock は OBS の設定ファイルを 1 バイトも書かない**（§5）。書くのは常に obs-websocket 経由で **OBS 自身**。

---

## 14. コメントオーバーレイ構成

### 14-1. ⚠⚠⚠ 要望⑥（localhost HTTP ＋ Browser Source）は**採らない**

依頼の想定は `http://localhost:{port}/overlay/twitch-chat` などを Browser Source で読む方式だったが、**採らない**。理由:

1. ⚠⚠ **[044s](044s-obs-websocket-spike.md) が実測で落としている**。macOS / OBS 32.1.2 で
   **Browser Source が loopback URL を 1 回も取得しなかった**（`curl` は 200・OBS 側だけが取得しない／Interact は真っ黒）。
   環境固有の可能性は高いが、**製品ユーザーの実機で現に動かなかった**という事実がある。
2. **HTTP サーバが新設になる**。いまの sidecar は **loopback WS だけ**で HTTP サーバを持たない。
   ⇒ ポート競合・CORS・未認証の口が**もう 1 面**増える（066 が塞いだ議論の再来）。
3. **既存資産が全部載っている先が窓側である**。テーマ（[060](060-overlay-custom-css.md) 系）・カスタム CSS・
   外部フォントのスナップショット・アバターの data URI 化（[036](036-overlay-user-avatar.md)）は**すべて webview 前提**で作られている。
   Browser Source へ移すと**これを全部作り直す**ことになる。
4. **窓方式は既に動いている**（044a・046d・061k で 3 種類）。

⇒ **既存の「透過窓 → ウィンドウキャプチャ」を 4 本目として延長する**。

### 14-2. 追加する窓（1 本だけ）✅ **実装済み（段 1・2026-09-09）**

⚠ **ラベルは `twitch-overlay`**（本文の初稿は `comment-overlay-twitch` と書いていたが、既存 3 窓が
`comment-overlay` / `pinned-overlay` / `stage-overlay` と `<x>-overlay` で揃っているため実装時に変更した）。

| 窓 | label | 窓タイトル＝ソース名 | 描くもの | 用途 |
|---|---|---|---|---|
| 既存 | `comment-overlay` | `StreamDock コメントオーバーレイ` | **全 source（統合）** | **YouTube 出力**・単独配信 |
| **新規** | `twitch-overlay` | **`StreamDock Twitchコメント`** | **`source === "twitch"` のみ** | **Twitch 出力** |

⚠⚠ **窓タイトルの制約チェック（`overlay_window_contract` の総当たり）**:
`StreamDock Twitchコメント` は既存 3 つ（`StreamDock コメントオーバーレイ` / `StreamDock 固定コメント` / `StreamDock ステージ演出`）の
**いずれも部分文字列として含まず、いずれにも含まれない**。⇒ ✅ 追加可（⚠ **テストで機械的に再確認すること**）。

⚠ **`OverlayApp.tsx` は 1 本のまま**にする。`getCurrentWindow().label` を見て
「絞り込み対象の source 集合」を決める**純関数**（`overlayCommentFilter.ts`・新規）を通すだけにし、
**描画・テーマ・CSS・フォント・アバターの経路は 1 本も分岐させない**（[061g](061g-shared-primitives-extraction.md) の共通化方針と整合）。

⚠ **既存ユーザーへの影響ゼロ**: `comment-overlay` の**既定の**挙動（統合表示）は変えない（既定値＝両方 ON）。

### 14-3. 出力シーンとオーバーレイ窓の対応（1 対 1）

| 出力 | 置く窓 | 描く source | 変更可否 |
|---|---|---|---|
| Twitch 出力シーン | `StreamDock Twitchコメント` | **`twitch` のみ** | 🔒 **不可**（ポリシー表・[15](#15-規約違反防止ロジックpolicy-enforcement)） |
| YouTube 出力シーン | `StreamDock コメントオーバーレイ`（既存の統合窓） | 既定 `twitch` ＋ `youtube` | ✅ ユーザーが減らせる |

⚠⚠ **1 シーンに 2 本置かない。** 統合窓は既に Twitch のコメントを含むので、Twitch 専用窓と併置すると**二重に出る**。

⚠ **[16-2](#16-2-平常時main-窓配信画面) の「YouTube へ出す画面」のチェックボックスは、統合窓の描画対象 source を絞る設定**である
（窓を増やすのではなく、既存窓の filter を変える）。⇒ **窓は 2 本で足りる**。
⚠ **却下した案＝「Twitch 専用窓＋YouTube 専用窓の 2 本を YouTube シーンに重ねる」**（依頼の `/twitch-chat + /youtube-chat` 相当）:
窓が 3 本になり、**2 本のコメント列が別々にスクロールして時系列が壊れる**（統合窓は 1 リストにマージ済み・[035b](035b-viewer-overlay-simultaneous-display.md)）。

### 14-4. ⚠ この設計が守れない範囲（正直に書く）

StreamDock が保証できるのは **StreamDock が作った出力シーンの中身だけ**である。
配信者が**自分で作ったシーン**に統合窓のキャプチャを置き、そのシーンを Twitch へ流す構成は、StreamDock からは止められない。
⇒ **[15-2](#15-2-強制は-3-段ui-だけに頼らない)② の照合は「StreamDock 製の Twitch 出力シーン」に対して行う**（そこに許可外の窓があれば開始しない）。
⇒ ⚠ セットアップで「Twitch へ出すシーンには StreamDock が用意したものを使ってください」と明示する。

---

## 15. 規約違反防止ロジック（Policy Enforcement）

### 15-1. 置き場所の判断: **ハードコード（凍結テーブル）＋ 契約テスト**。設定に出さない

```ts
// apps/comment-sidecar/src/obs/stream-policy.ts（新規・⚠ 判断はここだけ）
/**
 * 配信先ごとに「出力へ載せてよいコメント元」。
 * ⚠⚠ これはユーザー設定ではなく **安全側の不変条件** である。設定として外に出すと
 * 「設定で外せる＝規約違反の口」になる（OBS_OVERLAYS / FIREABLE_SOURCE_KINDS と同じ作法）。
 */
export const STREAM_POLICY = Object.freeze({
  twitch: Object.freeze({
    allowedCommentSources: Object.freeze(["twitch"] as const),
    locked: true,   // ⚠ UI で変更不可
    reason: "Twitch ToS §11 Simulcasting（2026-08-12 版）: 他プラットフォームの活動を Twitch 配信上で統合すること（チャットのマージを含む）を禁止",
  }),
  youtube: Object.freeze({
    allowedCommentSources: Object.freeze(["twitch", "youtube"] as const),
    locked: false,  // ユーザーが減らすのは自由（増やす余地はもう無い）
    reason: "YouTube 側に他社チャットの表示を禁じる条項は見当たらない（⚠ 着手時に再確認）",
  }),
});
```

**なぜ設定ファイルに分離しないか**:
- ⚠ 分離すると「**設定を書き換えれば規約違反構成が作れる**」＝ fail-open になる。
- 規約は変わる（2026-02 にエンフォースは止まった。⚠ **ただし 2026-08-12 の ToS 改訂後も条文は残っている**）が、変えるときに通したいのは
  **「コードの変更 ＋ `security-review`」**であって、**無言の設定変更ではない**。
- ⇒ **060c のチケット機構・046d の allow-list・064a の `FIREABLE_SOURCE_KINDS` と同じ判断**。

### 15-2. 強制は 3 段（UI だけに頼らない）

| 段 | どこ | 何をするか |
|---|---|---|
| ① **構造** | `stream-output.ts` のシーン構築 | ⚠⚠ **出力シーンの中身をポリシー表から導出する**。「Twitch シーンに YouTube オーバーレイを足す」**コードパスが存在しない** |
| ② **照合（fail-closed）** | 配信開始の直前 | `GetSceneItemList` で各出力シーンの実際の中身を取り、**許可外のオーバーレイソースが 1 つでもあれば開始しない**（＝ユーザーが OBS で手で足した場合を捕まえる）。理由を画面に出す |
| ③ **UI** | main 窓 | Twitch 列の「YouTube コメント」は**チェックできない**（disabled＋理由のツールチップ）。⚠ 「黙って効かない」を作らない（[061a](061a-effect-overlay-window.md) Q-1） |

⚠⚠ **②が本節の中心**。①だけだと「StreamDock が作った Twitch シーンに、ユーザーが手で YouTube オーバーレイを追加する」を止められない。
⚠ ②で拒否したときに**勝手に消さない**（ユーザーのシーンを壊さない）。**「これがあると配信を開始できません」と出して止まる**。

---

## 16. UI / UX

### 16-1. 初回（セットアップウィザード・1 回だけ）

```
[OBS 連携をセットアップ]
 1. OBS を起動してください                         → GetVersion で確認
 2. OBS の「ツール → WebSocket サーバー設定」を有効に → detect_obs_websocket_config（read-only）
    （パスワードが必要な設定なら、ここで入力）      → 既存 set_obs_websocket_password
 3. 拡張「Branch Output」を 1 回だけ入れてください   → 導入判定＋公式リリースへの導線
    （入れ終わったら OBS を再起動）                   ⚠ SHA-256 照合済みの DL は**段 4**
 4. 配信の中身が入っているシーンを選んでください     → GetSceneList（StreamDock 製シーンは選択肢から除く）
 5. 配信キーを入力してください（Twitch / YouTube）   → invoke → keychain（⚠ 画面には二度と出さない）
    ⚠ 同意: 「配信キーは OBS の設定ファイルにも保存されます」
 → StreamDock がシーン・ソース・出力設定を作ります（進捗と、失敗したらその理由）
```

### 16-2. 平常時（main 窓「配信」画面）

> ⛔⛔⛔ **この画面案のうち「配信開始 / 配信停止」と「配信中（経過時間）」は撤回された**（2026-09-12）。
> **[067e](067e-obs-native-stream-start.md) §5 の手順が正。**配信開始は **OBS の「配信開始」ボタン**に戻る。
> ⚠ 「配信先」「コメント表示」「配信の中身（シーン選択）」はそのまま生きている。
> ⚠⚠ なお実装は main 窓ではなく**コメビュ窓**に置いた（061a の「main 窓から WS を張れない」制約・`StreamOutputView` の JSDoc が正）。

```
配信先
  ☑ Twitch    ● 準備OK
  ☑ YouTube   ● 準備OK

コメント表示
  Twitch へ出す画面 :  Twitchのコメントのみ  （🔒 変更できません — Twitch の規約により）
  YouTube へ出す画面:  ☑ Twitchのコメント  ☑ YouTubeのコメント

                              [ 配信開始 ]
```

配信中:
```
  ● Twitch  配信中（00:12:34）      ● YouTube  配信中（00:12:31）
                              [ 配信停止 ]
```

- ⚠ **「シーン」「Branch Output」「RTMP」「フィルタ」という語を 1 つも出さない**。
  出すのは「配信先」「コメント表示」「配信の中身（シーン選択）」だけ。
- ⚠ **エラーは必ず「次にやること」とセットで出す**（061a Q-1 / 064c の判断＝「OBS が起動していない」と「設定が足りない」を混ぜない）。
- 導線: `HEADER_SECTIONS` に **`{ id: "stream", label: "配信", screen: "stream" }`** を 1 行足す（＝ヘッダーとルーティングが同時に増える既存の仕組み）。

---

## 17. エラー・リカバリ（Error / Recovery）

> ⛔⛔ **⛔ を付けた行（9 / 10 / 12 / 17）は [067e](067e-obs-native-stream-start.md) で撤回された。**
> いずれも「StreamDock が配信を開始する」ことが前提だった行である。⚠ **行は消していない**——
> なぜその設計にしたのかと、なぜやめたのかの両方が残っていないと、同じ判断をやり直すことになる。
> ⚠⚠ 他の行（OBS 未導入・未起動・接続失敗・版・プラグイン未導入・配信先の組み合わせ）は**そのまま生きている**。

⚠ **原則**: ①**黙って効かない状態を作らない** ②**規約違反の側に倒れない** ③**片方が落ちても、もう片方の配信を巻き込まない**。

| # | 事象 | 検出 | 挙動 |
|---|---|---|---|
| 1 | **OBS 未インストール** | `detect_obs_websocket_config` が `None`（config が無い） | セットアップ画面で「OBS が見つかりません」＋公式サイト導線。⚠ **ファイルシステムを探し回らない**（§7） |
| 2 | **OBS が起動していない** | connect が `ECONNREFUSED`（4s timeout） | 「OBS を起動してください」。⚠ **リトライループを張らない**（044a の hot-loop 禁止を踏襲） |
| 3 | **obs-websocket 接続失敗（無効/ポート違い/認証失敗）** | `4009` / `ECONNREFUSED` | 事象ごとに文言を変える（044s で 3 通り実測済み）。パスワードは**画面にもログにも出さない** |
| 4 | **プラグイン未導入** | ✅ `GetSourceFilterDefaultSettings("osi_branch_output")` が **`code 607`**（⚠ シーン名誤りの 600 と区別できる・067s S-5） | ✅ **実装済み**: `driverFor()` が `OBS_NATIVE_DRIVER` を返し、**同時配信だけを無効化**（`maxPlatforms: 1`）して縮退モードへ落とす＋導入案内。⚠⚠ **OBS の設定は書き換えない**（[9-E](#9-e-方式-eplugin-なしで実現する) の訂正） |
| 5 | **OBS 版が非対応**（⚠ プラグイン自身の版は取れない） | `GetVersion.obsVersion` < 30.1.0 | ✅ **実装済み**（`obsVersionProblem`・構築と開始の両方で見る）。開始させない（fail-closed）＋更新案内。⚠ 版が**読めなかった**ときは止めない（判定できないことで配信を止めない）。⚠ **プラグイン自身の版は obs-websocket から取れない**（[24 Q-3](#24-未解決open-questions)） |
| 6 | **Twitch のみ配信** | ユーザー選択 | YouTube 出力シーンは**作るが使わない**（フィルタは無効のまま）。プログラム＝Twitch 出力シーン |
| 7 | **YouTube のみ配信** | ユーザー選択 | プログラム＝YouTube 出力シーン（唯一の出力なので上位集合＝最も制約の強い出力） |
| 8 | **Twitch + YouTube 同時** | ユーザー選択 | [10-1](#10-1-mvp-で採用する方式) の構成 |
| 9 | ⛔ **一方の配信開始だけ失敗**（067e で撤回。StreamDock は開始しなくなる） | プラットフォーム側の生存確認が片方だけ立たない | ✅ **実装済み**: `startOutputs` / `stopOutputs` が**配信先ごとに独立して** try/catch し `results[]` を返す。⚠⚠ **成功した側は止めない**（巻き戻さない）。失敗した側だけ赤で名指しする |
| 10 | ⛔ **一方の RTMP が切断**（067e で撤回。状態は Branch Output のドックが持つ） | ✅ 同上（`status-poller.ts` が 60 秒間隔で見る） | ✅ **実装済み**（状態 `dropped`）。Branch Output が自動再接続する（実コードで確認）。StreamDock は**状態を出すだけ**で、勝手に stop/start しない |
| 11 | **OBS がクラッシュ** | WS が切れる | 「OBS が落ちました」。⚠ **配信キーは keychain にあるので、OBS 再起動後にシーン再構築（べき等）で復帰できる** |
| 12 | ⛔ **StreamDock がクラッシュ**（067e で撤回。配信は OBS 側なので StreamDock の生死と無関係になる） | — | ✅ **実装済み**: `probeOutputs` が `enabled[]`（フィルタが有効な配信先）を返し、sidecar が `poller.adopt()` で追跡を再開する。⚠ **配信は止まらない**（sidecar 終了時も `stopOutputs` を呼ばない）。⚠⚠ 復元後も**生存確認を通ってから**「配信中」と表示する |
| 13 | **プラグイン導入の途中失敗** | — | ⚠ **StreamDock はインストールしないので、この状態を作らない**（B へ進むときに初めて必要になる） |
| 14 | **オーバーレイ窓が閉じている / 表示されていない** | ✅ `GetInputPropertiesListPropertyItems("window")` に候補が出ない（`overlayWindowProblem`・⚠ **リトライしない**——開始直前は既に開いているはずの場面） | ✅ **実装済み**: **1 つも開始する前に**全配信先ぶんを見て、1 つでも欠けていれば**両方止める**。「オーバーレイを表示してください」 |
| 15 | **obs-websocket のポート競合 / 別の値** | `obs_config.rs` の検出値を使う（既存） | 検出できなければ「WebSocket サーバーを有効にしてください」 |
| 16 | **ウィンドウキャプチャが真っ黒**（Windows の BitBlt / macOS 画面収録権限） | 目視のみ | ✅ **実装済み**（`StreamOutputView` の配信カードに常設）。⚠ **Windows は WGC ＋「透過を許可」が要る**（044a の既知事項） |
| 17 | ⛔ **配信キーが誤り / 失効**（067e で撤回。⚠ **誤りは OBS 側で分かる**——Branch Output のドックに出る） | ✅ 生存確認が猶予（**90 秒**）を過ぎても立たない ⇒ 状態 `not-live` | ✅ **実装済み**。「配信キーが正しいか確認してください」＋配信キーカードへの再入力導線。⚠ **キーの値は画面に戻さない**。⚠⚠ 猶予を短くしないこと（実際は配信できているのに嘘の警告を出す） |

---

## 18. セキュリティ（`docs/security.md` 準拠）

### 18-1. 配信キーが OBS の設定ファイルに平文で残ることの明示同意

⚠⚠ **これは避けられない**。RTMP は配信キーを送るので、OBS のフィルタ設定に入れる必要があり、
OBS が**シーンコレクション JSON に平文で保存する**（OBS 本体の配信キーが `service.json` に入るのと同水準）。

⇒ **やること**:
- セットアップで**明示同意**を取る（文言に「OBS の設定ファイルにも保存されます」を必ず入れる）。
- `docs/security.md` §9 に**追補を書く**（「StreamDock が OBS へ書き込む秘密がある」ことを条文に残す）。
- ⚠ **同意ダイアログに「今後確認しない」を作らない**（060c の作法）。

### 18-2. 配信キーの取り回し（既存の OBS パスワード経路を 1 対 1 で真似る）

```
入力欄(main 窓) ──invoke("set_stream_key", {platform, key})──▶ Rust
                                                              ├─ §8 検証（trim / 制御文字拒否 / 長さ上限）
                                                              ├─ keychain へ保存（account = stream-key/<platform>）
                                                              └─ 稼働中 sidecar へ **stdin private pipe**
sidecar（in-memory のみ）──ws://127.0.0.1:4455──▶ OBS のフィルタ設定
```

- ❌ **SQLite に入れない**／❌ **localStorage に入れない**／❌ **loopback WS で viewer へ流さない**／❌ **ログに出さない**（§9）。
- ❌ **`invoke` の戻り値でキーを返さない**（画面に二度と出さない。あるのは「設定済み / 未設定」だけ）。
- ⚠ **`GetSourceFilter` を StreamDock 側から呼ぶときは、返ってきた `key` をログにも状態にも載せないこと**。

### 18-3. 配信キーの入手経路（MVP は手入力）

自動取得は**技術的には可能**だが、**MVP では採らない**:

| 経路 | 実現性 | MVP で採らない理由 |
|---|---|---|
| Twitch `GET https://api.twitch.tv/helix/streams/key?broadcaster_id=…` | ⚠ **新スコープ `channel:read:stream_key` が要る** | **5 本目のスコープ＝既存ユーザー全員に再ログインを強いる**（043a / 066 / 063e が 3 回踏んだ）。しかも**配信キーを読む権限**は重い |
| YouTube `liveStreams.list(part=cdn, mine=true)` の `cdn.ingestionInfo` | ⚠ **`youtube.readonly` で通る可能性がある**（ドキュメント上、受理スコープに `youtube.readonly` が含まれる） | ⚠ **未検証**。かつ Twitch 側と非対称な UX になる |

⇒ **MVP: 手入力**（YouTube Studio / Twitch ダッシュボードからコピー）。
⚠ **将来**: YouTube 側だけ先に自動取得（スコープ据え置きで済むなら）→ Twitch は次のスコープ拡大のタイミングに相乗り。

### 18-4. obs-websocket の認証を必須にする（決定）

⚠⚠ **配信キーを OBS へ書き込む機能は、obs-websocket の認証（`auth_required`）が有効なときだけ有効にする。**

理由: 未認証の `127.0.0.1:4455` は**同一 PC の任意プロセスが `GetSourceFilter` で配信キーを読める**。
StreamDock がそこへキーを置くなら、**置く側が鍵を要求する**のが筋。
- 既存の 044a（オーバーレイ自動追加）は**従来どおり認証なしでも動く**（挙動を変えない）。
- 制限は**配信キーを扱う経路だけ**に効かせる。
- ⚠ セットアップで有効化手順を案内する（OBS の設定は StreamDock が書かない・§5）。
- ⚠ 導入摩擦が増えるので [24 Q-1](#24-未解決open-questions) で依頼者の確認を取る。

### 18-5. プラグイン配布物の検証

- 公式リリースに**チェックサムファイルは無い**（GitHub のリリース署名のみ）。
- ⇒ **StreamDock 側に「対応版 → SHA-256」の凍結表を焼き込む**（`docs/security.md` §10 に記録）。
- DL 先は `https://github.com/OPENSPHERE-Inc/branch-output/releases/download/...` の**完全一致 URL**（allow-list・リダイレクト禁止・サイズ上限・`Content-Type` 検査）。
  ⚠ **060c の `assertAllowedThemeImportUrl` を流用しない**（あちらは「ユーザー指定の任意宛先」用で要件が逆）。**専用の固定 URL ガードを 1 本書く**。
- ⚠ **ハッシュが一致しないものは保存もしない**（fail-closed）。
- ⚠ **StreamDock は落としたファイルを実行しない**（§4）。**ダウンロードフォルダに置いて場所を示す**だけ。

### 18-6. loopback WS の未認証問題（新しいチケットが 1 本要る）

⚠⚠⚠ **`stream-output.start` は「配信を開始する」制御フレーム**である。
sidecar の loopback WS は**未認証**なので、**ブラウザで開いた悪意あるページが配信を開始/停止できてはいけない**。
⇒ **066 段 2 とまったく同じ形で、4 本目のチケットを足す**
（Rust: `STREAM_OUTPUT_TICKET_PREFIX` ＋ `get_stream_output_ticket` ／ sidecar: 形式検査＋定数時間比較・**dev-mock の分岐より前**／frontend: 送信直前に `invoke` で取り直す）。
⚠ **新しい機構を発明しない**（既に 3 本ある）。⚠ **Rust の `sidecar_ticket_contract`（5 本）に 4 本目を通すこと**。

### 18-7. その他

- **egress**: ⚠ **RTMP(S) は sidecar の `fetch` / ws を通らない**（OBS が出す）。ただし
  ⚠⚠ **「StreamDock の操作によって新しい外部宛先へ映像が出る」ことは §1 の条文に該当する** ⇒ **§1 に追補 ＋ `security-review` 必須**。
- **生存確認の egress**: `api.twitch.tv`（既に allow-list）／`www.googleapis.com`（既に allow-list）。⚠ **新規宛先ゼロ**。
- **`ingest.twitch.tv`（ingest 一覧 API）は MVP では使わない** ⇒ **RTMP URL は同梱の定数表**（OBS の `services.json` 由来）。新規 egress を増やさないため。
- **Tauri capability**: 新規 window（`comment-overlay-twitch`）用の capability を 1 枚（`core:default` のみ・既存 3 枚と同型）。
  ⚠ **`shell:*` はゼロのまま**。main 窓の capability は**変えない**。
- **path traversal / 任意ファイル書込**: ⚠ **StreamDock はファイルを 1 つも書かない**（B へ進むまでは DL 先＝OS のダウンロードフォルダのみ）。
- **Windows UAC**: MVP では**昇格しない**（インストーラを起動しないため）。

---

## 19. 実装ステップ（Implementation Steps）

⚠ CLAUDE.md「1 回の作業で複数機能をまとめて実装しない」。**段ごとに子タスクを切る**。

### 段 0 — **067s スパイク（実測・本体差分ゼロ）** ✅ **実施済み（2026-09-09・macOS）**

⚠⚠ **結果と訂正は [`067s-branch-output-spike.md`](067s-branch-output-spike.md) が正。**
⚠⚠⚠ 本ファイルの §9-A-3・§8・§17 #4 は**実測で訂正が入っている**（下記）。S-8（Windows）だけ未実施。

**成果物＝決定メモ**。使い捨てブランチ＋リポジトリ外スクリプトで行い、**本体へマージしない**（044s と同じ作法）。

| # | 検証項目 | これが失敗したら |
|---|---|---|
| S-1 | ⚠⚠⚠ **非アクティブシーンの `window_capture` が止まらないこと**（両 OS）。⚠ 具体的には **YouTube 出力シーン（非アクティブ）に置いた統合オーバーレイ窓のキャプチャ**が黒/静止にならないこと | [12-1](#12-1-シーン切り替えについてmvp-の割り切り) の将来案が消える／最悪は「キャンバス外に 1 枚置いて showing を保つ」フォールバック |
| S-2 | `CreateSourceFilter(filterKind:"osi_branch_output")` ＋ [9-A-3](#9-a-3-設定はフィルタ設定なので-obs-websocket-で全部書ける本方式の決定打) の設定 JSON で**実際に配信が始まる**こと | 設定キーを実測で修正 |
| S-3 | `SetSourceFilterEnabled(false/true)` で**止まる/始まる**こと（インターロック既定 Always On 前提） | 開始/停止の手段を作り直し |
| S-4 | **音声が乗ること**（`custom_audio_source` + `master_track`） | 無音配信＝致命的 |
| S-5 | **プラグイン未導入時のエラー**（`CreateSourceFilter` の戻り）を実測し、判定根拠を 1 つに決める | 導入判定を別の手段に |
| S-6 | **2 出力同時**（Twitch 側は本番キーを使わずローカル RTMP 受け or ダミーで可）で**映像が別内容**になること | 設計の再検討 |
| S-7 | **負荷の実測**（GPU/CPU/VRAM・1 出力 vs 2 出力） | 上限の案内文に反映 |
| S-8 | **Windows 実機**（[098](098-windows-build.md) の VM）: `window_capture` の WGC・透過・フィルタ設定 | Windows 分岐を追加 |

### 段 1 — **067a: Twitch 専用オーバーレイ窓（4 本目）** ✅ **完了（2026-09-09）**

⚠ 実装の記録・決めたこと・ミューテーション結果は [`docs/progress.md`](../progress.md) の「067a」節が正。
⚠⚠ **`security-review` は未実施**（capability を 1 枚足したので「レビュー必須条件」に当たる）。

⚠ **配信とは独立に価値がある**（Twitch 単独配信の人がそのまま使える）。**ここだけで完結させる**。
- Rust: `open_twitch_comment_overlay_window` ＋ capability 1 枚 ＋ `OVERLAY_TITLES` に 1 行 ＋ コマンド登録。
- sidecar: `ObsOverlayKind` に `"twitchComments"`（仮）／`OBS_OVERLAYS` に 1 行。⚠ **`parseOverlayKind` は表から導出なので自動追随**。
- frontend: `overlayCommentFilter.ts`（純関数・新規）／`OverlayApp` が label から filter を決める／
  コメビュ設定に ①「Twitch 専用オーバーレイを表示」トグル ②**統合窓の描画対象 source の絞り込み**（⚠ **既定は両方 ON ＝現行挙動**・[14-3](#14-3-出力シーンとオーバーレイ窓の対応1-対-1)）。
- テスト: `overlay_window_contract` の総当たり（4 窓）／`obs_overlay_kind_union_matches_between_sidecar_and_desktop`／`overlayCommentFilter` の単体。

### 段 2 — **067b: 配信キーの保管と OBS への引き渡し**

- Rust: `set_stream_key` / `clear_stream_key` / `has_stream_key`（⚠ **値を返す関数を作らない**）／keychain account 2 本／stdin pipe。
- Rust: **4 本目のチケット**（[18-6](#18-6-loopback-ws-の未認証問題新しいチケットが-1-本要る)）＋ `sidecar_ticket_contract` に 1 本。
- sidecar: in-memory 保持のみ。
- ⚠ **この段では OBS へ何も書かない**（配線だけを固める。066 が段 1 で「送信の基盤だけ」を通したのと同じ理由）。
- ⚠ **`security-review` 必須**。

### 段 3 — **067c: 出力の構築と配信開始/停止** ✅ **実装済み（2026-09-10）**

> ⛔⛔⛔ **この段のうち「配信開始/停止」と「生存確認」は撤回された**（2026-09-12・依頼者の判断）。
> **[067e](067e-obs-native-stream-start.md) が正。**以下の記述は**実装の記録として残してある**だけで、
> これから実装する人は 067e を読むこと。
> ⚠ **生きている**のは: シーン構築（`ensureOutputs`）／規約の照合／プラグイン判定／縮退モード／配信キーの引き渡し。
> ⛔ **死んでいる**のは: `startOutputs` / `stopOutputs` ／ `liveness.ts` ／ `status-poller.ts` ／ 配信ピル ／ `StreamControls`。
>
> **撤回の理由（要約・詳細は 067e §1）**: 「配信開始」と書いたボタンは**押したら配信が始まる**ことを約束するが、
> Branch Output の出力状態もインターロック設定も読めないので、StreamDock はその約束を守れない（R-4）。
> 代替として作った生存確認 842 行は、YouTube 連携を事実上必須にし、実機で「状態が確認できません」から抜けられなくした。

⚠⚠⚠ **067s の実測により、「構築」と「配信開始」は別の操作に分けること**（obs-websocket で作ったフィルタは OBS 再起動まで動かない・[9-A-3-b](#9-a-3-b-obs-websocket-で作ったフィルタはobs-を再起動するまで動かない067s-実測)）。

- sidecar: `obs/stream-policy.ts`（凍結表）／`obs/stream-output.ts`（べき等構築・②の照合・start/stop）／`outputDriver` 境界。
  - ✅ `obs/output-driver.ts`: **実装が 2 本ある**（`BRANCH_OUTPUT_DRIVER` ／ `OBS_NATIVE_DRIVER`）。
    ⚠ 「将来のための抽象化」ではなく、[24 Q-8](#24-未解決open-questions) の縮退モードが 2 本目を要求したことで生まれた境界である。
  - ✅ `stream-output/liveness.ts`: プラットフォーム API による生存確認（**既存の宛先・既存スコープ・新規 egress ゼロ**）。
  - ✅ `stream-output/status-poller.ts`: 状態機械（`off` / `starting` / `live` / `unconfirmed` / `not-live` / `dropped`）。
    ⚠⚠ **`live` だけが「配信中」と表示してよい状態**。開始直後 5 秒間隔（猶予 90 秒）→ 確認後 60 秒間隔
    （YouTube `liveBroadcasts.list` は 1 unit なので 4 時間で 240 units＝枠の 2.4%）。
- frontend: main 窓「配信」画面 ＋ セットアップウィザード ＋ `HEADER_SECTIONS` に 1 行。
- 状態: プラットフォーム API による生存確認（既存の egress・既存スコープ）。✅ **実装済み**。
  ⚠⚠⚠ **生存確認は配信の可否を握らない**（fail-open）——確認できない理由の大半は未ログインだが、
  配信自体はログイン無しで成立する。fail-closed にすると**確認機能のバグで配信できなくなる**。
- ⚠ **`security-review` 必須**（§1 追補・§9 追補）。

### 段 4（任意）— **067d: 半自動導入（DL＋SHA-256 照合）**

⚠ **段 3 が実ユーザーで回ってから判断する**。⚠⚠ **067e の影響は受けない**（導入の話であって開始の話ではない）。

### 段 5 — **[067e](067e-obs-native-stream-start.md): 配信開始を OBS に返す** ⛔ **段 3 の一部を撤回する**

⚠⚠⚠ **順序に注意: 段 4 より先にやる。**段 4（自動導入）は段 3 が実ユーザーで回ってからの判断だが、
**段 3 は 067e を通すまで「回る形」になっていない**。

- ⚠ **一般解は「決め打ちせず、OBS を読んで合わせる」**——`GetStreamServiceSettings` で
  OBS 本体の宛先サイトを判定し、**残りの配信先にだけ** Branch Output を割り当てる。
  ⚠⚠ 初期案は「OBS 本体 = YouTube」のように**特定の環境を前提にしていた**（依頼者の指摘で棄却）。
- ⚠⚠⚠ **最大の危険は「準備が配信を始めてしまう」こと**。インターロック既定 `Always ON` ＝
  フィルタを有効にした瞬間に送信が始まる。⇒ 067e §3 の 4 段構えで守る。
- ⚠⚠ **`outputStatusDock.json` は OBS 終了時にしか書かれない**（`saveSettings()` の呼び出しは
  `OBS_FRONTEND_EVENT_EXIT` と `PROFILE_CHANGING` の 2 か所だけ・2026-09-12 に確定）。
  ⇒ **インターロックの変更は OBS 再起動より前**に置く。順序を逆にすると画面が嘘をつく。
- ⚠ **`security-review` 必須**（段 067e-6）——`GetStreamServiceSettings` が**配信キーを返す**ため、
  新しい秘密の経路が 1 本増える。

---

## 20. 変更対象になりそうなファイル

⚠ 行番号は書かない。**シンボル名で特定すること**。

| 層 | ファイル | 変更 |
|---|---|---|
| Rust | [`src-tauri/src/lib.rs`](../../apps/desktop/src-tauri/src/lib.rs) | 窓コマンド 1 本／`set_stream_key` 等 3 本／`get_stream_output_ticket`／`generate_handler!` 登録／`OVERLAY_TITLES` に 1 行／`window_commands_used_by_the_frontend_are_registered` の下限 |
| Rust | [`src-tauri/src/comment_sidecar/mod.rs`](../../apps/desktop/src-tauri/src/comment_sidecar/mod.rs) | `STREAM_OUTPUT_TICKET_PREFIX`／`STREAM_KEY_PREFIX`（stdin pipe）／`CommentSidecar` にフィールド |
| Rust | `src-tauri/src/comment_sidecar/token_vault.rs` | keychain account 2 本（`stream-key/twitch` / `stream-key/youtube`） |
| Rust | [`src-tauri/src/obs_config.rs`](../../apps/desktop/src-tauri/src/obs_config.rs) | ⚠ **変更なしの見込み**（`auth_required` は既に返る） |
| Rust | `src-tauri/capabilities/twitch-overlay.json` | ✅ **作成済み**（`core:default` のみ・label 名に合わせた） |
| sidecar | [`src/obs/obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts) | `ObsOverlayKind` ＋ `OBS_OVERLAYS` に 1 行／⚠ **作成先シーンを引数化**（現在はプログラムシーン固定） |
| sidecar | `src/obs/stream-policy.ts` | **新規**（凍結表・純関数） |
| sidecar | `src/obs/stream-output.ts` | **新規**（構築・照合・start/stop・`outputDriver`） |
| sidecar | [`src/index.ts`](../../apps/comment-sidecar/src/index.ts) | 制御フレーム 2〜3 種の受理（⚠ **チケット照合は dev-mock 分岐より前**）／stdin 行の受領 |
| sidecar | [`src/host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) | ⚠ **段 3 までは変更なし**の見込み（段 4 で GitHub リリース URL の専用ガードを新設） |
| frontend | `src/screens/stream/StreamScreen.tsx` ほか | **新規**（配信画面・セットアップ） |
| frontend | [`src/components/headerSections.ts`](../../apps/desktop/src/components/headerSections.ts) ／ [`src/types.ts`](../../apps/desktop/src/types.ts) ／ `src/App.tsx` | 導線 1 本 |
| frontend | [`src/screens/comment-viewer/OverlayApp.tsx`](../../apps/desktop/src/screens/comment-viewer/OverlayApp.tsx) | label → filter（⚠ 分岐は 1 箇所だけ） |
| frontend | `src/features/comment-viewer/overlayCommentFilter.ts` | **新規**（純関数） |
| frontend | [`src/features/comment-viewer/overlaySettings.ts`](../../apps/desktop/src/features/comment-viewer/overlaySettings.ts) | トグル 1 本 |
| frontend | [`src/features/comment-viewer/commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts) | 制御フレーム送信（⚠ 送信直前にチケット取り直し） |
| frontend | `src/features/stream-output/*` | **新規**（API ラッパ・状態）。⚠ `stream-session` の `StreamPlatform` を再利用 |
| docs | [`docs/security.md`](../security.md) | §1 追補（RTMP egress）／§9 追補（配信キー）／§10（新規依存があれば） |
| docs | [`docs/task-board.md`](../task-board.md) ／ [`docs/progress.md`](../progress.md) | 着手時に項目追加 |

⚠ **新規ライブラリ**: 現時点で**ゼロの見込み**（`obs-websocket-js` は導入済み・RTMP は OBS が話す）。
段 4 の DL でも Node の `fetch` ＋ `node:crypto` で足りる。⚠ **足すなら CLAUDE.md どおり理由を先に出す**。

---

## 21. 完了条件（Acceptance Criteria）

⚠ すべて**検証手段つき**。「動く」で終わらせない。

### 段 1（067a）
- [ ] `StreamDock Twitchコメント` 窓が開き、**`source === "twitch"` のコメントだけ**が描画される（`overlayCommentFilter` の単体テストで固定）。
- [ ] 既存 `comment-overlay` の表示内容が**変わっていない**（既存テスト green ＋ 実機目視）。
- [ ] `overlay_window_contract` が **4 窓の総当たり**で green（相互に部分文字列でない）。
- [ ] `obs_overlay_kind_union_matches_between_sidecar_and_desktop` が green。
- [ ] 044a の自動追加が**新しい窓でも動く**（OBS に `StreamDock Twitchコメント` ソースが作られる・べき等）。

### 段 2（067b）
- [ ] 配信キーを保存したあと、**`grep` で SQLite / localStorage / ログに値が存在しない**（実測コマンドは [22](#22-テストtest-cases)）。
- [ ] 配信キーを**返す `invoke` が存在しない**（コマンド一覧を機械で確認）。
- [ ] チケット無しの `stream-output.*` フレームを **sidecar が受け付けない**（fail-closed・テストで固定）。
- [ ] `sidecar_ticket_contract` が **4 本**で green（prefix のバイト一致・相互に前方一致しない・独立採番）。

### 段 3（067c）
- [ ] **Twitch のみ / YouTube のみ / 両方**の 3 通りで、StreamDock の「配信開始」だけで**選んだプラットフォームが実際にライブになる**（プラットフォーム側の視聴ページで確認）。
- [ ] ⚠⚠ **Twitch の配信映像に YouTube のコメントが 1 件も出ない**（実配信 or ローカル RTMP 受けの録画で目視 ＋ フレーム確認）。
- [ ] ⚠⚠ **YouTube の配信映像に Twitch と YouTube の両方のコメントが出る**。
- [ ] **音声が両方に乗っている**。
- [ ] ユーザーが OBS で Twitch 出力シーンに YouTube オーバーレイを**手で追加すると、配信開始が拒否され理由が画面に出る**（[15-2](#15-2-強制は-3-段ui-だけに頼らない)②）。
- [ ] UI で **Twitch 列の YouTube コメントがチェックできない**（disabled ＋ 理由表示。「黙って効かない」になっていない）。⚠ 現状は**チェックボックスの行列ではなく固定文言**で表現している（`PLATFORM_POLICY_NOTE`）——判断は `stream-policy.ts` にしか無く、画面から変更する経路が構造的に存在しないため。
- [ ] **片方の開始が失敗しても、もう片方は配信され続ける**（[17](#17-エラーリカバリerror--recovery)#9）。⚠ 実装は済（`results[]`）・**実機未確認**。
- [ ] **StreamDock を落としても配信が止まらない**／再起動後に「配信中」を検出して UI が復元する（[17](#17-エラーリカバリerror--recovery)#12）。⚠ 実装は済（`probe.enabled` → `poller.adopt`）・**実機未確認**。
- [ ] **OBS を再起動しても、シーン構築がべき等**（二重にシーン/ソース/フィルタが増えない）。
- [ ] 配信停止後、**フィルタが無効になっている**（＝キーが入ったまま勝手に再送信しない）。
- [ ] `security-review` **実施済み**（段 2・段 3 それぞれ）。
- [ ] `pnpm typecheck` / `pnpm lint` / `cargo check` / `cargo test` / frontend テストが green。

---

## 22. テスト（Test Cases）

### 22-1. 純関数（実機不要・ここに判断を集める）

| 対象 | 固定すること |
|---|---|
| `overlayCommentFilter` | ①Twitch 窓は **設定に関わらず** `twitch` だけ通す（⚠ ポリシー由来なので設定で上書きできない） ②統合窓は**設定に従う**（未保存なら両方＝現行挙動） ③**未知の label は「何も出さない」に倒れる**（fail-closed・⚠ 「全部出す」にしない） |
| `stream-policy` | ①Twitch の許可集合が `["twitch"]` **だけ** ②表が `Object.freeze` されている（実行時に書き換え不能） ③**`__proto__` / `constructor` / `toString` を渡しても fail-open しない**（046d と同じ罠） |
| シーン構成の導出 | 選択（Twitch のみ / YouTube のみ / 両方）→ 期待するシーン・アイテム・フィルタの表が**一意に決まる** |
| 照合（②） | 許可外ソースが混じった `GetSceneItemList` 応答を渡すと**開始を拒否する** |
| RTMP URL 表 | プラットフォーム → URL が定数表から引かれ、**ユーザー入力が URL に混ざらない** |

### 22-2. 契約テスト（Rust・言語をまたぐ）

- `overlay_window_contract`: 4 窓の総当たり（既存ループにタイトルを 1 行足すだけ）。
- `obs_overlay_kind_union_matches_between_sidecar_and_desktop`: union の一致。
- `sidecar_ticket_contract`: 4 本目の prefix・独立採番・**dev-mock 分岐より前での照合**。
- ⚠ **新規**: `stream_policy_is_frozen_in_sidecar` — `include_str!` で `stream-policy.ts` を読み、
  **`twitch` の許可集合に `youtube` の文字列が現れないこと**を機械で固定する。
  ⚠⚠ **これが本タスクで最も重要なテスト**（規約違反を防ぐ最後の壁がコードの 1 行だから）。

### 22-3. ⚠ ミューテーション（[`write-tests` スキル](../../.claude/skills/write-tests) の作法）

最低限、次を**殺せること**を確認する:
1. `STREAM_POLICY.twitch.allowedCommentSources` に `"youtube"` を足す → **落ちる**。
2. 照合②を `return true` に潰す → **落ちる**。
3. フィルタを `filterEnabled: true` で作る → **落ちる**（[9-A-3](#9-a-3-設定はフィルタ設定なので-obs-websocket-で全部書ける本方式の決定打) の絶対条件）。
4. `overlayCommentFilter` の未知 label を「全部出す」に変える → **落ちる**。
5. チケット照合を dev-mock 分岐の後ろへ動かす → **落ちる**。

### 22-4. 実機（⚠ 未実施のまま完了にしない）

```bash
# 1) 秘密が漏れていないこと（配信キーを "SDTESTKEY123" にして実施）
grep -r "SDTESTKEY123" ~/Library/Application\ Support/<app id>/ 2>/dev/null   # SQLite / 設定
# → ヒットゼロが期待（⚠ OBS のシーンコレクションには入る。そこは同意済み・18-1）

# 2) egress が増えていないこと
lsof -i -P | grep -v "127.0.0.1\|\[::1\]"    # ⚠ RTMP は OBS プロセスから出る（StreamDock/sidecar からは出ない）

# 3) loopback だけを使っていること
lsof -i -P | grep 4455                        # sidecar → 127.0.0.1:4455 のみ

# 4) 検証コマンド（CLAUDE.md）
pnpm typecheck && pnpm lint && cargo check && cargo test
```

⚠ **実配信での確認**（Twitch/YouTube の両方を非公開/限定公開で立てて録画を見る）は**依頼者にしかできない**。
⚠⚠ **「Twitch 側に YouTube コメントが出ていないこと」だけは、必ず実配信の録画で確認すること**（本タスクの存在理由そのもの）。

---

## 23. リスク（Risks）

| # | リスク | 重さ | 緩和 |
|---|---|---|---|
| R-1 | ⚠⚠⚠ **規約の解釈違い**（Twitch 側に他社コメントが出る） | **致命** | ポリシー表の凍結 ＋ 構造で作れない ＋ 開始前照合 ＋ 契約テスト ＋ 実配信での目視 |
| ~~R-2~~ | ~~非アクティブシーンでソースが止まる~~ | — | ✅ **解消（067s S-1・2026-09-09）**。出力が有効な間は trigger-render が回り、`window_capture` は**止まらない**（対照実験: 出力 OFF=0/3 変化・ON=3/3 変化）。⚠ **フォールバックは不要** |
| R-3 | **第三者プラグインへの依存**（更新停止・OBS 版で壊れる） | 大 | `outputDriver` 境界で差し替え可能に。対抗馬（obs-multi-rtmp / 自作 D）を [9-A-4](#9-a-4-対抗馬-obs-multi-rtmp-を落とした理由重要) / [9-D](#9-d-方式-dstreamdock-専用-obs-plugin-を作る) に残してある |
| R-4 | ⚠⚠ **インターロック設定を外から読めない** ⇒ 「開始したつもりで出ていない」 | 大 | **プラットフォーム API で実際のライブ状態を確認**してから「配信中」と表示する（[17](#17-エラーリカバリerror--recovery)#9） |
| R-5 | **設定キーの誤り**（`service_count` 等の既定値の罠） | 中 | 067s S-2 で実測確定。⚠ **プラグイン版を上げるときに再確認**（版 → 設定キーの対応を記録する） |
| R-6 | **配信キーの漏洩** | 大 | keychain ＋ stdin pipe ＋ 非ログ ＋ 値を返さない ＋ obs-websocket 認証必須（[18-4](#18-4-obs-websocket-の認証を必須にする決定)） |
| R-7 | **PC の性能不足**（出力ぶんエンコードが増える） | 中 | 067s S-7 で実測し、**開始前に上り帯域とエンコード負荷の注意を出す**。⚠ 自動で画質を下げない（勝手に配信品質を変えない） |
| R-8 | ⚠ **配信者の既存 OBS 構成を壊す** | 大 | **作るだけ・消さない・ユーザーのシーンの中身に触らない**。プログラムシーンを変えることだけ明示同意を取る |
| R-9 | **OBS 本体の配信ボタンとの二重配信** | 中 | プログラムシーンを Twitch 側（安全な部分集合）にする ＋ `GetStreamStatus` を監視して警告（⚠ **勝手に止めない**） |
| R-10 | **上流の規約が動く**（エンフォースは 2026-02 に止まっており、条文だけが残っている状態） | 中 | ポリシー表に `reason`（版つき）を持たせ、**着手時に `legal.twitch.com` の ToS §11 本文を引き直す**手順を冒頭に明記。⚠ **緩める方向の変更は `security-review` を通す** |

---

## 24. 未解決（Open Questions）

| # | 問い | 推奨 | 誰が決めるか |
|---|---|---|---|
| **Q-1** | ⚠ **obs-websocket の認証を必須にするか**（[18-4](#18-4-obs-websocket-の認証を必須にする決定)）。セットアップの手数が 1 つ増える | **必須にする**（未認証だと同一 PC の任意プロセスが配信キーを読める） | 依頼者 |
| **Q-2** | プログラムシーンを StreamDock が握ること（＝OBS のシーン切り替えを配信中に使えなくする）を MVP の制約として受け入れるか | **受け入れる**。[12-1](#12-1-シーン切り替えについてmvp-の割り切り) の将来案で解消する | 依頼者 |
| ~~Q-3~~ | ~~プラグインのバージョンを obs-websocket から取る方法~~ | ✅ **決着（067s）**: `GetSourceFilterDefaultSettings` の返りに版の手がかりは**無い** ⇒ **版チェックはやらない**（設定キーの互換だけ見る）。⚠ 1.0.9 で proc handler（`calldata`）API が入りフィルタ列挙もできるが、**obs-websocket からは呼べない**（OBS の Python/Lua スクリプト経由のみ）＝将来の手段として記録 | — |
| **Q-4** | Twitch の ingest サーバーを**固定（東京）にするか、一覧から選ばせるか** | **同梱の定数表から選ばせる**（既定＝東京）。⚠ `ingest.twitch.tv` を叩くのは新規 egress なので MVP では避ける | 依頼者 |
| **Q-5** | Twitch の ingest は **RTMPS を受けるか**（`services.json` には RTMP しか無い） | 067s で `rtmps://` を実測。通らなければ RTMP（⚠ **配信キーが平文でネットワークに出る**＝OBS 本体と同条件だが記録する） | 実装者（067s） |
| **Q-6** | YouTube の `liveStreams.list` が **`youtube.readonly` で `cdn.ingestionInfo.streamName` を返すか** | 将来の自動取得の可否を左右する。⚠ **MVP では触らない**ので急がない | 後日 |
| ~~**Q-7**~~ | ~~新しい窓の `ObsOverlayKind` の値名~~ | ✅ **解決（2026-09-09）＝`"twitchComments"`**。両側とパイプ（Rust の契約テスト）を同時に更新済み | — |
| **Q-8** | ⚠ プラグイン未導入時の縮退（[9-E](#9-e-方式-eplugin-なしで実現する) の 1 プラットフォーム運用）を MVP に入れるか、段 4 送りか | **MVP に入れる**（入れないと「プラグインが無い人は配信画面が全部灰色」になる） | 依頼者 |

---

## 25. 一次ソース（調査日 2026-09-08〜09・⚠ 着手時に引き直すこと）

> ⚠⚠ **番号が重複している**（レビュー Q-5・2026-09-12）。本節「25. 一次ソース」と、
> ファイル末尾の **[§25 撤回](#25-撤回2026-09-12)** は**別物**である。
> 本文中の「§25-1」〜「§25-9」はすべて**撤回節**を指す（一次ソースに枝番は無い）。
> ⚠ 改番しないのは、参照元が progress.md / task-board.md / 067e / `overlayCommentFilter.ts` /
> `SettingsView.obs.test.tsx` に散っており、直すなら一度に直す必要があるため。

| 種別 | 出典 | 確認した内容 |
|---|---|---|
| 規約 | ⚠ **Twitch ToS §11 Simulcasting 本文（`legal.twitch.com`・Last modified 08/12/2026）を直接取得して確認**（2026-09-09） | **「配信中に他プラットフォームの活動を Twitch 配信上で統合する第三者サービス（チャットのマージ等）を使わないこと」は現行条文に存在する**。⚠ 2026-02 のエンフォース停止表明の**後に改訂されてなお残っている** |
| OBS | OBS Studio 32.2 リリースノート（2026-07-21）／32.2.1（2026-07-24） | **異なる 2 サービスへの同時配信は本体機能に無い**。Canvas はプラグイン向け内部 API |
| obs-websocket | `docs/generated/protocol.md`（RPC v1） | `CreateSourceFilter` / `SetSourceFilterSettings` / `SetSourceFilterEnabled` / `CreateScene` / `CreateSceneItem` / `GetSceneItemList` / `CurrentProgramSceneChanged` の存在と引数 |
| プラグイン | `OPENSPHERE-Inc/branch-output` **1.0.9（2026-04-12）**・GPL-2.0 | README_ja（本要件が用例）／`src/plugin-main.cpp`（`FILTER_ID = "osi_branch_output"`・設定キー・インターロック）／`src/plugin-streaming.cpp`（`rtmp_custom`＋`rtmp_output`・再接続設定）／`src/video/filter-video-capture.*`（非アクティブシーンの trigger render・⚠ `inc_showing` 無し）／`src/UI/output-status-dock.cpp`（インターロックは `outputStatusDock.json`）／`API.md`（proc のみ・**vendor API 無し**） |
| 対抗馬 | `sorayuki/obs-multi-rtmp`（GPL-2.0）／`Aitum/obs-vertical-canvas`（GPL-2.0）／`exeldro/obs-source-record`（GPL-2.0） | multi-rtmp は**出力ごとのシーン指定あり・`obs_source_inc_active` を呼ぶ**が、**外部制御の口が無い** |
| RTMP 宛先 | OBS `plugins/rtmp-services/data/services.json` | Twitch `rtmp://live-tyo.twitch.tv/app` 等／YouTube `rtmps://a.rtmps.youtube.com:443/live2`（＋backup `b`） |
| API | Twitch Helix `GET /helix/streams/key`（scope `channel:read:stream_key`）／`GET /helix/streams`（生存確認・追加スコープ不要） | [18-3](#18-3-配信キーの入手経路mvp-は手入力) / [17](#17-エラーリカバリerror--recovery) の根拠 |
| API | YouTube Data API `liveStreams.list`（`mine=true`・受理スコープに `youtube.readonly` を含む） | [24 Q-6](#24-未解決open-questions) の根拠 |

---

## 26. このタスクでやらないこと（再掲・線引き）

- ⚠⚠ **複数チャンネルからの同時コメント取得**（同じ platform に 2 つ以上のチャンネル）。
  ⇒ **[068](068-multi-channel-comment-fetch.md) として起票済み**（2026-09-10・依頼者の指示）。
  ⚠ 本タスクは **配信の出口**を 2 つに分けるところまでで、**コメントの入口は 1 platform 1 本のまま**である。
  ⚠⚠⚠ **本タスクの成果物（凍結表・出力シーン）は 068 でも無改変で使える**——判断が platform 単位で、
  チャンネル数に依存しないため。⇒ **2 固定のまま完了させてよい**（068 §5-4 に根拠を書いてある）。
- ⚠ **配信先を 3 つ以上にすること**（出口側の拡張）。⇒ 必要になったら本タスクの続きとして別途起票する。
- 実装（⚠ **「実装して」まで着手しない**）。
- `docs/security.md` の本文更新（⚠ **段 2 / 段 3 の実装時に、その段のぶんだけ追記して `security-review` を通す**）。
- [`docs/task-board.md`](../task-board.md) / [`docs/progress.md`](../progress.md) への記録（着手時に行う）。

---

## §25 撤回（2026-09-12）

⚠⚠⚠ **本タスクの段 1〜3・段 5（067a / 067b / 067c / 067e）は実装を撤回し、コードを削除した。**
配信先ごとに別のコメント一覧を載せる、という目的そのものを取り下げる。

### 25-1 何を作ろうとしていたか

Twitch ToS §11 は同時配信中に他プラットフォームのチャットを Twitch の配信画面へ
統合することを禁じている。⇒ Twitch には Twitch のコメントだけ、YouTube には両方を載せる、
という**配信先ごとの出し分け**を、配信者が意識せずに得られる状態を目指した。

実装は Branch Output プラグイン（`osi_branch_output`）のフィルタで、
配信先ごとに別のシーンを作り、それぞれに専用のオーバーレイ窓を置く方式を採った。

### 25-2 ⚠⚠⚠ 撤回の決め手——シーン管理の乗っ取りが構造的に避けられない

配信先ごとに違う映像を送るには
「**配信者のシーン ＋ その配信先用のコメント一覧**」という合成シーンを作り、
そこに Branch Output のフィルタを付けるしかない。

⚠ OBS には「いま番組に出ているもの」をソースとして入れ子にする手段が無い。
⇒ **合成シーンを番組シーンにする以外の方法が存在しない。**

その帰結として、実装は画面にこう書くことになっていた:

> 配信中は OBS のシーンを切り替えないでください。

⚠⚠ 配信者は配信中にシーンを切り替える（待機画面・ゲーム画面・雑談・終了画面）。
**それを禁止するのは、配信の質を上げる機能ではなく、配信のやり方を変えさせる機能である。**
⇒ 本タスクの前提（配信者が意識せずに得られる）と両立しない。

### 25-3 前提が外れていた——Branch Output はデファクトではない

OBS 公式フォーラムの DL 数（2026-09-12 時点）:

| プラグイン | DL 数 | 評価 | 配信先ごとに別の映像 |
|---|---|---|---|
| [obs-multi-rtmp](https://obsproject.com/forum/resources/multiple-rtmp-outputs-plugin.964/) | 2,888,119 | 4.07★ (84) | ❌ 同じ番組出力の複製 |
| [Aitum Multistream](https://obsproject.com/forum/resources/aitum-multistream.1991/) | 395,679 | 3.09★ (11) | ❌ 同じ番組出力（縦型キャンバスは別枠） |
| [**Branch Output**](https://obsproject.com/forum/resources/branch-output-streaming-recording-filter-for-source-scene.1987/) | **50,636** | 4.53★ (15) | ✅ |

⚠ Branch Output は obs-multi-rtmp の **1.7%**。「多くの配信者にすでに入っている」は成り立たない。
⇒ ほぼ全員にプラグイン導入 ＋ OBS 再起動 ＋ インターロック変更を要求することになる。

⚠⚠ **デファクト側へ乗り換えても解決しない。**
obs-multi-rtmp も Aitum Multistream も**同じ番組出力を複製する**だけで、
配信先ごとに違う映像は送れない。⇒ 目的を満たすのは Branch Output だけだが、
それは 25-2 のシーン乗っ取りと不可分である。

⚠ 副作用として、既存の obs-multi-rtmp / Aitum 利用者が本機能を使うと、
**同じ配信先へ二重に送信される**（未検討のまま残っていた）。

⚠ なお obs-multi-rtmp は OBS フォーラムの掲載上 **Windows / Linux のみ**で、macOS 版が無い。

### 25-4 ⚠ 配信者はツールの変更を避ける

配信トラブルは配信中にしか露見せず、取り返しがつかない。
⇒ 環境を変える提案は、得られるものが大きくても採られにくい。
本機能が要求していたもの（プラグイン導入・OBS 再起動・ドックの設定変更・シーン構成の変更）は
**そのすべてに当たる**。

### 25-5 ⚠ Twitch ToS の現況（撤回の理由ではない）

- **条文は残っている。**§11 Simulcasting（`legal.twitch.com`・Last modified 2026-08-12）は
  他プラットフォームの活動を Twitch 配信上で統合する第三者サービス（チャットのマージを例示）の
  使用を禁じている。
- ⚠ **2026-02、エンフォースが停止された。**配信者が統合チャット表示で警告を受けた件を機に、
  CEO Dan Clancy が Patch Notes 配信内で取り締まらない旨を述べた。
- ⚠⚠ **公式文書は出ていない。**[同時配信ガイドライン](https://help.twitch.tv/s/article/simulcasting-guidelines)は
  更新されておらず、条文も残っている。

⇒ **StreamDock は条文を正としつつ、判断を配信者に渡す**（25-6）。
⚠ 「公式が許可した」と書いてはならない——条文が残っている以上それは事実に反する。

### 25-6 代わりに何を提供するか

コメント一覧は **1 つ**に戻し、**そこに出すサイトを配信者が選べる**ようにする（067a の
`overlayCommentFilter.ts` の仕組みをそのまま使う）。設定画面には次の 3 点を書く:

> Twitch は利用規約で、同時配信中に他サイトのコメントを Twitch の配信画面へ
> 表示することを禁じています。
> 2026年2月、Twitch の CEO は配信内で「これを取り締まらない」と述べましたが、
> 規約の条文は残っています。
> 両方を表示するかどうかは、ご自身の判断で決めてください。

⚠ StreamDock の環境要求はゼロになる（プラグイン不要・OBS の設定変更不要・シーン構成に触れない）。
⚠⚠ 文言は `SettingsView.obs.test.tsx` の「067a Twitch の規約についての注意書き」が固定している——
**断定（「出せません」）にも、誤った安心（「許可されました」）にも倒さない**ことをテストで見張る。

### 25-7 削除したもの

段 1〜3・段 5 で追加した実装をすべて削除した（新規 21 ファイル ＋ 既存への配線）。

| 層 | 削除したもの |
|---|---|
| sidecar | `obs/stream-output.ts` `obs/branch-output.ts` `obs/native-output.ts` `obs/stream-policy.ts` `obs/rtmp-endpoints.ts` `stream-output/`（配信キー保管・チケット・生存確認） |
| Rust | `branch_output_config.rs`（インターロック読取）／配信キーの keychain 保管／Twitch 専用窓のコマンド 3 本／`capabilities/twitch-overlay.json` |
| frontend | `StreamOutputView.tsx` `StreamSetupGuide.tsx` `streamSetupSteps.ts` `interlock.ts` `interlockApi.ts` `streamKeyApi.ts` `branchOutputGuide.ts` `streamPlatformLabel.ts` `bindings/BranchOutputInterlock.ts`／`commentStream.ts` の `stream-output.*` 送受信 |
| frontend（副産物） | `ToolbarPill.tsx` `statusDotClass.ts`（配信ピルと接続ピルで共有するために切り出したもの。配信ピルが消えて利用者が 1 つになったため `ConnectionCard.tsx` ごと HEAD へ戻した） |

⚠⚠ **1 箇所だけ残したものがある**（レビュー Q-2・2026-09-12）:
`CommentViewerApp.module.css` の `.connPopover` に足した `max-height` / `overflow-y`。
067c の作業中に入ったが、**067 と無関係に正しい**（`.connPopover` に溢れ止めが無いことは
067 以前から過去レビューで「後回し可」として挙がっていた既存論点）。⇒ 戻さず、コメントの
理由づけだけを書き直した。

⚠ **067a の Twitch 専用オーバーレイ窓（`twitch-overlay`）も削除した**——
シーン分割が無くなると置き場所が無く、開く理由が消えるため。
⚠⚠ ラベル `"twitch-overlay"` は `resolveOverlaySources` の **fail-closed 側**に落ちる
（＝どこかに残っていても何も描かない）。これを `overlayCommentFilter.test.ts` と
`OverlayApp.sourceFilter.test.tsx` が固定している。

⚠⚠⚠ **`overlayCommentFilter.ts` の「出す配信元の選択」と fail-closed の作法は残した**（25-6 の中身）。

### 25-7b ⚠⚠⚠ 実機に残るもの（コードは消えたが、書き込んだものは消えていない）

**⚠⚠⚠ 撤回の順序を間違えた。**後始末（`clear_stream_key` / フィルタ削除）を**実行する前に**
その手段ごとコードを削除したため、**StreamDock が書き込んだ秘密だけが実機に残り、アプリからは消せない**。
security-review（2026-09-12・本タスク初回）で実測確認した。

| 場所 | 残っているもの |
|---|---|
| OS キーチェーン | `service="stream-dock"` / `account="stream-key-twitch"`・`"stream-key-youtube"` の 2 本 |
| OBS シーンコレクション | `StreamDock Twitch出力` / `StreamDock YouTube出力` / `StreamDock Twitchコメント` の 3 ソース |
| 同上・**平文の配信キー** | `osi_branch_output` フィルタの `settings.key` ×2。⚠⚠ **`.json` と `.json.bak` の両方**＝**計 4 箇所** |
| ユーザーの番組シーン | `シーン` の中に `StreamDock Twitchコメント`（削除済み `twitch-overlay` 窓の window_capture＝**もう開かない窓を指している**） |

- ✅ フィルタは `enabled: false`・番組シーンはユーザー自身の `シーン` のまま。
- ⚠⚠ ただし**フィルタ設定の内部フラグは `streaming_enabled: true`** で、`server` には本番 RTMP ingest が入っている。
  ⇒ **「危険が無い」ではなく「いまは送っていないが、OBS 上の有効化 1 操作で復帰する」**が正確。
- ⚠ `StreamDock Twitchコメント` が OBS でどう振る舞うか（何も映らない／別の StreamDock 窓を掴む）は**実機未確認**。

**⇒ 後始末の手順**（⚠ **StreamDock が自動でやらない**——そのためだけに撤回済みの obs-websocket 経路を
復活させると、本撤回の最大の成果＝攻撃面ゼロを捨てることになる。1 回きりの作業に恒久的なコマンドは要らない）:

1. **キーチェーン**（⚠ `-a` を必ず指定。`-s` だけで消すと OAuth トークンまで消えて**全員再ログイン**になる）
   ```bash
   security delete-generic-password -s "stream-dock" -a "stream-key-twitch"
   security delete-generic-password -s "stream-dock" -a "stream-key-youtube"
   ```
2. **OBS**（⚠ ユーザーが OBS の UI で操作する。⚠⚠ **StreamDock がシーンコレクション JSON を直接書くのは
   `docs/security.md` §5 の禁止に真正面から当たる**——[§4](#4-やらないことnon-goals) で自分でも ❌ と決めている）
   1. シーン `StreamDock Twitch出力` / `StreamDock YouTube出力` を削除（フィルタごと消える）
   2. 番組シーン `シーン` の中のソース `StreamDock Twitchコメント` を削除
   3. **OBS を正常終了**させる（終了時に書き直され `.json` から平文キーが消える）
   4. 終了後に `rm ~/Library/Application\ Support/obs-studio/basic/scenes/<profile>.json.bak`
3. ⚠⚠⚠ **配信キーを再生成する**（Twitch ダッシュボード / YouTube Studio）。
   **シーンコレクション JSON は書き出し・共有・バックアップで複製されうる**ので、
   **消すだけでは「漏れていない」ことの証明にならない。これが 3 つの中で最も重要。**

⚠⚠ **規則として `docs/security.md` §5 に追補を書いた**（「外部アプリへ書き込む機能を撤去するときは、
後始末を 1 回実行してからコードを削除する」）。§18-1 が約束していた §9 追補の**縮小版**にあたる
（個別の実施記録は `docs/progress.md` へ書き、security.md には規則だけを残す＝同ファイルの役割どおり）。

### 25-7c ⚠ 残した設定が効く範囲（レビュー S-2）

`overlayCommentFilter.ts` が効くのは **`comment-overlay` 窓だけ**である。
`pinned-overlay`（固定コメント）と `stage-overlay`（ガチャ演出の `viewerName`＝第三者の表示名）は
**この設定を読まない＝素通りする**。⇒ 「Twitch を OFF にした」のにピン留め済みの Twitch コメントと
Twitch 視聴者の表示名は配信に載る。

⚠ **067a 当初からの範囲で、撤回で新たに空いた穴ではない。**ただし**規約の強制がコードから完全に消えた**
（凍結テーブルごと削除した）いま、この設定が唯一の手段なので、範囲のずれは記録しておく。
⚠⚠ 直すなら **3 窓まとめて**（1 窓だけ塞ぐと「塞いだ窓と素通りの窓」が混在してかえって危ない）。

### 25-8 ⚠ 再検討する条件

次のいずれかが満たされたら、25-2 の制約が外れるので作り直す価値がある:

1. OBS が「番組出力そのもの」をソースとして扱えるようになる
   （⇒ 合成シーンを番組にする必要が消える）
2. デファクトのプラグイン（Aitum Multistream 等）が配信先ごとに別シーンを送れるようになる
3. Branch Output が普及し、導入とインターロックの案内が不要になる

⚠ 逆に、Twitch ToS §11 の条文が削除されても**この判断は変わらない**——
撤回の理由は規約ではなく、25-2 のシーン乗っ取りだからである。

### 25-9 ⚠ 未実施のまま終わったもの（再開時に引き継ぐ）

- ⚠⚠⚠ **実機の後始末**（[25-7b](#25-7b--実機に残るものコードは消えたが書き込んだものは消えていない)）——
  keychain 2 本 ／ OBS の 3 ソース ／ 平文の配信キー 4 箇所 ／ **配信キーの再生成**。**すべて未実施。**
- ~~`security-review`（段 067e-6・**一度も実施していない**）~~
  → **2026-09-12 に実施した**（撤回差分に対する初回。判定＝軽微な懸念あり・修正必須 1 件＝上記の後始末）。
  ⚠ **実装期間中のコードに対しては、最後まで一度も実施されなかった**ことは変わらない
- sidecar 側の 067 テスト（§22-2 が「本タスクで最も重要」と名指しした
  `stream_policy_is_frozen_in_sidecar` を含め、**1 本も書かれなかった**）
- 実機での通し確認（**一度も成功していない**）
- S-8（Windows・098 の VM 待ち）

⚠⚠ **再開するなら、これらが未了であることが出発点である。**「動いていた実装がある」ではない。
