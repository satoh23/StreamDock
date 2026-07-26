# 044s obs-websocket 技術検証（スパイク・方式決定）

> 状態: **未着手（スパイク＝技術検証・本実装しない）**。分割・線引きは親 [044](044-obs-auto-source.md) を正とする。
>
> **必読前提**: 親 [044](044-obs-auto-source.md)、[033f](033f-obs-transparent-overlay.md)（現行オーバーレイ窓・窓名）、[`docs/security.md`](../security.md)（§1／allow-list／sidecar 封じ込め／§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。本タスクは**検証用コードに留め本実装しない**（成果物は決定メモ）。

## 目的

要望①（OBS へオーバーレイソースを自動追加）を、方針反転のコストとリスクを見極めた上で正しい方式で実装できるよう、**obs-websocket 連携の実現性を実測で検証**し、
**方式 A（ウィンドウキャプチャ）／方式 B（ブラウザソース＋ローカル HTTP）を決定**する。技術的に可能か・どこが脆いか・工数を確定するのが本タスクのゴール。

## 現在の前提（調査結果・実コード）

- obs-websocket 連携は未実装（親 044 の「現在の前提」参照）。現行は透過窓（label `comment-overlay`・窓名「StreamDock コメントオーバーレイ」）＋手動ウィンドウキャプチャ。
- 通信面は sidecar 封じ込めが方針（Rust 完全同期）。sidecar 宛先は [`host-guard.ts`] の allow-list で fail-closed。sidecar は Node（`ws` 等）で WS を既に扱う。
- OBS WebSocket は v5 系プロトコル（OBS 28+ 同梱）。既定 `ws://127.0.0.1:4455`、パスワード認証は任意（設定で有効/無効）。

## このタスクでやること（検証項目）

### (1) 疎通

- sidecar から `ws://127.0.0.1:4455` へ obs-websocket v5 で接続できるか（`obs-websocket-js` を検証用に導入）。**認証パスワード有/無の両対応**（有効時のハンドシェイク）。
- **graceful 失敗**の確認: OBS 未起動 / WebSocket サーバ無効 / ポート相違 / 認証失敗 のとき、クラッシュ・hot-loop せず「OBS に接続できません（手動手順へ）」に落とせるか。

### (2) ソース自動作成の可否と方式比較

- **方式 A（ウィンドウキャプチャ）**: `CreateInput` 等で「ウィンドウキャプチャ」ソースを作り、既存透過窓（窓名指定）をターゲットにできるか。
  - Windows: ソース種別 kind とウィンドウ指定形式（`title:class:exe`）、WGC/透過の挙動。
  - macOS: ソース種別（ScreenCaptureKit 系）と**画面収録権限**の要否・付与フロー、ウィンドウ指定の安定性。
  - → OS 依存の脆さ（ウィンドウ名の一致・DPI・権限）を実測。
- **方式 B（ブラウザソース）**: オーバーレイを**ローカル HTTP 配信**し、`CreateInput` で「ブラウザソース」に loopback URL を設定できるか。透過の安定性・クロスプラットフォーム一貫性・HTTP サーバ新設の工数（Rust に持つと同期方針に反するため sidecar 側 or 別手段）を実測。
- 両方式で **既存ソースの検出→重複追加防止**（`GetSceneItemList`/`GetInputList` 等）、**シーン選択**（どのシーンに足すか・現在シーン取得）を確認。

### (3) セキュリティ設計の素案

- allow-list（[`host-guard.ts`]）に **loopback `127.0.0.1:4455`** を通す最小の設計（外部 HTTPS/WSS の allow-list とは分離・loopback 限定）。
- パスワードの受け渡し（UI 入力→sidecar・非ログ・非永続 or キーチェーン）と、接続はユーザーが有効化した時のみ、の設計素案。

## 成果物

- **方式決定メモ**（A か B か・理由＝実現性/脆さ/工数/クロスプラットフォーム）。本ファイル末尾または 044a に転記。
- **security 方針の差分ドラフト**（§1 loopback 限定解禁・§10 依存・パスワード §9）＝ 044a で [`docs/security.md`](../security.md) へ正式追記する内容の下書き。
- **044a の実装スコープ確定**（対象ファイル・UI 位置・フォールバック仕様）。

## このタスクでやらないこと

- **本実装**（044a）。検証コードはブランチ/破棄前提の最小限に留め、本体へマージしない。
- 外部インターネット通信の追加（検証も loopback 4455 のみ）。方式の事前決め打ち（実測で決める）。

## セキュリティ制約（docs/security.md 準拠）

- 検証通信も **loopback（`127.0.0.1:4455`）のみ**。外部インターネットへ出さない。パスワード等は**非ログ・非外部送信**（§9）。
- 検証で入れる依存（`obs-websocket-js`）は**検証用**であり、本採用は 044a で §10 記録＋security-review を通してから。

## 完了条件

- 疎通（認証有/無・graceful 失敗）が確認できる。方式 A/B のソース自動作成可否・脆さ・工数が実測で比較され、**方式が決定**している。
- security 方針の差分ドラフトと 044a の実装スコープが用意できている。
- 本体コードに検証コードを残していない（`git status` で確認）。[`docs/progress.md`](../progress.md) にスパイク結果を記録。

## 確認コマンド

```bash
# 検証は使い捨てブランチ推奨。OBS を起動し WebSocket サーバ（ツール→WebSocket サーバー設定）を有効化して実施。
# 疎通/ソース作成の検証スクリプト（sidecar 内 or 単体）を実行し、A/B それぞれで OBS にソースが出る/出ないを目視。
# lsof -i で 4455 への接続が sidecar PID 下のみ・外部 ESTABLISHED が増えないことを確認。
git status   # 検証コードが本体に残っていないこと
```

## 実装後に必要なレビュー

- 本スパイクは security 方針の**ドラフト作成**まで（本レビューは 044a で実施）。ただし検証段階でも loopback 限定・非ログを守ること。

---

## スパイク結果（2026-07-26・macOS 実測）

検証は使い捨てブランチ `044s-obs-websocket-spike`＋**リポジトリ外の単体スクリプト**（scratchpad・`obs-websocket-js` は検証用に別環境へ導入）で実施し、
**本体コード・依存は一切変更していない**（host-guard も未改変）。OBS の GUI 操作・目視は本人が担当。**検証コードは破棄**（本体マージ無し）。

### 実測環境
- OBS **32.1.2**（macOS）/ obs-websocket **5.7.3**（OBS 同梱）/ RPC v1。既定 `ws://127.0.0.1:4455`。
- ターゲット透過窓「StreamDock コメントオーバーレイ」（`open_comment_overlay_window`）を本人がアプリから表示。

### (1) 疎通・認証・graceful 失敗（すべて確認）
| ケース | 結果 |
|---|---|
| 認証**なし**接続 | ✅ 接続成功（`GetVersion`/`GetSceneList`/`GetInputKindList` 取得可） |
| 認証**あり**接続（パスワード） | ✅ ハンドシェイク成功。**パスワードは出力・ログに一切出さず**（ファイル経由で受領） |
| 誤パスワード（認証有効時） | ✅ `4009: Authentication failed.` を graceful に catch（≈5ms・クラッシュ/hot-loop なし） |
| 未起動 / WS 無効 / ポート相違 | ✅ `ECONNREFUSED` を graceful に catch（≈1–4ms） |
- いずれも**単発試行＋timeout（4s）**で catch でき、UI 文言（「OBS に接続できません／手動手順へ」）へ落とせる。実装ではリトライは**指数バックオフ**推奨。

### (2) 方式 A（ウィンドウキャプチャ）＝**成功**
- macOS の `GetInputKindList` に **`window_capture` と `screen_capture` の両方**が存在（当初「mac は ScreenCaptureKit のみ」の推論を実測で更新）。従来型 **`window_capture`** を採用。
- `CreateInput`（`window_capture`）→ `GetInputPropertiesListPropertyItems("window")` で**ウィンドウ候補26件**を列挙。**オーバーレイ窓を窓名で発見**: `[stream-dock] StreamDock コメントオーバーレイ`。
- macOS の window_capture 設定は **`{owner_name, window_name, window(数値ID)}` の3フィールド**。`window`（数値ID・**起動毎に変化＝不安定**）に加え、**安定キー `owner_name`（"stream-dock"）＋`window_name`（"StreamDock コメントオーバーレイ"）**を併せて設定 → **本人目視でオーバーレイが透過合成表示されることを確認**。
- **既存検出→重複追加防止（べき等）**：`GetInputList` で同名ソース検出時は再作成しないことを確認。作成先は `GetSceneList.currentProgramSceneName`（現在シーン）。
- `window_name`/`capture_window` プロパティは `window_capture` に**存在しない**（`600: Unable to find a property by that name.`）＝窓指定は上記3フィールド形式で行う（Windows の `title:class:exe` 文字列とは別形式）。

### (3) 方式 B（ブラウザソース）＝**この環境では未描画（不採用理由の一つ）**
- 単体スクリプト内の極小ローカル HTTP（`127.0.0.1:<port>`）で透過テスト HTML を配信し、`CreateInput`（`browser_source`）に URL 設定は**成功**（べき等更新も可）。
- しかし **OBS ブラウザソースが loopback URL を取得しない**：自動作成時・`SetInputSettings`＋`refreshnocache`・手動リフレッシュのいずれでも **HTTP 取得リクエストがサーバへ 0 件**（同 URL への `curl` は 200/正常配信＝**サーバ側は正常**、取得しないのは OBS/CEF 側）。**「対話（Interact）」で真っ黒・操作不能**＝CEF がページを描画していない。
- 一般にブラウザソース＋localhost は動く手法のため、これは**この OBS 32.1.2/macOS 環境固有の不具合の可能性**が高いが、**本製品ユーザーの実機で現に動かない**という事実は方式選定に効く。加えて方式 B は**ローカル HTTP 配信の新設（工数・sidecar 側 or 別手段）**が必要。

### (4) 通信面（loopback 封じ込め）
- `lsof -i` で、OBS 接続は `127.0.0.1:<x> → 127.0.0.1:4455`、方式 B の HTTP は `127.0.0.1:<port>` の **loopback のみ**。**外部 ESTABLISHED はゼロ**（`[::1]:1420` は Vite 開発サーバ＝IPv6 loopback で外部ではない）。

## 方式決定メモ → **方式 A（ウィンドウキャプチャ自動追加）を採用**

| 観点 | 方式 A（ウィンドウキャプチャ） | 方式 B（ブラウザソース＋ローカル HTTP） |
|---|---|---|
| 実現性（実測） | ✅ 動作（自動作成・窓ターゲット・透過合成・べき等） | ⚠ 作成は可だが**この環境で未描画**（取得ゼロ／Interact 黒） |
| 工数 | 小（既存の透過窓を再利用・**HTTP サーバ不要**） | 大（**ローカル HTTP 配信の新設**＋不具合の追加調査） |
| 脆さ | 窓名一致（`owner_name`＋`window_name`）・数値 ID は不安定だが安定キーで再解決・**macOS 画面収録権限**（既に OBS へ付与済みなら追加プロンプト無し）・DPI/多窓 | 透過は本来安定・クロスプラットフォーム一貫だが、**まず描画不具合の解消が前提** |
| アーキ整合 | ✅ Rust 完全同期のまま・obs-websocket は sidecar 側・**main no-internet 不変** | 同左だが HTTP 配信面が増える |

**理由**：方式 A は実測で end-to-end 動作（自動追加・重複防止・透過合成）が確認でき、**HTTP サーバ新設が不要**で既存アーキ（Rust 同期／sidecar 封じ込め）に最小変更で載る。方式 B は作成 API は通るが**本製品ユーザーの実機で描画されず**、さらにローカル HTTP 配信の新設という追加工数・攻撃面が要る。→ **A を採用**。B は将来「描画不具合の解消＋HTTP 配信の整備」が揃えば再検討可（本決定を覆すには 044s 相当の再実測が必要）。

### 方式 A の残リスク（044a で対処）
- **窓一致の安定性**：`owner_name`＋`window_name` で再解決させる（数値 ID に依存しない）。オーバーレイ窓名「StreamDock コメントオーバーレイ」を安定キーとして扱う（窓名変更時は追従設定が必要）。
- **macOS 画面収録権限**：OBS 本体に付与済みなら追加プロンプトは出ない（今回の実測でも出ず）。未付与ユーザー向けに権限誘導の案内を用意。
- **Windows は要実機検証（後日 098 VM）**：Windows の `window_capture` は kind／`window` 指定が **`title:class:exe` 文字列**形式・**WGC/透過**挙動・DPI が macOS と異なる（本スパイクは macOS 実測のみ）。044a では OS 分岐で窓指定を組み立て、Windows は 098 で実挙動確認。

### 検証コードの所在
- scratchpad（リポジトリ外）の単体スクリプト `spike.mjs`＋検証用 `obs-websocket-js`。**本体（main）へは未マージ・依存追加なし・host-guard 未改変**。スパイク用 OBS ソース（`SD_SPIKE_A_window`/`SD_SPIKE_B_browser`）とパスワードファイルは削除済み。
