# 061a エフェクト用透過窓＋OBS ソース自動追加＋`obs-effects` 画面の枠

> 状態: **未着手（実装サブタスク）**。分割・線引きは親 [061](061-obs-effects.md) を正とする。
>
> **必読前提**: 親 [061](061-obs-effects.md)、
> 窓生成の手本 [`lib.rs`](../../apps/desktop/src-tauri/src/lib.rs)（`open_pinned_overlay_window` ＋ `pinned_overlay_contract` テスト）と [046b](046b-pinned-overlay-window.md)、
> OBS 自動追加 [`obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts)（`ObsOverlayKind` / `OBS_OVERLAYS`）と [046d](046d-pinned-overlay-obs-auto-add.md)（**1 → 2 ソースへの一般化の先例**）、
> 制御フレーム [`commentStream.ts`](../../apps/desktop/src/features/comment-viewer/commentStream.ts)（`obs-enable` / `obs-hide` / `obs-disable`）と sidecar の [`index.ts`](../../apps/comment-sidecar/src/index.ts)、
> 窓ルーティング [`App.tsx`](../../apps/desktop/src/App.tsx)、画面導線 [`headerSections.ts`](../../apps/desktop/src/components/headerSections.ts)、
> capability の書式 [`pinned-overlay.json`](../../apps/desktop/src-tauri/capabilities/pinned-overlay.json)、
> [`docs/security.md`](../security.md)（§1／§3／Capabilities 方針／レビュー必須条件）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。**軽 security-review**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

エフェクトを配信画面に出すための**器**を作る。具体的には 3 つ。

1. **エフェクト専用の透過オーバーレイ窓**（label `effect-overlay`）
2. **OBS への自動ソース追加**（`ObsOverlayKind` の 3 本目）
3. **`obs-effects` 画面の枠**（`ComingSoonScreen` を実画面へ差し替え）

**この時点ではまだ何も表示しない**（エフェクトの中身は [061b](061b-monetary-effect-builtin.md)）。
器が正しく OBS に載ることだけを確かめる。

## 現在の前提（調査結果・実コード）

- 透過窓は 2 本ある（`comment-overlay`＝033f / `pinned-overlay`＝046b）。生成の作法は
  `transparent(true)` + `decorations(false)` + `always_on_bottom(true)` + `focused(false)` + `shadow(false)` +
  `background_throttling(Disabled)` + `additional_browser_args(SHARED_BROWSER_ARGS)` + `WINDOW_OPEN_LOCK`。
  ⚠ **`SHARED_BROWSER_ARGS` は全窓でバイト一致**が必須（Windows で WebView2 生成が `ERROR_INVALID_STATE` になる・033f 追修正③）。
  この不変条件は `lib.rs` のテストで固定済み。
- 各窓に **1 枚ずつ capability ファイル**があり、いずれも `"permissions": ["core:default"]` のみ。
  `windows` はラベル完全一致で、permission は他窓へ継承されない。
- `obs-client.ts` の `ObsOverlayKind = "comments" | "pinned"` と `OBS_OVERLAYS` レジストリに
  ソース名／窓名が閉じている。⚠ **viewer から任意の名前を受け取らない固定 union**（§3/§8）。
- ⚠ **窓名の 2 者間契約**: Rust の `.title` と sidecar の `windowTitle` が**バイト一致**し、かつ
  **互いに部分文字列でない**こと（候補一致が `includes` のため）。`pinned_overlay_contract` テストで固定済み。
  ⚠ **壊れると静かに失敗する**: `ensureOverlaySource` の M2 フォールバックにより、
  既存ソースがある状態で窓名不一致になると **`"reused"`＝成功として返る**（UI は成功表示・OBS は真っ黒）。
- 制御フレームは viewer → sidecar の WS で送る（`obs-enable` / `obs-hide` / `obs-disable`）。
  ⚠ **これらを送っているのはコメビュ窓**（`CommentViewerApp`）。エフェクト窓は**表示専用**で WS に制御を送らない。
- `App.tsx` は窓 label を見て 4 つのルート App を出し分ける（同一 Vite バンドルを全窓が読む）。
- `headerSections.ts` の「OBSエフェクト」は `implemented: false` で `ComingSoonScreen` が出る。

## このタスクでやること

### (1) Rust: エフェクト窓の生成／終了／存在確認（`lib.rs`）

- `open_effect_overlay_window` / `close_effect_overlay_window` / `is_effect_overlay_open` の 3 本を
  **`open_pinned_overlay_window` の完全踏襲**で足す（`#[tauri::command(async)]` は open のみ）。
- **窓タイトル = `"StreamDock エフェクト"`**。
  ⚠ 既存 2 本（`"StreamDock コメントオーバーレイ"` / `"StreamDock 固定コメント"`）と
  **互いに部分文字列でない**ことを確認済み。
- **サイズと位置**: エフェクトは画面中央〜上部に大きく出すものなので、既存 2 本より大きめの既定値にする
  （実値は実装時に決め、**理由をコメントに残す**）。⚠ `decorations(false)` では手動リサイズが実質できず
  サイズは永続化されない＝**既定値がすべて**（046c の教訓）。
- **window イベントを登録しない**（この窓は sidecar を起動/停止しない＝`comment-overlay` / `pinned-overlay` と同じ）。
- `pinned_overlay_contract` 相当のテストを**3 窓ぶんに拡張**する:
  - 3 つの窓タイトルが sidecar の `OBS_OVERLAYS` とバイト一致すること
  - **3 つが互いに部分文字列でない**こと（2 つのときより組み合わせが増える＝ここが 3 本目の新しい risk）
  - `SHARED_BROWSER_ARGS` が全 5 窓（`main` は `tauri.conf.json`）でバイト一致していること

### (2) capability（新規 1 ファイル）

- `capabilities/effect-overlay.json` を追加。既存 3 枚と同型で **`"permissions": ["core:default"]` のみ**。

```json
{
  "identifier": "effect-overlay",
  "description": "Capability for the OBS effect transparent overlay window (061a). Display-only, minimal permissions.",
  "windows": ["effect-overlay"],
  "permissions": ["core:default"]
}
```

- ⚠ **これ以外は増やさない**。
- ⚠ [`docs/security.md`](../security.md) の Capabilities 方針に 1 行追記する
  （「capability だけを見て『この窓は無害』と判断しないこと」＝アプリ定義コマンドは ACL 対象外、という
  046b の注記が既にあるので、**その但し書きの適用対象が 1 窓増えた**ことを書く）。

### (3) sidecar: `ObsOverlayKind` の 3 本目（`obs-client.ts`）

- `ObsOverlayKind` に `"effects"` を足し、`OBS_OVERLAYS` にエントリを 1 つ追加する。

```ts
effects: {
  sourceName: "StreamDock エフェクト",
  windowTitle: "StreamDock エフェクト",
},
```

- ⚠ **`enable` / `hide` / `disable` のロジックは 1 行も変えない**（046d が既に kind 汎用化を済ませている）。
- ⚠ **`includes` による候補一致で 3 つが紛れないこと**をテストで固定する
  （`scripts/test-obs-client.mjs` に足す。046d が 2 つで固定したのを 3 つへ）。

### (4) 制御フレームと配線

- `commentStream.ts` の `obs-enable` / `obs-hide` は既に kind を取る形になっているはず。
  なっていなければ**ここで kind 対応にする**（046d の一般化の続き）。
- ⚠ **エフェクト窓の表示 ON/OFF と OBS 自動反映の連動は、046b/046d/045c で確立した規律に従う**:
  - 自動反映トグルは**設定を立てるだけ**（045c で「自動反映 ON が窓を開く経路」を回帰として削除した経緯）
  - **反映の契機は「表示 ON」**
  - 表示 OFF で `obsState` を idle へ戻す
  - ⚠ **猶予タイマーは必ず取り消す**（045c のレビューで見つかった既存回帰：猶予中に OFF にしても
    発火が止まらず `hideObs` の後に `enableObs` が飛んでいた）

### (5) frontend: `EffectOverlayApp` と `obs-effects` 画面の枠

- `screens/obs-effects/EffectOverlayApp.tsx`（新規）: 透過窓の描画本体。
  - `document.documentElement` に `data-overlay="1"` を立てる作法は `OverlayApp` を踏襲。
  - **この時点では中身は空**（[061b](061b-monetary-effect-builtin.md) が描く）。
    ただし **OBS のセットアップ時に窓の位置が分かる必要がある**ので、
    「エフェクトはここに出ます」の**セットアップ用ガイド表示**を出す
    （`OverlayApp` の `.empty`（「コメントはまだありません」）が同じ意図で残されている先例）。
    ⚠ **配信中に出ないよう、`obs-effects` 画面を開いている間だけ**にするか、
    設定トグルで消せるようにする。**どちらにするか実装時に決めてコメントに残す。**
- `App.tsx` に窓 label `effect-overlay` の分岐を足す。
- `screens/obs-effects/ObsEffectsScreen.tsx`（新規）: main 窓の画面。
  この時点では「エフェクトを配信に表示する」トグル＋OBS 自動反映トグル＋接続ステータスだけ。
- `headerSections.ts` の `obs` エントリを **`implemented: true`** にする。
  ⚠ **`comingSoonDescription` は消す**（使われなくなるので残すと嘘になる）。

### (6) テスト

- Rust: 窓タイトル契約テストを 3 窓へ拡張（バイト一致・**相互に部分文字列でない**・`SHARED_BROWSER_ARGS` 一致）
- sidecar: `test-obs-client.mjs` に 3 種の kind が `includes` で紛れないケースを足す
- frontend: `ObsEffectsScreen` のトグル挙動（自動反映は設定を立てるだけ・表示 ON が反映の契機・
  **猶予タイマーの取り消し**）を 045c のテストと同型で固定する
- **ミューテーションで実効性を確認**する。最低限、窓タイトルを 1 文字変えたときにレッドになること。

## このタスクでやらないこと

- **エフェクトの中身**（[061b](061b-monetary-effect-builtin.md)）。本タスクは器だけ。
- **テンプレートの取り込み**（[061c](061c-effect-template-import.md)）。
- **発火層**（[061b](061b-monetary-effect-builtin.md)）。
- `obs-effects` 画面の本体 UI（テンプレート一覧・割り当ては [061d](061d-effect-template-ui.md)）。
- ブラウザソース方式（[044s](044s-obs-websocket-spike.md) の決定どおりウィンドウキャプチャ）。
- エフェクト窓のリサイズ・位置の永続化（`decorations(false)` では実質できない・046c の教訓）。

## セキュリティ制約（docs/security.md 準拠）

- **外部通信ゼロ**（§1）。OBS 接続は既存の loopback（`127.0.0.1:4455`）で、`assertAllowedObsUrl` を通る経路のまま。
  **新規宛先ゼロ。**
- **capability は 1 ファイル追加のみ**（`core:default` のみ・既存 3 枚と同型）。それ以外は増やさない。
  ⚠ **アプリ定義コマンドは ACL 対象外**なので、この窓も `invoke_handler` の全コマンドを呼べる。
  「capability だけを見て無害と判断しない」（046b の注記）が 1 窓増える。
- **コマンドは単一目的**（open/close/is_open の 3 本・任意ラベルの窓操作を露出しない・§3）。
- **`ObsOverlayKind` は固定 union のまま**（viewer から任意のソース名／窓名を受け取らない・§3/§8）。
- **窓名の 2 者間契約をテストで固定する**（壊れると OBS 自動追加が静かに失敗する）。
- `csp: null` 不変・`tauri.conf.json` 差分ゼロ・**新規依存ゼロ**。
- エフェクト窓に**コメント本文・投稿者名を持ち込まない**（本タスクの時点では何も表示しない）。

## 完了条件

- `open_effect_overlay_window` / `close_effect_overlay_window` / `is_effect_overlay_open` が動き、
  透過窓が既存 2 本と同じ体裁（透過・装飾なし・最背面・非フォーカス）で開く。
- `capabilities/effect-overlay.json` が追加され、**`core:default` のみ**。他の capability は差分ゼロ。
- OBS 自動追加でソース「StreamDock エフェクト」が作られ、**既存 2 ソースと取り違えない**。
- **3 窓のタイトル契約テスト**（バイト一致・相互に部分文字列でない・`SHARED_BROWSER_ARGS` 一致）が通る。
- ヘッダーの「OBSエフェクト」が `ComingSoonScreen` ではなく実画面を開く。
- 自動反映トグルが**設定を立てるだけ**で、反映の契機が**表示 ON**であること（045c の規律）。
- **猶予タイマーが表示 OFF / 自動反映 OFF で取り消される**こと。
- [`docs/security.md`](../security.md) の Capabilities 方針に 1 行追記されている。
- `tauri.conf.json` 差分ゼロ・`csp: null` 不変・新規依存ゼロ。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test`、`pnpm --filter ./apps/comment-sidecar test`、
  `cargo check` / `cargo test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/comment-sidecar test
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml   # 窓タイトル契約テスト

# capability は 1 ファイル増えるだけ（既存 4 枚は差分ゼロ）
git status --short -- apps/desktop/src-tauri/capabilities/
# tauri.conf.json は差分ゼロが期待
git status --short -- apps/desktop/src-tauri/tauri.conf.json .github/
# 新規依存ゼロの担保（差分ゼロが期待）
git status --short -- apps/comment-sidecar/package.json apps/desktop/package.json pnpm-lock.yaml package.json apps/desktop/src-tauri/Cargo.toml

pnpm --filter ./apps/desktop tauri dev
# ① ヘッダー「OBSエフェクト」が実画面を開く（準備中プレースホルダでない）
# ② 表示トグル ON → 透過窓が開く（最背面・非フォーカス・枠なし）
# ③ OBS 自動反映 ON ＋ 表示 ON → OBS に「StreamDock エフェクト」ソースが作られる
# ④ **既存の「StreamDock コメントオーバーレイ」「StreamDock 固定コメント」が取り違えられない**
#    （3 つ同時に表示して、それぞれ正しい窓が映ること）
# ⑤ 表示 OFF → ソースが非表示になる（削除されない）／ステータスが idle に戻る
# ⑥ 猶予中に表示 OFF → 後から enable が飛ばない
# ⑦ Windows（098 の VM が使えれば）で窓が生成できる（SHARED_BROWSER_ARGS の一致確認）
```

## 実装後に必要なレビュー

- **軽 security-review**（[`security-review`](../../.claude/skills/security-review/SKILL.md)）。
  [044a](044a-obs-auto-source-impl.md) / [046d](046d-pinned-overlay-obs-auto-add.md) と同型のため軽め。対象:
  - 新規 capability が `core:default` のみであること
  - コマンドが単一目的で、任意ラベルの窓操作を露出していないこと
  - `ObsOverlayKind` が固定 union のままであること（viewer から任意の名前を受け取らない）
  - 新規宛先ゼロ（OBS は既存 loopback のみ）
