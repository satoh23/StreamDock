# Security Policy

## 目的

stream-dock は、ユーザーのPC上で動作し、外部アプリのパスを保存し、将来的にはプロセス起動・停止を行うデスクトップアプリである。

そのため、ユーザーのPCを壊さないこと、意図しないファイル操作やシェル操作を行わないこと、外部通信を勝手に行わないことを最重要方針とする。

## 基本方針

### 1. 外部通信をしない

MVPでは、stream-dock は外部サーバーと通信しない。

禁止するもの:

- telemetry
- analytics
- crash report の自動送信
- remote config
- cloud sync
- 外部API通信
- CDNからのscript/css/image読み込み
- ユーザーデータの外部送信

許可する可能性があるもの:

- ユーザーが明示的に押した「公式サイトを開く」ボタン
- 将来的なアップデート確認

ただし、MVPではこれらも原則実装しない。

### 2. frontendから自由なOS操作をさせない

React / TypeScript側から、自由なshell実行・自由なファイル操作・自由なプロセス操作を行わない。

禁止するもの:

- frontendから任意コマンドを組み立てて実行する
- frontendから任意のファイルを読み書きする
- frontendから任意パスを削除する
- frontendからshell pluginのexecute/openを自由に呼ぶ
- ユーザー入力をそのままコマンドラインに渡す

OS操作、ファイル操作、プロセス操作は、Rust/Tauri側で定義した限定的なcommandのみを経由する。

### 3. Tauri commandは最小権限にする

Tauri commandは、機能ごとに明示的に定義する。

例:

- `create_tool`
- `list_tools`
- `update_tool`
- `delete_tool`
- `launch_tool`
- `stop_tool`

禁止するcommand例:

- `run_command(command: string)`
- `execute_shell(input: string)`
- `write_file(path: string, content: string)`
- `delete_path(path: string)`
- `open_anything(pathOrUrl: string)`

つまり、汎用的で強すぎるcommandを作らない。

### 4. Shell実行は原則使わない

MVPでは、自由なshell実行は使わない。

外部アプリ起動が必要な場合は、Rust側で `std::process::Command` 等を使い、登録済みのTool情報に基づいて起動する。

禁止するもの:

- `cmd /C <user input>`
- `powershell <user input>`
- `sh -c <user input>`
- shell経由での文字列コマンド実行
- ユーザー入力を結合したコマンド実行

許可するもの:

- 登録済みの `executablePath` を、Rust側で検証したうえで起動する
- 引数が必要な場合も、文字列結合ではなく配列として明示的に渡す

### 5. ファイル操作はアプリ管理領域に限定する

MVPで許可するファイル操作は、原則としてアプリの管理領域内に限定する。

許可するもの:

- アプリ設定の保存
- SQLite DBの保存
- ログファイルの保存
- 将来的な設定バックアップファイルの保存

禁止するもの:

- 任意パスへの書き込み
- 任意パスの削除
- ユーザーのドキュメント、デスクトップ、ダウンロード配下を勝手に変更する
- 登録された外部アプリの設定ファイルを勝手に上書きする

将来的に設定ファイルのバックアップ・上書きを行う場合は、別タスクでセキュリティレビューを必須とする。

### 6. プロセス停止はstream-dock経由で起動したPIDに限定する

MVPでは、停止対象は stream-dock 経由で起動し、PIDを保持しているプロセスのみとする。

禁止するもの:

- process nameだけでkillする
- OBSなどの有名アプリ名を見つけて勝手に停止する
- ユーザーが手動で起動したプロセスを停止する
- 管理者権限で強制停止する

許可するもの:

- stream-dockが起動したPIDを停止する
- 停止できなかった場合にエラーを表示する

既知の実装上の限界（013 macOS `.app`）:

- macOS `.app` は `/usr/bin/open`（LaunchServices）で起動するため掴む `Child` が実アプリにならず、
  起動した実アプリの PID を「exe の親が `<bundle>/Contents/MacOS` である実行中プロセス」の照合で同定する。
  停止・状態確認の直前に **exe 絶対パスと起動時刻（start_time）の一致**を再検証して PID 再利用を弾く。
- `Contents/MacOS` 直下に**複数のフラットバイナリ**を持つ `.app`（ランチャスタブ＋本体等）では、本体以外の
  PID を同定・停止しうる（低頻度・アプリ依存の既知の限界）。`Info.plist` の `CFBundleExecutable` で厳密化する
  余地はあるが、読み取り専用の追加依存を避けるため MVP では据え置く。
- 既起動アプリの再アクティブ化（新規 PID が出ない）や遅延解決時に、ユーザーが手動起動したインスタンスを
  管理対象に取り込む可能性がある（上記「ユーザーが手動で起動したプロセスを停止する」禁止事項に対する緊張点）。

### 7. パス入力は検証する

ツール登録時の `executablePath` は、Rust側で最低限検証する。

確認項目:

- 空文字ではない
- 前後の空白をtrimする
- 重複登録を防ぐ
- 危険な制御文字を含まない
- 将来的には拡張子や存在チェックを行う

MVPでは、存在しないパスを保存するかどうかはタスクごとに判断してよいが、起動時には必ずエラーとして扱う。

### 8. ユーザー入力を信頼しない

frontend側でバリデーションしていても、Rust側でも必ず検証する。

対象:

- ツール名
- 実行ファイルパス
- 説明
- アイコンラベル
- プリセット名
- 起動順
- launchMode
- toolId
- presetId

### 9. ログに機密情報を出しすぎない

ログには、デバッグに必要な情報だけを書く。

避けるもの:

- 不必要なフルパスの大量出力
- 環境変数
- ユーザー名を含む情報の過剰出力
- 将来的な認証情報
- 外部送信

MVPではログはローカル保存のみとし、外部送信しない。

### 10. 依存関係を増やしすぎない

新しいnpm package、Rust crate、Tauri pluginを追加する場合は、理由を説明する。

特に注意するもの:

- shell操作系
- file system操作系
- auto update系
- network/http系
- telemetry系
- updater系
- plugin経由で強い権限を要求するもの

## Tauri Permissions / Capabilities 方針

Tauriのpermissions/capabilitiesは最小限にする。

方針:

- `shell:default` のような広い権限を安易に許可しない
- `fs:default` のような広い権限を安易に許可しない
- 使っていないplugin権限をcapabilitiesに追加しない
- frontendから呼べるcommandを必要最小限にする
- 危険なscopeを広げない

## CSP方針

MVPでは外部リソースを読み込まない。

方針:

- 外部scriptを読み込まない
- 外部styleを読み込まない
- 外部imageを読み込まない
- inline scriptを増やさない
- remote domain IPCを使わない

### 現状の実装メモ（018 時点）

`tauri.conf.json` は plain JSON でインラインコメントを持てないため、CSP の現状意図をここに残す。

- `app.security.csp` は現在 `null`（＝CSP を**強制していない**）。これは 018 以前からの既定で、
  018 Tool Icon Auto-Extraction でも**緩めていない**（変更していない）。
- 018 のアイコン表示は `data:image/png;base64,...`（inline data URI）のみを使い、リモート画像の
  取得は行わない。上記「外部imageを読み込まない」方針とは矛盾しない。
- TODO（別タスク）: CSP を実際に効かせる場合は `img-src 'self' data:` 等を設定し、`data:` inline を
  許可しつつ外部リソースをブロックする。値の変更はレビュー必須条件（下記）に該当するため別途対応する。

### 例外（032 追加対応・らくらくツール設定 詳細画面の YouTube デモ動画埋め込み）

上記「外部リソースを読み込まない」原則に対し、**らくらくツール設定の詳細画面のデモ動画に限り**、
YouTube（`https://www.youtube-nocookie.com/embed/<id>`）の **iframe 埋め込み**を例外的に許容する
（動画をアプリに同梱すると容量が増えるため。明示同意ではなくデモ表示のため security-review で担保）。

- **プライバシー強化ドメイン（youtube-nocookie）**を使い、再生するまで Cookie を張らない。`rel=0` で関連動画を抑制。
- iframe 属性は最小・安全側（`referrerpolicy="strict-origin-when-cross-origin"` / `allow="encrypted-media; fullscreen;
  picture-in-picture"` / `loading="lazy"` / `title`）。動画 ID は **frontend の定数**（ユーザー入力でない）で、
  `^[A-Za-z0-9_-]{11}$` の正規表現ガードを通してから src を組み立てる（未設定・不正時は「準備中」プレースホルダ）。
- 新規依存・Tauri command・capability の追加なし（iframe は純 HTML・webview が描画し IPC に触れない）。`csp: null` 不変。
  詳細画面を開くと YouTube/Google へ外部通信が発生する（§1 の一般禁止に対する限定例外）。telemetry は追加しない。
- **TODO（別タスク・上記と同じ）**: CSP を実際に効かせる場合、本埋め込みのため `frame-src https://www.youtube-nocookie.com`
  （および YouTube 側が要求する `googlevideo.com` 等の派生ドメイン）を許可する必要がある。

## らくらくツール設定（外部アプリ連携）方針

らくらくツール設定の「外部アプリ連携」機能に関する方針（詳細な設計判断は
`docs/tasks/032-rakuraku-auto-setup-design.md` を正とする）。

**032c-a（方針転換に伴う撤去）**: 032b で実装した棒読みちゃん×VOICEVOX 連携のうち、**ループバック疎通通信
（§1 の限定解禁分・VOICEVOX 50021 / 棒読みちゃん 50001）／棒読みちゃん設定ファイルの書換（§5 の限定解禁分・
バックアップ付き）／新規依存 `ureq`／SAPI レジストリ読取（`Win32_System_Registry`）**は撤去した。これにより
§1（外部通信をしない）・§5（外部設定を上書きしない）の一般原則へ復帰する（限定解禁は無し）。現時点で登録済みの
連携実装は無い（`registry()` は空）。VOICEVOX 直接読み上げの通信方針は 032c-b で security-review の上あらためて
定義する（本タスクでは外部通信の新規解禁は追記しない）。

以下は温存する共有部（らくらく画面シェル・登録済みアプリの自動起動・公式ページ誘導）の方針。

- **インストーラの自動DL・自動インストールはしない**。不足アプリは公式配布元ページを開いて誘導するのみとする
  （URL は Rust 側の固定定数で解決し、frontend は raw URL を渡さない）。
- **既導入・同意済みアプリの自動起動を許可**する（032b 修正2 の導入検出・起動経路を温存）。対象は**「ツール管理」に
  登録済みで `executablePath` が有効**（絶対・実在・非ディレクトリ・`.lnk`/`.bat` でない）なアプリのみ。
  **解決は登録済み `executablePath` のみ**を用い、**FS 広域走査（Downloads/ドライブ直下等の `read_dir`）・sysinfo に
  よるプロセス列挙は行わない**（同名 exe 偽装の攻撃面を排除）。登録済みツールと部品の対応付けは **exe ファイル名一致**
  （大小無視）で行い、**永続化しない**。起動は **shell 非経由**で、登録時にユーザーが明示選択・検証済みの絶対パスを
  **既存の管理付き `process::service::spawn`＋PID registry 登録**（`launch_tool` と同経路）で行う。これにより起動
  プロセスは**停止/監視の対象になる**（§6「停止は自 spawn 起動 PID に限定」と整合）。frontend は部品名の固定語だけを
  渡し、raw パスは渡さない。**未署名バイナリの DL/インストールはしない**（誘導のみ）。
- **明示同意（同意画面）＋ security-review を必須**とする。自動起動は同意画面に明示する。
- **frontend からは raw なパス/URL/ポート/コマンドを受けず、限定コマンド（`rakuraku_*`）経由のみ**とする。
  外部通信は追加しない（capability は追加しない）。`csp: null` 不変。

## レビュー必須条件

以下を変更する場合は、必ずセキュリティレビューを行う。

- Tauri capabilities
- shell plugin
- filesystem plugin
- opener plugin
- process起動処理
- process停止処理
- ファイル読み書き処理
- ログ出力処理
- 外部通信
- 自動アップデート
- 設定ファイルのバックアップ・上書き
- ユーザー入力をOS操作に渡す処理
- ログイン項目（autostart / 永続 OS 連携）の登録・解除処理
- らくらくツール設定の外部アプリ連携（**既導入アプリの自動起動**・公式ページ誘導）
- 外部コンテンツの埋め込み（iframe・外部 script/style/image/media・外部ドメインの読込）

### 011 ログイン項目（autostart, 019 時点）

- ログイン項目の登録・解除は公式 `tauri-plugin-autostart`（v2, macOS は LaunchAgent 方式）のみで行い、
  手書きの LaunchAgent plist / レジストリ書込は行わない（§5）。
- ユーザー向けのグローバル ON/OFF は設けず、「`auto_launch_on_boot` フラグ付きプリセットが 1 つ以上
  ⇔ ログイン項目 ON」という不変条件を reconcile（create/update/delete/起動時）で導出する。
  全フラグ解除時は `disable()` により**必ず**解除される（`is_enabled()` でガードし冗長書込を回避）。
- OS がログイン時に起動する際は `--autostart` 引数を渡し、起動時フックはこの引数がある時のみ
  フラグ付きプリセットのツールを自動一括起動する（手動起動では発火しない）。起動処理は既存
  `validate_executable` / 保存済み `executablePath` 経由のみで、新規 spawn 面・shell・外部通信を増やさない。
- capabilities は autostart の 3 permission（`allow-enable` / `allow-disable` / `allow-is-enabled`）のみ。
  なお reconcile は Rust 側 `ManagerExt`（IPC 非経由）で行うため、これら 3 permission は **JS からは未使用**。
  削除すると plugin が ACL 経由の場合に autostart が黙って壊れるリスクがあるため最小構成として保持する
  （`capabilities/default.json` は JSON でコメントを書けないため、保持理由をここに残す）。
- **既知の限界**: アプリをアンインストールした場合、登録済みのログイン項目（macOS の
  `~/Library/LaunchAgents/<identifier>.plist` 等）が OS 側に残留し得る。アンインストーラ側での
  クリーンアップは MVP スコープ外（別途検討）。ユーザーが手動で削除することでも解除できる。
- **プラットフォーム限定（未検証）**: `tauri-plugin-autostart` は OS ごとに登録方式が異なる
  （macOS=LaunchAgent / Windows=レジストリ Run キー / Linux=.desktop）。本開発環境は macOS のため、
  Windows/Linux の autostart 登録経路は `cargo check` でコンパイルされても**実挙動は未検証**
  （動作対象は macOS のみ）。起動時の自動一括起動が再利用する `launch_preset_targets` も
  013 由来のプラットフォーム差（macOS `/usr/bin/open` 縮退）を継承する。

### 021 カスタムタイトルバー（core:window capabilities / frameless）

- Docker Desktop 風に OS ウィンドウ枠へヘッダーを統合するため、`capabilities/default.json` に
  `core:window` の変更系 permission を**ウィンドウ操作に限定**して追加した:
  `allow-start-dragging` / `allow-minimize` / `allow-toggle-maximize` / `allow-close`。
  いずれも自ウィンドウの移動・最小化・最大化・クローズという UI 制御のみで、shell / fs / process / network を
  伴わない（実害の小さい操作）。広い scope（`core:window:default` を超える任意 window 生成等）は追加しない。
- **frontend からの呼び出し面**: `@tauri-apps/api/window` の `getCurrentWindow().minimize()/toggleMaximize()/
  close()`（Windows の自作制御ボタン）と、`data-tauri-drag-region`（両 OS のドラッグ移動）に限定。
  任意 URL/コマンド/パスを渡す口はない。
- **OS 判定コマンド `host_os`**: `std::env::consts::OS` を返すだけの自前コマンド（ユーザー入力なし・固定文字列）。
  タイトルバーの出し分け（macOS=信号機回避の余白 / Windows=制御ボタン表示）にのみ使う。ACL 追加は不要。
- **ウィンドウ枠設定**: macOS は `titleBarStyle="Overlay"`＋`hiddenTitle`＋`trafficLightPosition`（config）で
  ネイティブ信号機を残す。Windows は `lib.rs` setup で `#[cfg(windows)]` 時のみ `set_decorations(false)` で
  フレームレス化する（static config の `decorations` 衝突回避のため実行時に設定）。
- **CSP・外部リソースは不変**（`csp: null` のまま／外部フォント・CSS・CDN・リモート画像を増やさない）。
  新規 npm / crate / plugin の追加なし。
- **プラットフォーム限定（未検証）**: 本開発環境は macOS のため、Windows のフレームレス＋自作制御ボタン経路は
  `cargo check` でコンパイルされても**実挙動は未検証**（動作対象は macOS を主とする。既存 013/019 と同じ扱い）。
  フレームレス Windows の Aero Snap / リサイズ縁 / スナップレイアウトのホバーはネイティブ同等にならない場合がある。

### 028 Windows アイコン抽出（`windows` feature 追加 / unsafe FFI・未検証）

- 018 で `Ok(None)` スタブだった Windows(.exe) の実アイコン抽出を本実装した（`tools/icon.rs::windows`）。
  ユーザー選択済み `.exe` のシェル表示アイコンを **読み取り専用**で取得し、018 と同じ出力仕様
  （`data:` 無し base64 PNG・≤128px・失敗は `Ok(None)`）で返す。frontend / DB / `extract_app_icon` の
  I/F・出力仕様は 018 のまま流用（変更なし）。
- 主経路 `IShellItemImageFactory::GetImage` / フォールバック `SHGetFileInfoW` はいずれもアイコン描画取得のみで、
  **書き込み・削除・外部通信を行わない**。抽出対象は `validate_icon_path`（非空・絶対・実在・非ディレクトリ・
  `.lnk`/`.bat` 拒否）を通過したパスのみで、汎用ファイル読取にはしない（§3/§4/§7）。エラー詳細（フルパス/OS
  エラー）は返さず `Ok(None)` に丸め、ログ追加もしない（§9）。
- 追加依存は `windows` クレートの **feature 追加のみ**（`Win32_UI_Shell` / `Win32_Graphics_Gdi` /
  `Win32_System_Com` / `Win32_Storage_FileSystem`）。新規クレートは増やさず、`image`/`base64` は macOS 限定
  ブロックから共通 `[dependencies]` への**ターゲット再配置**（新規追加ではない）。Cargo.lock 差分なし（§10）。
- ハンドル/COM リーク対策として RAII ガード（`CoUninitialize`/`DestroyIcon`/`DeleteObject`/`ReleaseDC` を Drop）を
  用い、全 early-return 経路で解放する。COM インターフェース Release が `CoUninitialize` より先に走る宣言順にしてある。
  `unsafe` FFI は各呼び出し単位の最小スコープに限定。
- **プラットフォーム限定（未検証）**: 本開発環境は macOS のため `#[cfg(windows)] mod windows` は
  `cargo check` の対象外＝**macOS では未コンパイル・実機未確認**。型・API 名・unsafe FFI は windows 0.58 実ソース
  との**机上整合のみ**で、実コンパイル・実機 E2E・リーク実挙動の確認は 098（Windows ARM64 VM）が初
  （既存 013/019/021 の Windows 経路と同じ扱い）。098 でコンパイルエラー/不具合が出た場合は 098 側で最小修正する。

### 098 Windows Build（Windows 前面化 / focus_process / windows クレート / 028 unsafe FFI の実検証・security-review 実施済み）

- Windows 11 ARM64（UTM/QEMU）実機で、これまで未コンパイル・未検証だった Windows 限定コードを **初コンパイル・初 E2E** した:
  前面化（`process/service.rs::mod windows`：`focus_by_pid`/`EnumWindows`/`SetForegroundWindow`/`AttachThreadInput`/
  `CreateToolhelp32Snapshot`）、`focus_process` コマンド、028 アイコン抽出（`tools/icon.rs::mod windows` の unsafe FFI）。
  `cargo check`/`clippy` は **コード修正ゼロで通過**（GDI/COM の型も windows 0.58 で問題なし）。
- **前面化 / focus_process / windows クレート・028 unsafe FFI の security-review を実施し、判定＝問題なし**（修正必須なし）。
  これにより、これまで「未実施」だった前面化まわりの security-review（011/021 の Windows 経路注記・progress.md 既知 TODO）を**解消**する。
  確認事項:
  - `focus_process` は frontend から **launchId のみ**受け取り raw PID / HWND を受けない。前面化対象は **registry 保持の
    自分が起動した PID とその子孫プロセス**に限定し、**プロセス名では他人のウィンドウを探さない**（§6/§2）。
  - registry に無い launchId は前面化せず **新規インスタンスを起動しない**（二重起動を根絶）。
  - ウィンドウ選定は `GetWindowTextLengthW` の**長さ判定のみ**で**タイトル文字列を読まない**。エラーは固定文言・
    フルパス/OS エラー非露出・追加ログなし（§9）。shell 非経由・外部通信/ファイル書込削除なし（§1/§4/§5）。
  - ハンドル/COM 解放: 前面化は `CloseHandle(snapshot)` 実施。028 は RAII ガード（`CoUninitialize`/`DestroyIcon`/
    `DeleteObject`/`ReleaseDC`）が全 early-return・`?` 経路で解放し、COM インターフェース Release → `CoUninitialize` の
    drop 順も正しい。実機の繰り返し登録で不安定化なし＝リーク兆候なしと整合。
  - 追加依存は `windows` クレートの **feature のみ**（新規 crate なし・§10）。`csp:null` 不変・外部リソース非増加（§CSP）。
- **既知の限界（記録のみ・修正不要）**: `collect_process_tree` は PID 再利用時に無関係な PID を子孫集合に含めうる
  （深さ 8 / 件数 1024 で保護）。ただし操作は**前面化のみ（kill しない）**で実害は「無関係なウィンドウが前面に出る」程度・
  低頻度。停止経路（§6）のような exe/start_time 照合の追加は前面化の低リスクに対し過剰なため据え置く。
- **アプリアイコン（icon.ico）**: 098 で Windows 用 `icon.ico` を再生成した（読み取り専用の静的アセット変更のみ・
  OS 操作/通信/権限に影響なし）。macOS の `icon.icns` は不変。`tauri.conf.json` / capabilities は変更なし。

### 032c-a らくらくツール設定 032b（棒読み×VOICEVOX）撤去（ループバック通信 / 外部設定書換 / `ureq` / SAPI レジストリ読取の削除・security-review 実施済み）

- 032c 方針転換（内蔵コメントビューア × VOICEVOX 直接読み上げ）に伴い、032b で追加した棒読みちゃん×VOICEVOX
  連携の**棒読み/SAPI 依存部分**を撤去した。削除対象: `rakuraku/integrations/bouyomi_voicevox.rs` 全体
  （`#[cfg(windows)] mod imp`）／`Integration` trait の `configure`/`verify` メソッド／`rakuraku_configure_integration`・
  `rakuraku_verify_integration` コマンドと `lib.rs` 登録／`ConfigureResult`/`VerifyResult` 系 model・TS binding／
  `Cargo.toml` の `ureq` 依存・`windows` feature `Win32_System_Registry`。frontend 側は `integrationRegistry` の唯一の
  エントリ・`rakurakuApi` の configure/verify ラッパ・ExecutionView の設定書換/疎通経路を撤去。
- **security-review を実施し、判定＝問題なし**（修正必須なし・攻撃面は縮小方向）。確認事項:
  - **外部通信の限定解禁を全撤去**: `ureq`（`127.0.0.1:50021`）・`std::net::TcpStream`（`127.0.0.1:50001`）の利用箇所は
    `bouyomi_voicevox.rs` のみで、同ファイル削除後は残らない（grep で他用途ゼロを確認）。§1（外部通信をしない）の
    一般原則へ復帰。**本タスクでは外部通信の新規解禁は追記しない**（VOICEVOX 直接読み上げの通信方針は 032c-b）。
  - **外部設定書換の限定解禁を撤去**: 棒読みちゃん設定ファイルの書換（バックアップ先取り）経路を削除。§5（外部設定を
    上書きしない）の一般原則へ復帰。app 管理領域外への書込は行わない。
  - **レジストリ読取を撤去**: SAPI トークン列挙（`Win32_System_Registry`・`RegOpenKeyExW`/`RegEnumKeyExW`）の利用は
    `bouyomi_voicevox.rs` のみで、削除後に未使用（grep 確認）。`Cargo.toml` から feature を外した。
  - **capability / CSP 不変**: `capabilities/default.json` / `tauri.conf.json`（`csp: null`）に差分なし。新規 command は
    追加せず、`rakuraku_*` は 2 本削減（scan / launch / open_official_page の 3 本は温存）。
  - **温存した共有部**: らくらく画面シェル（一覧/詳細/同意/実行の器）・`rakuraku_launch_component`（登録済み exe を
    管理付き `spawn`＋PID registry で起動）・`rakuraku_open_official_page`・`resolve_tool_for_component`。これらの
    セキュリティ方針は上記「らくらくツール設定（外部アプリ連携）方針」に集約済み（撤去で挙動は変わらない）。撤去後
    `registry()` は空で、`find` は常に `NotFound` を返す（空でもらくらく画面はクラッシュしない）。
  - **binding drift ゼロ**: 削除した Rust 型の残骸 TS（`ConfigureResult.ts`/`ConfigureStatus.ts`/`VerifyResult.ts`/
    `VerifyStatus.ts`）を手動削除し、`gen:bindings` 再実行で差分ゼロを確認。
- **docs 整理**: 本 security.md の §1/§5 の 032b 例外・らくらく方針節・032b 系レビュー記録、`docs/product.md` の
  棒読み/SAPI 例外を、撤去に合わせて整理（撤去/整理のみで外部通信の新規解禁追記は含まない）。

### 032 追加対応 らくらくツール設定 詳細画面（YouTube デモ動画 iframe 埋め込み / 非対応 OS ガード・security-review 実施済み）

- 詳細画面のデモ動画を **YouTube（youtube-nocookie）iframe でインライン埋め込み**（アプリ同梱による容量増を避けるため）。
  非対応 OS では「確認画面に進む」を無効化＋小さめ赤文字「(このOSでは利用できません)」を表示。**frontend のみ**
  （registry＋screen＋css）・Rust/Cargo/capabilities/`tauri.conf.json`（`csp: null`）不変。詳細は上記 CSP方針の「例外」を参照。
- **security-review を実施し、判定＝問題なし**（修正必須なし）。確認済み: youtube-nocookie＋`rel=0`（Cookie/関連動画抑制・
  telemetry 追加なし）／動画 ID は frontend 定数を `^[A-Za-z0-9_-]{11}$` でガードしてから src を組み立て（URL/属性の
  ブレイクアウト不可・未設定/不正は「準備中」フォールバック）／iframe 属性は最小・安全側（`allow` は
  encrypted-media/fullscreen/picture-in-picture のみ・`referrerpolicy=strict-origin-when-cross-origin`・`loading=lazy`・`title`）／
  クロスオリジン外部フレームで Tauri IPC 非接触・新規依存/command/capability なし・`csp:null` 不変／OS ガードは UI のみで多重防御。
- **留意点（動画 ID 設定後に `tauri dev` で確認）**: 現状 `demoVideoId` 未設定のため外部通信は未発生。実 ID 設定後、
  ① インライン再生 ② フレーム内操作でアプリウィンドウが外部 URL へ遷移/想定外ポップアップしないこと を確認する。
  top-navigation/popups が起きる場合は `sandbox="allow-scripts allow-same-origin allow-presentation"`（top-nav/popups 非付与）を
  追加し再生維持を確認する。将来 CSP を効かせる際は `frame-src https://www.youtube-nocookie.com`（＋派生ドメイン）が必要。

## 004 Tool Registry時点のレビュー観点

004では、以下を確認する。

- frontendから直接shell実行していない
- frontendから直接ファイル操作していない
- Tool保存処理がRust/Tauri側に寄っている
- Tool入力値をRust側でも検証している
- executablePathを保存するだけで、まだ起動していない
- 同じexecutablePathの重複登録を防いでいる
- 保存先がアプリ管理領域内である
- 外部通信を追加していない
- capabilitiesに不要な強権限を追加していない
- 003 App Shellの見た目を大きく壊していない
