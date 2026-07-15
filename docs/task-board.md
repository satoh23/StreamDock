# Task Board

## Done

- 001 Project Setup
- 002 Monorepo Structure
- 003 App Shell
- 004 Tool Registry
- 005 Preset CRUD
- 006 Preset Item Ordering
- 007 Process Launch
- 008 Bulk Launch
- 009 Process Stop
- 010 Runtime Status
- 011 Error Handling / Logs
- 012 Rust Common Helper Refactor
- 013 macOS App Bundle Stop
- 014 Bulk Stop for Individual Launches
- 015 Design Tokens & Color Unification
- 016 Light/Dark Theme + Settings
- 017 Tool Path Input Lock
- 018 Tool Icon Auto-Extraction
- 019 Preset Auto-Launch on Boot
- 020 App Header (Docker-like)
- 021 UI Design Modernization
- 022 Tool/Preset Form Polish
- 023 Browser URL Tool Support
- 024 Tool → Preset Registration
- 025 Form/UI Polish Round 2
- 026 Header Polish & Navigation Foundation
- 027 First-Run Tutorial (Onboarding)
- 028 Windows App Icon Auto-Extraction
- 029 StreamDock Naming Consistency
- 030 "登録" Wording Unification
- 031 Rakuraku Tool Settings Rename
- 032 Rakuraku Auto-Setup Design — 設計確定（Bouyomi×VOICEVOX 方式は 032c で supersede／らくらく画面枠組みは継続）
- 032a らくらくツール設定 画面枠組み（実装済）

## Next

## Todo

- 032c 内蔵コメントビューア × VOICEVOX 直接読み上げ 設計・方針転換（032b を supersede・実装は 032c-a〜d へ分割）
  - 実装順: 032c-a → 032c-c（モックで先行可）→ 032c-b → 032c-d → E2E 統合（設計は docs/tasks/032c-comment-viewer-voicevox-design.md／032b 撤去は 032c-a・撤去範囲は同設計「032b の撤去範囲」節）
- 032c-a コメビュ別ウィンドウ枠組み＋内蔵デフォルトツール＋032b 撤去（mac 検証可）
- 032c-b Node sidecar 基盤＋Twitch コメント取得＋インターネット通信 初解禁（mac 検証可・security-review）
- 032c-c VOICEVOX 直接合成＋TTS キュー（ずんだもん・Web Audio・loopback 例外拡張・mac 検証可）
- 032c-d YouTube コメント取得有効化（OAuth PKCE・Google Cloud 運用・Client Secret 同梱・security 追記）

## MVP リリース前最後

- 098 Windows Build
- 099 User Test Package
