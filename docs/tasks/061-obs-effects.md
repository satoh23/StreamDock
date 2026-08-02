# 061 OBS エフェクト基盤＋投げ銭エフェクト（親・設計/方針）

> 状態: **未着手（親ドキュメント）**。本ファイルは 061a〜061d の**分割・線引き・実装順の正**。
>
> **必読前提**: 透過オーバーレイ窓の生成 [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)（`open_pinned_overlay_window` が最新の手本）、
> OBS 自動追加 [`obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts)（`OBS_OVERLAYS` レジストリ）と [044a](044a-obs-auto-source-impl.md) / [046d](046d-pinned-overlay-obs-auto-add.md)、
> 方式決定 [044s](044s-obs-websocket-spike.md)（**ウィンドウキャプチャ＝方式 A**）、
> 画面導線 [`headerSections.ts`](../../apps/desktop/src/components/headerSections.ts)（**「OBSエフェクト」が `implemented: false` で既に存在**）と [`types.ts`](../../apps/desktop/src/types.ts)（`Screen` に `obs-effects`）、
> 課金判定 [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts)（`isMonetaryEvent` / `composeEventMessage` / `monetaryTone`）、
> **Jewels combo 再送 [043e](043e-youtube-jewels-combo-fidelity.md)（同一 id が更新で再送される）**、
> 取り込み方式の先行設計 [039](039-font-import.md) / [060b](060b-custom-css-import-backend.md)、
> [`docs/security.md`](../security.md)（§1／§3／§5／§8／Capabilities 方針／レビュー必須条件）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。各サブタスクは 1 タスク 1 機能で分割済み。

## 目的

依頼者の要望④のうち**視覚**の部分を実装する。

- 課金チャットを検知したとき、**配信にエフェクトが出せる**（「〇〇さんが ¥1,000」のような表示）。
- それとは別に、**OBS のエフェクトを import してそのままテンプレートとして適用**できる形にする（**マスト**）。

あわせて、[063](063-gacha-effect.md)（ガチャ）が乗る**エフェクト基盤**をここで作る。

## 現在の前提（調査結果・実コード）

### 「OBSエフェクト」画面は導線だけ既に存在する

- [`headerSections.ts`](../../apps/desktop/src/components/headerSections.ts) に
  `{ id: "obs", label: "OBSエフェクト", screen: "obs-effects", implemented: false, comingSoonDescription: "OBS と連携して配信画面にエフェクトを反映する機能を準備中です。" }` があり、
  [`types.ts`](../../apps/desktop/src/types.ts) の `Screen` にも `"obs-effects"` が入っている。
  現状は `ComingSoonScreen`（準備中プレースホルダ）が出る。**061 がこれを実体化する。**

### 透過オーバーレイ窓と OBS 自動追加の仕組みは完成している

- Rust の窓生成は 3 本（`open_comment_viewer_window` / `open_comment_overlay_window` / `open_pinned_overlay_window`）。
  透過窓の作法は `transparent(true)` + `decorations(false)` + `always_on_bottom(true)` + `focused(false)` +
  `shadow(false)` + `background_throttling(Disabled)` + `SHARED_BROWSER_ARGS` + `WINDOW_OPEN_LOCK`。
  ⚠ **`SHARED_BROWSER_ARGS` は全窓でバイト一致**していないと Windows で WebView2 生成が失敗する（033f 追修正③の経緯）。
- OBS 側は [`obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts) の `OBS_OVERLAYS`
  （`ObsOverlayKind = "comments" | "pinned"`）に**種別ごとのソース名／窓名**が閉じており、
  `enable` / `hide` / `disable` のオンデマンド接続でソースを自動追加する。
  ⚠ **窓名は Rust の `.title` と sidecar の `windowTitle` の 2 者間契約でバイト一致が必須**。
  候補一致は `includes` なので、**片方が他方の部分文字列であってはいけない**。
  この契約は `lib.rs` の `pinned_overlay_contract` テストで固定されている。
- ⚠ **[046d](046d-pinned-overlay-obs-auto-add.md) が「1 → 2 ソースへの一般化」を済ませている**ので、
  061a は**3 本目**（同じ広げ方の 3 回目）になる＝設計は既に敷かれている。

### エフェクトに使える判定はすべて既存

- `isMonetaryEvent(eventType)` / `displayEventType(c)` / `composeEventMessage(c)`（「〇〇さんが…しました」）/
  `monetaryTone(c)`（金額ティア配色）が [`viewerFormat.ts`](../../apps/desktop/src/screens/comment-viewer/viewerFormat.ts) と
  [`monetaryTone.ts`](../../apps/desktop/src/screens/comment-viewer/monetaryTone.ts) にある。
  **エフェクトも必ずこの 1 本を使う**（判定の 2 実装は片方だけ更新漏れが起きる）。
- ⚠ **[043e](043e-youtube-jewels-combo-fidelity.md) の combo 再送**: YouTube Jewels は**同一 id が更新として再送**される。
  `mergeComments` はこれを `updated` バケットで返す。**エフェクトは `added` でのみ発火し、`updated` では発火しない**。
- ⚠ **Twitch コミュニティギフトの二重計上**（043a から残る既存課題）: N 件のギフトで **N+1 行**届く。
  → **エフェクトが N+1 回出る**。抑制が要る。

### エフェクトのアセットを取り込む経路は存在しない

- `fs` plugin も asset protocol も未導入。ファイル書き込みコマンドは 1 本も無い。
- [039](039-font-import.md) / [060b](060b-custom-css-import-backend.md) が
  「`app_data_dir` へコピー＋Rust 検証＋SQLite レジストリ＋data URI で webview へ供給」という
  **確定方針**を持っている。**061c はこれをなぞる。**

## 確定した方針

### (1) エフェクトは「専用の透過窓 ＋ OBS ウィンドウキャプチャ」で出す

- コメントオーバーレイ・固定コメントと**同じ仕組みの 3 本目**。新しい表示手段を発明しない。
- ⚠ **ブラウザソース方式は採らない**（[044s](044s-obs-websocket-spike.md) が「当該環境で未描画」と実測済み）。
  たぬえさ3 が `forOBS3.html` をブラウザソースで読ませているのとは**前提が違う**。

### (2) テンプレートは「アセット＋宣言的レイアウト」（依頼者決定）

- 同梱物 = **画像 / GIF / APNG / WebM(alpha) / 音源** ＋ **`manifest.json`**（配置・サイズ・表示秒数・
  差し込み変数の位置）。
- ⚠ **HTML / CSS / JS は実行しない。** 理由:
  - 第三者の任意コード実行になり、`dangerouslySetInnerHTML` 使用ゼロという既存の不変条件と正面衝突する。
  - 現アーキテクチャ（ウィンドウキャプチャ・`csp: null`）だと、**注入された JS は Tauri のコマンドを
    全部呼べる**（[`docs/security.md`](../security.md) 046b 節：アプリ定義コマンドは ACL の対象外）。
  - たぬえさ3 互換（`forOBS3.html` をそのまま読む）は**捨てる**。互換より安全性を採る。
- ⚠ **「そのままテンプレートとして適用」の意味を UI で正しく伝えること**。
  他所の HTML エフェクトは読めない。**StreamDock 形式のテンプレート**を読む。

### (3) 発火は 1 か所に集約する

- 「どのイベントで・どのエフェクトを・何回出すか」を決める層を 1 つだけ持つ（`effectTrigger`）。
  投げ銭（061b）もガチャ（[063b](063b-gacha-draw-and-triggers.md)）もここに乗る。
- ⚠ **多重発火の抑制は基盤側の責務**（combo 再送・コミュニティギフト N+1・連投）。
  各エフェクトが個別に対策すると必ず漏れる。

### (4) 保存・供給は 039 / 060b の確定方針をなぞる

- `app_data_dir/effects/<id>/` へ保存、レジストリは SQLite テーブル `effect_templates`。
- webview へは **data URI**（asset protocol も CSP も capability も増やさない）。

## 子タスクと線引き

| 子 | 内容 | 層 | 外部通信（新規） | レビュー |
|---|---|---|---|---|
| [061a](061a-effect-overlay-window.md) | エフェクト用透過窓＋OBS ソース自動追加（3 本目の一般化）＋`obs-effects` 画面の枠 | Rust/sidecar/frontend | なし | **軽 security-review** |
| [061b](061b-monetary-effect-builtin.md) | **組み込み投げ銭エフェクト**（「〇〇さんが ¥1,000」）＋発火層＋多重発火抑制 | frontend | なし | 軽レビュー |
| [061c](061c-effect-template-import.md) | **テンプレート取り込み**（アセット＋`manifest.json`＋Rust 検証＋レジストリ） | Rust | なし | **security-review 必須** |
| [061d](061d-effect-template-ui.md) | テンプレート適用 UI（一覧・切替・プレビュー・イベント割り当て） | frontend | なし | 軽レビュー |

- **061a が土台**（窓・OBS ソース・画面の枠）。ここが無いとエフェクトを映す場所が無い。
- **061b が「発火層」を作る**。061c/061d と [063](063-gacha-effect.md) はここに乗る。
- **061c と 061d を分ける**理由＝061c は「第三者が作ったファイルを取り込む」（security-review 必須）、
  061d は「取り込んだものを選ぶ」（軽レビュー）で**リスクの質が違う**。

## 依存関係と推奨実装順

```
061a ──> 061b ──> 061c ──> 061d
                     └──> 063（ガチャ）
```

- **061a + 061b で「組み込みエフェクトが配信に出る」まで通しで動く**。ここで実機の手応えを見る。
- 061c/061d はテンプレート持ち込みの増分。**マスト要件だが、061b までで一度動くものを作る**のが安全。

## 横断セキュリティ方針（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。テンプレートはローカルファイルの取り込みのみ。
  ⚠ **`manifest.json` に URL フィールドを作らない**（外部取得の経路を最初から作らない）。
- **第三者コードを実行しない。** テンプレートは**宣言的データ＋メディアファイル**のみ。
  HTML/CSS/JS を受け付けない。`dangerouslySetInnerHTML` を使わない。
- **ファイル操作は Rust 側・`app_data_dir/effects/` 限定**（§5）。管理ディレクトリ外へ書き込まない。
  **ファイル名にユーザー入力を使わない**（id 由来で採番）。
- **入力検証は Rust 側で必ず行う**（§8）。拡張子許可リスト・サイズ上限・件数上限・
  `manifest.json` のスキーマ検証・パス検証・制御文字拒否。
- **コマンドは単一目的・最小権限**（§3）。⚠ **足したコマンドは全窓から呼べる**（ACL 対象外）前提で設計する。
- **capability の追加はエフェクト窓の 1 ファイル（`core:default` のみ）だけ**。
  `dialog:allow-open` は [060b](060b-custom-css-import-backend.md) で `comment-viewer.json` に追加済みだが、
  **エフェクト画面は main 窓**なので `default.json` の既存 `dialog:allow-open` で足りる（追加不要）。
- **窓名の 2 者間契約を壊さない**（Rust `.title` ↔ sidecar `windowTitle` のバイト一致・
  互いに部分文字列でないこと）。**テストで固定する**（`pinned_overlay_contract` の先例）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ。**新規依存ゼロを目指す。**
- ログにテンプレート名・ファイルパス・投稿者名・金額を出さない（§9）。

## 完了条件（親）

- 061a〜061d のタスクファイルが本親の分割・依存どおりに存在し、既存フォーマットに沿う。
- [`docs/task-board.md`](../task-board.md) に 061 系が追記されている。
- 本親ドキュメント自体はコードを変更しない（実装は各サブタスクで「実装して」後）。

## security.md へ追記する節の割り当て

| 節 | 追記する子 | 内容 |
|---|---|---|
| Capabilities 方針 | [061a](061a-effect-overlay-window.md) | エフェクト窓の capability（`core:default` のみ・既存 3 窓と同型） |
| §5 ファイル操作 | [061c](061c-effect-template-import.md) | 例外節（`app_data_dir/effects/` への取り込み書き込み・060b と同型） |
| §8 入力検証 | [061c](061c-effect-template-import.md) | `manifest.json` のスキーマ検証・メディアの拡張子/サイズ/件数上限 |
| §10 依存 | [061c](061c-effect-template-import.md) | 新規依存ゼロを記録（画像/動画の検証で足す場合はその理由） |

## このタスク（親）でやらないこと

- コード実装（061a〜d それぞれで行う）。
- **ガチャ**（[063](063-gacha-effect.md)）。061 はガチャが乗る基盤まで。
- **通知音**（[059](059-notification-sounds.md)）。ただしテンプレートに音源が含まれるので、
  **エフェクトの音**は 061c/061d の範囲（通知音とは別系統）。
- **たぬえさ3 の `forOBS3.html` 互換**（第三者コード実行になるため採らない）。
- ブラウザソース方式への変更（[044s](044s-obs-websocket-spike.md) の決定を覆すには 044s 相当の再実測が要る）。
- チャンネルポイント連携（Twitch）。⚠ 新規 OAuth スコープが要るので別タスク
  （[040](040-lurker-list.md) が同種の論点を持っている）。
- 配信中のエフェクト手動発火（テストボタン以外）。
- エフェクトの共有・配布・マーケットプレイス。

## 実装後に必要なレビュー

- [061a](061a-effect-overlay-window.md): **軽 security-review**（新規窓＋新規 capability ファイル＋
  OBS ソースの追加＝044a/046d と同型のため軽め）。
- [061b](061b-monetary-effect-builtin.md) / [061d](061d-effect-template-ui.md): **軽レビュー**。
- [061c](061c-effect-template-import.md): **security-review 必須**
  （§5 ファイル書き込み経路・§8 入力検証・第三者ファイルの取り込み）。
