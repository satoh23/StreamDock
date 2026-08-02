# 057b OBS ブラウザソース自動追加（StreamKit URL の自動投入・自動更新）

> 状態: **保留（2026-08-02・親 057 の中止条件に連動）**。分割・線引きは親 [057](057-discord-voice-overlay-design.md) を正とする。
>
> ⚠ **着手条件**: [057s](057s-discord-rpc-streamkit-spike.md) の検証項目 **(5) StreamKit URL の描画**と
> **(6) OBS ブラウザソースの自動作成 / URL 更新**がどちらも ✅ であること。
>
> ⚠⚠ **2026-08-02: 本タスク自身の着手条件は満たされている（(5)(6) とも ✅）。**
> 止まっているのは **057a（VC の検出）が Discord の承認要件で不可能になった**ためで、本タスクの技術的障害ではない。
> **URL を組むための guild_id / channel_id を供給する側が無い**ので、単独で作っても機能にならない＝親 057 の中止条件に連動して保留。
> **再開時は本タスクから着手できる**（実測値は下記のとおり既に揃っている）。
>
> **057s で確定した実測（そのまま実装仕様に使える）**:
> - **`SetInputSettings` で URL を差し替えるだけで再読込される** → **`PressInputPropertiesButton{refreshnocache}` は不要**
> - `GetInputList` による既存検出 → 重複作成の防止が効く。作成先は `GetSceneList.currentProgramSceneName`
> - `browser_source` の既定値: **css は既定で背景透過**・`shutdown:false`・`restart_when_active:false`・`fps 30`・`width 800 / height 600`
> - 誰もいない VC の URL は**空表示**（エラーにならない）。VC 退出時は `SetSceneItemEnabled` で非表示にするのが妥当
> - ⚠ **`webpage_control_level` の既定は `1`**（埋め込みページに OBS ステータス読取を許す）。
>   **第三者サイト `streamkit.discord.com` を載せるので `0`（NONE）へ落とすこと**
> - ⚠ **`BrowserHWAccel` が有効だとブラウザソースが描画されない環境がある**（macOS 14.6.1 / OBS 32.2.1 / M3 Pro で実測。
>   OBS 既定 URL すら真っ黒になり、OFF にすると直る）。**「描画されないときはこれを疑う」という案内が要る。**
>   [044s](044s-obs-websocket-spike.md) が「方式 B は未描画」と結論した根拠も同じ現象だった可能性が高い。
> ⚠ **本タスクは [057a](057a-discord-rpc-voice-detection.md) に依存しない。**
> URL を固定値（自分のサーバーの guild / channel）で通せるので、057a が承認待ちで止まっても**先に進められる**。
>
> **必読前提**: 親 [057](057-discord-voice-overlay-design.md)、[057s](057s-discord-rpc-streamkit-spike.md)（実測結果が実装の前提）、
> 対象 [`obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts)、[`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts)、
> [044a](044a-obs-auto-source-impl.md)（自動追加の原型）、**[046d](046d-pinned-overlay-obs-auto-add.md)（1 ソース → 2 ソースへ一般化した先例。本タスクは同じ広げ方の 3 回目）**、
> [`docs/security.md`](../security.md)（§1「例外（044a）」／§3／§8／§10）。
> CLAUDE.md どおり **「実装して」まで変更せず、まず変更計画と対象ファイルを提示する**。
> **OBS に作るソースの種別が増える（`window_capture` → `browser_source`）ため、軽 security-review**。
>
> ⚠ **行番号は書かない**（特定はシンボル名で行うこと）。

## 目的

**guild ID / channel ID を受け取ったら、OBS に StreamKit の Browser Source を自動で作り、VC が変わったら URL を差し替える。**

これで「URL をコピーして OBS に貼る」という手順が消える。

## 現在の前提（調査結果・実コード）

[`obs-client.ts`](../../apps/comment-sidecar/src/obs/obs-client.ts) は 044a で作られ 046d で 2 種へ一般化されている。
**本タスクはこの一般化をもう一段進めるだけ**で、新しい仕組みは要らない。

- `ObsOverlayKind` は **`"comments" | "pinned"` の固定 union**。ソース名と窓名の対応は `OBS_OVERLAYS` 表に閉じている。
  **viewer / frontend からソース名・窓名は渡さない**（渡るのは union の値だけ）。046d のコメントに
  「制御フレームに載るのは固定 union だけで実名は sidecar 内の表に閉じる（§3/§8）」と明記されている。
- **`inputKind` は `window_capture` に固定**（モジュール内のローカル定数）。`browser_source` を扱う経路は無い。
- `ensureOverlaySource` は
  `GetSceneList` → `GetInputList` → 無ければ `CreateInput` → `GetInputPropertiesListPropertyItems("window")` で
  窓候補を探す、という **window_capture 専用の流れ**になっている。
  `findOverlayWindowItem` / `pickWgcMethodValue` / macOS の `owner_name` / `window_name` 併設もすべて窓キャプチャ固有。
- `setOverlaySceneItemEnabled` は `GetSceneItemId` → `SetSceneItemEnabled`。**種別に依存しない**ので再利用できる。
- 接続は**オンデマンド**（enable のたびに connect → 確保 → disconnect）。`CONNECT_TIMEOUT_MS = 4000`。
  **接続リトライループは張らない**（失敗は `onState("failed", reason)` で graceful に返す）。
- 宛先は `ws://${OBS_HOST}:${port}`（`OBS_HOST` はコード定数 `127.0.0.1`）で、接続直前に
  [`host-guard.ts`](../../apps/comment-sidecar/src/host-guard.ts) の `assertAllowedObsUrl` を必ず通す。
- 窓名は Rust の窓タイトルと**バイト一致**が機能要件で、`lib.rs` の `#[cfg(test)] mod pinned_overlay_contract` が
  TS ソースを `include_str!` で読んで契約をテストしている。
  候補一致は `includes` なので **片方が他方を部分文字列として含んではいけない**。
- ⚠ **044s は「方式 B（ブラウザソース）は当該 macOS 環境で未描画」と記録している**
  （`CreateInput` は成功するが CEF が取得しに行かず Interact が真っ黒）。あのときの対象は
  `127.0.0.1` のローカル HTTP なので今回（公開 HTTPS）と同じとは限らないが、**057s (6) で必ず潰しておくこと**。

## このタスクでやること

### (1) ソース種別を `browser_source` へ一般化する

- `ObsOverlayKind` に **`"discord"`** を足す（`"comments" | "pinned" | "discord"`）。
- `OBS_OVERLAYS` 表を**種別ごとに必要な情報が違う形**へ広げる。窓キャプチャ 2 種は今までどおり
  `{ sourceName, windowTitle }`、Discord は `{ sourceName, inputKind: "browser_source" }`。
  ⚠ **判別可能な形（`kind` フィールドか discriminated union）にすること。**
  「`windowTitle` があるかどうか」で暗黙に分岐すると、次に種別が増えたとき静かに壊れる。
- `ensureOverlaySource` を **窓キャプチャの経路とブラウザソースの経路に分ける**。
  共通なのは「`GetSceneList` で現在シーンを取る → `GetInputList` で既存を探す → 無ければ `CreateInput`」までで、
  そこから先（窓の解決 vs URL の設定）は別。**窓キャプチャ側のコードは 1 行も変えない**のが理想
  （044a / 046d / 047c の回帰を持ち込まないため）。
- `setOverlaySceneItemEnabled` はそのまま再利用する。

### (2) ソース名を決める

- ソース名は **`StreamDock Discord 通話`**。
- ⚠ **既存 2 ソースと `includes` で紛れないこと**を確認する。
  `StreamDock コメントオーバーレイ` / `StreamDock 固定コメント` のどちらの部分文字列でもなく、
  逆にどちらもこの名前を含まない。**046d が明文化した制約なので、テストで固定する。**
- ⚠ ただし **Discord ソースは窓キャプチャではないので `lib.rs` の窓タイトルとの契約は無い**。
  Rust 側の `#[cfg(test)]` 契約テストに新しい行を足す必要はない
  （**足すと「窓が存在する」という誤った契約を作ってしまう**）。TS 側のテストで名前の非包含だけ固定する。

### (3) URL の組み立て（sidecar 内に閉じる）

- URL テンプレートは **sidecar 内のモジュール定数**。

  ```
  https://streamkit.discord.com/overlay/voice/{guildId}/{channelId}?<固定のクエリ>
  ```

- **guild ID / channel ID は使う前に `^\d{17,20}$` で検証する**（057a と同じ検証。**両方で持つ**＝
  057a が壊れても不正な値が URL に入らない）。落ちたら **URL を組まずに `failed` を返す**（fail-closed）。
- クエリパラメータは**固定値**にする（057s で見た目を決めて定数化する）。
  **ユーザー入力を混ぜない**（§8）。意匠のカスタマイズ UI は親 057 のスコープ外。
- **`assertAllowedStreamKitUrl` を書く**（新規・`assertAllowedObsUrl` と同じ作法）。
  `https:` かつ host が `streamkit.discord.com` 完全一致かつ path が `/overlay/voice/<数字>/<数字>` に一致すること。
  ⚠ **これは「OBS に何を開かせるか」の最後の関門**なので、組み立てた直後に必ず通す。
  `__hostGuardInternals` に公開し `scripts/test-host-guard.mjs` にケースを足す
  （`streamkit.discord.com.evil.com` / `evil-streamkit.discord.com` / `http:` / パス改変が throw すること）。

### (4) URL の更新と再読込

- 既にソースが在るときは `CreateInput` せず **`SetInputSettings` で `url` だけ差し替える**（べき等）。
- **URL 差し替え後にブラウザソースが再読込されるか**は 057s (6) の実測に従う。
  されないなら `PressInputPropertiesButton { propertyName: "refreshnocache" }` を続けて呼ぶ。
  ⚠ **常に refresh を呼ばない**（URL が変わっていないのに再読込すると、配信中に映像が一瞬消える）。
  **URL が実際に変わったときだけ**呼ぶこと。
- VC 退出時の挙動は 057s (8) の実測結論に従う。既定案は
  **`setOverlaySceneItemEnabled(false)` で非表示にし、ソースは消さない**（044a / 046d と同じ「削除せず非表示」）。

### (5) 状態通知

- 既存の `ObsState`（`idle` / `connecting` / `added` / `reused` / `failed`）をそのまま使う。
  **新しい状態を増やさない**（UI 側の分岐が増えるだけで得が無い）。
- 失敗は `safeReason` を通して graceful に返す。**リトライループは張らない**。

### (6) security.md の更新

- §1 の **「例外（044a・OBS オーバーレイソース自動追加＝obs-websocket loopback 連携）」に 057b 節を追記**する。
  - OBS に作るソースが `window_capture` に加え **`browser_source` へ拡張**されたこと（**ソースは最大 3 つ**）。
  - その URL が `streamkit.discord.com` を指し、**開くのは OBS であって StreamDock ではない**こと。
    **StreamDock 自身の egress は増えていない。**
  - URL は sidecar 内の定数テンプレート ＋ ID の書式検証 ＋ `assertAllowedStreamKitUrl` の**三重**で組み立てること。
  - viewer / frontend からは**固定 union しか渡さない**（実名も URL も渡さない）こと。

## このタスクでやらないこと

- **Discord への接続**（[057a](057a-discord-rpc-voice-detection.md)）。本タスクは ID を**引数として受け取るだけ**。
- **UI**（[057c](057c-rakuraku-discord-integration-ui.md)）。
- **窓キャプチャ 2 種（`comments` / `pinned`）の挙動変更。** 差分ゼロを完了条件にする。
- **StreamKit の意匠カスタマイズ UI**（クエリパラメータを設定で変えられるようにする）。
- OBS への新規宛先の追加（`ws://127.0.0.1:<port>` のまま）。新規依存の追加。
- 新規 capability。`tauri.conf.json` の変更。

## セキュリティ制約（docs/security.md 準拠）

- **OBS への宛先は不変**（`ws://127.0.0.1:<port>`・`assertAllowedObsUrl` を通す）。**新規 egress ゼロ**。
- **StreamKit URL は sidecar 内で組み立て、`assertAllowedStreamKitUrl` で fail-closed に検証する**。
  組み立てに使う ID は `^\d{17,20}$` を通す。**ユーザー入力を URL に混ぜない**（§8）。
- **viewer / frontend からソース名・URL・ID を受け取らない**（§3／§8。046d の `parseOverlayKind` と同じ作法で、
  受け取るのは固定 union の値だけ）。
- 新規依存ゼロ（`obs-websocket-js` は既存）。新規 capability ゼロ。`csp: null` 不変。
- **ログに URL を出さない**（guild / channel ID が URL に含まれる＝コラボ相手のサーバーが特定される。§9）。
  失敗理由は `safeReason` で丸める。

## 完了条件

- guild ID / channel ID を渡すと OBS の現在シーンに **`StreamDock Discord 通話`** というブラウザソースが作られ、
  **StreamKit の参加者表示が描画される**（既にあれば再利用して URL だけ更新する）。
- **URL が変わったときだけ**再読込され、変わっていないときは何もしない。
- 不正な ID（数字でない・桁数外・空）を渡すと **URL を組まずに `failed` を返す**。
- `assertAllowedStreamKitUrl` が偽装ホスト・非 HTTPS・パス改変を throw し、
  `scripts/test-host-guard.mjs` で固定されている。
- **ソース名が既存 2 ソースと `includes` で紛れない**ことがテストで固定されている。
- **窓キャプチャ 2 種（`comments` / `pinned`）の挙動が不変**（既存テストが全部通る・実機で回帰しない）。
- 制御フレームに **`StreamDock` の実名も URL も現れない**ことがテストで固定されている（046d と同じアサート）。
- [`docs/security.md`](../security.md) の §1「例外（044a）」に 057b 節が追記されている。
- 新規依存ゼロ・新規 capability ゼロ・`tauri.conf.json` 差分ゼロ・`csp: null` 不変。
- `pnpm --filter ./apps/desktop typecheck` / `lint` / `test` と sidecar のテストが通る。
  [`docs/progress.md`](../progress.md) を更新。

## 確認コマンド

```bash
git diff --stat
pnpm --filter ./apps/desktop typecheck
pnpm --filter ./apps/desktop lint
pnpm --filter ./apps/desktop test
pnpm --filter ./apps/comment-sidecar test     # host-guard に StreamKit のケースが増えている
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml   # 窓タイトルの契約テストが不変で通ること

# ゼロ拡大の担保（差分ゼロが期待）
git status --short -- apps/desktop/src-tauri/ apps/desktop/package.json apps/comment-sidecar/package.json pnpm-lock.yaml .github/

# URL をログに出していないこと
grep -rn "console\." apps/comment-sidecar/src/obs/ | grep -i "url\|streamkit" || echo "OK: URL をログしていない"

# OBS を起動（WebSocket サーバー有効）して実機確認
pnpm --filter ./apps/desktop tauri dev
# ①固定 ID でソースが作られ、StreamKit の参加者が描画される
# ②同じ ID でもう一度実行 → ソースが 2 つに増えない（再利用）
# ③別の VC の ID に差し替え → 表示が切り替わる
# ④同じ ID で再実行 → 再読込されない（映像が一瞬消えない）
# ⑤退出相当の操作 → ソースが非表示になる（削除されない）
# ⑥OBS 未起動 / WS 無効 → graceful に failed（クラッシュも hot-loop も無い）
# ⑦コメントオーバーレイ・固定コメントの自動追加が今までどおり動く（回帰なし）
```

## 実装後に必要なレビュー

- **軽 security-review。** 確認するのは次の 4 点。
  1. **StreamDock 自身の egress が増えていない**こと（OBS 宛は loopback のまま・新規 allow-list ホストゼロ）。
     「OBS が `streamkit.discord.com` を開く」ことは §1「例外（044a）」の 057b 節に記録されているか。
  2. **URL の組み立てが三重（定数テンプレート ＋ ID 書式検証 ＋ `assertAllowedStreamKitUrl`）**で、
     ユーザー入力が混ざる経路が無いこと。
  3. **viewer / frontend からソース名・URL・ID を受け取っていない**こと（制御フレームのアサートが在ること）。
  4. **URL がログ・エラーメッセージに出ていない**こと（§9・コラボ相手のサーバーが特定される）。
- 品質面: **窓キャプチャ 2 種の差分がゼロ**であること、`OBS_OVERLAYS` の広げ方が
  「`windowTitle` の有無で暗黙分岐」になっていないことを確認する。
