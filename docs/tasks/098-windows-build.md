# 098 Windows Build

## 目的

MVP のアプリ動作は **macOS 実機で確認済み**だが、**Windows では未確認**。本タスクでは
**Windows 上の仮想環境（VM）** に開発ツールチェインを用意し、このアプリを実際にビルド・起動して
コア導線（ツール登録 → プリセット作成 → 一括起動/停止）が Windows でも動作することを確認する。

重要な前提として、リポジトリには **一度も Windows でコンパイルされていない Windows 限定コード** が
存在する（開発環境が macOS のため `#[cfg(windows)]` はビルド対象外だった）。したがって本タスクの主眼は
「クロスビルド設定」ではなく、**Windows 実環境で初めて型・API 使用を静的検査し、実機 E2E で挙動を確認する**
ことにある。ビルドを通すための修正が発生した場合は、**最小差分**でかつ別途合意の上で行う（大規模
リファクタや macOS 挙動の変更はしない）。

## 現在の前提（調査結果）

### ビルド構成

- Tauri 2 + React/TypeScript(Vite) + Rust。pnpm workspace モノレポ（`apps/desktop` が本体）。
- `tauri.conf.json`: `bundle.targets = "all"`、`bundle.icon` に `icons/icon.ico` を既に含む。
  → Windows では **`.msi`（WiX）と `.exe`（NSIS）** インストーラが生成される想定。
- `tauri.conf.json` の `app.windows[0]` は macOS 向け設定（`titleBarStyle:"Overlay"` / `hiddenTitle` /
  `trafficLightPosition`）を持つ。Windows ではこれらは無視され、代わりに `lib.rs` の
  `#[cfg(windows)] set_decorations(false)` でフレームレス化する設計（021）。
- 必要要件（README）: Node.js 20+ / pnpm 10+ / Rust ツールチェイン。

### Windows 限定・**未コンパイル/未検証**のコード（progress.md で明記済み）

- `apps/desktop/src-tauri/Cargo.toml`
  `[target.'cfg(windows)'.dependencies] windows = "0.58"`（features:
  `Win32_Foundation` / `Win32_UI_WindowsAndMessaging` / `Win32_System_Threading` /
  `Win32_System_Diagnostics_ToolHelp`）。macOS では解決されないため **feature/型の妥当性は未検証**。
- `apps/desktop/src-tauri/src/process/service.rs`
  `#[cfg(windows)] mod windows`（`focus_by_pid` / `EnumWindows` / `SetForegroundWindow` /
  `ShowWindow` / `CreateToolhelp32Snapshot` / `AttachThreadInput` 等）＝「開く」ボタンで
  **既存プロセスを前面化・新規起動しない**挙動。`focus()` の `#[cfg(windows)]` 分岐から呼ばれる。
- `apps/desktop/src-tauri/src/lib.rs`
  `#[cfg(target_os = "windows")]` で `window.set_decorations(false)`（フレームレス）＋
  `host_os` コマンド。フロントは `hostOs === "windows"` のとき nav 右端に自作 min/max/close を描画。
- autostart（`tauri-plugin-autostart`）: Windows は **レジストリ Run キー**経路。コンパイルのみで実挙動未検証。
- アイコン自動抽出（018）: Windows(.exe) は元々 **`Ok(None)` スタブ**だが、**028（Windows App Icon
  Auto-Extraction）で本実装済み**（若い番号順で 098 より先に実装）。ただし 028 の Windows 分岐は
  macOS 上で書かれた**未検証コード**で、**本タスク (B) の `cargo check` が初コンパイル、(C) が初 E2E**
  になる（→ `docs/tasks/028-windows-icon-extraction.md`）。コンパイルエラー/不具合が出たら本タスクで最小修正する。
- プロセス起動（`spawn`）: 非 macOS は `Command::new(path).spawn()` で子プロセスを直接掴む（007/008 の共通経路）。
  `.lnk` / `.bat` は起動対象外・絶対パス必須のバリデーションは共通。

### 関連する既知の TODO（progress.md）

- `focus_process` / Windows 前面化 / `windows` クレート追加に対する **security-review 未実施**。
- Windows 実機での「起動 → 背面化 → 開くで既存を前面化・**二重起動しない**」E2E 未実施。

## このタスクでやること

> 方針: (A) 環境準備 →(B) 静的検査でコンパイルを通す →(C) 実機起動・E2E、の順で進める。
> コード修正が必要になった箇所は逐次記録し、修正は最小差分・別途合意の上で行う。

### (A) Windows 仮想環境の準備（UTM/QEMU・**Windows 11 ARM64**）

> 決定事項: VM は **UTM(QEMU)**、ゲストは **Windows 11 ARM64**。ホストが Apple Silicon 前提のため
> ビルドターゲットは **`aarch64-pc-windows-msvc`**（ARM64 ネイティブ）で進める。x64 実機は使わない。

1. **UTM に Windows 11 ARM64 を導入**する。
   - UTM の "Windows" ギャラリー手順、または Microsoft の Windows 11 ARM64 評価版イメージを使う。
   - ネットワーク（NAT）と十分なディスク（Rust ビルド + 依存で数十 GB）を確保する。
   - 共有フォルダ or クリップボードでファイル授受できるよう UTM 側設定を有効化しておく。
2. VM に開発ツールチェインを導入する（**すべて ARM64 版**を選ぶ）。
   - **Rust**（`rustup`）＋ MSVC ツールチェイン **`aarch64-pc-windows-msvc`**（`rustup default` で設定）。
   - **Visual Studio Build Tools（ARM64）**: 「C++ によるデスクトップ開発」ワークロード＋
     **ARM64 ビルドツール**＋ Windows SDK（MSVC リンカに必須）。
   - **WebView2 ランタイム（ARM64）**（Win11 ARM64 に未同梱なら導入）。
   - **Node.js 20+（ARM64）** と **pnpm 10+**（`corepack enable`）。
   - インストーラ生成用: **NSIS(.exe)** は Tauri CLI が取得。**WiX(.msi)** は ARM64 対応/取得可否が
     不透明なため、`.msi` が生成できない場合は `.exe`(NSIS) を主とする（下記 (C) 11 参照）。
3. リポジトリを VM に取得する（`git clone` もしくは共有フォルダ経由）。改行コード/権限差異に注意。

### (B) 静的検査（Windows 限定コードを初めてコンパイル）

4. 依存を解決する: リポジトリ root で `pnpm install`。
5. **Rust の静的検査**（`apps/desktop/src-tauri`）:
   - `cargo check` … `#[cfg(windows)] mod windows` と `windows` クレートの feature/型/API 使用が
     **ここで初めて検査される**。エラーが出た場合は原因を記録し、最小修正で対応（feature 追加・
     型名/シグネチャ修正など）。
   - `cargo clippy` … 追加の警告確認。
6. **フロント側の検査**: root で `pnpm typecheck` / `pnpm lint`（プラットフォーム非依存だが VM 上でも再確認）。

### (C) 実機起動・E2E 検証

7. `pnpm tauri dev` で起動し、ウィンドウが表示されることを確認（初回は Rust ビルドに数分）。
8. **Windows 固有の見た目/ウィンドウ挙動**を確認:
   - フレームレス表示になっている（`set_decorations(false)`）。
   - nav 右端の **自作 min / max / close** が機能する。ドラッグ領域でウィンドウ移動できる。
   - タイトル文字の二重表示や、全画面/リサイズ時の破綻がない。
9. **コア導線の E2E**（MVP 動作確認）:
   - ツール登録（.exe をアプリ選択で登録。パスバリデーション・絶対パス要求が効く）。
   - URL ツール登録 → 既定ブラウザで開ける（023）。
   - プリセット作成 → **一括起動** → **一括停止** が Windows の実 .exe に対して機能する。
   - 個別起動 / 個別停止 / ランタイムステータス表示。
10. **Windows 限定の要注意フロー**（progress.md の未検証項目）:
    - 「**開く**」ボタン: 起動済みプロセスを背面化 → 「開く」で **既存インスタンスを前面化**し、
      **二重起動しない**こと（`focus_by_pid` / `SetForegroundWindow` 経路）。
    - **autostart**: 自動起動フラグ付きプリセットを作成 → OS ログイン項目（レジストリ Run キー）に
      登録/解除され、再ログインで `--autostart` 起動になること。
    - アイコン抽出（.exe）: 028 で実装済みの Windows 抽出経路がここで**初めて実機検証**される。実アイコンが
      プレビュー / 一覧 / サイドバー / プリセット追加に表示されること。抽出不可な `.exe` は文字フォールバック。
      （028 の Windows E2E・ハンドル/COM リーク確認は本タスクで実施する。）
11. `pnpm tauri build` で **ARM64 インストーラ**を生成し、生成物からインストール → 起動できることを
    確認する（**本タスクのゴールに含む**）。
    - `.exe`(NSIS) を主ターゲットとする。`.msi`(WiX) は ARM64 で生成できない場合、その旨を記録して
      `.exe` のみで完了とする（無理に WiX を通すことはしない）。
    - 署名なしのため SmartScreen 等の警告が出るが、これは **想定内**（コード署名は 099 で扱う）。
12. 検証結果（通った項目 / 直した箇所 / 残課題）を **docs/progress.md** に追記する。

## このタスクでやらないこと

- macOS 側の挙動変更・共通ロジックの大規模リファクタ。
- Windows(.exe) の実アイコン抽出実装（`Ok(None)` スタブのまま。別タスク）。
- Linux ビルド対応。
- x86_64（x64）Windows での検証（本タスクは **ARM64** に限定。x64 配布が必要なら別途）。
- CI（GitHub Actions 等）での自動 Windows ビルドパイプライン構築（本タスクは手動 VM 検証が目的）。
- 新機能追加。ビルドを通す/実機で動かすために不可欠な**最小修正**のみ許容し、それ以外の仕様変更はしない。
- **コード署名 / 公証**の本番対応（署名なし警告は想定内。署名は 099 側で扱う）。

## セキュリティ制約（docs/security.md 準拠）

- 本タスクで **プロセス操作・OS 操作・ファイル操作の設計は変更しない**（既存の Rust 実装を Windows で
  動かすのみ）。shell を経由しない・絶対パス検証・`.lnk`/`.bat` 拒否などの既存ガードを弱めない（§2/§4）。
- Windows 前面化（`focus_process` / `windows` クレート）は用途を **自分が起動した PID とその子ツリーの
  ウィンドウ操作**に限定する方針を維持（§10）。**この経路は security-review 未実施のため、E2E 前後で
  `docs/security.md` に基づくレビューを実施**する（`focus_process` / Windows 前面化 / `windows` クレート）。
- 新しい npm / crate / plugin を追加しない（ビルドに不可欠で回避不能な場合のみ理由を明記して合意）。
- 外部通信 / telemetry を増やさない。ビルド生成物に外部リソース取得を混ぜない（§1 / §CSP）。

## 決定事項（確認済み）

- **VM = UTM(QEMU) / ゲスト = Windows 11 ARM64**。ビルドターゲットは **`aarch64-pc-windows-msvc`**。
- **ゴールにインストーラ生成を含む**（`.exe`(NSIS) を主。`.msi`(WiX) は ARM64 で不可なら記録して省略）。
- x64 検証・コード署名は本タスク対象外（署名なし警告は想定内）。

## 留意点（進行中に確認するリスク）

- Windows **ARM64** ネイティブビルドは事例が x64 より少なく、`windows`(0.58) クレートや WebView2、
  WiX/NSIS の ARM64 対応で詰まる可能性がある。詰まったら生成物ターゲット（.exe のみ等）を縮退し、
  ブロッカーを progress.md に記録して前へ進める。
- UTM 上の Windows 11 ARM64 は動作が重くなりがち。ビルド時間・GUI 応答に余裕を見る。

## 完了条件

- Windows VM 上で `cargo check` / `cargo clippy` が通る（`#[cfg(windows)] mod windows` と `windows`
  クレートが初めてコンパイル・型検査される）。
- `pnpm typecheck` / `pnpm lint` が通る。
- `pnpm tauri dev` で起動し、フレームレス表示＋自作 min/max/close が機能する。
- ツール登録 → プリセット作成 → 一括起動 → 一括停止 のコア導線が Windows で動作する。
- 「開く」で既存インスタンスが前面化し、**二重起動しない**ことを確認済み。
- autostart の登録/解除・`--autostart` 起動が Windows で動作することを確認済み（またはブロッカーを記録）。
- `pnpm tauri build` で **ARM64 の `.exe`(NSIS) インストーラ**が生成でき、インストール → 起動できる
  （`.msi` は生成できた場合のみ。不可ならブロッカーとして記録済み）。
- Windows 前面化まわりの security-review を実施し、結果を docs に反映。
- 検証結果（成功項目・修正箇所・残課題）が docs/progress.md に追記されている。

## 確認コマンド（Windows VM 上・PowerShell 想定）

```powershell
# 依存解決
pnpm install

# フロント静的検査（root から）
pnpm typecheck
pnpm lint

# Rust 静的検査（Windows 限定コードの初コンパイル）
cd apps/desktop/src-tauri
cargo check
cargo clippy

# 実機起動（root から）
cd ../../..
pnpm tauri dev

# （任意）インストーラ生成
pnpm tauri build
```
