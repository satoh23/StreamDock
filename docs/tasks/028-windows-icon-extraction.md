# 028 Windows App Icon Auto-Extraction

## 目的

018 で入れたツールアイコンの**自動読み込み・反映**は、macOS(`.app`) では本実装済みだが、**Windows(`.exe`) は
`Ok(None)` スタブ**のまま（当時 macOS 開発環境では `#[cfg(windows)]` を検証できず、未検証コードを混ぜない
決定だった / progress.md 記載の TODO）。本タスクでは **Windows でユーザーが選択した実行ファイルの実アイコンを
自動抽出し、base64 PNG(≤128px) として反映する経路を本実装**する。

frontend / DB / スキーマの配線は **018 で既に完成しており流用する**（変更しない）。本タスクの実質は
Rust の Windows 抽出ロジック追加のみ。

> 実装順序と検証方針: 連番タスクは**番号が若い順に実装する**ため、028 は 098（Windows Build）**より先に、
> 現在の macOS 開発環境で実装だけ完了させる**。ただしこのコードは `#[cfg(windows)]` のため
> **macOS では `cargo check` の対象にならず、その場でコンパイル検証できない**。よって本タスクでは
> **未検証の Windows コードとして書き切る**（既存の Windows 前面化コード `service.rs::mod windows` と同じ
> 扱い＝macOS で書いて Windows ビルドで初検証、という本リポジトリの前例に倣う）。型・API・unsafe FFI の
> 実コンパイルと実機 E2E は **098 の Windows 11 ARM64(VM) 環境で初めて行う**（本タスクの完了条件には含めない）。
>
> ⚠️ この前提により、028 の Windows 分岐は「動作未確認のまま main に入る」ことを許容する。098 で
> コンパイルエラー/挙動不具合が出た場合は 098 側で最小修正する想定（未検証であることを progress.md に明記する）。

## 現在の前提（調査結果）

### 018 で既に配線済み（流用・変更しない）

- DB: `tools.icon_png`（nullable TEXT・`ensure_column` で冪等追加済み）。
- コマンド: `extract_app_icon(path: String) -> AppResult<Option<String>>`
  （`tools/commands.rs` → `tools/icon.rs::extract_app_icon`）。
- frontend: `AddToolScreen.selectFile()` が選択直後に `extractAppIcon` を invoke し `iconPng` を保存。
  表示は `IconTile`（PNG あれば画像・無ければ 1 文字ラベル）で一覧 / サイドバー / プレビュー / プリセット追加に統一。
  → **frontend は原則ノータッチ**（Windows で `Some(base64)` が返れば自動的に画像表示される）。
- 出力仕様: `data:` プレフィックス無しの base64 PNG、**≤128px**、非対応/失敗は `Ok(None)`（クラッシュしない）。

### 実装対象（Rust `apps/desktop/src-tauri/src/tools/icon.rs`）

- 現状 `extract_app_icon` の `#[cfg(not(target_os = "macos"))]` 分岐が `let _ = validated; Ok(None)`（スタブ）。
  ここを `#[cfg(windows)]`（実装）/ `#[cfg(all(not(macos), not(windows)))]`（Linux 等は従来どおり `Ok(None)`）に分ける。
- パス検証 `validate_icon_path` は共通（非空・絶対・実在・非ディレクトリ・`.lnk`/`.bat` 拒否）。
  **`.lnk` は対象外**（ショートカット実体解決はしない・018 の非目標を踏襲）。
- `encode_png_base64`（アスペクト維持 ≤128px 縮小 + PNG + base64）と定数 `MAX_ICON_PX` は現在 `mod macos`
  **内部**にある。Windows でも同一の出力仕様に合流させるため、**親モジュール（`icon.rs` 直下）へ引き上げて
  共有**する（macOS 側の呼び出しはパス変更のみ・ロジック不変の小リファクタ）。

### Cargo.toml の依存構成（要変更）

- **注意**: `image` / `base64` は現在 `[target.'cfg(target_os = "macos")'.dependencies]` **ブロック内**に
  ある（＝macOS 限定）。Windows でも共有 `encode_png_base64` を使うため、この 2 つを **共通
  `[dependencies]` へ移す**必要がある（いずれも pure-Rust・`image` は `default-features=false,
  features=["png"]` を維持）。`plist` / `icns` / `objc2-*` は macOS 限定のまま。
- `windows` クレート（0.58）は既に `[target.'cfg(windows)'.dependencies]` にあるが、現行 feature は
  前面化用途（`Win32_Foundation` / `Win32_UI_WindowsAndMessaging` / `Win32_System_Threading` /
  `Win32_System_Diagnostics_ToolHelp`）のみ。アイコン抽出に必要な feature を**追加**する:
  - `Win32_UI_Shell`（`SHCreateItemFromParsingName` / `IShellItemImageFactory` / `SHGetFileInfoW`）
  - `Win32_Graphics_Gdi`（`GetObjectW` / `GetDIBits` / `HBITMAP` / `BITMAP` / `DeleteObject` / DC 系）
  - `Win32_System_Com`（`CoInitializeEx` / `CoUninitialize` / `CoCreateInstance`）

## このタスクでやること

### (1) Cargo.toml（依存の再配置と feature 追加）

- `image` / `base64` を macOS 限定ブロックから **共通 `[dependencies]` へ移動**（機能スペックは維持）。
- `[target.'cfg(windows)'.dependencies] windows` に `Win32_UI_Shell` / `Win32_Graphics_Gdi` /
  `Win32_System_Com` を追加。理由をコメントで明記（docs/security.md §10 準拠）。
- `Cargo.lock` 更新。

### (2) icon.rs 共通化（macOS 挙動不変の小リファクタ）

- `MAX_ICON_PX` と `encode_png_base64` を `mod macos` から **`icon.rs` 直下へ移動**し、`macos` / 新設
  `windows` の両モジュールから使えるようにする。macOS 側は呼び出しパスの変更のみ（出力は完全に不変）。
- `extract_app_icon` の非 macOS 分岐を OS で分ける:
  - `#[cfg(windows)]` → `Ok(windows::extract(&validated))`
  - `#[cfg(all(not(target_os = "macos"), not(windows)))]` → 従来どおり `Ok(None)`

### (3) Windows 抽出ロジック（新設 `#[cfg(windows)] mod windows`）

**方針**: OS（シェル）が表示する実アイコンを取得する。macOS の `NSWorkspace.iconForFile:` に対応する
Windows の正攻法を採る。読み取り専用・外部通信なし。

- **主経路: `IShellItemImageFactory::GetImage`**
  1. `CoInitializeEx`（本関数スコープ内で初期化。Tauri ワーカースレッドで呼ばれるため、関数の最後に
     必ず `CoUninitialize` する）。
  2. `SHCreateItemFromParsingName(path)` → `IShellItemImageFactory`。
  3. `GetImage(SIZE { cx: 128, cy: 128 }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)` → `HBITMAP`
     （32bpp premultiplied BGRA。要求サイズ ≤128px は `MAX_ICON_PX` と整合）。
  4. `GetObjectW`(BITMAP) で幅/高さ取得 → `GetDIBits`（`BITMAPINFOHEADER` に `biHeight` 負で top-down、
     32bpp）でピクセル列を取得 → **BGRA → RGBA** に並べ替え（premultiplied は許容: 表示用途で実害小）。
  5. `image::RgbaImage::from_raw` → 共有 `encode_png_base64`（≤128px・PNG・base64）。
- **フォールバック: `SHGetFileInfoW`（`SHGFI_ICON | SHGFI_LARGEICON`）→ `HICON`**
  - `GetIconInfo` → カラー `HBITMAP` → 上記 (4)(5) と同じ DIB 変換で PNG 化。
  - 主経路が使えない/失敗した場合の保険（`.ico` 直接指定や一部環境）。
- **すべて失敗したら `None`**（`extract_app_icon` が `Ok(None)` → 文字フォールバック）。
- **リソース解放を厳守**: `HICON` は `DestroyIcon`、`HBITMAP`/DC は `DeleteObject`/`DeleteDC`、COM は
  `CoUninitialize`。取得失敗の各経路でもリークしないよう early-return 前に確実に解放する
  （unsafe FFI は最小スコープに閉じ、`?`/明示解放で分岐）。

### (4) 検証

**本タスク（macOS 上）で行う＝完了条件に含む:**

- **macOS 側の非退行**: mac で `cargo check` が通り、`.app` 抽出が従来どおり動くこと。
  今回の変更のうち mac に影響するのは (a) `encode_png_base64` / `MAX_ICON_PX` の親モジュールへの引き上げ、
  (b) `image` / `base64` の共通 `[dependencies]` への再配置、の 2 点。ここを重点確認する。
- `pnpm typecheck` / `pnpm lint`（frontend 変更は無い想定だが再確認）。
- Windows 分岐（`#[cfg(windows)] mod windows`）が、参照している `windows` クレートの API/feature 名・
  `image`/`base64` の共有経路と**整合するよう机上レビュー**する（実コンパイルは mac では走らないため）。

**098（Windows Build）へ持ち越す＝本タスクの完了条件に含めない:**

- Windows ARM64(VM) での `cargo check` / `cargo clippy`（`#[cfg(windows)] mod windows` の初コンパイル）。
- `pnpm tauri dev` で `.exe`（例: メモ帳 / OBS / Chrome 等）を登録し、実アイコンがプレビュー・一覧・
  サイドバー・プリセット追加に表示されることの確認。抽出不可（アイコン無し `.exe` 等）は文字フォールバック。
- ハンドル/COM リークの実挙動確認。

## このタスクでやらないこと

- frontend / DB スキーマ / `extract_app_icon` の I/F・出力仕様の変更（018 の配線をそのまま使う）。
- macOS 抽出ロジックの挙動変更（`encode_png_base64` の**移動のみ**でロジックは不変）。
- Linux のアイコン抽出（従来どおり `Ok(None)`）。
- `.lnk`（ショートカット）実体解決 / `.bat` 対応 / アイコンの手動アップロード・差し替え・加工。
- 一覧表示時の都度再抽出（選択時に一度だけ・018 と同じ）。
- 高解像度化のための追加依存（`SHGetImageList`/`SHIL_JUMBO` の別 API 追加等は、まず 128px で十分か実機で
  判断。必要になったら別途）。

## セキュリティ制約（docs/security.md §3/§4/§7/§9/§10 準拠）

- **読み取り専用**。`GetImage`/`SHGetFileInfoW` はアイコン描画取得のみで、書き込み・削除・外部通信を行わない。
- 抽出対象は `validate_icon_path` を通過した**ユーザー選択済みパスのみ**（汎用ファイル読取にしない）。
- 出力は **≤128px** に制限（DB 肥大化防止）。エラー詳細（フルパス/OS エラー）は返さず **`Ok(None)` に丸める**。
- **ハンドル/COM リークを起こさない**（`DestroyIcon`/`DeleteObject`/`CoUninitialize` を全経路で確実に）。
  unsafe FFI は最小スコープに限定する。
- 追加依存は `windows` クレートの **feature 追加のみ**（新規クレートは増やさない）。`image`/`base64` は
  既存クレートの**ターゲット再配置**であり新規追加ではない。
- **security-review 必須**（新規 OS API 呼び出し・`windows` feature 追加・unsafe FFI が対象）。実施して結果を docs に反映。

## 完了条件（本タスク＝macOS 上で達成できるもの）

- Windows 抽出ロジック（`#[cfg(windows)] mod windows`）と Cargo.toml の依存再配置・feature 追加を**実装済み**。
- **macOS は非退行**（mac で `cargo check` 成功・`.app` 抽出が従来どおり）。
- `pnpm typecheck` / `pnpm lint` が通る（frontend 変更が無くても再確認）。
- Windows コードは**未検証であることを明示**して main に入れる（`cargo check` 未走・実機未確認である旨を
  progress.md に記録）。
- security-review を実施し、結果を docs に反映（新規 OS API・`windows` feature 追加・unsafe FFI が対象。
  実挙動は未検証のため、コードレビュー観点＝読み取り専用/解放漏れ/丸めを中心に）。
- docs/progress.md に実装内容・**未検証範囲**・098 へ持ち越す検証項目を追記。

## 098 で確認する完了条件（本タスクでは未達で可）

- Windows ARM64(VM) で `cargo check` / `cargo clippy` が通る（`mod windows` 初コンパイル成功）。
- Windows で `.exe` 登録時に実アイコンがプレビュー / 一覧 / サイドバー / プリセット追加に表示される。
- アイコンを持たない/取得失敗の実行ファイルは**文字ラベルにフォールバック**し、クラッシュしない。
- 再起動後もアイコンが保持される（`icon_png` 永続化は 018 のまま）。
- ハンドル/COM リークがない（解放を全経路で確認）。

## 確認コマンド

```sh
# --- 本タスク: macOS（非退行確認）---
cd apps/desktop/src-tauri && cargo check   # 共通化リファクタ・依存再配置で mac 経路が壊れていないこと
cd ../../.. && pnpm typecheck && pnpm lint
# ※ Windows 分岐は macOS では cargo check の対象外（コンパイルされない）
```

```powershell
# --- 098 へ持ち越し: Windows ARM64 VM 上 ---
cd apps/desktop/src-tauri
cargo check      # #[cfg(windows)] mod windows の初コンパイル
cargo clippy
cd ../../..
pnpm tauri dev   # .exe を登録して実アイコン表示を確認
```
