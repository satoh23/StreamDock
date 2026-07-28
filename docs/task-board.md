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
- 042 配信連携 UX 刷新（親設計 [docs/tasks/042-stream-link-ux.md](tasks/042-stream-link-ux.md)／接続操作をコメビュ本体のプラットフォーム別カードへ移設＋文言「接続」→「連携」・033b の接続 UI 集約を部分反転・main no-internet／窓内 WS 1 本は不変）
  - 実装順: 042a → 042b
  - 042a 「接続」→「連携」文言統一（OAuth リンク操作のみ・取得セッション状態表示「接続中/接続済み」は別概念で不変・**軽レビュー**）
  - 042b 接続状態インジケータ→プラットフォーム別 展開カード（連携/配信接続/切断・設定ビューの接続カードを本体へ移設し撤去・**軽 security-review**）
- 043 お金がかかるコメントの強調＋取得精緻化（親設計 [docs/tasks/043-monetary-emphasis.md](tasks/043-monetary-emphasis.md)／投げ銭（スパチャ/ビッツ/サブスク/メンシプ/ギフト）を配信者に見逃させない・**037/037b を supersede**）
  - 実装順（提案）: 043b → 043a → 043c（網羅重視なら 043a 先行も可）
  - 043a 取得精緻化（sidecar/wire/Rust＝membership を実発行・ギフトを subscription と区別・**2026-07-26 拡張で網羅化**＝チャリティ `donation` 新種別・
    有料化(`*_paid_upgrade`)・共有チャット(`shared_chat_*`)・Twitch Bits Power-ups(`channel.bits.use`＝`bits:read` 追加・再ログイン要)・**security-review 済**）
  - 043b コメビュ本体の投げ銭強調＋種別ラベル（chat 以外の全イベントを枠色＋ラベル＋金額・**軽レビュー**）
  - 043c オーバーレイ投げ銭強調（現行意匠単独・037a 非依存・**037b を supersede**・**軽レビュー**）→ **2026-07-26 実装済み**
    （本人指示で **YouTube スパチャ風カード**に具体化＝色付きヘッダ帯＋淡色ボディ／スパチャは金額ティア段階配色・他課金種別は種別単色／金額バッジ／窓透過維持・036a data URI ガード維持／**軽 security-review 通過**）
  - 043d YouTube ギフトメンシプ／Jewels の取得（[docs/tasks/043d-youtube-jewels-gift-membership.md](tasks/043d-youtube-jewels-gift-membership.md)／
    受信面拡張＝**security-review 必須**）→ **2026-07-27 実装済み・security-review 通過**（これで 043 系のうち YouTube 網羅が完了）
    - **2026-07-27 保留解除→実装**: 旧保留の前提「gRPC proto のフィールド番号が非公開」は**誤り**で、Google が `stream_list.proto` の全文（enum 整数値・フィールド番号込み）を公式ガイド `https://developers.google.com/youtube/v3/live/streaming-live-chat` にインライン掲載していた（旧調査は REST リファレンスのみを見ていた）。**採用した番号はすべて公式出典＝推測ゼロ**（`MEMBERSHIP_GIFTING_EVENT=18`／`GIFT_EVENT=21`／`membership_gifting_details=31`／`gift_details=34`／`gift_memberships_count=1`／`jewels_amount=3`）。実配信キャプチャ・協力配信者の確保は**不要化**。
    - **受領側（`GIFT_MEMBERSHIP_RECEIVED_EVENT`）は取り込まない**（決定1）＝1 購入 N 件発火の二重計上ゼロ。詳細メッセージ（=32）を proto に宣言しないので受贈者情報は**そもそもデコードされない**（§9）。新規宛先/OAuth スコープ/依存ゼロ・wire/Rust/binding/集計 SQL 変更ゼロ。
    - **あわせて既存バグ 2 件を修正**: `member_month` を公式の `2` へ（旧 1 は `member_level_name`＝string で、マイルストーンのデコードが壊れ `invalid wire type` を throw し得た）／`amount_micros` を `uint64` へ（旧 string はワイヤ型不一致）。`profile_image_url = 104`（036b の「未確定」）も公式一致と確定し注記を解消。
    - **テスト**: `apps/comment-sidecar/scripts/test-youtube-mapper.mjs`（**51 件 PASS**・**公式 proto でシリアライズ→自 proto でデコード**の往復＋番号アサート＋§9 アサート＋未宣言フィールドのスキップ検証／ミューテーションでレッドになることを確認済み）＋ alias ローダ `scripts/dist-alias-loader.mjs`。sidecar に `test` スクリプトを追加（host-guard/obs/youtube-mapper を一括実行）。旧キャプチャ足場の stash / ブランチ `043d-grpc-capture-spike` は**不要化したが残置**。
    - **2026-07-27 独立レビュー反映済み**: 一次情報を再取得しての全項目照合で**番号の不一致ゼロ**を確認。`mapJewelsAmount` の 0 扱いを対称化（「0 JEWELS」誤表示の解消）ほかを反映（詳細は progress.md の apply-review 節）。
      ⚠ **既知の未解決課題 → 043e として起票済み（2026-07-27）**: `GIFT_EVENT` は**同一 id が combo 更新で再送される**（公式 proto の `LiveChatMessage.id` に明記）ため、`combo_count` 未採用＋Rust の `INSERT OR IGNORE` と相まって**連続ギフトの Jewels の金額が最初の 1 回ぶんのまま**になる。合計の意味論が公式に無く実データ検証もできないため 043d では記録のみとした。
  - 043e YouTube Jewels の combo 更新に対応（同一 id 再送の取り込み・[docs/tasks/043e-youtube-jewels-combo-fidelity.md](tasks/043e-youtube-jewels-combo-fidelity.md)／
    **受信面拡張（`combo_count`）＋`viewer_comments` の既存行 UPDATE を jewels 限定で解禁＝security-review 必須**）
    → **2026-07-27 フェーズ1 実装済み・独立レビュー（セキュリティ＋品質）指摘反映済み**（自己 security-review「問題なし」／独立レビュー「軽微な懸念あり」＝実装本体の脆弱性ゼロ・主指摘は二重ロック各層の単独テスト欠落。apply-review で反映済み）
    - **2 フェーズ構成**: フェーズ1（本体・実データ不要）＝ combo 更新を frontend `mergeComments` の新設 `updated` バケット経由で Rust まで到達させ、`event_type='jewels'` 限定で `amount` を差し替える。換算は**最新値をそのまま採る（乗算しない）**＝累計読みなら完全に正しく、単価読みでも**今日より悪くならない**安全側。フェーズ2（実データ入手後）＝ `jewels_amount` が単価と判明したら `× max(combo_count, 1)` を 1 行足して再レビュー。
    - **影響範囲は限定的**（過大に見積もらないこと）: JEWELS を合計するロールアップ列は**現時点で存在しない**（`bits_amount` は `currency='BITS'`・`superchat_amount` は `event_type='superchat'` 条件）。実害はコメント行の金額バッジ表示と `viewer_comments.amount` の値の 2 点で、視聴者一覧の集計は壊れていない。
    - TTS の再読み上げなし・表示行は 1 行のまま金額のみ更新・`jewels` 以外の冪等契約は不変、を完了条件に含める。
    - **実装の要点**: `mergeComments` の戻り値を `{ next, added, updated }` へ拡張し `updated` は **jewels 限定**（他種別の同一 id は従来どおり完全スキップ＝3 層すべてで挙動不変）。変化判定は **Rust が UPDATE する 4 列＋`comboCount`**（比較キー ⊇ 更新列）。Rust は引数の `viewer_id` を信用せず**保存済み行から所有者を読んで**再計算する。`combo_count` は本体コメント行の「×N」として表示（オーバーレイには出さない）＝フェーズ2 の観測手段。
    - **テスト**: sidecar `test-youtube-mapper.mjs` **51 → 65 アサート**／`mergeComments.test.ts` **新規 11 件**（従来テスト無し）／`CommentList.test.tsx` +3／Rust `repository.rs` +5。3 種のミューテーションでレッドになることを確認済み。dev-mock に combo 合成発行（`seq%20===12`）を追加し実測（詳細は progress.md）。
    - ⚠ **フェーズ2 は未了・実データ待ち**: `jewels_amount` が単価か累計かは**今も未確定**（実データ入手不可のまま）。combo が発火する配信を観測できたら再開する。
- 045 OBSオーバーレイ 分かりやすさ改善（命名見直し＋表示トグル移設・親設計 [docs/tasks/045-obs-overlay-clarity.md](tasks/045-obs-overlay-clarity.md)／「OBSオーバーレイ」→「コメントをOBSに表示」＋表示トグルを本体へ・自動反映(044a)は設定に残置・**034d を部分反転**・frontend のみ）
  - 実装順: 045a → 045b
  - 045a 「OBSオーバーレイ」等の可視文言を「コメントをOBSに表示」系へ統一（OBS 実窓名リテラルは据え置き＝044a の窓名一致を壊さない・**軽レビュー**）
    → **2026-07-28 実装済み＋レビュー対応済み**（`SettingsView.tsx` の可視文言 7 箇所・自動追加トグルも「OBSに自動で反映する」へ／実窓名 `StreamDock コメントオーバーレイ` は据え置き＝Rust/sidecar/UI の 3 者一致を実測で確認済み・**回帰テスト追加**／`SettingsView.obs.test.tsx` のアサート追従／セキュリティ判定＝問題なし／typecheck・lint・test(140) pass・実機確認は本人環境）
    - レビュー対応で **045b・親 045 のタスクファイルの行番号と旧 label 参照を現物へ更新**（045a でカード内の行番号が +2 ずれたため。045b 着手前に必読）
  - 045b 表示/非表示トグルを本体ツールバーへ移設（`handleOverlayToggle`/`handleObsAutoAddToggle` の連動維持・自動反映は設定に残す・**軽レビュー**）
    → **2026-07-28 実装済み＋レビュー対応済み**（表示トグルを `toolbarActions` の先頭＝VOICEVOX 読み上げの左へ移設／設定カードには自動反映(044a)以下と**移設先への導線注記 1 行**を残置／`handleOverlayToggle`・`handleObsAutoAddToggle`・マウント同期は **diff ゼロ**＝移設は UI 位置のみ・新規 state/ハンドラ/command/capability/依存なし・`csp: null` 不変・CSS 無変更／`SettingsView.obs.test.tsx` の `baseProps` 追従＋**`CommentViewerApp.toolbar.test.tsx` 新規**（初のコンポーネントテストハーネス・6 ケース・3 種のミューテーションでレッド確認）／セキュリティ判定＝軽微な懸念あり・修正必須 0 件／typecheck・lint・test(**146**) pass・実機確認は本人環境）
    - レビュー対応で **偽 `CommentStreamHandle` を `satisfies` で実型に固定**／**モックの export 面を実モジュールへ揃えた**（未モック export が `undefined` に化けて静かに壊れるのを防ぐ）／045a が残した**表記ゆれ「OBS に接続しています…」を解消**（トリガー発火と判断）／接続状態がツールバーに出ない件・カード見出しのずれは**再修正トリガーをコメント化**
  - 045c 実機 E2E 回帰修正（自動反映は表示に従う／ツールバーに OBS 連携ステータス／自動反映トグルの文言）
    → **2026-07-28 実装済み**（① `handleObsAutoAddToggle` から**オーバーレイを開く経路を削除**＝自動反映 ON は設定を立てるだけ・反映は表示 ON が契機［044a の設計が 045b の移設で隠れた副作用に変質していた回帰］／② `toolbarActions` 先頭に `obsAutoAdd` ON 時だけ **`OBSに接続できませんでした`（`.toolbarError`・`title` に全文）** を表示・表示 OFF で `obsState` を idle へ戻す［045b レビューでコメント化した再修正トリガーが E2E で発火］・**進行表示（`OBSに接続中…`）は一度入れたが実機で「一瞬で消えてチラつく」ため撤回**＝失敗のみ伝える（再修正するなら遅延表示）／③ 自動反映トグルを **`「コメントをOBSに表示」ON時、OBSに自動で反映する`** へ改名＋注記を短縮／`.toolbarActions` に `flex-wrap: wrap` + `justify-content: flex-end`［045b の再検討トリガーがステータス追加で先に成立・最小幅 560px での横溢れ回避］／Rust・sidecar・capabilities・`csp: null`・依存は無変更・宛先追加なし［むしろ操作なしに窓が開く経路が 1 本減る］／**新規 4 ケース・ミューテーション 10 種で確認**（猶予の長さには非依存）／typecheck・lint・test(**150**) pass・実機での再 E2E は本人環境）
    - レビュー対応で **猶予タイマーの取り消しを追加**（猶予中に表示 OFF / 自動反映 OFF にしても発火が止まらず `hideObs`/`disableObs` の後に `enableObs` が飛んでいた既存回帰＝044a 由来・回帰テスト 2 本追加で test(**152**)）／`role="status"` の効き方・`obsState` を union にしない理由・ゲート条件の非対称・CSS の効き方・テスト③の vacuous 回避は**コメント化**
  → **親 045 は 045a・045b・045c とも完了**（要望①命名見直し・要望②表示トグル移設＋実機 E2E で出た回帰の修正まで入った）
- 046 固定コメント（ピン留め）＋専用オーバーレイ（親設計 [docs/tasks/046-pinned-comment-overlay.md](tasks/046-pinned-comment-overlay.md)／右クリックでコメントを上部固定＋**既存 comment-overlay とは独立した専用オーバーレイ窓**で OBS 固定表示・窓間伝達は localStorage＋storage イベントで完結＝新規 WS/emit/外部通信なし）
  - 実装順: 046a → 046b
  - 046a 本体のコメント固定（右クリック→上部固定＋ピンストア localStorage・046b が読む書式・**軽レビュー**）
  - 046b 固定専用オーバーレイ窓（新 label `pinned-overlay`・Rust 窓コマンド3つ＋新 capability＋App.tsx label 分岐＋PinnedOverlayApp＋開閉トグル・表示専用/WS なし・**security-review 必須**）
- 047 課金チャット 横スクロールティッカー＋クリック展開（単体 [docs/tasks/047-superchat-ticker.md](tasks/047-superchat-ticker.md)／課金チャットを YouTube 風に上部へ横スクロール小表示＋クリックで重ねダイアログ・本体 UI のみ・`isMonetaryEvent`/`superchatTier` 等を流用・043b/043c と共存・**軽レビュー**）
- 048 ずんだもん読み上げ 文字数上限（単体 [docs/tasks/048-tts-reading-length-cap.md](tasks/048-tts-reading-length-cap.md)／長文コメントは「以下略」で打ち切り・省略は常時有効・文字数は設定で可変（既定60）・`ttsQueue` の合成前チョークポイントで読み上げテキストのみ切詰・表示は全文のまま・**軽レビュー**）
  → ⚠ **2026-07-28 の読み上げ不具合調査で最優先と確定**。「長文の後のコメントが読まれない」の直接原因は `MAX_BACKLOG=20` の**古い未読の無言破棄**で、290 字の長文 1 件（読み上げ 48〜64 秒）の間に 27〜38 件届き **7〜18 件が捨てられる**。本タスクの文字数上限だけで長文起因の取りこぼしはほぼ解消する（60 字なら破棄 0 件）。**048 → 050 → 049 の順で実装すること**（048/049/050 は同じ `enqueue` を触る）
- 049 課金イベントの読み上げ（単体 [docs/tasks/049-monetary-event-speech.md](tasks/049-monetary-event-speech.md)／メンシプ継続・メンシプギフト/サブギフト・サブスク・ジュエルが**まったく読み上げられない**＝`ttsQueue` が `comment.text` しか見ず、表示文言は `composeEventMessage` が別途組み立てているため。読み上げ用テキストを getter 注入で差し替える・**課金イベントだけ投稿者名を読む**（通常チャット/スパチャは従来どおり名前を読まない）・jewels の文言は**読み上げ専用で新設**し表示は不変・**軽レビュー**）
  - ⚠ jewels は **dev-mock でだけ読まれる**（`text = "投げ銭ジュエル 🎁"` が入るため）。実データの `GIFT_EVENT` は本文が空で**本番のみ無音**＝dev 確認では気付けない
- 050 読み上げ取りこぼしの可視化と保護（単体 [docs/tasks/050-tts-dropout-protection.md](tasks/050-tts-dropout-protection.md)／**黙って諦める経路が 3 つ**〔①backlog 超過の古い未読破棄 ②`synthesize` のタイムアウト無しによる詰まり ③AudioContext suspended 時の 1 件スキップ〕あり、いずれも `console.debug` か無言でユーザーに見えない。件数と理由だけを画面に出す（本文・投稿者名は出さない＝§9）＋合成タイムアウトで詰まりを塞ぐ・**048 実装後に実測してから着手**・**軽レビュー**）
  - 経路③（AudioContext suspended）は**実機での発生が未確認**。可視化を先に入れて発生の有無を確定させてから挙動変更を判断する（現行の「1 件スキップ」は永久ハング回避のため意図的な設計＝ハングを再発させない形でしか変えない）

## 保留

> 優先度が高くないため一旦保留（着手時は該当ブロックを ## Next へ戻す）。

- 037 OBSオーバーレイ 意匠の拡張（親設計 [docs/tasks/037-overlay-design-expansion.md](tasks/037-overlay-design-expansion.md)／意匠選択機構を新設し複数意匠から選べるように＋新デザイン2種・表示専用/外部通信なし・下記 Todo「複数デザイン＋選択 UI」の実体化）
  - 実装順: 037a → 037b
  - 037a 意匠選択機構＋シンプル意匠（ユーザー名＋コメントのみ・背景透過・白い細字・**軽レビュー**）
  - 037b 投げ銭メッセージ（スパチャ/サブスク/ビッツ）強調意匠（`event_type` 分岐・全意匠に相乗り・**軽レビュー**）→ **[043c](tasks/043c-overlay-monetary-highlight.md) に supersede**（現行意匠単独で実体化・037a 非依存。オーバーレイ投げ銭強調は 043c を正とする）＝**043c は 2026-07-26 実装済み（YT スパチャ風カード）**
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
- 044 OBSオーバーレイ 自動ソース追加（obs-websocket・親設計 [docs/tasks/044-obs-auto-source.md](tasks/044-obs-auto-source.md)／オーバーレイ ON で OBS にソースを自動追加＝ワンクリック表示・**033/033f の「obs-websocket 不使用」決定を反転**・新規 loopback 通信(4455)/依存/方針反転のため**スパイク先行**・スパイク後に Next へ昇格）
  - 実装順: 044s（スパイク・方式決定）→ 044a（実装）
  - 044s obs-websocket 技術検証（疎通/認証/graceful 失敗/ソース自動作成・方式 A ウィンドウキャプチャ vs B ブラウザソース+ローカル HTTP を実測決定・**検証のみ／本実装しない**）
  - 044a 自動ソース追加 実装（決定方式・obs-websocket は sidecar 側・loopback 4455 限定・明示同意時のみ・fail 時は手動手順フォールバック・**security-review 必須**）

## Todo

- OBSオーバーレイ 複数デザイン＋選択 UI は **037（現在保留）で着手予定**（意匠選択機構＋シンプル意匠＋投げ銭強調）。**画像/GIF プレビューで意匠を選ぶ**版はさらに次段（未タスク化）。

## MVP リリース前最後

- 098 Windows Build
- 099 User Test Package（フェーズ1＝未署名 CI ビルド）
  - 099a Windows コード署名（Azure Trusted Signing・フェーズ2／署名タスク [docs/tasks/099a-windows-code-signing.md](tasks/099a-windows-code-signing.md)・証明書取得後に着手・軽レビュー）
