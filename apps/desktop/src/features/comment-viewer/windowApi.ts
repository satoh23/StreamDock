import { invoke } from "@tauri-apps/api/core";

/**
 * 033e: 内蔵コメントビューア窓（label `comment-viewer`）の停止/開閉状態を扱う薄い Rust command ラッパ。
 *
 * ツール管理（`MainScreen`）でコメビュを他ツールと同じ再生/停止・起動済み表示にするために使う。
 * コメビュは PID プロセスではなく Tauri ウィンドウのため、PID registry には載せず窓の開閉から状態を導出する。
 * 起動（開く）は既存の `launchTool`（Rust が `open_comment_viewer_window` を呼ぶ）を再利用するため、
 * ここには含めない（このファイルは停止＝窓 close と、状態取得＝窓存在確認のみ）。
 *
 * どちらもアプリ定義 command（`generate_handler!` 登録）で、Tauri v2 の ACL（capability の `permissions`）は
 * plugin/core command のみを対象とするため列挙不要（main は `core:default` で既に多数のアプリ command を invoke 済み）。
 */

/**
 * 内蔵コメントビューア窓を閉じる（ツール管理の「停止」用）。窓が無ければ Rust 側 no-op（冪等）。
 * PID kill は行わず、自アプリのウィンドウを閉じるのみ（docs/security.md §6）。
 *
 * ⚠⚠ **061b で「sidecar の停止も連動する」は偽になった**（061b レビュー S-1）。停止条件が
 * 「`comment-viewer` と `effect-overlay` のどちらも無いとき」へ広がったので、**エフェクト窓が
 * 開いている間はこれを呼んでも sidecar は落ちない**＝ Twitch/YouTube の取得（外部通信）も続く
 * （窓の close では `stop-session` を送らないため）。取得を確実に止めるのは
 * コメビュ窓の取得停止ボタン（`stop-session`）か、エフェクト窓も閉じること。
 * docs/security.md §1 の「取得の停止条件」が正。
 */
export function closeCommentViewerWindow(): Promise<void> {
  return invoke<void>("close_comment_viewer_window");
}

/**
 * 内蔵コメントビューア窓が開いているかを返す（読み取り専用）。
 * reconcile が窓の開閉から internal 行の起動状態を導出するために使う（開＝起動済み / 閉＝停止済み）。
 */
export function isCommentViewerOpen(): Promise<boolean> {
  return invoke<boolean>("is_comment_viewer_open");
}

/**
 * 033f: OBS 用の背景透過オーバーレイ窓（label `comment-overlay`）を開く（ワンクリック）。窓が既に開いていれば
 * Rust 側で再利用する（冪等）。033f 追修正で**最背面・非フォーカス**で開くため、配信者の画面に前面表示されず
 * OBS のウィンドウキャプチャにだけ映る。オーバーレイは**表示専用**で、sidecar の起動/停止には関与しない。
 * data 源は既存の loopback WS の読み取り専用接続のみ。
 *
 * ⚠ **061b: 「no-orphan kill 契機はコメビュ窓に集約のまま」ではなくなった**（061b レビュー②S-4）。
 * 契機は `comment-viewer` / `effect-overlay` の 2 点（Rust の `SIDECAR_CONSUMER_LABELS`）。
 * ただし**この窓はそこに入っていない**ので、「この窓は sidecar の生存に関与しない」は 033f から真のまま。
 */
export function openCommentOverlayWindow(): Promise<void> {
  return invoke<void>("open_comment_overlay_window");
}

/**
 * 033f 追修正: OBS 用オーバーレイ窓を閉じる（コメビュ本体の「閉じる」用）。窓が無ければ Rust 側 no-op（冪等）。
 * オーバーレイは最背面・非フォーカスで開き Cmd+W で掴みにくいため、本体から明示的に閉じられるよう用意する。
 * オーバーレイは sidecar を起動していないため、閉じても sidecar は落ちない
 * （⚠ 061b で kill 契機は 2 点へ広がったが、この窓は `SIDECAR_CONSUMER_LABELS` に入っていない）。
 */
export function closeCommentOverlayWindow(): Promise<void> {
  return invoke<void>("close_comment_overlay_window");
}

/**
 * 034d: OBS オーバーレイ窓（label `comment-overlay`）が開いているかを返す（読み取り専用）。
 * 設定ビューの開閉トグルが、初期同期・外部close後の再同期に使う（開＝ON / 閉＝OFF）。
 * アプリ定義 command のため capability 列挙不要（本ファイル冒頭の注記どおり）。
 */
export function isCommentOverlayOpen(): Promise<boolean> {
  return invoke<boolean>("is_comment_overlay_open");
}

/**
 * 046b: 固定コメント（046a のピン留め）専用の背景透過オーバーレイ窓（label `pinned-overlay`）を開く。
 * 既に開いていれば Rust 側で再利用する（冪等）。既存の `comment-overlay`（コメント一覧用）とは
 * **独立した別窓**で、OBS では別ソースとして取り込む（窓名「StreamDock 固定コメント」）。
 *
 * この窓は**表示専用**で WS へ接続しない（046a が localStorage に書いた固定コメントを読むだけ）。
 * sidecar の起動/停止にも関与しないため、閉じても sidecar は落ちない
 * （⚠ 061b で kill 契機は 2 点へ広がったが、この窓は `SIDECAR_CONSUMER_LABELS` に入っていない）。
 */
export function openPinnedOverlayWindow(): Promise<void> {
  return invoke<void>("open_pinned_overlay_window");
}

/**
 * 046b: 固定コメント専用オーバーレイ窓を閉じる（設定ビューのトグル OFF 用）。窓が無ければ Rust 側 no-op（冪等）。
 * 最背面・非フォーカスで開くため Cmd+W では掴みにくく、設定から明示的に閉じられるよう用意する。
 */
export function closePinnedOverlayWindow(): Promise<void> {
  return invoke<void>("close_pinned_overlay_window");
}

/**
 * 046b: 固定コメント専用オーバーレイ窓が開いているかを返す（読み取り専用）。
 * 設定トグルが、マウント時に「設定 ON なのに窓が無い」場合だけ開き直すために使う。
 * アプリ定義 command のため capability 列挙不要（本ファイル冒頭の注記どおり）。
 */
export function isPinnedOverlayOpen(): Promise<boolean> {
  return invoke<boolean>("is_pinned_overlay_open");
}

/**
 * 061a: エフェクト専用の背景透過オーバーレイ窓（label `effect-overlay`）を開く。
 * 既に開いていれば Rust 側で再利用する（冪等）。既存の `comment-overlay` / `pinned-overlay` とは
 * **独立した別窓**で、OBS では 3 本目の別ソースとして取り込む（窓名「StreamDock エフェクト」）。
 *
 * ⚠⚠ **061k でこれは「エフェクトの出力窓のうち*コーナー側*」になった**（もう 1 本は
 * [`openStageOverlayWindow`]＝全画面／ステージ側）。⚠ **label も窓タイトルも 1 バイトも変えていない**
 * ——変えると既に OBS にソースを作ったユーザーだけが `ensureOverlaySource` の M2 経路
 * （既存ソース＋窓名不一致 → `"reused"`＝成功として返る）で静かに壊れるため。
 * ⇒ **UI 上の呼び方だけを「コーナー（小さめ）」に変え、OBS のソース名は実際の窓名をそのまま案内する。**
 *
 * ⚠⚠ **061b で 061a の決定を反転した。** この窓は**表示専用のまま**だが、`comment-overlay` 窓と同じく
 * sidecar の loopback WS へ**読み取り専用接続**する（`connectCommentStream` の `onComments` だけ・
 * 制御フレームは送らない）。061a が「WS へ接続しない」と書いていたのは、当時の 061b が localStorage ＋
 * `storage` で `EffectRequest` を受ける設計だったため。その経路ごと廃止された。
 *
 * ⚠ **sidecar のライフサイクル**: この窓は sidecar を**起動しない**（起動契機は
 * `openCommentViewerWindow` の 1 箇所のまま）が、**この窓が生きている間は sidecar が落ちない**
 * （Rust の `SIDECAR_CONSUMER_LABELS`）。＝ **コメント取得を開始したあとコメビュ窓を閉じても
 * エフェクトが出続ける**。どの窓も無くなれば必ず落ちる（孤児プロセスを残さない）。
 *
 * ⚠ **呼ぶのは main 窓（`ObsEffectsScreen` と起動時復元）**。アプリ定義コマンドは ACL 対象外なので
 * main 窓からそのまま invoke できる（`default.json` は差分ゼロ）。
 */
export function openEffectOverlayWindow(): Promise<void> {
  return invoke<void>("open_effect_overlay_window");
}

/**
 * 061a: エフェクト専用オーバーレイ窓を閉じる。窓が無ければ Rust 側 no-op（冪等）。
 * 最背面・非フォーカスで開くため Cmd+W では掴みにくく、画面から明示的に閉じられるよう用意する
 * （`closePinnedOverlayWindow` と同型）。
 *
 * ⚠⚠ **061i 申し送り §9 の残骸をここで返済した**（061k）。旧コメントは用途として
 * **061i で廃止された旧トグルの OFF 操作**を唯一の呼び出し元として名指ししていた。
 * いまの呼び出し元は `ObsEffectsScreen` の前提ステータスにある**「ウィンドウを閉じる」**（明示操作）だけで、
 * ⚠ **これは `docs/security.md` §1「取得の停止条件」が名指しする停止導線そのもの**なので、
 * 存在しない操作を指す記述を残すと導線を壊すのと同じになる（061i レビュー S-1 と同型）。
 */
export function closeEffectOverlayWindow(): Promise<void> {
  return invoke<void>("close_effect_overlay_window");
}

/**
 * 061a: エフェクト専用オーバーレイ窓が開いているかを返す（読み取り専用）。
 * ⚠ **3 か所から呼ぶ**: ①`ObsEffectsScreen`（main 窓）が前提ステータスと起動時の窓復元に使う
 * ②`CommentViewerApp`（コメビュ窓）が `enableObs("effects")` を送る前の実窓確認に使う
 * （046d レビューの指摘＝設定値ではなく実窓で判定しないと、OBS に空ソースが残る）
 * ③`MainScreen` がコメビュ停止時のフィードバック文言を分岐するのに使う（§1 の導線）。
 */
export function isEffectOverlayOpen(): Promise<boolean> {
  return invoke<boolean>("is_effect_overlay_open");
}

/**
 * 061k: エフェクトの**全画面（ステージ）側の出力窓**（label `stage-overlay`）を開く。
 * 既に開いていれば Rust 側で再利用する（冪等）。既存の `effect-overlay`（コーナー側）とは
 * **独立した別窓**で、OBS では 4 本目の別ソースとして取り込む（窓名「StreamDock ステージ演出」）。
 *
 * ⚠⚠ **出力窓を用途別に 2 本へ分けたのが 061k の目的**——1 本しか無いと「全画面に出す演出」と
 * 「右下に小さく出す投げ銭」を同時に成立させられなかった。⚠ **どちらの窓に出すかは
 * 条件（`EffectCondition.output`）が決める**ので、この関数は「窓を用意する」だけを担う。
 *
 * ⚠ **sidecar のライフサイクル**: この窓は sidecar を**起動しない**（起動契機は
 * `openCommentViewerWindow` の 1 箇所のまま）が、**この窓が生きている間は sidecar が落ちない**
 * （Rust の `SIDECAR_CONSUMER_LABELS`）＝ **コメビュ窓を閉じてもステージ演出が出続ける**。
 * ⚠⚠ **裏返すと「この窓が開いている間はコメント取得（外部通信）が続く」**（docs/security.md §1）。
 * どの窓も無くなれば必ず落ちる（孤児プロセスを残さない）。
 *
 * ⚠ **呼ぶのは main 窓（`ObsEffectsScreen` と起動時復元）**。アプリ定義コマンドは ACL 対象外なので
 * main 窓からそのまま invoke できる（`default.json` は差分ゼロ）。
 */
export function openStageOverlayWindow(): Promise<void> {
  return invoke<void>("open_stage_overlay_window");
}

/**
 * 061k: ステージ演出オーバーレイ窓を閉じる。窓が無ければ Rust 側 no-op（冪等）。
 * 呼び出し元は `ObsEffectsScreen` の前提ステータスにある**「ウィンドウを閉じる」**（明示操作）だけで、
 * ⚠ **`docs/security.md` §1「取得の停止条件」が名指しする停止導線の一部**である
 * （コーナー側と**両方**閉じたときに sidecar が落ちる＝取得が止まる）。
 */
export function closeStageOverlayWindow(): Promise<void> {
  return invoke<void>("close_stage_overlay_window");
}

/**
 * 061k: ステージ演出オーバーレイ窓が開いているかを返す（読み取り専用）。
 * ⚠ **`isEffectOverlayOpen` と同じ 3 か所から、対で呼ぶ**（前提ステータス／`enableObs("stage")` の
 * 実窓確認／`MainScreen` の停止フィードバック）。
 * ⚠⚠ **片方だけ見て分岐しないこと**——§1 が要求する「取得が続いていることの明示」は
 * **どちらか 1 つでも開いていれば真**なので、コーナー側だけを見ると
 * 「ステージ窓だけ開いたまま『停止しました』と嘘をつく」形になる（061i レビュー S-1 と同型）。
 */
export function isStageOverlayOpen(): Promise<boolean> {
  return invoke<boolean>("is_stage_overlay_open");
}

/**
 * 061a: 内蔵コメントビューア窓（label `comment-viewer`）を開く（＝Twitch/YouTube 取得 sidecar を起動する）。
 *
 * ⚠ **`obs-effects` 画面の前提案内から呼ぶための導線**。`obs-enable`（OBS へのソース自動追加）を送れる
 * WS ハンドルを持つのはコメビュ窓だけなので、**コメビュ窓が開いていないと OBS への自動反映は起きない**。
 * main 窓に「開いてください」とだけ書いて放り出さないためのボタン。
 *
 * ⚠⚠ **061b で「エフェクトの発火自体もコメビュ窓が要る」は偽になった。** エフェクト窓が sidecar の WS を
 * 直接張り、sidecar もエフェクト窓が生きている間は落ちなくなったため、**一度コメント取得を開始すれば
 * コメビュ窓を閉じてもエフェクトは出続ける**。ただし **sidecar の起動と `start-session`（取得開始）の
 * 導線はどちらもコメビュ窓にしかない**ので、「コメビュ窓を一度も開かずにエフェクト」には到達しない。
 *
 * ⚠ 新規コマンドではない（032c-a の `open_comment_viewer_window` をそのまま呼ぶ）。ツール管理
 * （`MainScreen`）は同じ窓を `launchTool` 経由で開いており、main 窓から sidecar を起動できること自体は
 * 既存の構造（061a が広げたものではない）。
 */
export function openCommentViewerWindow(): Promise<void> {
  return invoke<void>("open_comment_viewer_window");
}
