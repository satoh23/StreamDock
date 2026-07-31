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
    → **2026-07-28 実装済み**（新規 `pinnedComments.ts`〔キー `stream-dock.comment-viewer.pinned-comments`・JSON 配列・`PINNED_LIMIT=1`〕／`CommentContextMenu.tsx`〔項目 1 個の自作メニュー・`role="menu"`・Esc/外側 mousedown で閉／`preventDefault` はコメント行の `onContextMenu` だけ＝アプリ全体のネイティブメニューは潰さない〕／`PinnedCommentBar.tsx`〔0 件なら null・`max-height:22vh`・意匠と文言整形は `.item`/`.badge` と `viewerFormat` を流用〕／`CommentList` に optional な `onPin`〔トグル〕・`pinnedIds` を追加〔`badges` と同じ作法〕・overlay バリアントには効かせない／`CommentViewerApp` に `pinned` state＋保存 effect＋`handleTogglePin`/`handleUnpin`／**Rust・sidecar・capabilities・package.json は差分ゼロ**・`csp: null` 不変・新規宛先/依存なし・`console.log` なし・`recordComments` 等の DB 経路へ流さない〔§9〕／**新規 26 テスト**〔ストア 18＋メニュー 8〕・save/load 双方のクランプにミューテーションでレッド確認／typecheck・lint・test(**178**) pass・実機確認は本人環境）
    - **決定事項 2 点が親 046 の初期案から変更**: ①**上限 N＝1（単一ピン）**〔親の「例 3」から変更・YouTube/Twitch のコメント固定と同じ体験にする依頼者の決定。親 046 の該当節も更新済み〕 ②**`author.avatar` を保存しない**〔base64 data URI・容量と `storage` ペイロードと §9。**046b は WS へ繋がないため再取得できず、専用オーバーレイのアイコンは 036a のイニシャルフォールバックになる**〕
    - **046b 着手前に必読**: ピンストアの JSON スキーマ（046b が読む契約）は [docs/progress.md](progress.md) の 046a 節が正。破壊的なスキーマ変更は version 欄ではなく**キー名を変える**方針
    - **2026-07-28 security-review ＋ code-review 実施**（当初「軽」指定だったが追加実施）。判定「軽微な懸念あり」でコード側の修正必須ゼロ（通信/Rust/capabilities/依存は差分ゼロを実測）。対応済み: ①**[docs/security.md](security.md) §9 に追補（046a・固定コメントの端末内 localStorage 保存）を新設**＝第三者のコメント本文/表示名/金額の永続化は保存先が SQLite でなくても §9 の対象、「レビュー必須条件」も保存先を問わない旨に更新 ②`delete_viewer`/`clear_viewers` は固定コメントを消さない旨を明記（一括削除/エクスポート実装時の申し送り・連動削除は**別タスク**）③ミューテーション実測で素通りしていた `preventDefault`／`toPinned` 明示列挙をテストで固定 ④`PinnedCommentBar` の単体テスト新設（7 件）⑤メニューを閉じたときのフォーカス復帰（a11y）⑥`MENU_WIDTH` と CSS の幅を一致。test **16 files / 189 tests** pass
    - **教訓**: frontend のみ・通信ゼロでも、**保存するデータの種類が変わる変更は軽レビューに置かない**（親 046 が固定コメントを「非機密 UI データ」と誤ってラベリングしていたのが軽レビュー指定の起点だった）
  - 046b 固定専用オーバーレイ窓（新 label `pinned-overlay`・Rust 窓コマンド3つ＋新 capability＋App.tsx label 分岐＋PinnedOverlayApp＋開閉トグル・表示専用/WS なし・**security-review 必須**）
    → **2026-07-29 実装済み**（`lib.rs` に単一目的 3 コマンド〔`open`/`close`/`is_pinned_overlay_open`・**引数は AppHandle のみ**・`WINDOW_OPEN_LOCK` 再利用・`SHARED_BROWSER_ARGS` を全 4 窓一致・透過/装飾なし/最背面/非フォーカス/`background_throttling(Disabled)`・**window イベント非登録＝close で sidecar を落とさない**〕＋`invoke_handler` 登録／新規 `capabilities/pinned-overlay.json`〔`windows:["pinned-overlay"]`・`core:default`〕／新規 `PinnedOverlayApp.tsx`〔**WS 非接続**・`loadPinned()` の read-on-mount＋`storage` 購読・0 件は `null`・`CommentList variant="overlay"` を流用・**新規 CSS ゼロ**〕／`windowApi.ts` に 3 ラッパ／`overlaySettings.ts` に永続キー `...pinned-overlay-enabled`／`App.tsx` label 分岐／**既存 3 capability・`tauri.conf.json`〔`csp: null`〕・`vite.config.ts`・`package.json`・sidecar〔044a〕・`pinnedComments.ts`・`OverlayApp`/`CommentList`/CSS はすべて差分ゼロ**／typecheck・lint・test(**17 files / 220 tests**)・`cargo check` pass・実機確認は本人環境）
    - **窓タイトルは `StreamDock 固定コメント`**（044a が `includes("StreamDock コメントオーバーレイ")` で窓を探すため**部分一致で紛れない名前**が必須条件・テストで固定）。ジオメトリは `position(456,48)`/`inner_size(480,320)`/`min(280,160)`（幅は「640 は広すぎ→400 へ差し戻し・次は 480〜520」の教訓の下限・`decorations(false)` でサイズは永続化されず**既定値がすべて**）→ ⚠ **高さ 320 は見積り誤りで、046c で 560 へ修正**
    - **トグルは設定ビューの新カード**（既存 OBS カードの直後・既存カードは無改変）。**046b タスクファイルの「034d と同型」は 045b の部分反転で古い**ため、現在の線引き（表示＝ツールバー／セットアップ＝設定）に照らして再判断した。固定の出し入れは右クリックメニュー側の仕事で窓は開けっぱなし＝セットアップ側、かつ**この窓は 044a 自動追加の対象外**（手動キャプチャの手順注記と同じカードに置くのが自然・注記で非対称を明示）
    - **決定（親 046 の文言からの意図的な逸脱）**: トグルは **localStorage に永続**し、ON ならコメビュ本体のマウント時に**窓を自動で開く**。親 046 の「自動開閉にしない」の理由は「**ピン 0 件で自動 close すると OBS ソースが壊れる**」＝自動 close の禁止で、入れたのは明示設定に基づく自動 **open** のみ。**自動 close は作っていない**（設定 OFF で窓が開いていても閉じない・テストで固定）
    - **⚠ 実機で判定する唯一の未検証点**: 別 webview 間で `storage` が跨って届くか（034e review M1 と同じ）。046b は**即時反映が完了条件**なので 034e より重い。届かない場合の代替＝**localStorage ポーリング**（制約内・`reloadPinned()` に再読込を閉じてあるので数行）。`BroadcastChannel`（同じ未検証点に依存）と Tauri `emit`（親 046 の線引き改訂が要る）は却下。**採否は実機判定後**
    - **2026-07-29 security-review 実施**。判定「軽微な懸念あり」・修正必須 0 件。指摘は「永続 ON でマウント時に窓が自動オープン＝**操作なしに窓が開く経路が 1 本増える**」（045c が 1 本減らしたのと逆行）だが、①起点は明示的な永続設定（既定 OFF）②開く窓は表示専用で**新規通信・OBS 接続・sidecar 起動を伴わない**ため許容。[docs/security.md](security.md) の Capabilities 方針に **046b 節を新設**（新窓/新 capability/3 コマンド/no-orphan kill 不変/窓名の制約/新キーは UI 設定値＝§9 追補の対象外）、§9 追補（046a）に**読み手が増えた旨**と一括削除時の申し送りを追記
    - **落とし穴（次回も踏む）**: `CommentViewerApp.toolbar.test.tsx` の `vi.mock("windowApi")` は**モジュール丸ごと差し替え**なので、`windowApi.ts` に export を足したら必ずここにも足す（書き漏らすと undefined で**実装が正しくても全ケースがレッド**になる。今回実際に踏んだ）
    - **2026-07-29 外部レビュー（security + 品質）対応済み**。総合判定は自己判定どおり「軽微な懸念あり・修正必須 0 件」で追認（capability 追加 1 枚のみ／conf・vite・依存・sidecar・`pinnedComments.ts`・既存 overlay/CSS の差分ゼロを再現）。要修正 3 件＝①**S-1: 前回配信で固定したコメントが次の配信開始時に無操作で本番へ出る**（ピン永続＋トグル永続＋自動 open の帰結・**永続した第三者データが配信面へ自動描画されるのは 046b が初めて**）→ **依頼者の決定で挙動変更＝コメビュ窓のマウント時にピンストアを空へ倒す**（`pinned` state を `loadPinned()` 初期化から空配列へ。**`pinnedComments.ts` は無改変**＝「いつ空へ倒すか」だけ本体側で決定）。副作用＝**ピンは配信をまたいで残らない**（設定カードの注記で明示）②**Q2: ON→OFF 連打で「設定 OFF なのに窓が残る」**（async open と同期 close の解決順）→ `pinnedOverlayOpRef` で開閉要求を直列化＋回帰テスト ③**Q3: vacuous なアサート**を実装由来（注記ノードの textContent）へ変更。他 10 件は修正不要としてコメント化。test **17 files / 222 tests** pass・ミューテーション実測 3 件で対応ケースだけがレッドになることを確認
    - **落とし穴（S-1 の再発条件）**: クリアを担っているのは `useEffect(()=>savePinned(pinned),[pinned])` の**マウント時 1 発**。ここに「初回スキップ」「前回値と同じなら書かない」といったガードを足すと**前回のピンが localStorage に残り S-1 が再発する**（046a/046b のコードとタスクファイル双方にコメント済み）。なおこの担保は**未検証の `storage` 跨ぎ配送に依存しない**（再起動時はオーバーレイ窓がまだ無く、開くのは必ず書込の後＝read-on-mount が空を読む）
  - 046c 固定オーバーレイの長文見切れ修正（単体 [docs/tasks/046c-pinned-overlay-long-text-fit.md](tasks/046c-pinned-overlay-long-text-fit.md)／046b の E2E 追修正・**軽レビュー**）
    → **2026-07-29 実装済み**。E2E で 290 字の長文（dev-mock `LONG_CHAT_TEXT`）が「大好」＝約 57% で見切れた。**原因は CSS のクリップではなく窓の高さ不足**（`-webkit-line-clamp`/`max-height` はリポジトリ全体で 0 ヒット・本文は DOM に全部出ている）。`.root`(height:100%) と `ol.list`(flex:1+overflow-y:auto) が窓高に固定され、`li.item{flex-shrink:0}` で縮まず溢れ、`followMode="off"` で自動スクロールもせず、スクロールバーも overlay スコープで非表示＝**溢れが見えない**。実測見積りで 290 字は ≈554px 必要 vs 320px ＝ 約 57%（報告位置と一致）
    - **対応**: ①`lib.rs` の `inner_size(480,320)` → **`(480,560)`**（290 字が等倍で収まる高さ・JSDoc に見積り根拠と「下げるとフィットが常時発動する」警告）②収まらない分は **`transform: scale(k)` ＋ `width`/`height:${100/k}%` で自動縮小して必ず全文を出す**（UX 下限なし）。**窓 560 化が主役・フィットは保険**
    - **却下案**: `zoom`（macOS WKWebView と Chromium で `clientHeight` が zoom 適用後か否かが非対称＝測定がエンジン依存）／ルート font-size ＋ em 化（共有 CSS 全面改変）／`-webkit-line-clamp` で「…」省略（全文を出す要件に反する）
    - **サイズ補正が本体**: transform はレイアウトに影響しないので、`width`/`height` 補正が無いと `ol` の測定値が変わらず**収まり判定が永久に動かない**（ミューテーションで固定）
    - **新規 `overlayFit.ts`（DOM を知らない純粋ソルバ）に切り出した**＝jsdom がレイアウトを持たなくても合成 measure の注入で意味のある単体テストが書ける。`next = min(k*sqrt(available/content), k-0.02)` で**毎回必ず 1 段下げる**ため敵対的 measure でも停止。`MIN_FIT_SCALE=0.1` は UX 下限ではなく `100/k` 発散防止の数値ガード（約 24,000 字相当＝Twitch 500 字の 40 倍以上の余裕）
    - **新規 CSS 1 枚**（`PinnedOverlayApp.module.css` の `.fit{height:100%;overflow:hidden}`）。縮小時 `.root` のレイアウトボックスが `#root` を溢れ**透過窓に body スクロールバーが出うる**ため（既存のバー消しは `ol` 限定で防げない）。046b の「新規 CSS ゼロ」は共有 CSS を触らない唯一の手段として意図的に破った
    - **既存 `comment-overlay` は差分ゼロ**（`OverlayApp.tsx`/共有 CSS 3 本/`CommentList.tsx`/`pinnedComments.ts`/`useFollowScroll.ts`）。capability・conf・依存・sidecar も差分ゼロ。test **18 files / 239 tests** pass・ミューテーション実測 3 件
    - ⚠ **2026-07-29 追修正（自分で入れたバグ）**: 収まり判定を `content <= available - 8` と書いていたが、`scrollHeight` は**`clientHeight` を下限にクランプ**されるため**この条件は絶対に真にならず、短文でも常時 ~0.86 倍に縮小**されていた。`content - available <= 1` の向きへ修正し、定数名も `FIT_SAFETY_PX` → `FIT_TOLERANCE_PX`（余白を取る向きに書いてはいけない理由を JSDoc に明記）。**テストが素通しした原因**は合成モデルが `content`/`available` を独立に返し、実 DOM でありえない `content < available` を作れていたこと → モデルに `content >= available` の制約を入れ回帰ケースを追加（旧式へ戻すと 4 ケースがレッド）
    - **⚠ 実機で見る点**: k≈0.6 での**にじみ**（`.bubble`/`.card` の `filter: drop-shadow` がオフスクリーンを経由するため）と **body スクロールバーが出ないこと**を macOS / Windows 双方で。**`will-change`/`translateZ(0)` は絶対に足さない**（レイヤー昇格でラスタ倍率が固定され確実にボケる）。にじみが許容できなければ本文だけ要素セレクタで font-size を上書きするフォールバックへ切替（ソルバは再利用可）
  - 046d 固定オーバーレイの OBS 自動ソース追加（単体 [docs/tasks/046d-pinned-overlay-obs-auto-add.md](tasks/046d-pinned-overlay-obs-auto-add.md)／044a を 2 ソースへ一般化・**軽レビュー**）
    → **2026-07-29 実装済み**。⚠ **先送り判断の誤りを撤回したもの**: 親 046・046b が固定オーバーレイの OBS 自動追加を「044a の枠組み拡張・**将来タスク**」として「やらないこと」に入れていたが、**できない理由はどこにも記録されておらず**、実際の障害は `obs-client.ts` がソース名/窓名を**モジュール定数 1 組**で持っていた実装都合だけだった。依頼者の意図は当初から「自動追加の対象内」で、**先送りにした時点で確認を取るべきだった**。この行が「※対象外です（手動で追加してください）」という UI 文言を生み、E2E で「固定しても OBS に自動で反映されない」として顕在化した
    - **実装**: `obs-client.ts` に `ObsOverlayKind`（`"comments" | "pinned"`）と `OBS_OVERLAYS` 表を新設し、`enable`/`hide`/`ensureOverlaySource`/`findOverlayWindowItem`/`pickWgcMethodValue`/`setOverlaySceneItemEnabled` を種別でパラメータ化。ソース名は `StreamDock コメントオーバーレイ` / **`StreamDock 固定コメント`**（窓名は Rust の `.title` とバイト一致・`includes` 一致なので**片方が他方を含んではいけない**）
    - **viewer からソース名・窓名は渡さない**: 制御フレームに載るのは**固定 union だけ**で実名は sidecar 内の表に閉じる（§3/§8）。`parseOverlayKind` は allow-list（未知値・未指定は `"comments"` へ劣化＝044a フレームとの後方互換）。テストで「送信フレームに `StreamDock` が現れない」ことを固定
    - **接続契機は不変**: 「OBSに自動で反映する」が ON のときだけ OBS へ繋ぐ（045c の「表示が主・自動反映は従」を維持）。自動反映 OFF なら固定オーバーレイを開閉しても一切繋がない（テストで固定）。猶予タイマーは**種別ごとに別 ref**（共有すると片方の ON が他方の仕掛かりを取り消す）
    - **セキュリティ（軽）**: 宛先・プロトコル・依存すべて不変（`ws://127.0.0.1:4455`・obs-websocket-js・新規 npm/crate ゼロ）。差分は「OBS のシーンに作られるソースが最大 2 つ」だけで [docs/security.md](security.md) の 044a 例外に 046d 節として明記。`test-host-guard.mjs` PASS＝loopback 限定の fail-closed は不変。test **18 files / 243 tests** pass
    - → **2026-07-29 外部レビュー（security + 品質）対応済み**。判定「軽微な懸念あり・コードの修正必須 0 件」。`docs/security.md` の 046b 節に残っていた「044a の自動追加の対象外」という**失効した記述**（046d と自己矛盾）を訂正し、`lib.rs` doc comment / テストの仕様記述も併せて修正。品質は ①`PinnedOverlayApp.test.tsx` の `stubLayout` に `scrollHeight >= clientHeight` 制約を追加（046c 初回実装と同じモデリング欠陥が残っていた＝旧判定式でグリーンになる状態） ②`fitScale` の反復打ち切り経路で契約（返り値＝DOM 適用済み）が破れていたのを `apply` ラッパで構造的に修正 ③固定側の自動追加ゲートを永続設定値から**実窓**へ（空ソースが OBS に残る問題） ④S-1 のクリアを専用 effect へ明示化 ⑤窓タイトルのバイト一致契約を Rust `#[cfg(test)]` でテスト化（046d で重大度が上がったため格上げ）。test **18 files / 247 tests** ＋ `cargo test` 95 tests pass。詳細は [docs/progress.md](progress.md) の該当節。**意図的に対応しない 1 件**＝`parseOverlayKind` の単体テスト（依頼者の決定で現状維持）。`index.ts` は top-level で `main()` を呼ぶため import 不可＝テストには関数移動が必要だが、移動先の `obs-helpers.ts`/`scripts/` は差分ゼロ要件。安全側の根拠（明示構築でスプレッドしない・enable/hide 両方に適用・未知値の劣化先は 044a と同一挙動）と再修正トリガーを `parseOverlayKind` の JSDoc に記載
- 047 課金チャット 横スクロールティッカー＋クリック展開（単体 [docs/tasks/047-superchat-ticker.md](tasks/047-superchat-ticker.md)／課金チャットを YouTube 風に上部へ横スクロール小表示＋クリックで重ねダイアログ・本体 UI のみ・`isMonetaryEvent`/`displayEventType`/`eventLabel`/`composeEventMessage` を流用・043b/043c/046a と共存・**軽レビュー**）
  → **2026-07-29 実装済み**（`MonetaryTicker` / `MonetaryDetailDialog` / `monetaryFeed.ts`）。**frontend の表示追加のみ**で Rust / sidecar / capabilities / `csp: null` / `package.json` は差分ゼロ、**localStorage 書き込みもゼロ**
  - ⚠ **最大の設計判断＝`comments` から導出しない**。`comments` は `MAX_COMMENTS = 200` でクランプされるため、タスクファイルの案（`comments.filter(isMonetaryEvent)`）だと **200 件流れた時点でティッカーから投げ銭が消える**＝「見失わないための常時表示」という目的を直接壊す（046a が実機で踏んだのと同じ轍）。新規純関数 `monetaryFeed.ts` が**課金だけを別に蓄積**する（上限 50・最新が先頭・**043e の jewels combo 更新に追随**・変化ゼロなら同一参照）。`mergeComments.ts` への変更は `hasComboPayloadChanged` の `export` 1 行だけ（比較キーを複製すると「比較キー ⊇ Rust の UPDATE 列」が片方だけ腐り、金額が古いまま固まる）
  - **永続しない**（蓄積・既読とも）。046b の S-1「前回配信のコメントが操作ゼロで本番画面へ出る経路を断つ」と同じ方針＋046 の教訓「保存するデータの種類が変わる変更は軽レビューに置かない」。結果として §9 追補〔046a〕の対象外＝軽レビューで完結
  - **依頼者の追加要望＝既読マーク**。ピルを押して全文ダイアログを開いた時点で既読になり ✓＋減光、~~未読は赤枠（043b の `.itemMonetary` と同じ `--danger` 表現）、左端に `position: sticky` の「未読 N」~~ → **047b で撤回**（未読＝赤枠はティア配色と信号が競合するため廃止・sticky チップは角丸が下のピルを隠しきれず 2 ブロック構成へ）。**既読 id は `CommentViewerApp` が持つ**（ティッカー側だとビュー切替のアンマウントで消える）
  - **最新は左に積み・自動スクロールしない**。積む向きを変えるだけで `useFollowScroll` 相当の追従状態機械が**不要**になり、「過去のスパチャを見ている最中に飛ばされる」が構造的に起きない。マーキーにもしない（動く的をクリックさせない）
  - ダイアログは `detailPane` ではなく**ネイティブ `<dialog>` ＋ `showModal()`**（`ConfirmDialog` と同じ idiom）。focus trap/Esc/backdrop が新規依存ゼロで付き、**top-layer なので z-index 表（`.detailPane`=5 / `.contextMenu`=20）に行を増やさない**。閉じる 3 経路をテストで固定
  - 上部の並び順は `toolbar` → クレジット → ENGINE バナー → **ティッカー**（≈36px） → 固定帯（046a） → 一覧。全 5 段同時で 273px＝既定 720px なら一覧に 447px 残る。**課金 0 件では `return null`＝既存レイアウト完全不変**。`PinnedCommentBar` / `CommentList` / overlay 系は**差分ゼロ**
  - **意図的な逸脱**: ~~①ティア配色（`superchatTier`）を使わない＝未読/既読の色信号と競合し「未読が一目で分からない」本末転倒になるため（金額は verbatim 表示なので情報は落ちない）~~ → **①は 047b で撤回・ティア配色を採用**（依頼者の決定で未読/既読を減光＋✓へ移し色チャネルを空けた）／②名前は `SuperchatTicker` → **`MonetaryTicker`**（対象は superchat 以外 6 種を含む）③ダイアログにピン留め導線は足さない（範囲外・別タスク相当）
  - test **20 files / 269 tests** pass（`monetaryFeed` +10・`MonetaryTicker` +12）。詳細は [docs/progress.md](progress.md) の該当節
  - → **2026-07-29 047b 実機フィードバックで意匠を作り直し**（データ層は 1 行も触らず・`monetaryFeed.ts`/`mergeMonetary`/`MONETARY_MAX`/既読 Set/配線すべて無変更・外部通信/永続化/依存/capability もゼロ増）。報告 5 件＝①未読チップとピルが被る/透ける ②バッチが見にくい・額で色分けしたい・枠でなく塗り ③間隔が狭い ④細すぎる ⑤何の欄か分からない。**①の真因は構造**（`border-radius: 999px` の角丸要素を `overflow-x: auto` 内に `position: sticky` で置いていた＝角丸は bounding box の四隅を塗らないので下のピルが必ず覗く。Q-4 の `box-shadow` 目張りは右しか塞げない）→ **ラベルをスクロールコンテナの外へ出す 2 ブロック構成**にして sticky/z-index/目張りを全廃、ラベル「投げ銭」は未読 0 でも消さない（⑤も同時解消）。②は **047 の逸脱①「ティア配色を使わない」を撤回**——依頼者の決定で未読/既読を減光＋✓へ移し色チャネルが空いたため、`MonetaryTicker.tsx` の再修正トリガーどおり反転。**ティッカー＝YouTube 厳守（ティア色塗りつぶし・アイコン＋金額のみ）／一覧の課金行＝OBS と同じフルカード／固定帯も追従**（046a が avatar を保存しないためアイコンなし・`pinnedComments.ts` 無変更）。色トークンは `--overlay-tip-*`→`--tip-*` へ改名し **YouTube 実値へ更新＋tone ごとの文字色を追加**（`theme.css` 自身が「仮値・白文字が AA 未満」と申し送っていた分を解消。明るいティアは本家同様**暗文字**・非ティア 3 色は暗色化・gift は t5 と同値になるため色相移動＝**現在すべて AA 達成**）。⚠ **OBS の投げ銭カードも同トークンなので見た目が変わる**（配信画面と本体で同じ額を同じ色にするため共有を選択）。③ gap 6→10px、④ ピル実高 21→30px・帯 33→46px（上部 5 段 273→286px・最小窓 520px でも一覧に 234px）。重複解消として `monetaryTone()` を `viewerFormat.ts` へ、036a のガード `avatarDataUri`/`authorInitial` を `CommentList.tsx` から移設、tone→クラス表を新規 `monetaryTone.ts` に集約（`Record<MonetaryTone,string>` で**当て漏れは typecheck が落とす**）。dead CSS（`.badgeEvent`/`.combo`/`.itemMonetary`）削除。test **20 files / 294 tests** pass（壊れた既存は事前洗い出しどおり 3 件のみ・+21 追加・**ミューテーション 7 パターンで実効性確認済み**）。**実機確認 6 件**は progress.md 末尾に記載
  - → **2026-07-29 外部レビュー（security + 品質）対応済み**。**セキュリティ判定「問題なし」・修正必須 0 件**で、争点だった「§9 追補〔046a〕の対象外＝軽レビューで完結」という区分は**正しい**と確認（`localStorage` 書き込み 0 件・新規キー 0 件・外部境界 0 件・`src-tauri/`/sidecar/オーバーレイの差分ゼロを実測。条文も「**永続化**する変更」が対象なので該当せず、`docs/security.md` を変えない判断も妥当）。品質も重大な欠陥 0 件。対応は ①**Q-1**＝`hasComboPayloadChanged` のガードを削除しても全テストが通る状態だった（`mergeComments` から export した唯一の理由が無防備）ので「jewels でも中身が同じなら同一参照」を追加 ②**Q-2**＝「配線は単体で足りる」を**反転**し `CommentViewerApp` の受信バッチ分配テストを 3 件追加（`monetaryFeed.test.ts` は純関数直呼びのため **`comments.filter()` へ書き戻す退行を構造的に検出できない**＝本タスク最大の設計判断が無防備だった。既存 `mocks.handlers` ハーネスに相乗り）③**Q-4**＝未読チップの gap 塞ぎ影を spread 6 へ（上下 2.5px の隙間が残っていた）④**Q-5**＝`.tickerBar` に `flex: none`。**修正不要 5 件はコメント化**（S-1 画面滞在時間の伸び／Q-3 ダイアログの自動再オープン／Q-6 第三者の任意長テキストと `.confirmDialog` の max-height／申し送り5 ポリシー複製／申し送り4 既読 Set の具体的発火機構）。test **20 files / 273 tests** pass。**実機確認事項 3 件**は progress.md 末尾に記載
  - → **2026-07-29 047c 実機不具合の修正**（CSS 2 行・1 ファイル・TSX 無変更）。症状＝「コメントが追加されるたびに課金カードがどんどん潰れ、最終的に線になる」。真因は **Flexbox の automatic minimum size**——`.list` は `overflow-y:auto` の flex 縦積みで子 `.item` は既定の `flex-shrink:1`、そこへ 047b が `.item.itemTipCard { overflow: hidden }` を足したため**この子だけ自動最小高さが 0 になり、はみ出し分を独りで全部吸って潰れた**（chat 行は `overflow:visible` ＝自動最小高さが内容高なので無事という非対称）。はみ出し量はコメント 1 件につき約 40px 増えるので**1 件ごとに約 40px ずつ縮み**、高さ 0 で `border:1px` 上下だけが残って**ティア色の 2px の線**になる。⚠ **このリポジトリで 3 回目の同一バグ**（035c `.card` / 043c overlay `.item`・どちらも `flex-shrink:0` で解決済み）——047b が **OBS のカード意匠を移植した際に「見えるもの」だけ移し、それを成立させていた `flex-shrink:0` が付いてこなかった**。修正は `.item { flex-shrink: 0 }`（根本・chat 行は元から縮まないので**見た目不変**）＋ `.pinnedBar { flex: none }`（二次防御・帯自身にも縮み止めが無く `.tickerBar` だけ Q-5 で対策済みだった）。`.item` を共有する 3 箇所（`.list`/`.pinnedBar`/`.pastList`）と OBS オーバーレイ（別 CSS モジュール）で退行なし。⚠ **テスト無し**＝jsdom はレイアウトを計算せず、CSS ソースを読むガードテストも `?raw` が CSS モジュールに効かないため `@types/node` の新規追加が要り、依存を増やさない判断で見送った（CSS コメントに未カバーの理由と目視確認の指示を明記）。test **20 files / 294 tests** pass
  - → **2026-07-29 047d ティッカー帯の崩れを修正**（CSS のみ・`.tickerTrack` 1 ルール・TSX 無変更）。047c の「症状 C＝原因未特定・推測で触らない」の解決編。症状＝「特定のコメント（`25,000 bits`）が流れた瞬間にティッカーが縮み、次のコメントで元に戻る」。**推測で CSS を足さず 3 点だけヒアリングしたら、答えがそのまま特定になった**: ①「**ちょうどそのコメントで横に溢れた**」＝引き金は横スクロールバーの発生 ②「**ピルが四角くなった**」＝ `border-radius:999px` は小さくなれば角丸も比例縮小するので、**四角く見える＝上下を切り落とされている**＝クリップの signature（「縮んだ」だけなら縮小/クリップ/折り返しの 3 候補が残るが、形の変化が 2 つを落とした）③ macOS「スクロールバー: **自動的に表示**」＝**マウス接続時に占有型へ切り替わる**設定で、オーバーレイ前提にできない。真因＝`.tickerBar { align-items: stretch }` でトラックの高さは**外から**与えられるため、横スクロールバーが出ても帯は伸びず content box だけが 30px→15px に減り、`overflow-y: hidden` が 30px のピルを切る。「次のコメントで戻る」のは次のレイアウトでスクロールバーが最初から在る状態で高さが計算し直されるため＝**帯の高さが「溢れているか／何回目のレイアウトか」に依存してブレていた**。⚠ 047c（flex の縮小配分）とは**別機構**だが、形は同じ＝**「overflow を visible 以外にした箱が、外から与えられた高さの中で中身を黙って切る」**。修正は `.tickerTrack` に `scrollbar-width: none` ＋ `::-webkit-scrollbar { display: none }`（根本・帯高を溢れ状態から切り離す。先例 `OverlayApp.module.css`）＋ `min-height: 30px`（二次防御・ピル実高の床。`.tickerAvatar` 24px と `.tickerPill` の縦 padding と**対で動かす**）。`align-items: stretch` は維持（ラベルの縦罫を全高に通すため）。操作性は不変（ピルは実 `<button>`＝Tab で自動横スクロール・トラックパッド/Shift+ホイールも可・右端の見切れが affordance＝YouTube 同様）。⚠ **テスト無し**＝jsdom はレイアウトも**スクロールバーの有無**も再現しない。test **20 files / 294 tests** pass
- 048 ずんだもん読み上げ 文字数上限（単体 [docs/tasks/048-tts-reading-length-cap.md](tasks/048-tts-reading-length-cap.md)／長文コメントは「以下略」で打ち切り・省略は常時有効・文字数は設定で可変（既定60）・`ttsQueue` の合成前チョークポイントで読み上げテキストのみ切詰・表示は全文のまま・**軽レビュー**）
  → ⚠ **2026-07-28 の読み上げ不具合調査で最優先と確定**。「長文の後のコメントが読まれない」の直接原因は `MAX_BACKLOG=20` の**古い未読の無言破棄**で、290 字の長文 1 件（読み上げ 48〜64 秒）の間に 27〜38 件届き **7〜18 件が捨てられる**。本タスクの文字数上限だけで長文起因の取りこぼしはほぼ解消する（60 字なら破棄 0 件）。**048 → 050 → 049 の順で実装すること**（048/049/050 は同じ `enqueue` を触る）
  - → **2026-07-31 実装済み（実機確認は未実施）**。切り詰めは**純関数 `capForSpeech(text, max)`**（`ttsQueue.ts` から export・`sanitizeForSpeech` の隣）で、`enqueue` の読み替え適用直後・空判定の前の**1 箇所だけ**。`enqueue` は **① 入力決定 → ② sanitize → ③ 読み替え → ④ 切り詰め → ⑤ 空判定 → push** の 5 段になり、この不変条件をコードコメントで明示（**049 は ① だけを差し替える**）。純関数に切り出した理由＝`createTtsQueue` が `new AudioContext()` を作るため jsdom で動かず、`enqueue` 直書きだと**単体テストが書けない**。**数える単位はコードポイント**（`[...text]`）＝`slice` はサロゲートペアを割り孤立サロゲート「�」を作るため（`viewerFormat.ts` の `authorInitial` と同じ理由・非絵文字の 𠮷 は `sanitizeForSpeech` を通過する）。書記素クラスタ（`Intl.Segmenter`）は意図的に不採用。上限値は **getter 注入**（`TtsQueueOptions.getMaxLength`・**未注入なら切り詰めない**＝既存 getter と同じ作法で、既定値の定義元を `ttsPrefs.ts` 1 箇所に保つ）で、**設定を変えてもキューを作り直さない**。既定 **60**（読み上げ 10〜13 秒・dev-mock で到着 5〜7 件＝**破棄 0 件**）/ 下限 **20**（一文が助詞の途中で切れる）/ 上限 **200**（050 の試算で backlog 破棄が始まる境界）。**「上限なし」は作らない**（省略は常時有効・トグル無し）。クランプは `clampTtsMaxLength` **1 関数**が持ち load / save / UI 確定の 3 箇所が呼ぶ。接尾辞 `SPEECH_ELLIPSIS = "、以下略"`（読点は OpenJTalk のアクセント句区切り・**読み替え辞書適用後**に足すので辞書に壊されない・**実機の読みは未判定**で崩れたら `、以下省略` へ差し替え＝**定数 1 行＋ `ttsQueue.test.ts` のリテラル 4 箇所**）。設定 UI は `<input type="number">` で**確定は blur / Enter のみ**（打鍵途中の `8` が下限へクランプされる事故と、1 打鍵ごとの localStorage 書き込みを両方避ける／空・NaN は直前値へ戻す／CSS 追加ゼロ）。**新規 `ttsQueue.test.ts` / `ttsPrefs.test.ts`＝TTS 経路に初めて単体テストが入った**（049/050 が追記する土台）。test **22 files / 324 tests** pass。表示側 4 ファイル・`src-tauri/`・sidecar・`package.json` は**差分ゼロ**を実測
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
