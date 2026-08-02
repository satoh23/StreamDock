# 057c らくらくツール設定への統合（Discord コラボ連携を 1 件目の連携として載せる）

> 状態: **保留（2026-08-02・親 057 の中止条件に連動）**。分割・線引きは親 [057](057-discord-voice-overlay-design.md) を正とする。
>
> ⚠ **着手条件**: [057a](057a-discord-rpc-voice-detection.md) と [057b](057b-obs-streamkit-browser-source.md) の両方が完了していること。
>
> ⚠⚠ **2026-08-02: 057a が Discord の承認要件で着手不可になったため保留。**
> 詳細は [057s の「スパイク結果」節](057s-discord-rpc-streamkit-spike.md)と[親 057 の「発動の記録」](057-discord-voice-overlay-design.md)。
> ⚠ **`INTEGRATION_REGISTRY` は空のまま**である（本タスクが 1 件目のエントリになる予定だった）。
> **らくらく画面はカードが 0 件の状態が続く**ので、他の連携を先に載せる判断をする場合はここを参照すること。
>
> **必読前提**: 親 [057](057-discord-voice-overlay-design.md)、[057a](057a-discord-rpc-voice-detection.md)（状態イベントの契約）、
> [032](032-rakuraku-auto-setup-design.md)（per-integration アーキテクチャ）、
> **[032a](032a-rakuraku-tools-screen.md)（画面シェルの器＝一覧 / 詳細 / 同意 / 実行）**、
> 対象 [`integrationRegistry.ts`](../../apps/desktop/src/features/rakuraku/integrationRegistry.ts)・
> [`RakurakuToolsScreen.tsx`](../../apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.tsx)、
> [054](054-comment-viewer-settings-readability.md)（タイポグラフィの階層規則）、
> [`docs/security.md`](../security.md)（**「らくらくツール設定（外部アプリ連携）方針」＝ 057a で改訂済みのもの**）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **frontend の表示と配線のみ**＝**軽レビュー**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

らくらくツール設定の画面に **「Discord のコラボ通話を OBS に自動で映す」** を 1 件目の連携として載せ、
ユーザーが**同意して 1 回設定するだけ**で、以後は VC に入るだけで OBS に反映される状態にする。

## 現在の前提（調査結果・実コード）

### 器は 032a のまま完成しており、中身が 0 件

- [`integrationRegistry.ts`](../../apps/desktop/src/features/rakuraku/integrationRegistry.ts) の
  **`INTEGRATION_REGISTRY` は空配列**（032c-a で唯一の連携を撤去したまま）。
  したがって **`ListView` は見出しだけ描画してカードが 0 件**で、詳細以降に到達できない。
  **本タスクが入れるのが 1 件目のエントリになる。**
- 型は温存されている。`Integration` は
  `id` / `icon`（絵文字）/ `title` / `summary` / `benefits[]` / `demoVideoId?` / `osAvailability` /
  `requiredComponents[]` / `prerequisites?` / `consent` / `steps[]` / `executable` を持つ。
- `IntegrationStepKind` は `"scan" | "prepare" | "configure" | "register" | "launch" | "verify"`。
- 共通免責文は `COMMON_DISCLAIMER` に単一ソース化されている。
- `IntegrationConsent` は `allowsDownload` / `allowsConfigOverwrite` / `allowsAutoLaunch` / `creditNotice` の 4 項目。
- OS ヘルパ（`osAvailabilityLabel` / `supportedOsName` / `isOsSupported`）も温存。
  `isOsSupported` は **`hostOs` が null のとき安全側で非対応扱い**にする。
- 画面は [`RakurakuToolsScreen.tsx`](../../apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.tsx) の
  1 ファイルに `ListView` / `DetailView` / `ConsentView` / `ExecutionView` が同居し、
  遷移は判別可能ユニオン `View` の `useState` で**画面内ローカル完結**（上位 `Screen` union は増やさない方針がコメントに明記されている）。
- `ExecutionView` の JSDoc に「現時点で登録済み連携は無くこの画面は到達しないが、器として温存する」とある。
  **本タスクで初めて到達する。**
- 導線は [`headerSections.ts`](../../apps/desktop/src/components/headerSections.ts) の `rakuraku` エントリで
  既に `implemented: true`。ヘッダーからは入れる。
- ⚠ **らくらく関連のテストは 0 件**（`rakuraku-tools/` 配下は `.tsx` と `.module.css` のみ）。
  本タスクが初めてテストを入れる。

### ⚠ 既存の実行モデルと合わない点（設計上の逸脱を先に確定させる）

- Rust の `rakuraku_scan_integration` / `rakuraku_launch_component` / `rakuraku_open_official_page` は
  **単発・同期**の設計で、「ツール管理に登録済みの exe を起動する」ためのもの。
  `rakuraku::service::resolve_tool_for_component` は **exe ファイル名一致**で登録済みツールを解決する。
- Discord 連携は **常駐監視**（VC の参加・移動・退出に追従）で、**外部アプリを起動しない**。
  したがって **既存の 3 コマンドはどれも使わない。**
- 代わりに **057a が emit する Tauri イベント（`discord-voice:state` 相当）を購読する**。
  → **これは 032 の per-integration アーキテクチャからの意図的な逸脱**なので、親 057 と本ファイルに明記する。
- ⚠ 逸脱の帰結として、**らくらくの連携には「一発実行して終わり」型と「常駐監視」型の 2 系統ができる。**
  `Integration` 型に `executable: boolean` があるが、これは前者を想定したフラグである。
  **2 件目の連携を足すときは、この 2 系統をどう表現するかを先に決めること。**
  今回は 1 件目なので `Integration` 型を壊さずに済む形（後述 (1)）に留める。

## このタスクでやること

### (1) `INTEGRATION_REGISTRY` に 1 件目のエントリを入れる

**`Integration` 型は変更しない**（1 件目なので、既存の型に載る形で書けるかを先に確かめる。載らないなら型の拡張を
親 057 に差し戻して判断する）。

| フィールド | 値 |
| --- | --- |
| `id` | `discord-voice-overlay`（**変更しない**） |
| `icon` | 絵文字（外部画像は読み込まない・既存の方針どおり） |
| `title` | 「Discord のコラボ通話を OBS に自動で映す」（**やりたいことベース**） |
| `summary` | VC に入るだけで参加者が OBS に出るようになること |
| `benefits` | StreamKit を開かなくてよい／サーバーを探さなくてよい／URL をコピーしなくてよい／VC を移動しても追随する |
| `osAvailability` | 057s (4) の実測に従う。**Windows 未検証なら `"macos"` から始める**（後で広げる方が安全） |
| `requiredComponents` | Discord デスクトップアプリ（`setup: "guided"`）／OBS（obs-websocket 有効化・`setup: "guided"`） |
| `prerequisites` | Discord にログイン済みであること／OBS の WebSocket サーバーが有効であること |
| `consent` | 後述 (2) |
| `steps` | `scan` → `configure` → `register` → `verify`（**`prepare` と `launch` は使わない**＝何もダウンロードせず何も起動しないため） |
| `executable` | `true` |

- `demoVideoId` は**用意できるまで設定しない**（未設定なら「準備中」プレースホルダになる既存挙動をそのまま使う）。

### (2) 同意画面に載せる内容

既存の `ConsentView` と `COMMON_DISCLAIMER` をそのまま使い、`IntegrationConsent` の 4 項目を次のようにする。

- `allowsDownload: false`（**何もダウンロードしない**）
- `allowsConfigOverwrite: false`（**外部アプリの設定ファイルを書き換えない**。OBS へのソース追加は
  obs-websocket 経由であって設定ファイルの上書きではない）
- `allowsAutoLaunch: false`（**Discord も OBS も自動起動しない**）
- `creditNotice` — ⚠ **この項目は「ずんだもんのクレジット表記義務」用に作られたフィールド**で、Discord には義務が無い。
  **空文字にして表示を出さないか、`ConsentView` 側で空なら描画しないようにする**（既存の描画がどうなっているかを
  実装時に確認し、空文字で崩れるなら描画側にガードを足す）。

**同意画面に必ず出す 3 点**（`ConsentView` の既存項目で表現できないなら、`benefits` や `summary` に織り込む）。

1. **Discord アカウントを StreamDock と連携すること**（同意モーダルが Discord 側に出ること）
2. **OBS のシーンにソースを 1 つ作ること**（名前は `StreamDock Discord 通話`）
3. ⚠ **コラボ相手の表示名とアイコンが、OBS 経由で配信画面に出ること**
   （第三者の情報が配信に出る。**これが本連携でいちばん説明が要る点**）

### (3) 実行画面と状態表示

- `ExecutionView` の 4 ステップを 057a / 057b の実挙動に対応させる。

  | step | 実際にやること | 表示 |
  | --- | --- | --- |
  | `scan` | Discord に接続し、現在の VC を取得 | 「Discord を確認しています」 |
  | `configure` | guild / channel から URL を組む（sidecar 内） | 「表示内容を準備しています」 |
  | `register` | OBS にブラウザソースを作成 / URL を更新 | 「OBS に追加しています」 |
  | `verify` | ソースが有効になったことを確認 | 「反映を確認しています」 |

- **既存の `StepRunState`（`waiting` / `running` / `done` / `skipped` / `error` / `blocked` / `info`）と
  `blockAfter()` をそのまま使う**（失敗の波及の作法を変えない）。
- 設定後の**常駐状態**を出す場所が要る。`ExecutionView` は「1 回走って終わる」画面なので、
  **一覧カード（`ListView`）に現在の状態を出す**のが素直（例: 「連携中 — ◯◯（チャンネル名）」「連携中 — VC 未参加」「未連携」）。
- ⚠ **状態は `discord-voice:state` イベントの購読で受ける**（既存の `rakuraku_*` コマンドは使わない）。
  購読は `features/rakuraku/` に薄いフック（`useDiscordVoiceState` 相当）として置き、
  **コンポーネントから `listen` を直接呼ばない**（`invoke` を `*Api.ts` に閉じている既存の作法と同じ理由）。
- ⚠ **イベントはどの窓の webview からでも偽造できる**（055c/055d の申し送り）。
  **表示にしか使わない**こと。このイベントを起点に OS 操作・プロセス起動を行わない。

### (4) 文言とタイポグラフィ

- [054](054-comment-viewer-settings-readability.md) で確定した**役割の規則**に従う
  （項目名＝`var(--text)` × 太字／説明＝`var(--muted)` × 標準／`--text-faint` は無効状態専用）。
  ⚠ **054 は「コメビュ窓の中」を統一の単位と定義している**ので、らくらく画面では
  既存の [`RakurakuToolsScreen.module.css`](../../apps/desktop/src/screens/rakuraku-tools/RakurakuToolsScreen.module.css) の値に揃え、
  **新しい値を発明しない**。
- 生 hex / rgba を書かない（役割トークン経由）。ライト / ダーク両テーマで確認する。

### (5) テスト（このスライスに初めてテストを入れる）

- `integrationRegistry` のエントリが**契約を満たす**こと
  （`id` が固定値／`steps` に `prepare` と `launch` が無い／`consent` の 3 つの boolean がすべて `false`）。
  ⚠ **`consent` の boolean は「何もダウンロードしない・何も上書きしない・何も自動起動しない」という
  セキュリティ上の約束そのもの**なので、テストで固定する価値がある。
- `ListView` にカードが 1 枚出ること（**0 件表示からの回帰を防ぐ**）。
- 状態フックが `disconnected` / `connected` / `in-voice` / `failed` を正しく表示に落とすこと。
- ミューテーションで実効性を確認する（既存タスクの作法どおり、レッドになることを実測する）。

## このタスクでやらないこと

- **Discord への接続**（[057a](057a-discord-rpc-voice-detection.md)）。**OBS への反映**（[057b](057b-obs-streamkit-browser-source.md)）。
- **`Integration` 型の拡張**（1 件目は既存の型に載る形で書く。載らないなら親 057 へ差し戻す）。
- **既存 `rakuraku_*` コマンド 3 本の変更**（使わないだけで、消しも直しもしない）。
- **上位 `Screen` union の追加**（032a の「画面内ローカル完結」の方針を守る）。
- **StreamKit の意匠カスタマイズ UI**（クエリパラメータを設定で変えられるようにする）。
- **2 件目の連携**を見越した抽象化（「一発実行型」と「常駐監視型」の共通化は、2 件目が来てから考える）。
- Rust / sidecar / capability / `tauri.conf.json` / CI の変更。**新規依存の追加。**

## セキュリティ制約（docs/security.md 準拠）

- **frontend の表示と配線のみ**。外部通信宛先・API・capability・**依存**を増やさない（§1／§3／§10）。`csp: null` 不変。
- **frontend からは raw なパス / URL / ポート / コマンドを渡さない**（らくらく方針）。
  渡すのは連携 id（固定値）だけ。**guild ID / channel ID / StreamKit URL は frontend に現れない。**
- **`discord-voice:state` イベントは表示にのみ使う**（webview から偽造可能なため、OS 操作の起点にしない）。
- 同意画面で **第三者（コラボ相手）の表示名とアイコンが配信に出ること**を明示する。
- **保存するデータを増やさない。** チャンネル名・状態を localStorage や SQLite に**永続化しない**
  （⚠ 046 の教訓「保存するデータの種類が変わる変更は軽レビューに置かない」。
  **永続化を足すなら本タスクは軽レビューでは済まなくなる**ので、足さないこと）。
- 外部画像を読み込まない（アイコンは絵文字）。

## 完了条件

- らくらくツール設定の一覧に**カードが 1 枚出る**（0 件表示ではなくなる）。
- 詳細 → 同意 → 実行の 4 ステップが最後まで進み、**OBS に参加者表示が出る**。
- 実行後、一覧カードに**現在の連携状態**（未連携 / VC 未参加 / チャンネル名）が出て、
  **VC を移動すると表示が追随する**。
- 同意画面に「Discord 連携」「OBS にソースを作る」「**コラボ相手の表示名とアイコンが配信に出る**」の 3 点が出ている。
- ライト / ダーク両テーマで破綻せず、生 hex / rgba を書いていない。054 の役割規則に従っている。
- **frontend のコードに guild / channel ID も StreamKit URL も現れない**ことを grep で確認できる。
- **localStorage / SQLite への新規書き込みがゼロ。**
- Rust・sidecar・capabilities・`tauri.conf.json`・`package.json` が**差分ゼロ**。`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` が通る。[`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/comment-sidecar/ .github/ apps/desktop/package.json pnpm-lock.yaml

# ID / URL が frontend に漏れていないこと
grep -rn "streamkit\|guildId\|guild_id\|channelId\|channel_id" apps/desktop/src/ || echo "OK: frontend に URL/ID 無し"

# 新しい永続化を足していないこと
git diff -- apps/desktop/src/ | grep -n "localStorage\|setItem" || echo "OK: 新規の永続化なし"

pnpm --filter ./apps/desktop tauri dev
# ①ヘッダー「らくらくツール設定」→ カードが 1 枚出る
# ②詳細 → 同意（3 点が読める）→ 実行 → 4 ステップが done になる
# ③OBS に「StreamDock Discord 通話」が出て参加者が映る
# ④VC を移動 → 一覧カードのチャンネル名が変わり、OBS の表示も切り替わる
# ⑤VC を退出 → 「VC 未参加」になり、OBS のソースが非表示になる
# ⑥Discord を落とす → 「未連携」になり、エラーが読める文言で出る（クラッシュしない）
# ⑦ライト / ダーク両テーマで文字が読める
```

## 実装後に必要なレビュー

- **軽レビュー。** 確認するのは次の 5 点。
  1. 外部通信宛先・API・capability・依存が**不変**であること（Rust / sidecar / conf が差分ゼロ）。
  2. **frontend に guild / channel ID も StreamKit URL も現れない**こと（らくらく方針）。
  3. **`discord-voice:state` を表示以外に使っていない**こと（OS 操作の起点にしていない）。
  4. **新しい永続化を足していない**こと（⚠ 足していたら軽レビューでは済まない＝ 046 の教訓）。
  5. 同意画面に**第三者の情報が配信に出る旨**が明示されていること。
- 併せて、`consent` の 3 つの boolean（`allowsDownload` / `allowsConfigOverwrite` / `allowsAutoLaunch`）が
  **すべて `false` であることがテストで固定されている**ことを確認する。
