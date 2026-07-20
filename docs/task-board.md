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
- 032c 内蔵コメントビューア × VOICEVOX 直接読み上げ 設計・方針転換（032b を supersede・実装は 032c-a〜d へ分割）
  - 実装順: 032c-a → 032c-c（モックで先行可）→ 032c-b → 032c-d → E2E 統合（設計は docs/tasks/032c-comment-viewer-voicevox-design.md／032b 撤去は 032c-a・撤去範囲は同設計「032b の撤去範囲」節）
- 032c-a コメビュ別ウィンドウ枠組み＋内蔵デフォルトツール＋032b 撤去（mac 検証可）
- 032c-b Node sidecar 基盤＋Twitch コメント取得＋インターネット通信 初解禁（mac 検証可・security-review）
- 032c-c VOICEVOX 直接合成＋TTS キュー（ずんだもん・Web Audio・loopback 例外拡張・mac 検証可）
- 032c-d YouTube コメント取得有効化（OAuth PKCE・Google Cloud 運用・Client Secret 同梱・security 追記）
  （**実装済**・ヘッドレス検証 pass／実機 OAuth・実ライブ E2E は要 Google「Desktop app」OAuth クライアント＋実配信）
  - 032c-d′/″/‴（セッション増分・**実装済**・再 security-review／code-review(high) 済＝問題なし・実機 GUI E2E は要実配信）:
    ′ YouTube ログインを OS キーチェーン永続化（§9 ポリシー変更・Twitch と同型）／″ 取得継続性修正（retryOnStreamEnd 分離・
    終了監視 videos.list 化）＋sidecar stderr 透過（観測性）／‴ クォータ削減（検出 liveBroadcasts.list=1u・監視 silence-gated 化）
- 033 コメントビューア UX 刷新（第1弾・親設計 [docs/tasks/033-comment-viewer-ux-revamp.md](tasks/033-comment-viewer-ux-revamp.md)／設定ビュー分離・VOICEVOX 制御・OBS オーバーレイ・ツール管理統一）
  - 直近コミットで 033a〜f 実装反映済み（本番でギリギリ運用可）。UX 追い込みは第2弾 034 へ継続
  - 033a コメビュ本体の軽量化・レイアウト整理（タイトル削除・総数右上・モック撤去・窓サイズ拡大）
  - 033b 設定ビュー新設＋接続UI移設＋接続状態インジケータ（円アイコン＋テキスト）
  - 033c VOICEVOX 読み上げ ON/OFF トグル＋クレジット条件表示＋自動起動/自動連携
  - 033d VOICEVOX 話者選択＋「ずんだもん読み上げ」→「VOICEVOX読み上げ」改名（loopback に `/speakers` 追加）
  - 033e ツール管理でコメビュを再生/停止・起動済み表示（他ツールと統一・窓/プロセス ライフサイクル）
  - 033f OBS 用透過オーバーレイ窓（ワンクリック・新規窓/透過/新規 capability）

## Next

- 034 コメントビューア/OBSオーバーレイ UX 改善（第2弾・親設計 [docs/tasks/034-comment-viewer-obs-ux-round2.md](tasks/034-comment-viewer-obs-ux-round2.md)／最新コメント追従・VOICEVOX 試聴・オーバーレイ状態表示/設定移設/意匠刷新）
  - 実装順: 034a → 034b、並行で 034c、034d → 034e
  - 034a コメビュ本体 最新コメント自動追従＋「最新コメント N件 ↓」ジャンプボタン（security-review 不要）
  - 034b OBSオーバーレイ 常時追従＋サイドバー(スクロールバー)抑止（security-review 不要）
  - 034c VOICEVOX 話者サンプルボイス試聴（選択で即再生・再生中は中断切替／既存 loopback 合成の再利用・security-review 不要）
  - 034d OBSオーバーレイ表示 ON/OFF を設定ビューへ移設＋開閉状態インジケータ（読み取りコマンド追加・**軽レビュー**）
  - 034e OBSオーバーレイ デザイン刷新（透過・本文＋アカウント名のみ・文字拡大・サイト名表示トグル／表示専用・**軽レビュー**）
- 035 YouTube+Twitch コメント同時取得・マージ表示（親設計 [docs/tasks/035-simultaneous-youtube-twitch-comments.md](tasks/035-simultaneous-youtube-twitch-comments.md)／sidecar の単一セッション排他を provider 別化・security.md「同時取得しない」方針を反転）
  - 実装順: 035a → 035b → 035c
  - 035a sidecar の取得セッション排他を provider 別化（`Map<Provider, AbortController>`）＋security.md 方針更新（**security-review 必須**・方針反転／新規宛先は増やさない）
  - 035b viewer/overlay の同時（mixed）表示 検証＋UI 微調整（両接続インジケータ・source バッジ常時表示・片方 stop の UX・表示のみ）
  - 035c TTS ソース別読み上げフィルタ＋YouTube クォータ保護・警告（両稼働時の読み上げ暴発/クォータ枯渇対策・軽レビュー）

## Todo

- （将来）OBSオーバーレイ 複数デザイン＋プレビュー選択 UI（画像/GIF で意匠を選べる／034e の単一デザイン刷新の次段）

## MVP リリース前最後

- 098 Windows Build
- 099 User Test Package（フェーズ1＝未署名 CI ビルド）
  - 099a Windows コード署名（Azure Trusted Signing・フェーズ2／署名タスク [docs/tasks/099a-windows-code-signing.md](tasks/099a-windows-code-signing.md)・証明書取得後に着手・軽レビュー）
