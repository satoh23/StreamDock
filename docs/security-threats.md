# Security Threat Model（脅威モデル）

`docs/security.md` が「守るべき方針」を定めるのに対し、本ファイルは **攻撃者視点**で
「誰が・どこから・何を送れるか」を列挙し、`security-attack` skill の作業対象を管理する。

- **本ファイルは発見（脅威）の台帳**であり、修正の記録ではない（修正は `docs/tasks/` と `docs/progress.md`）。
- 各脅威には ID（`T-n`）・状態（未対応 / 対応中 / 対応済 / 受容）・再現テストの所在を持たせる。
- ローカルモック限定で検証する（本番 API・実サービス・実端末を攻撃対象にしない）。

## 攻撃者モデル

| 記号 | 攻撃者 | 前提 |
|---|---|---|
| A1 | ユーザーが配信中にブラウザで開いた**悪意あるWebページのJS** | StreamDock 稼働中。ブラウザから `ws://127.0.0.1:<port>` へ接続可（WSはSOP外・ポートは総当たり可能） |
| A2 | 同一PC上の**任意のローカルプロセス**（別アプリ/マルウェア） | loopback に到達可 |
| A3 | 攻撃者が本文/表示名を自由に決められる**第三者の視聴者コメント** | ユーザーが配信サービスに接続中 |
| A4 | ユーザーが取り込む**外部リソース**（CSSテーマ / フォント / エフェクト / CSV） | ユーザーが取り込み操作を実行 |

## 脅威台帳

### T-1: loopback WS が未認証・Origin未検証（sidecar 制御フレーム）

- **状態**: 未対応（発見と再現テストまで／修正は別タスク）
- **攻撃者**: A1 / A2
- **面**: `apps/comment-sidecar/vendor/gateway/src/adapters/ws/websocket-comment.output-port.ts` `bind()`
- **内容**: WS サーバは `WebSocketServer({ host, port })` のみで、接続時の **Origin 検証も認証ハンドシェイクも無い**。
  ブラウザは WS ハンドシェイクに `Origin` を必ず付けるが、サーバはこれを見ない。結果、A1/A2 が接続でき、
  **チケット不要の制御フレーム**が `controlHandler` に届く。
- **チケットで守られている（撃てない）**: `chat-send`（配信への書き込み）/ `start-session`（宛先チャンネル差し替え）/
  `stop-session` / `theme-import.fetch` / `theme-font.fetch`。← 066 / 060c の stdin private-pipe チケットで担保。
- **チケット無しで撃てる（＝本脅威の実害）**:
  - `obs-fire-source` … ユーザーの**生配信にエフェクトを勝手に出す**（sourceName は allow-list・duration はクランプで範囲は限定的）
  - `obs-list-sources` … ユーザーの **OBS ソース名を窃取**（情報漏洩）
  - `obs-enable` / `obs-disable` / `obs-hide` … OBS 連携の勝手な接続/切断/オーバーレイ操作
  - `start-login` … OAuth ログインを勝手に開始（迷惑・混乱誘導）
  - （受信方向）`comments.append` … ユーザー宛の**受信コメントを盗み見**
- **前提条件**: OBS 系は「ユーザーが OBS 連携を設定済み」でないと実際の副作用は出ない（パスワードは stdin 経由）。
  それでも `obs-list-sources` の情報漏洩・`start-login`・コメント盗み見は前提が緩い。
- **既知性**: コード自身がこの穴を明記し、`security.md` にも「後回し改善」として記録済み（新規発見ではなく**未対応の既知穴**の再現）。
- **再現テスト**: `apps/comment-sidecar/scripts/test-ws-unauth-origin.mjs`（`pnpm --filter @stream-dock/comment-sidecar test` に含む）。
  本物の WS サーバへ **偽 Origin (`https://evil.example`)** のクライアントで接続し、①接続が拒否されない
  ②未認証フレームが全て届く ③`bind()` に Origin 検証コードが無い、の3点を固定する。修正が入ると③（と①）が反転する。
- **修正案（別タスク）**: 接続時に **Origin allow-list**（webview 由来以外を拒否）を入れる。コード自身が挙げている対策
  （`Origin 検証 ＋ nonce ハンドシェイク`）に沿う。二層目として、未認証フレーム（obs-*・start-login）にも
  セッション nonce を要求する案。実装時は本再現テストを「拒否されること」を確認する向きへ反転する。

<!-- 次の脅威（T-2: 第三者コメント → csp:null 描画 / T-3: 取り込み系の allow-list 回避 …）は別セッションで追記する。 -->
