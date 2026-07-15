# 032c-c VOICEVOX 直接合成 ＋ TTS キュー（ずんだもん・Web Audio）

> 状態: **未着手（実装サブタスク）**。本ファイルは [032c（親設計・方針転換の正）](032c-comment-viewer-voicevox-design.md)
> の「## 実装タスクへの分割」032c-c 節・「## 決定事項」論点 3・「## セキュリティ方針の改訂方針」を distill
> したもの。**スコープ・決定の線引きは 032c を正とする**。
>
> **必読前提**: [032c（親設計）](032c-comment-viewer-voicevox-design.md) と `docs/security.md` を読むこと。
> あわせて [032c-a（前提サブタスク）](032c-a-comment-viewer-window-internal-tool.md) の viewer 枠組み・
> モック `CommentViewDto` 描画・内蔵ツールを把握し、ずんだもんクレジット文言は
> [032a（らくらくツール設定画面）](032a-rakuraku-tools-screen.md) を再利用元とする。
>
> **依存は 032c-a のみ**。032c-b（Twitch 取得・Node sidecar）とは**相互独立**で、本タスクは**モック
> `CommentViewDto` のみで mac 開発機で完結して E2E 検証できる**（Twitch/YouTube・sidecar・OAuth・
> インターネット通信は一切含まない）。CLAUDE.md どおり「実装して」と言われるまでコードは変更せず、
> まず変更計画と対象ファイルを提示すること。

## 目的

らくらくツール設定の中核目的（＝**配信者が簡単にずんだもんの声でコメントを読ませる**）を最初に実現する。
取得したコメント本文を **VOICEVOX ENGINE の HTTP 合成 API（`/audio_query` + `/synthesis`）に viewer webview
から直接投げ、返る WAV を Web Audio でローカル再生**する。棒読みちゃん・SAPI For VOICEVOX を一切介さず、
残る前提は「VOICEVOX ENGINE が起動していること」と「ずんだもんクレジット表記義務」のみ。

本タスクは **viewer webview 側の合成・再生・TTS キュー、ENGINE 稼働検出＋起動誘導、ずんだもんクレジット
表記、`docs/security.md` の loopback 50021 例外の（再）定義**に限定する。**新依存ゼロ**（Rust 側に音声再生
`rodio` / HTTP クライアント `reqwest` 等を足さない・Web Audio と `fetch` のみ）が原則。コメントは 032c-a の
**モック `CommentViewDto`** を流して検証する（実データ取得は 032c-b/-d）。実装全体像は
[032c](032c-comment-viewer-voicevox-design.md) を正とする。

## 現在の前提（調査結果）

### 032c-a が用意済み（本タスクの接続先）

- viewer 別ウィンドウ：Rust `open_comment_viewer_window`（`apps/desktop/src-tauri/src/lib.rs`・ラベル
  `comment-viewer`・単一インスタンスガード）＋ `App.tsx` のラベル分岐描画（`CommentViewerApp`）。
- モック描画：`apps/desktop/src/screens/comment-viewer/CommentViewerApp.tsx` が **frontend 専用モック
  `CommentViewDto`** を append ＋ **id 重複排除** ＋ **上限クランプ**して描画。純関数
  `mergeComments(prev, incoming)` の重複排除ループで「実際にリストへ append される新規 1 件」が確定する
  （＝**TTS enqueue の単一注入点**）。型は `apps/desktop/src/features/comment-viewer/types.ts`。
- 内蔵ツール：`ToolKind::Internal`（`apps/desktop/src-tauri/src/tools/model.rs`）＋固定 id
  `builtin-comment-viewer` の冪等 seed＋launch dispatch 分岐（削除不可・コア編集不可・プリセット組込可）。
- capability：`apps/desktop/src-tauri/capabilities/comment-viewer.json`（`core:default` のみ・最小権限）。
  `apps/desktop/src-tauri/tauri.conf.json` は `app.security.csp: null`。webview の `fetch` / Web Audio は
  Tauri IPC 権限ではなく webview ネイティブ機能のため capability 不要（CSP 管理下。現 `csp: null`）。

### 再利用する既存パターン（プロセス起動・ツール解決）

- 管理付き spawn プリミティブ：`apps/desktop/src-tauri/src/process/service.rs` の `spawn(tool) -> Handle`
  （shell 非経由・`validate_executable` で絶対パス実在検証）＋ `register(...)`（PID registry へ登録・
  `launch_id` 採番）。registry は `apps/desktop/src-tauri/src/process/registry.rs`。
- 登録済みツール解決：`apps/desktop/src-tauri/src/rakuraku/service.rs` の
  `resolve_tool_for_component(tools, expected_exe)`（**032b 修正2**・登録済みツール一覧から exe ファイル名
  照合で Tool を引く・`ToolKind::Executable` 限定・FS 広域走査しない）。ツール一覧は
  `tools::service::list`。**完成形テンプレは `rakuraku_launch_component`**（`rakuraku/commands.rs`：exe 名で
  登録済み Tool を解決 → `spawn` → `register`）。

### 重要な現状（本タスクで新規実装／（再）定義する点）

- **VOICEVOX ENGINE 稼働検出（50021 probe）は現状ゼロ実装**。032c-a で `bouyomi_voicevox.rs`（`ureq` による
  `127.0.0.1:50021` probe）ごと撤去済みで、Rust にも viewer にも `/version` 疎通は無い。→ 本タスクで
  viewer webview の `fetch("http://127.0.0.1:50021/version")` として**新規実装**する。
- **`docs/security.md` の loopback 50021 例外は 032c-a で全撤去済み**。親設計 032c（L149-150）は「/version
  ヘルスチェックのみ → /audio_query・/synthesis へ**拡張**」と記すが、これは撤去前の記述で、現行 §1/§5 に
  loopback 例外は**存在しない**（一般原則「外部通信をしない」へ復帰済み）。→ 本タスクは「拡張」ではなく
  **loopback 50021 例外を新規に（再）定義**する（`/version` 稼働検出＋`/audio_query`＋`/synthesis`＋WAV
  ローカル再生）。現行 security.md の 032c-a 撤去注記は「VOICEVOX 直接読み上げの通信方針は **032c-b** で
  定義」と書くが、合成が実際に載るのは本タスク（032c-c）なので、この stale pointer も本タスクで正す。
- rakuraku の連携実装レジストリは 032c-a で空（`registry()` は空・TS `INTEGRATION_REGISTRY = []`）。
  ずんだもんクレジット文言 `creditNotice` は空になった `INTEGRATION_REGISTRY` エントリと共に削除され、
  **git 履歴に退避**している（下記 (5) で復元して再掲）。

## このタスクでやること

### (1) VOICEVOX 直接合成（viewer webview・新依存ゼロ）

- viewer から `fetch` で `POST http://127.0.0.1:50021/audio_query`（`text`, `speaker`）→ 得た query JSON で
  `POST /synthesis`（`speaker`）→ 返る WAV を `ArrayBuffer` で受ける。
- **Rust 側の HTTP クライアント・音声再生ライブラリは足さない**（合成 HTTP と再生は viewer webview に閉じる）。
  VOICEVOX ENGINE の**プロセス起動**のみ Rust に寄せる（下記 (4)）。

### (2) Web Audio 直列再生

- `AudioContext.decodeAudioData(arrayBuffer)` → `AudioBufferSourceNode` で再生し、`onended` で次のキュー要素へ
  進める（**同時再生しない厳密な直列化**）。`AudioContext` は viewer ライフサイクルに 1 つ。

### (3) TTS キュー

- **FIFO 直列**：再生中フラグを持ち、再生中は enqueue のみ・終了（`onended`）で次を pop して合成→再生。
- **バックログ上限**：上限超過時は**古い未読を破棄**（最新を優先／破棄件数は目視できるよう最小限のログ可）。
- **最小テキスト整形**：**URL 除去・絵文字除去**のみ（osareview のリッチ整形は移植しない）。**著者名は
  読み上げない**。
- 話者は **ずんだもん（ノーマル）**固定（speaker id は下記「speaker id 実機スパイク方針」で確定・定数化）。
- 接続点：`CommentViewerApp.tsx` の `mergeComments` で「新規追加が確定した 1 件」を TTS キューへ enqueue する。
  `mergeComments` は純関数のまま**新規追加分を戻り値で返す**形に最小リファクタし、`addMock`（および将来の
  実データハンドラ）から enqueue を呼ぶ単一注入点にする。

### (4) ENGINE 稼働検出＋起動誘導

- viewer から `fetch("http://127.0.0.1:50021/version")` で ENGINE 稼働を検出。未起動なら**起動誘導 UI**
  （「VOICEVOX を起動」ボタン等）を提示。
- 起動は**専用の薄い新 command**で「登録済みツールの管理付き spawn」を再利用する：
  `resolve_tool_for_component(tools, "VOICEVOX.exe")` → `process::service::spawn` → `register`。
  **絶対パス直起動はしない**（`rakuraku_launch_component` と同じ流儀を薄く再現）。
- VOICEVOX が**ツール管理に未登録**（resolve が `None`）なら「ツール管理に登録してください」を促す
  （既存挙動に整合）。rakuraku registry は空のまま触らない。
- 注意（実装計画で確定）：viewer window（capability = `core:default`）から新 command を invoke できるかを
  確認し、必要なら `comment-viewer.json` に**最小権限の command 許可のみ**を足す（CSP 硬化・main の
  capability 変更はしない）。

### (5) ずんだもんクレジット表記

- viewer に **「VOICEVOX:ずんだもん」表記**を提示する。文言は 032a の `creditNotice`（git 履歴に退避）を復元
  して再掲：「ずんだもんの音声を使う配信・動画では『VOICEVOX:ずんだもん』のクレジット表記が必須です
  （VOICEVOX 利用規約 https://voicevox.hiroshiba.jp/term/ に準拠）。」
- 表示体裁は `apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.tsx` のクレジット見出し
  （「クレジット表記のお願い（必須）」＋段落）を踏襲する。

### (6) docs/security.md 改訂（loopback 50021 例外の（再）定義）

- **loopback 50021 例外を新規に（再）定義**する（現行は撤去済みで例外なし）。許可範囲は
  **`127.0.0.1:50021` への `GET /version`（稼働検出）＋ `POST /audio_query` ＋ `POST /synthesis`（合成）＋
  返る WAV の Web Audio ローカル再生**に限定。インターネット通信・Node sidecar には**波及しない**。
- 032c-a 撤去注記の stale pointer（「VOICEVOX 直接読み上げの通信方針は 032c-b で定義」）を、本タスクが
  50021 loopback を定義する旨に正す。**棒読み 50001** は撤去済みとして列挙から外す整理も行う。
- 既存の例外注記の書式を踏襲する。`csp: null` は当面維持（webview の loopback `fetch` / Web Audio は
  capability 不要）。**この security.md 差分は security-review 必須**（インターネット・sidecar に波及しない
  ことを確認する軽い範囲）。

## speaker id 実機スパイク方針

- 既定は **ずんだもん（ノーマル）= VOICEVOX speaker 3**（親設計の既定）だが、**ハードコード前に実機で確認**する。
- 段階①で mac の VOICEVOX ENGINE に `GET http://127.0.0.1:50021/speakers` を投げ、`name: "ずんだもん"` の
  `styles` から `name: "ノーマル"` の `id` を確認し、**定数化**（例 `ZUNDAMON_NORMAL_SPEAKER_ID`）。
- 観測値と確認手順を本 spec の追記または `docs/progress.md` に記録する（実値が 3 と一致するかを明記）。

## このタスクでやらないこと

- Twitch / YouTube コメント取得・Node sidecar（externalBin）・OAuth・インターネット通信（すべて
  **032c-b / -d**）。コメントは**モック `CommentViewDto`** で検証する。
- TTS 高度化：話者 / スタイル選択 UI・速度 / 音程設定・著者名読み上げ・スキップ / モデレーション
  （ミニマム対象外。**固定ずんだもん ＋ 基本整形 ＋ バックログ破棄のみ**）。
- Rust 側の音声再生・HTTP クライアント追加（`rodio` / `reqwest` 等）。**Web Audio と `fetch` のみ・
  新依存ゼロ**を守る。
- CSP 硬化（`csp: null` は当面維持）。main window の capability 変更。
- osareview のリッチ機能移植（ピン留め・タグ・スパチャ装飾・統計・SQLite 永続化・リッチ整形）。

## セキュリティ制約（docs/security.md 準拠）

- **触れる範囲は loopback 50021（VOICEVOX 合成）例外の（再）定義に限定**。§1（外部通信）／§5 の延長
  （loopback 50021 を `/version`＋`/audio_query`＋`/synthesis`＋WAV ローカル再生へ）に対する限定例外として
  明文化する。**インターネット通信・Node sidecar・OAuth トークンには一切波及しない**（それらは 032c-b/-d）。
- VOICEVOX ENGINE のプロセス起動は Rust の管理付き spawn（`spawn`＋`register`）経路を再利用し、
  frontend から直接 shell 実行しない・絶対パス直起動しない（CLAUDE.md「OS 操作・プロセス起動は Rust に
  寄せる」に整合）。webview から loopback への `fetch` は shell/OS 操作ではないため同原則に抵触しない。
- **security.md 本文を触るため security-review 必須**（loopback 例外が合成＋ローカル再生に限定され、
  インターネット・sidecar に波及しないことを確認する）。

## 完了条件

- モックコメントが VOICEVOX（ずんだもん・speaker 実値を確定して定数化）で `/audio_query` + `/synthesis` →
  **Web Audio 直列再生**される（音が重ならない FIFO 直列）。
- TTS キュー（FIFO 直列・再生中フラグ・バックログ上限破棄・URL/絵文字除去の最小整形・著者名読み上げなし）
  が動作する。
- ENGINE 稼働検出＋起動誘導が動き、VOICEVOX 起動は**登録済みツールの管理付き spawn 再利用**（専用の薄い
  新 command）で行われる。未登録時は登録誘導が出る。
- ずんだもんクレジット表記が viewer に提示される（032a 文言を復元して再利用）。
- `docs/security.md` の loopback 50021 例外が `/version`＋`/audio_query`＋`/synthesis`＋WAV ローカル再生へ
  （再）定義され、棒読み 50001 の整理・stale pointer 修正を含み、**security-review を通過**している。
- **新依存ゼロ**（Web Audio と `fetch` のみ・`Cargo.toml` / `package.json` に音声/HTTP ライブラリが増えない）。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `cargo check` が pass。Rust↔TS bindings drift ゼロ。
  既存機能（ツール起動/停止・プリセット・らくらく画面枠組み・032c-a の別窓/内蔵ツール/モック描画）に退行なし。
- `docs/progress.md` が更新されている。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm gen:bindings && git diff --stat        # bindings drift ゼロ確認
pnpm --filter ./apps/desktop tauri dev      # mac・VOICEVOX ENGINE 起動状態で E2E 目視
# 新依存ゼロ確認（音声/HTTP ライブラリが増えていない）
git diff -- apps/desktop/src-tauri/Cargo.toml apps/desktop/package.json
```

E2E 目視（`pnpm tauri dev`・VOICEVOX ENGINE 起動状態）:
1. モックコメントが**ずんだもんの声で順番に読み上げられる**（FIFO 直列・音が重ならない）。
2. バックログ上限超過で古い未読が破棄される。
3. URL / 絵文字が除去されて読まれる。
4. ENGINE 未起動時に稼働検出 → 起動誘導が出て、登録済み VOICEVOX を管理付き spawn で起動できる
   （未登録なら登録誘導）。
5. ずんだもんクレジット表記が表示される。
6. 通信は 127.0.0.1:50021 の loopback のみ・インターネット接続が一切無い。

## 段階分割（実装は「実装して」後・4 コミット）

1. **コミット1: 単発合成 ＋ Web Audio 再生**。固定テキストで `GET /speakers`（speaker id 確定・定数化）→
   `POST /audio_query` → `POST /synthesis` → `decodeAudioData` → 1 回鳴らす。typecheck / lint / cargo check。
2. **コミット2: TTS キュー ＋ モックコメント連動**。FIFO 直列・再生中フラグ・バックログ上限・URL/絵文字除去を
   実装し、`mergeComments` の新規追加分を enqueue。モックコメントが順に重ならず読み上げられることを確認。
3. **コミット3: ENGINE 稼働検出 ＋ 起動誘導 ＋ ずんだもんクレジット**。`fetch /version` 検出・専用の薄い新
   command（resolve → spawn → register）・未登録誘導・クレジット表記表示。必要なら `comment-viewer.json` に
   最小権限の command 許可を追加。bindings 再生成を同梱。
4. **コミット4: `docs/security.md` loopback 50021 例外の（再）定義 ＋ security-review**。例外明文化・棒読み
   50001 整理・stale pointer 修正・`docs/progress.md` 更新。**docs 差分に security-review スキルを適用**。
