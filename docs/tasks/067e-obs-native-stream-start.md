# 067e 配信開始を OBS に返す（067c の設計見直し）

> ⛔ **撤回（2026-09-12）。本段の実装も、前提だった 067b/067c もすべて削除した。**
> ⚠⚠⚠ 理由は本ファイルではなく **[067 §25](067-multistream-output-split.md#25-撤回2026-09-12)** が正。
> 要約: 配信先ごとに違う映像を送る方式は**配信者のシーン管理を乗っ取る**（配信中のシーン切り替えを
> 禁止することになる）ため、目的そのものを取り下げた。
> ⚠ 以下の §1〜 は「やろうとしたこと」の記録であって、実装の指示ではない。
> ⚠⚠ 段 067e-6（`security-review`）は**一度も実施していない**（067 §25-9）。

⚠⚠⚠ **これは新機能ではなく、[067](067-multistream-output-split.md) 段 3（067c）で作った「StreamDock からの配信開始」を撤回する段である。**
撤回にともなって**生存確認一式（842 行）も消える**。消すものが足すものより多い。

- **起票**: 2026-09-12（依頼者の指示）
- **前提**: [067](067-multistream-output-split.md) 段 0〜3 実装済み・実機確認中
- **状態**: 起票のみ・未着手

## ⚠ 採番について（2026-09-12 に訂正）

**当初これを `069` として起票したのは誤りだった**（依頼者の指摘）。
本ファイルは新機能ではなく **067 の動作確認で見つかった 067c の設計ミスの修正**であり、
このリポジトリの規則は **番号＝機能／英字＝段**（067a / 067b / 067c / 067d / 067s）である。
⇒ **067e へ改めた。**⚠ 069 という番号は**欠番にはしない**（次の新機能が使う）。

---

## 1. なぜ撤回するのか

### 1-1. StreamDock は守れない約束をしている

「配信開始」と書いたボタンは、**押したら配信が始まる**ことを約束する。StreamDock はその約束を守れない。

| 知りたいこと | 取れるか |
|---|---|
| Branch Output の出力が動いているか | ❌ **vendor API が無い**（067 §17 #15・実コード確認済み） |
| インターロック設定 | ❌ obs-websocket からは読めない（`outputStatusDock.json`） |

⇒ ユーザーがインターロックを `Always ON` 以外にしていると、`SetSourceFilterEnabled(true)` は**黙って何も起こさない**（067 の R-4）。StreamDock はそれを検知できない。

### 1-2. 代替として作った生存確認が、費用対効果に合っていない

証明できないので、**プラットフォーム API で実際のライブ状態を見る**という代替を作った（067 §17）。その結果：

```
liveness.ts           175 行
status-poller.ts      335 行
streamPillFace.ts      85 行
StreamControls.tsx    204 行
useLiveClock/format    43 行
                    ──────
                      842 行
```

さらにこれを動かすために**YouTube の OAuth 連携が事実上必須**になり、クォータ管理が必要になり、
2026-09-10 の実機確認では **「状態が確認できません」から抜けられなくなった**。

### 1-3. OBS 本体に配信させたほうが、状態が正確に取れる

067 §9-E に自分でこう書いてある：

> 皮肉だが、**状態は Branch Output より正確に取れる**（`GetStreamStatus` があるため）

⇒ **OBS 本体が配信を担当する側については、`GetStreamStatus.outputActive` で正確に分かる。**

### 1-4. ⚠⚠ そもそも「配信先ごとのコメント出し分け」に同時配信は要らない

配信先が **1 つ**のユーザーでも、「Twitch なら Twitch のコメントだけ／YouTube なら両方」は成立する。
そこでは Branch Output も配信開始の変更も**一切要らない**（＝縮退モードが既にやっている）。

⇒ **大多数のユーザーにとって本タスクの論点は無関係で、体験は「今までどおり」のままである。**

---

## 2. ⚠⚠⚠ 一般解：決め打ちせず、OBS を読んで合わせる

067c の初期案は「OBS 本体 = YouTube」のように**特定の環境を前提にしていた**（依頼者の指摘・2026-09-12）。
ユーザーごとに OBS の配信設定は違うので、**読んで割り当てる**。

### 2-1. 割り当ての規則

`GetStreamServiceSettings`（obs-websocket v5・read-only）で OBS 本体の宛先サイトを判定し、

| その人の OBS | StreamDock がやること | 配信開始 |
|---|---|---|
| 配信先 1 つ | シーンを組むだけ（**Branch Output 不要**） | **OBS の配信開始** |
| 2 つ・本体が Twitch | **YouTube 側だけ** Branch Output | **OBS の配信開始** |
| 2 つ・本体が YouTube | **Twitch 側だけ** Branch Output | **OBS の配信開始** |
| 2 つ・本体が別サイト / 未設定 | ⚠ 「OBS の配信設定を Twitch か YouTube にしてください」と頼む | **OBS の配信開始** |

⚠ **どの行でも押すボタンは同じ**＝「今までの UX を損なわない」という要件を満たす。
⚠⚠ 番組シーンは **OBS 本体が担当する側の出力シーン**にする（本体は番組シーンを送るため）。これは既存実装がやっている。

### 2-2. ⚠ サイトの判定方法

`GetStreamServiceSettings` は `streamServiceType` と `streamServiceSettings` を返す。

- `rtmp_common` … `settings.service` がサービス名（`"Twitch"` / `"YouTube - RTMPS"` 等）
- `rtmp_custom` … `settings.server` の URL を **既存の `rtmp-endpoints.ts` の定数**と突き合わせる

⚠⚠⚠ **`settings.key`（配信キー）も一緒に返ってくる。**
⇒ **サイト名だけ取り出して、残りは即座に捨てる。**ログ・画面・WS・DB のどこにも出さない。
⇒ ⚠ これは秘密を 1 つ余分に触る変更なので、**`docs/security.md` への追記が必須**（§8-2）。

---

## 3. ⚠⚠⚠ 最重要：準備が配信を始めてしまう問題

### 3-1. 何が起きるか

Branch Output のインターロック既定は **`Always ON`**＝**フィルタが有効かつ server が入っていれば、その瞬間から送信が始まる**（067 §9-A-3）。

新設計では、インターロックを `Streaming` にしたうえで**フィルタを有効のままにしておく**必要がある
（無効だと OBS が配信を始めても Branch Output は動かない）。

⇒ **準備の最後にフィルタを有効化する。**
⇒ ⚠⚠⚠ **そのときインターロックが `Always ON` のままだと、準備した瞬間に配信が始まる。**

⚠ 順序を入れ替えても逃げられない：
- キーを書く → 有効化 … 有効化した瞬間に開始
- 有効化 → キーを書く … キーが入った瞬間に開始

### 3-2. 対策（3 段構え）

**① 読んで確かめる**（本命）

`outputStatusDock.json` の `interlock` を **read-only で読む**。
⚠ 既存の [`obs_config.rs`](../../apps/desktop/src-tauri/src/obs_config.rs) が **OBS の設定ファイルを read-only で読む先例**なので、同じ作法で新モジュールを足す。

⚠⚠ **書き換えは絶対にしない**（`docs/security.md` §5「外部アプリの設定ファイルを勝手に上書きしない」）。

**② 読み直せるようにする**（依頼者の指示・2026-09-12）

⚠⚠⚠ **ただし「いつでも今の値が読める」ボタンにはできない。**理由は §3-4 の保存タイミング。
⇒ ボタンの役割は「**OBS を再起動したあとに読み直す**」であって、「いまドックで変えた値を取りに行く」ではない。
⚠ 文言を「最新の状態にする」にしてはいけない。**「OBS 再起動後にもう一度確認する」**と書く。

**③ ユーザーに明示的に申告させる**（①が読めなかったとき）

チェックボックス「インターロックを Streaming に変更しました」にチェックが入るまで、有効化のボタンを押せなくする。

**④ ボタンの文言で正直に言う**（常に）

> 「配信の受け口を有効にする」
> ⚠ インターロックを Streaming にしていない場合、**押した瞬間に配信が始まります。**

⚠ ①が読めて `Streaming` だと確認できたときは、この警告を出さない（嘘の警告を出し続けると読まれなくなる）。

### 3-3. ✅ インターロックの値（2026-09-12 に plugin-main.hpp で確定）

```cpp
enum InterlockType {
    INTERLOCK_TYPE_ALWAYS_ON,            // 0 ← 既定
    INTERLOCK_TYPE_STREAMING,            // 1 ← これにしてもらう
    INTERLOCK_TYPE_RECORDING,            // 2
    INTERLOCK_TYPE_STREAMING_RECORDING,  // 3
    INTERLOCK_TYPE_VIRTUAL_CAM,          // 4
    INTERLOCK_TYPE_REPLAY_BUFFER,        // 5
    INTERLOCK_TYPE_INDIVIDUAL,           // 6
    INTERLOCK_TYPE_ALWAYS_OFF = 9999,
};
```

⚠⚠⚠ **コンボボックスの並び順と enum の値が違う。**
ドックは `ReplayBuffer` を `VirtualCam` より先に並べるが、enum は `VIRTUAL_CAM=4` / `REPLAY_BUFFER=5`。
さらに `ALWAYS_OFF` は 7 ではなく **9999**。
⇒ **並び順から対応表を書くと誤読する。**上の値をそのまま使うこと。

⚠ `interlock` キーが無い場合は `obs_data_get_int` が 0 を返す＝ **`Always ON` 扱い**（安全側と一致）。

### 3-4. ⚠⚠⚠ ファイルは「OBS 終了時」にしか書かれない（2026-09-12 に確定）

`output-status-dock.cpp` の `saveSettings()` の呼び出し箇所は **2 つだけ**：

```cpp
case OBS_FRONTEND_EVENT_EXIT:              dock->saveSettings(); break;
case OBS_FRONTEND_EVENT_PROFILE_CHANGING:  dock->saveSettings(); break;
```

⚠ コンボボックスの `currentIndexChanged` には**つながっていない**。デストラクタでも呼ばない
（ソース中のコメント: OBS 32 以降はデストラクタ時点で frontend API が壊れており
`obs_frontend_get_current_profile_path()` が `nullptr` を返すため、意図的に EXIT で保存している）。

⇒ **OBS 起動中にドックで変えた値は、ファイルに反映されていない。**
⇒ ⚠⚠ **読めるのは「最後に OBS を終了したとき / プロファイルを切り替えたときの値」である。**

**この事実が手順の順序を決める**（§5）:

- インターロックの変更は **OBS 再起動より前**に置く
- 再起動で初めてファイルに書かれる
- ⇒ **再起動のあとに読めば、正確な値が取れる**

⚠⚠⚠ **逆に、確認を通したあとで変えられたら検知できない。**
`Always ON` に戻されると、次に有効化したフィルタがその場で送信を始める。これは塞げない（§7）。

### 3-5. ✅ ファイルの場所（2026-09-12・実機 macOS で確定＝段 067e-1 完了）

プラグインは **プロファイル優先 → プラグイン共通の順**で読む（`output-status-dock.cpp`）。StreamDock も**同じ順**で探す。

**① プロファイル側**

```
<data_dir>/obs-studio/basic/profiles/<ProfileDir>/outputStatusDock.json
```

**② プラグイン共通側**（フォールバック）

```
<data_dir>/obs-studio/plugin_config/osi-branch-output/outputStatusDock.json
```

⚠ `<data_dir>` は [`obs_config.rs`](../../apps/desktop/src-tauri/src/obs_config.rs) の `config_path()` と**同じ規則**
（macOS/Windows は `app.path().data_dir()`／Linux は `config_dir()`）。⇒ **基底の求め方を新しく作らない。共有する。**
⚠⚠ プラグイン共通側のディレクトリ名は **`osi-branch-output`**（実機で確認）。

**⚠⚠⚠ `<ProfileDir>` の求め方（ここに罠がある）**

`<data_dir>/obs-studio/user.ini` の **`[Basic]` セクション**から読む：

```ini
[Basic]
Profile=無題                      ← ⛔ これは**表示名**。使ってはいけない
ProfileDir=characters_only        ← ✅ **これがディレクトリ名**
```

⚠⚠⚠ **`Profile` と `ProfileDir` は別物で、実機では実際に違う値だった。**
表示名は日本語や記号を含みうるが、ディレクトリ名は OBS が別に正規化している。
⇒ **`Profile` を使うとパスが存在しない**。必ず **`ProfileDir`** を読むこと。

⚠⚠ **OBS の版で置き場所が違う**：OBS 30 以降は `user.ini`、それ以前は `global.ini` に入っている。
⇒ **`user.ini` → 無ければ `global.ini`** の順で見る（どちらも `[Basic]` / `ProfileDir`）。
⚠ 実機の `global.ini` にあった `Profiles=` は**プロファイル置き場の基底**であって `ProfileDir` ではない。混同しないこと。

**確認できた実際の値**

```jsonc
// ⚠ 両方のファイルが存在し、内容も同一だった
{ "column.filterName.width":100, ..., "interlock":0, "sortingColumn":"filterName", "sortingOrder":0 }
```

⇒ **`interlock: 0` ＝ `ALWAYS_ON`**（§3-3 の既定と一致）。⚠ つまり**いまのままフィルタを有効化すると、その場で配信が始まる**。

⚠ 読めなかった場合は §3-2 の③（申告）へ落ちるので、**読めないこと自体で詰まらせない**。

---

## 4. 変更対象ファイル

### 4-1. 削除

| ファイル | 理由 |
|---|---|
| `apps/comment-sidecar/src/stream-output/liveness.ts` | 配信開始を持たないので、届いたかを証明する義務が無い |
| `apps/comment-sidecar/src/stream-output/status-poller.ts` | 同上 |
| `apps/desktop/src/features/comment-viewer/streamPillFace.ts` ＋ `.test.ts` | 配信ピルごと消える |
| `apps/desktop/src/features/comment-viewer/useLiveClock.ts` | 経過時間表示が無くなる |
| `apps/desktop/src/features/comment-viewer/formatElapsed.ts` | ⚠ 利用者は上の 2 つだけ（grep 確認済み） |
| `apps/desktop/src/screens/comment-viewer/StreamControls.tsx` | 開始/停止ボタンの本体 |

### 4-2. 変更（sidecar）

| ファイル | 変更 |
|---|---|
| `src/obs/stream-output.ts` | `startOutputs` / `stopOutputs` を**削除**。`ensureOutputs` が `GetStreamServiceSettings` を読んで**本体担当サイトを決め、残りにだけフィルタを作る**。`probeOutputs` は `nativePlatform` を返す |
| `src/obs/output-driver.ts` | `OBS_NATIVE_DRIVER` / `driverFor` / `canStartFromStreamDock` を**削除**（方式の二択ではなく**役割の割り当て**になるため）。`BRANCH_OUTPUT_DRIVER` だけ残す。⚠⚠ **段 067e-4 でやる**——`startOutputs` / `stopOutputs` がまだ使っているので、消すのは開始/停止を消すのと同時でなければ壊れる（2026-09-12 に段を移した） |
| `src/index.ts` | `stream-output.start` / `.stop` フレームを削除。`STREAM_OUTPUT_STATUS_FRAME` とポーラーを削除。⚠ **チケット機構は残す**（`ensure` / `probe` が使う） |

⚠ `src/obs/stream-policy.ts`（Twitch 規約の凍結テーブル）と照合は**一切触らない**。067 の規約対応はシーン構築側にあるので、開始を手放しても落ちない。

### 4-3. 変更（frontend）

| ファイル | 変更 |
|---|---|
| `features/comment-viewer/commentStream.ts` | `startStreamOutputs` / `stopStreamOutputs` / `onStreamOutputStatus` / `stream-output.status` を削除。`nativePlatform` を結果に追加 |
| `screens/comment-viewer/CommentViewerApp.tsx` | 配信ピル（`ToolbarPill`）と開始/停止ハンドラを削除。`openCard` を `"conn" \| null` へ戻す |
| `screens/comment-viewer/StreamOutputView.tsx` | 「配信」カードを**「準備の仕上げ」カード**へ。§3-2 の 3 段構えを実装 |
| `features/comment-viewer/streamSetupSteps.ts` ＋ `.test.ts` | ⚠ 手順を差し替え（下記 §5） |
| `screens/comment-viewer/CommentViewerApp.module.css` | 配信ピル関連の規則を削除 |

### 4-4. 追加

| ファイル | 役割 |
|---|---|
| `apps/desktop/src-tauri/src/branch_output_config.rs` | ⚠ `outputStatusDock.json` を **read-only** で読み `interlock` を返す。⚠⚠ [`obs_config.rs`](../../apps/desktop/src-tauri/src/obs_config.rs) の作法をそのまま踏襲（純関数のパーサを分けて単体テスト・見つからなければ `None`） |
| `apps/desktop/src/features/comment-viewer/interlock.ts` ＋ `.test.ts` | ⚠ 整数 → 意味の対応（§3-3 の表）。**純関数**。⚠⚠ 並び順ではなく**値**で書く |

---

## 5. 手順（`streamSetupSteps.ts`）の差し替え

**配信先 1 つ**（Branch Output 不要）:

```
✓ 1. 配信先を選ぶ
✓ 2. 配信の中身が入っている OBS のシーンを選ぶ
→ 3. 「OBS に配信の準備をする」を押す
  4. OBS の「配信開始」を押す        ← 今までどおり
```

**配信先 2 つ**（Branch Output が要る）:

```
✓ 1. OBS に拡張機能「Branch Output」を入れる
✓ 2. 配信キーを登録する（OBS 本体が担当しない側だけ）
✓ 3. 配信先を選ぶ
✓ 4. 配信の中身が入っている OBS のシーンを選ぶ
✓ 5. 「OBS に配信の準備をする」を押す
→ 6. Branch Output のインターロックを Streaming にする
  7. OBS を一度再起動する                    ⚠ done: null のまま（確認できない）
  8. 「確認する」を押す                       ⚠ ここで初めて 6 に ✓ が付く
  9. 「配信の受け口を有効にする」を押す
 10. OBS の「配信開始」を押す                 ← 今までどおり
```

⚠⚠⚠ **6 と 7 の順序が本タスクの肝である。**
インターロックは **OBS 終了時にしかファイルへ書かれない**（§3-4）。
⇒ 変更を再起動より**前**に置けば、再起動がそのまま保存になり、**8 で正確な値が読める**。
⇒ 逆にすると（067c の手順の並び）、8 で読める値は**変更前のもの**になり、
  「Streaming にしたのに Always ON と表示される」＝**画面が嘘をつく**。

⚠⚠ **7 と 8 を別の手順に分けてあるのも意図的である。**
再起動は StreamDock から確認できない（`done: null`）ので、
**ユーザーが「済んだ」と示す操作＝ 8 の「確認する」**が、実質的に再起動の完了合図になる。
⚠ ただし 8 が成功しても **7 に ✓ は付けない**（再起動したかは依然として分からない。✓ が付くのは 6 だけ）。

⚠ **連携（OAuth）の手順は消える。**生存確認が無くなるので、配信に連携は一切要らなくなる。
⚠⚠ 067c で足した「OBS の再起動は ✓ にしない」（`done: null`）の扱いは**そのまま維持**する。

---

## 6. 段取り

| 段 | 内容 | 検証 |
|---|---|---|
| **067e-1** | ~~実機でパスを確定~~ ✅ **完了（2026-09-12）** → §3-5 | ⚠ `ProfileDir` の罠を発見 |
| **067e-2** | ~~`branch_output_config.rs` ＋ `interlock.ts`~~ ✅ **完了（2026-09-12）** | Rust 13 本 ／ TS 11 本 ／ clippy 指摘 0 |
| **067e-3** | ~~`ensureOutputs` の割り当て変更（`GetStreamServiceSettings`）~~ ✅ **完了（2026-09-12）** | sidecar +44 本。⚠ 実機は未確認 |
| **067e-4** | ~~開始/停止と生存確認の**削除**~~ ✅ **完了（2026-09-12）** | ⚠ **純粋な削除ではなかった**（下記） |
| **067e-5** | ~~画面（手順・準備の仕上げカード・§3-2 の 4 段構え）~~ ✅ **完了（2026-09-12）** | frontend +28 本。⚠ 実機は未確認 |
| **067e-6** | ⚠⚠⚠ **`security-review`**（依頼者の指示・2026-09-12） | §9 の 3 点＋指摘の修正 |

⚠ **067e-4 を先にやらないこと。** 先に消すと、067e-3 が壊れたときに戻す先が無くなる。

### ⚠⚠⚠ 067e-4 は「削除」ではなく「改名して剥がす」だった（2026-09-12 に判明）

着手して初めて分かったが、`startOutputs` には**消してはいけないものが 3 つ**入っていた:

| 中身 | 扱い |
|---|---|
| **規約の照合**（強制の 2 段目・`reconcile`） | ⚠⚠⚠ **残す。** StreamDock が最後に触れる瞬間へ移した |
| **黒い枠を配信しない門**（§17 #14） | ⚠⚠ **残す。** 同上 |
| OBS 版の確認 | 残す |
| 生存確認・ポーリング・配信ピル | 消す |

⇒ `startOutputs` / `stopOutputs` は **`enableOutputs` / `disableOutputs`** に改名した。
⚠ 意味も変えている——「配信開始」ではなく「**配信の受け口を開く**」。
⚠⚠ 照合は**選択した配信先すべて**に掛ける（有効化するのは本体が担当しない側だけだが、
  本体が担当する側も**番組シーンとして OBS が送る**ので規約の対象である）。
⚠⚠ **067e-6 は省略できない。**§7-3（配信キーが `GetStreamServiceSettings` 経由で sidecar を通る）は
**新しい秘密の経路**であり、`docs/security.md` の追記だけで済ませてはならない（依頼者の明示指示）。

---

## 7. ⚠ 残る弱点（正直に書いておく）

1. **インターロックを StreamDock は変更できない。**読むだけ。
   ⚠ ユーザーが確認を通したあとに `Always ON` へ戻すと、次に有効化したフィルタが**その場で送信を始める**。検知できない。
2. ⚠⚠⚠ **読める値は「最後に OBS を終了したときの値」であって「いまの値」ではない**（§3-4 で確定）。
   ⇒ **「更新」ボタンは、OBS 起動中の変更を取りに行けない。**押しても同じ古い値が返る。
   ⇒ だからボタンの文言は「**最新の状態にする**」ではなく「**OBS 再起動後にもう一度確認する**」にする。
   ⚠⚠ ここを「最新にする」と書くと、**ボタンがあるせいで確認できたつもりになる**——
     067c の「配信開始ボタンが守れない約束をする」と**まったく同じ失敗**を、確認ボタンで繰り返すことになる。
3. **配信キーを `GetStreamServiceSettings` 経由で一瞬触る。**使わないが、通る。
   ⇒ ⚠⚠⚠ **`security-review` 必須**（§6 の 067e-6・依頼者の指示）。`docs/security.md` の追記だけでは済ませない。

⚠⚠ 1 と 2 は **067 の R-4 が形を変えて残ったもの**である。消えてはいない。
消えたのは「**StreamDock が嘘をつく**」ほうで、いま嘘をつきうるのは**ユーザー自身が設定した OBS** である。

---

## 8. テスト

| 対象 | 内容 |
|---|---|
| `parse_interlock`（Rust・純関数） | 0 → Always ON ／ 1 → Streaming ／ **9999 → Always OFF** ／ キー欠落 → Always ON ／ 壊れた JSON → `None` |
| `interlock.ts`（TS・純関数） | 同上。⚠ **4=VirtualCam / 5=ReplayBuffer** の順を明示的に固定する（並び順で書くと誤る） |
| `streamSetupSteps.test.ts` | 1 配信先 / 2 配信先で手順が変わる。⚠ 再起動は `done: null` のまま |
| サイト判定 | `rtmp_common` のサービス名 ／ `rtmp_custom` の URL 突き合わせ ／ 未設定 ／ 未知のサイト |
| ⚠⚠⚠ 回帰 | **`GetStreamServiceSettings` の `key` がログ・WS・画面のどこにも出ないこと**（grep 型の契約テスト） |
| ⚠⚠ 文言 | **「更新」ボタンのラベルに「最新」という語を使っていないこと**（§7-2・grep 型の契約テスト）。⚠ 読める値は常に「最後に OBS を終了したときの値」なので、**「最新」は嘘になる** |
| ⚠ 手順 | インターロックの変更が **OBS 再起動より前**に来ること（§5・順序が入れ替わると画面が嘘をつく） |

⚠ 067 側の未着手テスト（`stream_policy_is_frozen_in_sidecar` ほか）は**本タスクの影響を受けない**ので、そのまま残る。

---

## 9. `docs/security.md` への追記（必須）

1. `GetStreamServiceSettings` の読み取り＝**OBS に入っている配信キーが sidecar を通る**。サイト名だけ使い、残りは捨てる。
2. `outputStatusDock.json` の **read-only** 読み取り。⚠ **書き込みはしない**（§5 の踏襲）。
3. 逆に、**配信開始の能力が StreamDock から無くなる**（`stream-output.start` / `.stop` フレームの削除）＝**攻撃面が減る**。

⚠⚠⚠ **追記だけで終わらせないこと。**1 は**新しい秘密の経路**なので、
**`security-review` を段 067e-6 として必ず通す**（依頼者の指示・2026-09-12）。
⚠ レビューで見るべき最小の観点:
- `GetStreamServiceSettings` の戻り値が **sidecar の変数から外へ出ないこと**（ログ・WS フレーム・例外メッセージ・診断出力）
- サイト判定に使ったあと、**`key` を握り続けていないこと**（分割代入で `service` / `server` だけ取り出す等）
- `branch_output_config.rs` が **read-only** であること（`OpenOptions` を使っていない／`write` が無い）
- 読み取り先が **OS 別の既定パスに限られる**こと（任意パス読取にしない・`obs_config.rs` §7 の踏襲）

---

## 10. 067 との関係

- 067 の **段 0〜2（オーバーレイ分離・配信キー保管）はそのまま生きる**。
- 067 **段 3（067c）のうち、シーン構築・規約照合・プラグイン判定・縮退モードは生きる**。
- 067 段 3 のうち **配信開始/停止と生存確認だけが、本タスクで撤回される**。
- 067 **段 4（067d・プラグインの自動導入）は本タスクの影響を受けない**。
- ⚠ [068](068-multi-channel-comment-fetch.md)（複数チャンネル同時コメント取得）とも独立。
