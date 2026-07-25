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
- 034 コメントビューア/OBSオーバーレイ UX 改善（第2弾・親設計 [docs/tasks/034-comment-viewer-obs-ux-round2.md](tasks/034-comment-viewer-obs-ux-round2.md)／最新コメント追従・VOICEVOX 試聴・オーバーレイ状態表示/設定移設/意匠刷新）
  - 034a〜034e 実装済み（最新コメント自動追従＋ジャンプボタン／オーバーレイ常時追従／VOICEVOX 試聴／表示 ON/OFF 設定移設／意匠刷新＝透過・本文＋名前・サイト名トグル）
- 035 YouTube+Twitch コメント同時取得・マージ表示（親設計 [docs/tasks/035-simultaneous-youtube-twitch-comments.md](tasks/035-simultaneous-youtube-twitch-comments.md)／sidecar の単一セッション排他を provider 別化・「同時取得しない」方針を反転）
  - 035a〜035c 実装済み（provider 別 `Map<Provider, AbortController>`／viewer・overlay の mixed 表示／TTS ソース別読み上げフィルタ）
- 036 OBSオーバーレイ 実ユーザーアイコン表示（親設計 [docs/tasks/036-overlay-user-avatar.md](tasks/036-overlay-user-avatar.md)／sidecar が YouTube/Twitch のアイコンを取得→data URI 化して WS で送る・webview はオフライン維持/CSP 不変）
  - 036a〜036c 実装済み（2026-07-21）: 036a ワイヤ契約拡張＋overlay 描画／036b sidecar 取得基盤＋YouTube／036c Twitch（Helix `users` で URL 解決・128KB 上限対策で 70x70 縮小）
- 041a コメビュ読み上げ 読み替えエンジン＋内蔵一般辞書（`readingDictionary.ts`／`ttsQueue` に getter 注入・frontend 純テキスト置換・security-review 済・2026-07-24／実機確認のみ残）

## Next

- 038 視聴者メモリ（親設計 [docs/tasks/038-viewer-memory.md](tasks/038-viewer-memory.md)／一度コメントした視聴者を端末内 SQLite に記憶・初見/久しぶり判定の土台・§9「保存しない」を限定解禁）
  - 実装順: 038a → 038b → 038c
  - 038a Rust データ基盤（`viewer_memory` モジュール＋テーブル＋`record_comment` 集計＋一覧/詳細/メモ/削除コマンド＋security.md 更新・**security-review 必須**・§9 保存ポリシー変更）
  - 038b 視聴者一覧・詳細 UI＋配信者メモ編集（総数/サイト/bits/スパチャ回数・額/サブスク期間/過去コメント・**軽レビュー**）
  - 038c 初見/久しぶりバッジ＋枠色（初見＝初コメント／久しぶり＝最終コメントから1ヶ月以上経過後の初コメント・**軽レビュー**）

## 保留

> 優先度が高くないため一旦保留（着手時は該当ブロックを ## Next へ戻す）。

- 037 OBSオーバーレイ 意匠の拡張（親設計 [docs/tasks/037-overlay-design-expansion.md](tasks/037-overlay-design-expansion.md)／意匠選択機構を新設し複数意匠から選べるように＋新デザイン2種・表示専用/外部通信なし・下記 Todo「複数デザイン＋選択 UI」の実体化）
  - 実装順: 037a → 037b
  - 037a 意匠選択機構＋シンプル意匠（ユーザー名＋コメントのみ・背景透過・白い細字・**軽レビュー**）
  - 037b 投げ銭メッセージ（スパチャ/サブスク/ビッツ）強調意匠（`event_type` 分岐・全意匠に相乗り・**軽レビュー**）
- 039 フォントインポート（親設計 [docs/tasks/039-font-import.md](tasks/039-font-import.md)／ユーザーのフォントファイルを app data dir にコピー保存＋data URI で `@font-face` 供給・外部フォント非追加/CSP 不変）
  - 実装順: 039a → 039b
  - 039a Rust 取込基盤（管理ディレクトリへコピー＋検証＋`fonts` レジストリ＋import/list/delete/get_font_data コマンド＋security.md 更新・**security-review 必須**・新規ファイル書き込み経路/dialog capability 追加）
  - 039b `@font-face` 動的注入（data URI）＋フォント選択 UI 拡張（OS 標準＋インポート済み合流）＋プレビュー/適用（**軽レビュー**）
- 040 ROM勢一覧（親設計 [docs/tasks/040-lurker-list.md](tasks/040-lurker-list.md)／**Twitch 限定・近似・自/モデレータ channel 限定**・YouTube は視聴者一覧 API 無しで対象外・親でスパイク先行）
  - 実装順: 040(スパイク) → 040a → 040b
  - 040a sidecar chatters 取得（`moderator:read:chatters` スコープ追加＋Helix `Get Chatters` ポーリング＋loopback 配信・**security-review 必須**・新規スコープ）
  - 040b ROM勢一覧 UI（chatters −〔セッション＋038 視聴者メモリのコメント済み〕突合＋表示・近似/前提の注記・**軽レビュー**）
- 041 コメビュ読み上げ 読み替え辞書（親設計 [docs/tasks/041-comment-viewer-reading-dictionary.md](tasks/041-comment-viewer-reading-dictionary.md)／VOICEVOX へ渡す前に自前テキスト置換で読み替え・**localStorage 保存/自前テキスト置換**・優先順位 ユーザー辞書>内蔵一般辞書>VOICEVOX 既定・VOICEVOX 解析/再実装や user_dict API は使わず将来オプション・外部通信なし／**041a は完了済み＝Done・残りは 041b のみ**）
  - 041b ユーザー辞書 CRUD（localStorage）＋内蔵とのマージ（最優先上書き）＋設定 UI 行エディタ（**軽レビュー**）

## Todo

- OBSオーバーレイ 複数デザイン＋選択 UI は **037（現在保留）で着手予定**（意匠選択機構＋シンプル意匠＋投げ銭強調）。**画像/GIF プレビューで意匠を選ぶ**版はさらに次段（未タスク化）。

## MVP リリース前最後

- 098 Windows Build
- 099 User Test Package（フェーズ1＝未署名 CI ビルド）
  - 099a Windows コード署名（Azure Trusted Signing・フェーズ2／署名タスク [docs/tasks/099a-windows-code-signing.md](tasks/099a-windows-code-signing.md)・証明書取得後に着手・軽レビュー）
