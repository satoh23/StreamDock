/**
 * 034e: OBS オーバーレイの表示設定（フォント選択 / サイト名表示 ON/OFF）を localStorage に保持する。
 *
 * オーバーレイ窓（OverlayApp）と設定窓（CommentViewerApp/SettingsView）は別 webview だが、同一 Vite バンドル・
 * 同一 localStorage を共有する。設定窓が save* で書き込み、オーバーレイ窓が起動時に load*＋`storage` イベント
 * 購読で即反映する（設定窓での書換は他窓＝オーバーレイ窓で storage イベントを発火させる）。
 *
 * どちらも**非機密の UI 設定値**で、ttsPrefs.ts / channelStorage.ts と同方式（名前空間付き "stream-dock.*" キー・
 * localStorage 直 read/write・例外は握りつぶし）。OAuth トークン等の機密はここに保存しない。外部送信もしない。
 * フォントはすべて **OS 標準フォントのスタック**で、外部 Web フォント（CDN 等）は参照しない（docs/security.md の
 * CSP 方針: 外部 script/style/image/font を増やさない）。
 */

/** オーバーレイのフォント選択の保存キー（既定 system）。 */
export const OVERLAY_FONT_KEY = "stream-dock.comment-viewer.overlay-font";
/** オーバーレイのサイト名表示 ON/OFF の保存キー（既定 OFF）。 */
export const OVERLAY_SHOW_SOURCE_KEY =
  "stream-dock.comment-viewer.overlay-show-source";
/**
 * 044a: OBS へ自動追加（連携）ON/OFF の保存キー（既定 OFF）。**非機密の UI 設定のみ**。
 * OBS WebSocket パスワードはここに保存しない（Rust→OS キーチェーンで保持・§9）。
 */
export const OBS_AUTO_ADD_KEY = "stream-dock.comment-viewer.obs-auto-add";
/**
 * 046b: 「固定コメントをOBSに表示」ON/OFF の保存キー（既定 OFF）。**ユーザー自身の UI 設定値**（トグルの状態）で、
 * §9 追補（046a）が対象とする第三者の個人データ（コメント本文・表示名・金額＝`pinnedComments.ts` のキー）とは
 * データの性質が違う。既存の `OBS_AUTO_ADD_KEY` と同種の非機密トグル値として扱う。
 *
 * 永続化する理由: この設定は「OBS のウィンドウキャプチャに固定コメント窓を仕込む」一度きりのセットアップで、
 * 毎回 ON にし直させると配信開始時に OBS ソースが取り込めない（窓が無い）状態から始まってしまうため。
 * ON のときはコメビュ本体のマウント時に窓を開き直す（`CommentViewerApp` の 046b effect）。
 */
export const PINNED_OVERLAY_ENABLED_KEY =
  "stream-dock.comment-viewer.pinned-overlay-enabled";
/**
 * 061a: エフェクト専用オーバーレイ窓（label `effect-overlay`）を出すかの保存キー（既定 OFF）。
 * ⚠ **061h までの意味＝「エフェクトを配信画面に表示する」トグルの状態**／
 * ⚠⚠ **061i 以降の意味＝「エフェクトを表示する条件が 1 件以上あるか」の派生値**（下記）。
 * `PINNED_OVERLAY_ENABLED_KEY` と同種の**ユーザー自身の UI 設定値**で、
 * §9 追補（046a）が対象とする第三者の個人データではない。
 *
 * ⚠⚠ **このキーは 061a で初めて「窓をまたいで役割が分かれる」設定になった。**
 *   - **書き手＝main 窓**（⚠ **061i でトグルから派生値へ変わった**。下記）
 *   - **読み手＝コメビュ窓**（`CommentViewerApp`）。**`obs-enable` を送れる WS ハンドルを持つのは
 *     コメビュ窓だけ**なので、OBS への自動反映はコメビュ窓が代行する。
 *
 * ## ⚠⚠ 061i: ユーザーが触るトグルは消え、**割り当ての保存時に立てる派生値**になった（判断 2）
 *
 * 「エフェクトを配信画面に表示する」トグルは**二度手間**（条件を設定した時点で出したいことは自明なのに、
 * 別に ON にしないと何も出ない）だったので廃止した。いまの意味は
 * **「エフェクトを表示する条件が 1 件以上あるか」**で、書き手は
 * **`useEffectTemplates` の割り当て保存経路ただ 1 か所**（`saveEffectOverlayEnabled` の呼び出しは
 * リポジトリ全体でそこだけ＝`grep` で確認できる）。
 *
 * ⚠⚠ **キーを廃止して「割り当てから導出する」案は却下した**（判断 2 の (b)）。理屈は綺麗だが、
 * `CommentViewerApp` の `storage` 購読は **`e.key === EFFECT_OVERLAY_ENABLED_KEY` とキー名で分岐**しており、
 * 購読先を変えると **045c / 061e が固めた「OBS 反映の契機」の実装に手が入る**。
 * 派生値にしておけば `effectOverlayRestore.ts` / `CommentViewerApp.tsx` / `windowApi.ts` / `App.tsx` は
 * **差分ゼロ**で済む（061i の成果物として実測した不変条件）。
 * ⚠ **再修正トリガー＝061k で出力窓が 2 本になり、窓ごとに「開くべきか」を持つ必要が出たとき。**
 * そのとき (b) へ寄せるか、窓ごとにキーを持つかを決め直すこと。
 *
 * ## ⚠⚠ 061k の回答（上の再修正トリガーの発火）＝**窓ごとにキーを持つ**（判断 6）
 *
 * このキーの意味が **「コーナー側の出力窓を出すべきか」＝「`output === "corner"` の条件が 1 件以上あるか」**
 * へ狭まり、ステージ側は [`STAGE_OVERLAY_ENABLED_KEY`] が同じ形で持つ。
 * ⚠ **却下した 2 案**:
 *   - **1 本のキーに JSON を入れる** … `CommentViewerApp` はこの値を **`=== "true"`** で読むので、
 *     **値の形を変えると読み手が壊れる**（045c / 061e が固めた OBS 反映の契機に手が入る）。
 *   - **キーを廃止して割り当てから導出する** … `CommentViewerApp` の `storage` 購読は
 *     **`e.key === …` とキー名で分岐**している（061i が明示的に却下した案 (b) そのもの）。
 * ⇒ **(a) を採ると、既存の分岐がそのまま残り stage 用に同型の分岐を 1 本足すだけで済む**（値の形も同じ）。
 * ⚠ **書き手は引き続き `useEffectTemplates` の 2 か所**（保存経路 ＋ マウント時の再計算）で、
 * **その 2 か所が 2 キーを書く**。⚠ **hook の外から書かない**という 061i の不変条件は変えない。
 *
 * ⚠ **帰結（意図した新しい挙動）**: 条件を全部「エフェクトを出さない」に戻すとこの値は false になり、
 * `CommentViewerApp` の既存分岐が `hideObs("effects")` を送って **OBS 側のソースが非表示になる**
 * （⚠ **窓は閉じない**——自動 close は作らない・判断 1）。条件が無いのに OBS へ映り続けるほうが筋が悪い。
 * 伝達は 046a/046b と同じ**二段構え**（保証ベースライン＝コメビュ窓のマウント時に読み直す／
 * 即時反映＝`storage` 購読・ベストエフォート）。⚠ **コメビュ窓が閉じている間は誰も送れない**ので、
 * その事実は `ObsEffectsScreen` の前提ステータスでユーザーに明示する（黙って何も起きない状態を作らない）。
 */
export const EFFECT_OVERLAY_ENABLED_KEY =
  "stream-dock.comment-viewer.effect-overlay-enabled";
/**
 * 061k: **ステージ演出窓（label `stage-overlay`）を出すかの派生値**（既定 OFF）。
 * 意味は「**`output === "stage"` の条件が 1 件以上あるか**」で、
 * [`EFFECT_OVERLAY_ENABLED_KEY`] とまったく同型（値も `"true"` / `"false"` の文字列）。
 *
 * ⚠⚠ **既存キーの意味を変えず、新しいキーを 1 本足しただけ**なのが要点（判断 6 の (a)）。
 * ⚠ **書き手は `useEffectTemplates` の 2 か所だけ**（既存キーと同じ。`grep` で確認できる）。
 * ⚠ **読み手はコメビュ窓**（`CommentViewerApp`）で、既存の `effects` 分岐と同型の分岐が
 * `"stage"` 種別について 1 本増える。
 * ⚠ **旧ビルドへ戻したときはこのキーが誰にも読まれないだけ**＝ ステージ窓は開かず、
 * 条件は `output` ごと未知フィールドとして無視され、**全部コーナーに出る**（＝061j の挙動・安全側）。
 */
export const STAGE_OVERLAY_ENABLED_KEY =
  "stream-dock.comment-viewer.stage-overlay-enabled";
/**
 * 061a: 「エフェクト窓を OBS へ自動で反映する」ON/OFF の保存キー（既定 OFF）。
 *
 * ⚠ **既存の `OBS_AUTO_ADD_KEY`（コメント一覧＋固定コメント用）とは別のキーにしてある。** 理由は
 * 共有すると `CommentViewerApp` が state に持っている `obsAutoAdd` が **main 窓の書換で stale になる**ため、
 * 既存 OBS 系へ `storage` 購読を足す必要が生じる＝**045c で回帰が見つかった箇所に手を入れる**ことになる。
 * 専用キーなら既存 2 種の自動反映挙動は**差分ゼロ**のまま。代償として設定スイッチが 2 つになるので、
 * 画面側の文言で「エフェクト窓のソース」に限る旨を明示すること。
 * **再修正トリガー**＝「OBS 連携のスイッチを 1 つにしたい」となったら、先に `obsAutoAdd` を
 * localStorage 直読み（＋`storage` 購読）へ寄せてから統合する（state のミラーを残したまま統合しない）。
 */
export const EFFECT_OBS_AUTO_ADD_KEY =
  "stream-dock.comment-viewer.effect-obs-auto-add";
/**
 * 061a レビュー（Q-1 修正）: **エフェクト窓のセットアップ用ガイドを「次の 1 回だけ」出すためのワンショット旗**。
 *
 * ⚠⚠ **なぜ必要になったか**: 061a は「ガイドが配信中に出ない」根拠を「窓が開くのはユーザーが表示トグルを
 * ON にした明示操作のときだけ」に置いていたが、**同じ 061a が `MainWindowApp` のマウント（＝アプリ起動）で
 * 窓を開き直す経路を新設したため、その前提が偽になった**。本アプリは `boot_launch_presets` を持つ
 * **配信準備時に起動されるランチャ**なので、「設定 ON のまま配信直前に StreamDock を起動」は例外ではなく主動線で、
 * そのとき破線枠とセットアップ文言が 30 秒間 OBS のキャプチャに映る（ユーザー向け文言「配信中には
 * 表示されません」が守れない）。
 *
 * **書き手＝明示操作 1 つだけ**（⚠ **061i で起点が移った**。下記）。**読み手＝`EffectOverlayApp`** で、
 * マウント時に読み、直後に false へ倒す（次に開くときは出ない）。起動時の窓復元（`App.tsx`）は
 * **この旗を立てない**ので、復元経路ではガイドが出ない。
 *
 * ## ⚠⚠ 061i: 起点を「テスト表示で窓を開いたとき」へ移した（判断 3）
 *
 * 061a〜061h の起点は **`ObsEffectsScreen` の表示トグル ON** だったが、**061i でそのトグルを廃止した**
 * ので起点が消える。新しい起点は **「配信画面でテスト表示」で窓が停止中だったとき**＝
 * **OBS の位置合わせをしている最中**という、ガイドが最も要る瞬間そのもの（かつ明示操作）。
 * ⚠⚠ **条件を編集して窓が自動で開いたときは立てない**——立てると**条件を 1 つ足すたびに**
 * ガイドが 30 秒 OBS へ映る。上の Q-1 の規律（明示操作のときだけ）はここでも同じである。
 * ⚠ 「出し直せる」も不変（窓を閉じて、もう一度テスト表示を押せば出る）。
 *
 * ⚠ **fail 方向は「余分に 1 回出る」側に倒してある**（窓の open が失敗して旗が残ると、次回起動で 1 度だけ出る）。
 * 逆側（旗が消えてガイドが二度と出ない）に倒すとセットアップ不能になるため、この向きを選んでいる。
 * **再修正トリガー**＝ガイドを「窓の位置合わせ中は出し続ける」等の常時表示に変えるなら、この旗ごと廃して
 * `ObsEffectsScreen` 側の明示トグルにする（061a が却下した案なので、そのときは却下理由から見直すこと）。
 */
export const EFFECT_OVERLAY_GUIDE_PENDING_KEY =
  "stream-dock.comment-viewer.effect-overlay-guide-pending";
/**
 * 061b: **テスト発火の合図**（main 窓 → エフェクト窓）。値は `<nonce>:<templateId>`。
 *
 * ⚠⚠ **なぜこのキーが要るのか**（061b の穴 A）: 2026-08-09 の仕様変更でエフェクト窓が sidecar の WS を
 * 直接張る形になり、`effectQueue.ts`（localStorage 経由の窓間伝達）を廃止した結果、
 * **main 窓からエフェクト窓へ届く道が 1 本も無くなった**。しかしテスト発火ボタンは
 * 「実際のスパチャを待たないと OBS のセットアップができない」ため必須。
 * 却下した案: ①エフェクト窓側に操作 UI を置く（透過・非フォーカス・最背面なのでクリックを受けられない）
 * ②sidecar から合成コメントを流す（**sidecar 差分ゼロに反する**うえ、未認証の loopback WS に
 * 「配信画面へ任意の文字列を出す口」を作ることになる）③Rust コマンド＋Tauri emit（**新 command ゼロに反する**）。
 *
 * ⚠⚠ **値は `<nonce>:<templateId>` で、エフェクトの中身は載せない。**
 * 出す内容（名前・金額・種別ラベル）はエフェクト窓側の**固定ダミー定数**から作る＝
 * **第三者のデータが localStorage に 1 バイトも載らない**
 * （§9 追補〔046a〕の対象外。廃止した `effectQueue` とはここが決定的に違う）。
 * ⚠ **毎回値を変える**こと。同じ値の `setItem` では `storage` イベントを飛ばさない実装があるため。
 *
 * ## ⚠⚠ 061h: `templateId` を載せた（§9 の新しい判断）
 *
 * 061b〜061g のあいだ、このキーの値は **nonce だけ**で「中身は使わない」ことが §9 の担保だった。
 * 061h でテスト表示が「**テンプレート行ごと**に、そのテンプレートを出す」導線になったので、
 * **どれを出すか**を伝える必要が生じた。載せてよいと判断した根拠:
 *   1. 載るのは **nonce** と **Rust の `effect_template::service` が `Uuid::new_v4()` で採番した id** だけ。
 *      ⚠ **第三者の個人データ（本文・表示名・金額・アバター）は 1 バイトも入らない**——
 *      それらは相変わらずエフェクト窓側の固定ダミーから作る。
 *   2. **`EFFECT_ASSIGNMENTS_KEY` が既に同じ id を保存している**＝ localStorage に載るデータの
 *      **種類は 1 つも増えていない**（増えたのは「同じ種類の値を書く 2 本目のキー」だけ）。
 *   3. ⚠⚠ **受け取る側で形を検証する**——エフェクト窓は `effectAssignments.ts` の
 *      [`isEffectTemplateId`] を通してから使う。localStorage は他窓から書けるので**多層防御の 1 枚目**で、
 *      実際には Rust の `is_template_id` も同じ形を要求する（2 層の強さが揃っている）。
 * ⚠ **中身（名前・金額・本文）をここへ載せる変更は §9 の再評価が要る**（`effectQueue` を廃止した線）。
 *
 * ⚠⚠ **`docs/security.md` に追記していないのは、同ドキュメント自身のルールがそう定めているため**
 * （061h レビューで裏取り）。「レビュー必須条件」→「取得コメント・視聴者情報の端末保存」の下位条件が
 * **「ユーザー自身の UI 設定値（テーマ・フォント・トグル・チャンネル名等）を localStorage に置く変更は
 * 従来どおり本項に該当しない」**と明示しており、テンプレート id はこれに当たる。
 * 先例＝ **`OVERLAY_THEME_KEY`（060d・テーマ id）は security.md に 1 行も追記されていない**。
 * ⚠ 逆に §9 追補が要ったのは 058a のデバイス ID だが、あれの理由は「id を保存すること」ではなく
 * **デバイス名が配信者の環境を推測させるという中身の性質**なので、本キーの反例にはならない。
 *
 * ⚠ **このキーには削除経路が無い**（`EFFECT_ASSIGNMENTS_KEY` は「全部が既定ならキーごと削除」で消えるが、
 * こちらは一度書いたら残る）。＝ **端末内保存データの一括削除・エクスポートを作るときの対象が 1 本増えた**
 * （§9 追補〔046a〕の同趣旨の申し送りと同じ扱い）。⚠ 残るのは id 1 個なので §9 の線には触れない。
 *
 * ⚠⚠ **エフェクト窓はこの値を `storage` ハンドラの中でしか読まない（マウント時に `getItem` しない）。**
 * ⚠ **ここを「マウント時にも読む」に変えないこと**——残存値で**再起動直後に無操作で配信画面へ出る**
 * 経路になり、046b レビュー S-1（永続した値が無操作で配信面に出る）と同型の問題を作る。
 *
 * ⚠⚠ **061i の [`EFFECT_TEST_FIRE_PENDING_KEY`] は「マウント時に読む」が、これと矛盾しない。**
 * 違いは 2 つ:
 *   1. あちらは**読んだ瞬間に消える**（`take*`）＝ 残存値が積み上がらない。
 *      このキーは**一度書いたら残り続ける**ので、マウント時に読むと**毎回**出る。
 *   2. あちらを書くのは「**窓が停止中**のときのテスト表示」だけ＝ **書いた直後に必ず窓が開く**
 *      （＝押した本人が見ている）。残っても**次に窓が開いたとき 1 回だけ**出る
 *      （＝ガイド旗と同じ「余分に 1 回」の向き）。
 *      ⚠⚠ **061i レビュー S-4 で訂正**: 当初ここは「**残るのは open が失敗したときだけ**」と
 *      書いていたが、**それは真ではない**——旗を書くかどうかの判定に使う `effectWindowOpen` は
 *      2 秒ポーリングの値なので、**「実は既に開いていた」瞬間にも旗が書かれうる**
 *      （既存窓は `show()` されるだけで**再マウントしない**＝旗を読み直さない＝残骸になる）。
 *      ⚠ 露出窓は「窓の React がマウントし終えてから `is_effect_overlay_open` が解決するまで」に
 *      限られ、`ObsEffectsScreen` が **`openEffectOverlay` の時点で `effectWindowOpen` を
 *      楽観的に true にする**ことで塞いである（同レビューの対応）。
 * ⚠ 逆に言うと、**あちらを「読んでも消さない」に変えた瞬間にこの区別が崩れる**（窓を開くたびに出る）。
 *
 * ⚠ 伝達は `storage` イベント（**別 webview 間の伝播はプラットフォーム依存でベストエフォート**）。
 * 届かなくても壊れ方は「**テストボタンが効かない**」という観測可能なものに留まり、本番の発火（WS 直結）には
 * 影響しない。**再修正トリガー**＝実機で効かないと分かったら、エフェクト窓側でこのキーだけを
 * 短間隔で**読む**ポーリングへ切り替える（読み取りは `storage` を撒かないので他窓に副作用が無い）。
 */
export const EFFECT_TEST_FIRE_KEY =
  "stream-dock.comment-viewer.effect-test-fire";
/**
 * 061i（判断 4）: **エフェクト窓が停止中のときのテスト表示を、窓が開いた「後で」渡すためのワンショット旗**。
 * 値は **`templateId` 1 個だけ**（nonce は要らない＝`storage` イベントに乗せないため）。
 *
 * ⚠⚠ **なぜ必要か（061i で最も取りこぼしやすいところ）**: 061i でテスト表示は
 * 「窓が停止中なら**開いてから**出す」になった（＝条件を 1 つも作らずに OBS の位置合わせができる）。
 * ここで素直に **「`open_effect_overlay_window` を await → `EFFECT_TEST_FIRE_KEY` を書く」**と実装すると
 * **確率的に取りこぼす**——あのコマンドの解決は**窓生成の完了**であって、
 * **エフェクト窓の React がマウントして `storage` リスナーを登録し終えたこと**ではない。
 * `storage` は**登録前に飛んだ分を後から拾えない**ので、「押しても何も出ない」が起きる。
 *
 * ⇒ **`EFFECT_OVERLAY_GUIDE_PENDING_KEY` と同じ idiom**（旗を立てる → 窓がマウント時に読んで倒す）に
 * 寄せた。**実績のある形なので新しい仕組みを発明しない**（ポーリングも ready 通知も足さない）。
 *   - **書き手＝main 窓（`EffectTemplateCard`）で、窓が停止中のときだけ**。
 *     ⚠⚠ **窓が開いているときは旗を使わない**（従来どおり [`requestEffectTestFire`] の `storage` 発火）。
 *     **2 経路を混ぜないこと**——開いている窓は旗を読み直さないので、旗を立てても
 *     **消えない残骸**になり、次に窓を開いた瞬間に無操作でエフェクトが出る
 *     （`EFFECT_TEST_FIRE_KEY` の JSDoc が戒めている 046b レビュー S-1 と同型の問題）。
 *   - **読み手＝`EffectOverlayApp` のマウント時 1 回だけ**（[`takeEffectTestFirePending`]＝**読んだら消す**）。
 *     ⚠ 値は `isEffectTemplateId()` で検証してから使う（061h が作った検証を再利用＝
 *     正規表現の持ち主を増やさない。localStorage は他窓から書けるので多層防御の 1 枚目）。
 *
 * ⚠ **fail 方向は「余分に 1 回出る」側**（窓の open が失敗して旗が残ると、次に窓が開いたとき 1 度だけ出る）。
 * 逆側（旗が消えて押しても永久に出ない）に倒すと**位置合わせが不能になる**ので、この向きを選んでいる
 * （＝`EFFECT_OVERLAY_GUIDE_PENDING_KEY` と同じ判断）。
 *
 * ⚠ §9: 載るのは **Rust の `effect_template::service` が `Uuid::new_v4()` で採番した id** だけで、
 * 第三者の個人データは 1 バイトも入らない＝ **061h で `EFFECT_TEST_FIRE_KEY` について決着済みの判断の延長**
 * （localStorage に載るデータの**種類は 1 つも増えていない**。判断の全文は同キーの JSDoc）。
 * ⚠ **一括削除・エクスポートを作るときの対象が 1 本増えた**（`EFFECT_TEST_FIRE_KEY` と同じ扱い。
 * ⚠ ただしこちらは**読まれた時点で消える**ので、残り続けるのは「窓が開かなかった」ときだけ）。
 */
export const EFFECT_TEST_FIRE_PENDING_KEY =
  "stream-dock.comment-viewer.effect-test-fire-pending";
/**
 * 061k: **ステージ演出窓ぶんの保留旗**（[`EFFECT_TEST_FIRE_PENDING_KEY`] と完全に同型）。
 *
 * ⚠⚠ **なぜ窓ごとに 2 本要るのか**（判断 8）: テスト表示は **2 つの窓の両方へ出す**
 * （目的が OBS の位置合わせで、061k 以降は**合わせる対象が 2 ソースある**ため）。
 * 旗を 1 本にすると、**先にマウントしたほうの窓が読んで消してしまい**、
 * もう一方は**無反応**になる（`take*` ＝読んだら消す、なので取り合いになる）。
 * ⚠⚠ **各窓は自分の旗だけを `take` すること。相手の旗を消さない。**
 *
 * ⚠ **061i 判断 4 の取りこぼしは 2 窓ぶん起きる**——`open_*_overlay_window` の解決は
 * **窓生成の完了**であって、**その窓の React が `storage` リスナーを登録し終えたこと**ではない。
 * ⚠ **061i レビュー S-4 の楽観更新（開く側だけ前提ステータスを楽観的に倒す）も 2 窓ぶん要る**
 * （stale-false の隙間に押すと、既存窓は `show()` されるだけで再マウントせず**旗が残骸になる**）。
 *
 * ⚠ §9 の判断は [`EFFECT_TEST_FIRE_PENDING_KEY`] と同一（載るのは Rust 採番の uuid だけ）。
 * ⚠ **一括削除・エクスポートを作るときの対象がもう 1 本増えた**（読まれた時点で消えるのも同じ）。
 */
export const STAGE_TEST_FIRE_PENDING_KEY =
  "stream-dock.comment-viewer.stage-test-fire-pending";
/**
 * 061d-2: **イベント種別 → エフェクトの割り当て**の保存キー
 * （未保存＝全種別「表示しない」。⚠ **061h までは「組み込み」だった**）。
 *
 * ⚠⚠ **接頭辞が `comment-viewer` なのは既存 8 本と揃えるため**（`obs-effects.*` という 2 つ目の
 * 名前空間を作らない）。この画面の設定はすべてこの接頭辞に載っている。
 *
 * ⚠ **値は「イベント種別（固定 6 値）」と「テンプレート id（uuid v4）」だけ**＝ ユーザー自身の
 * UI 設定値で、§9 追補（046a）が対象とする第三者の個人データ（本文・表示名・金額）は 1 バイトも入らない。
 * 既存の `EFFECT_OVERLAY_ENABLED_KEY` 等の非機密トグル値と同種。
 * ⚠ **061h の `EFFECT_TEST_FIRE_KEY` が同じ id を載せるようになった**根拠もここにある
 * （＝ localStorage に載るデータの種類は増えていない）。
 *
 * ⚠⚠ **読み書きのロジックは `screens/obs-effects/effectAssignments.ts` が持つ**（⑩）。
 * ここに置くのはキーだけ——「localStorage のキーは本ファイルを grep すれば全部見える」という
 * §9 の監査上の性質を壊さないため（`load*` / `save*` の実体が別ファイルにあるのは本ファイルで初めて）。
 *
 * ⚠ **読み手はエフェクト窓（`EffectOverlayApp`）で、発火のたびに読み直す**
 * （state にミラーしない・`storage` にも依存しない。⚠ 061b はこの規律を
 * `EFFECT_MONETARY_ENABLED_KEY` にも適用していたが、あのキーは 061h で廃止した）。
 * `storage` イベントは**メディアの先読みを温めるためだけ**に使う
 * （届かなくても壊れ方は「そのテンプレートの初回だけ出ない」に留まる）。
 */
export const EFFECT_ASSIGNMENTS_KEY =
  "stream-dock.comment-viewer.effect-assignments";
/**
 * 061l: **適用中の配信イベント**の id（未保存＝まだ選んでいない）。
 *
 * ⚠⚠ **「適用」と「開始」は別の操作である**（判断 6）。このキーは「**このイベントを使う**」だけを表し、
 * **窓は開かないし、配信画面には何も出ない**。実際に開催を始めるのは [`STREAM_EVENT_ROUND_KEY`] のほう。
 * 分けた理由＝「配信前に選んでおく」と「配信中に走らせる」は違うタイミングの操作だから
 * （混ぜると「詳細画面を開いた瞬間に配信画面へ出る」になる）。
 *
 * ⚠ **値は同梱レジストリ（`features/obs-effects/streamEventRegistry.ts`）の id 1 個だけ**＝
 * **ユーザー自身の UI 設定値**で、§9 追補（046a）が対象とする第三者の個人データ
 * （コメント本文・表示名・金額）は 1 バイトも入らない。`OVERLAY_THEME_KEY`（テーマ id）と同種。
 * ⚠ **読み書きのロジックは `features/obs-effects/streamEventRound.ts` が持つ**——
 * ここに置くのは**キーだけ**（[`EFFECT_ASSIGNMENTS_KEY`] と同じ役割分担で、
 * 「localStorage のキーは本ファイルを grep すれば全部見える」という §9 の監査上の性質を壊さないため）。
 * ⚠ **書き手は main 窓（`StreamEventTab` の「適用」）だけ**で、ステージ窓はこのキーを読みも書きもしない
 * （ステージ窓が見るのは開催キーだけ＝「適用しただけでは配信画面に何も出ない」の担保）。
 */
export const STREAM_EVENT_SELECTED_KEY =
  "stream-dock.comment-viewer.stream-event-selected";
/**
 * 061l: **開催中の配信イベント 1 回ぶん**（未保存＝開催していない）。
 * 値は `{ eventId: string; startedAt: number; endsAt: number }` の JSON。
 *
 * ## ⚠⚠ 「セッション」と呼ばないこと（判断 1）
 *
 * `session` は**すでに埋まっている**——sidecar の wire（`start-session` / `session.state`）と
 * DB（`viewer_comments.session_id`）が**コメント取得**のセッションを指しており、
 * ⚠ **062b が `stream_sessions` テーブルを作る予定**である。
 * ⇒ イベントの 1 回ぶんは **「開催」**、コード上の識別子は **`round`**。
 * ⚠ **画面に出す語は「開始」「終了」**（ユーザーに `round` の語は見せない）。
 *
 * ## ⚠⚠ `endsAt` は絶対時刻（epoch ms）で持つ（判断 5）
 *
 * 「残り N 秒」を main 窓とステージ窓が**別々に数えると必ずずれる**ので、
 * **両窓が同じ `endsAt` から `Date.now()` で計算する**（＝時計は 1 つ）。
 * ⚠ 判定そのものは純関数（`parseStreamEventRound(raw, now)`）に閉じてあり、テストで時計を偽装しない。
 *
 * ## ⚠⚠ 終了は「期限切れの保存値を『開催していない』と読む」ことで表す
 *
 * ⚠ **`removeItem` する主体を決めない**——決めると「main 窓が閉じていると消えない」
 * 「両窓が競合して 2 回消す」が生まれる。⇒ **掃除は main 窓が
 * 「OBSエフェクト」画面を開いているときの best-effort に留める**（`ObsEffectsScreen`）。
 * ⚠⚠ **正しさは掃除に依存しない**（`parseStreamEventRound` が期限切れを必ず落とす）。
 * ⚠⚠ **ステージ窓はこのキーを 1 バイトも書かない・消さない**（読むだけ）。
 *
 * ⚠ **061i 判断 4 の「取りこぼし」は起きない**——あれは**ワンショットの旗**（`take*`）だったので
 * 「窓のリスナー登録前に飛んだ分が消える」問題があったが、開催状態は**永続状態**なので
 * **ステージ窓がマウント時に読めば取りこぼさない**。`storage` は「開催中にすでに窓が開いている」ときに
 * 即座に反映するためだけの経路で、届かなくても**次のマウントで回復する**
 * （061d-2 の「`storage` は速くするためだけ」と同じ位置づけ）。
 *
 * ⚠ §9: 載るのは**同梱レジストリの id 1 個と時刻 2 つ**だけ＝ **ユーザー自身の操作の結果**であり、
 * 第三者データではない（`docs/security.md`「レビュー必須条件」の保存ポリシー項が明示的に除外している
 * 「ユーザー自身の UI 設定値」に当たる）。⚠⚠ **開催中に数えるコメント件数はここに保存しない**
 * （穴 δ の結論＝ステージ窓のメモリだけに持つ。理由は `EffectOverlayApp` の件数 state の JSDoc が正）。
 * ⚠ **一括削除・エクスポートを作るときの対象が 2 本増えた**（本キーと [`STREAM_EVENT_SELECTED_KEY`]）。
 */
export const STREAM_EVENT_ROUND_KEY =
  "stream-dock.comment-viewer.stream-event-round";
/**
 * 060d: 選択中のカスタム CSS テーマ（`overlay_themes` の id）の保存キー。**未保存＝`null`＝既定意匠**。
 *
 * ⚠ **CSS 本文はここに置かない**（Rust が `app_data_dir/themes/<id>.css` に持ち、
 * `get_overlay_theme_css` が文字列で返す）。localStorage に置くのは**id 1 個だけ**で、
 * これは「フォント」「サイト名表示」と同じ**ユーザー自身の UI 設定値**＝ §9 追補（046a）が対象とする
 * 第三者の個人データ（コメント本文・表示名・金額）ではない。
 *
 * ⚠⚠ **`null`（既定）へ必ず戻せることが安全装置**。ユーザー CSS は `.sd-comment { display:none }` の
 * 一行でオーバーレイを完全に不可視にでき、オーバーレイ窓は表示専用・非フォーカスなので**そこからは
 * 何も操作できない**。設定ビューの「既定のデザインに戻す」だけが脱出路になる（060d のテストが固定）。
 */
export const OVERLAY_THEME_KEY = "stream-dock.comment-viewer.overlay-theme";

/**
 * オーバーレイのフォント候補（すべて OS 標準・日本語表示可・外部フォント無し）。`id` を localStorage に保存し、
 * `stack` を font-family に適用する。maru（丸ゴシック）は Windows に該当フォントが無いので gothic 相当へ
 * フォールバックする。ここに載せるのは system/OS 同梱フォントのみで、URL 参照は一切持たない。
 */
export const OVERLAY_FONTS = [
  {
    id: "system",
    label: "システム標準",
    stack:
      'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif',
  },
  {
    id: "gothic",
    label: "ゴシック",
    stack:
      '"Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif',
  },
  {
    id: "maru",
    label: "丸ゴシック",
    stack: '"Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif',
  },
  {
    id: "mincho",
    label: "明朝",
    stack:
      '"Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "MS Mincho", serif',
  },
] as const;

/** フォント id の型（OVERLAY_FONTS の id 群）。 */
export type OverlayFontId = (typeof OVERLAY_FONTS)[number]["id"];

/** 既定フォント（システム標準）。 */
export const DEFAULT_OVERLAY_FONT: OverlayFontId = "system";

/** 保存済みのフォント id を読み込む。未保存・不正・例外はすべて既定（system）へフォールバック。 */
export function loadOverlayFont(): OverlayFontId {
  try {
    const raw = localStorage.getItem(OVERLAY_FONT_KEY);
    return OVERLAY_FONTS.some((f) => f.id === raw)
      ? (raw as OverlayFontId)
      : DEFAULT_OVERLAY_FONT;
  } catch {
    return DEFAULT_OVERLAY_FONT;
  }
}

/** フォント id を保存する（ローカルのみ・外部送信しない）。 */
export function saveOverlayFont(id: OverlayFontId): void {
  try {
    localStorage.setItem(OVERLAY_FONT_KEY, id);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}

/**
 * フォント id を font-family スタック文字列へ解決する。未知 id は既定（DEFAULT_OVERLAY_FONT）のスタックへ。
 * 034e(review L3): フォールバックを DEFAULT_OVERLAY_FONT に一本化し、loadOverlayFont と既定の定義元を揃える
 * （OVERLAY_FONTS の並び順に依存しないため、将来 system を先頭以外へ移してもフォールバック先が乖離しない）。
 * 末尾の OVERLAY_FONTS[0] は型上の最終ガード（find の undefined を潰す・実運用では到達しない）。
 */
export function resolveOverlayFontStack(id: OverlayFontId): string {
  const found =
    OVERLAY_FONTS.find((f) => f.id === id) ??
    OVERLAY_FONTS.find((f) => f.id === DEFAULT_OVERLAY_FONT) ??
    OVERLAY_FONTS[0];
  return found.stack;
}

/** 保存済みのサイト名表示 ON/OFF を読み込む。未保存・不正・例外はすべて false（OFF）にフォールバック。 */
export function loadOverlayShowSource(): boolean {
  try {
    return localStorage.getItem(OVERLAY_SHOW_SOURCE_KEY) === "true";
  } catch {
    return false;
  }
}

/** サイト名表示 ON/OFF を保存する（ローカルのみ・外部送信しない）。 */
export function saveOverlayShowSource(show: boolean): void {
  try {
    localStorage.setItem(OVERLAY_SHOW_SOURCE_KEY, String(show));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}

/** 044a: OBS 自動追加 ON/OFF を読み込む。未保存・例外は false（OFF）へフォールバック。 */
export function loadObsAutoAdd(): boolean {
  try {
    return localStorage.getItem(OBS_AUTO_ADD_KEY) === "true";
  } catch {
    return false;
  }
}

/** 044a: OBS 自動追加 ON/OFF を保存する（ローカルのみ・非機密・外部送信しない）。 */
export function saveObsAutoAdd(enabled: boolean): void {
  try {
    localStorage.setItem(OBS_AUTO_ADD_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/** 046b: 「固定コメントをOBSに表示」ON/OFF を読み込む。未保存・例外は false（OFF）へフォールバック。 */
export function loadPinnedOverlayEnabled(): boolean {
  try {
    return localStorage.getItem(PINNED_OVERLAY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/** 046b: 「固定コメントをOBSに表示」ON/OFF を保存する（ローカルのみ・非機密・外部送信しない）。 */
export function savePinnedOverlayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PINNED_OVERLAY_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 061a: エフェクト窓を出すか（未保存・例外は false へフォールバック）。
 * ⚠ **061i でこの値の意味は「表示する条件が 1 件以上あるか」になった**（トグルは廃止・上の JSDoc）。
 * 読み手は `effectOverlayRestore.ts`（起動時の窓復元）と `CommentViewerApp`（OBS 反映の代行）。
 */
export function loadEffectOverlayEnabled(): boolean {
  try {
    return localStorage.getItem(EFFECT_OVERLAY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 061a: エフェクト窓を出すかを保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠⚠ **061i: 呼んでよいのは `useEffectTemplates` の中だけ**（判断 2 の「2 つの真実」対策）。
 * ほかの module から呼ばれた瞬間に「割り当て」と「このフラグ」が同期を外しうるので、
 * **`grep -rn "saveEffectOverlayEnabled" src` の実装側のヒットが本定義と `useEffectTemplates` に
 * 限られる**ことが不変条件である（＋本関数自身の単体テスト `overlaySettings.effects.test.ts`）。
 * ⚠ **061i レビュー S-3 で `useEffectTemplates` 内の呼び出しは 2 か所になった**——
 * ①割り当ての保存経路（`commitAssignments`）②**マウント時の再計算**
 * （アップグレードで持ち越した値を実態＝割り当てへ合わせ直す。値が一致していれば書かない）。
 * どちらも「割り当てが正」という同じ規則で書いており、**規律は不変**。
 * ⚠ 窓の open/close とは別物（設定が正・窓が従。「ウィンドウを閉じる」ボタンはこの値を触らない）。
 */
export function saveEffectOverlayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(EFFECT_OVERLAY_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 061k: ステージ演出窓を出すか（未保存・例外は false へフォールバック）。
 * ⚠ 意味は「`output === "stage"` の条件が 1 件以上あるか」＝ [`loadEffectOverlayEnabled`] と同型。
 * 読み手は `effectOverlayRestore.ts`（起動時の窓復元）と `CommentViewerApp`（OBS 反映の代行）。
 */
export function loadStageOverlayEnabled(): boolean {
  try {
    return localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 061k: ステージ演出窓を出すかを保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠⚠ **[`saveEffectOverlayEnabled`] と同じ規律**——**呼んでよいのは `useEffectTemplates` の中だけ**で、
 * 呼び出しは**同じ 2 か所**（保存経路 ＋ マウント時の再計算）。
 * ⚠ **2 キーは必ず対で書くこと**——片方だけ書くと「stage 条件を作ったのにステージ窓が開かない」
 * （あるいは逆に「条件を全部消したのに OBS に映り続ける」）が黙って起きる。
 * ⚠ 不変条件の確認は `grep -rn "saveEffectOverlayEnabled\|saveStageOverlayEnabled" src` で、
 * 実装側のヒットが本ファイルと `useEffectTemplates` に限られること。
 */
export function saveStageOverlayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/** 061a: 「エフェクト窓を OBS へ自動反映」ON/OFF を読み込む。未保存・例外は false（OFF）へフォールバック。 */
export function loadEffectObsAutoAdd(): boolean {
  try {
    return localStorage.getItem(EFFECT_OBS_AUTO_ADD_KEY) === "true";
  } catch {
    return false;
  }
}

/** 061a: 「エフェクト窓を OBS へ自動反映」ON/OFF を保存する（ローカルのみ・非機密・外部送信しない）。 */
export function saveEffectObsAutoAdd(enabled: boolean): void {
  try {
    localStorage.setItem(EFFECT_OBS_AUTO_ADD_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 061a レビュー（Q-1）: 次にエフェクト窓が開いたときにセットアップ用ガイドを出すか（ワンショット旗）。
 * ⚠ **未保存＝false**（＝起動時の窓復元では出ない）。旗の設計意図は `EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc。
 */
export function loadEffectOverlayGuidePending(): boolean {
  try {
    return localStorage.getItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 061a レビュー（Q-1）: 上記の旗を立てる／倒す。
 *
 * ⚠⚠ **061k で 061i 申し送り §9 の残骸を返済した。** ここは長らく
 * 「立てるのは `ObsEffectsScreen` の**旧トグル ON（明示操作）だけ**」と**現在形で**書いていたが、
 * **そのトグルは 061i で廃止済み**である（同キーの JSDoc は正しく「061i で起点が移った」と
 * 書いてあったのに、この関数側だけが取り残されていた）。
 * ⚠ **いまの起点は「ウィンドウが停止中のときに『配信画面でテスト表示』を押したとき」だけ**
 * （`EffectTemplateCard`）。⚠ **条件を編集して窓が自動で開いたときは立てない**
 * ——立てると条件を 1 つ足すたびにガイドが数十秒 OBS へ映る。
 * ⚠ 倒すのは `EffectOverlayApp` のマウント時（**2 窓とも**倒す＝旗は窓ごとに分けていない）。
 * ⚠ 書けない環境（プライベートモード等）では旗が立たず**ガイドが出ないだけ**＝配信画面は汚さない側に倒れる。
 */
export function saveEffectOverlayGuidePending(pending: boolean): void {
  try {
    localStorage.setItem(EFFECT_OVERLAY_GUIDE_PENDING_KEY, String(pending));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 061b/061h: **テスト表示の合図を出す**（main 窓のテンプレート行のボタンから呼ぶ）。
 *
 * ⚠⚠ **書くのは nonce と `templateId` だけ**（第三者のデータは 1 バイトも載せない・
 * §9 の判断の全文は `EFFECT_TEST_FIRE_KEY` の JSDoc）。
 * ⚠ **毎回必ず違う値**にする（同値の `setItem` では `storage` イベントを飛ばさない実装があるため）。
 * `Date.now()` は同一ミリ秒で衝突しうるので、プロセス内カウンタを併記して単調に増やす。
 * ⚠ **区切りは `:` 1 文字**——nonce（数字とハイフン）にも uuid にも `:` は現れないので、
 * 受け手は「最初の `:` の後ろ」を取れば必ず id になる。
 * ⚠ **ここでは id の形を検査しない**（呼び出し元は一覧の record から渡すので細工の余地が無い）。
 * 検査するのは**受け取る側**＝ localStorage を他窓から書かれうるエフェクト窓のほう。
 */
let testFireSeq = 0;
export function requestEffectTestFire(templateId: string): void {
  try {
    testFireSeq += 1;
    localStorage.setItem(
      EFFECT_TEST_FIRE_KEY,
      `${Date.now()}-${testFireSeq}:${templateId}`,
    );
  } catch {
    // 書けない環境では**テストボタンが効かないだけ**（本番の発火は WS 直結なので影響しない）。
  }
}

/**
 * 061i（判断 4）: **窓が停止中のときのテスト表示を「次に開く窓」へ渡す**（ワンショット旗を立てる）。
 *
 * ⚠ 呼ぶのは `EffectTemplateCard` の **`effectWindowOpen === false` のときだけ**。
 * ⚠⚠ **窓が開いているときに呼ばないこと**（残骸になる。理由は `EFFECT_TEST_FIRE_PENDING_KEY` の JSDoc）。
 * ⚠ **窓を開く invoke より先に書く**（窓のマウントは invoke の解決より後なので順序は保証されるが、
 * その保証に依存しないため先に書く＝`saveEffectOverlayGuidePending` と同じ作法）。
 * ⚠ 書けない環境（プライベートモード等）では**テスト表示が出ないだけ**で、配信画面は汚さない側に倒れる。
 */
export function saveEffectTestFirePending(templateId: string): void {
  try {
    localStorage.setItem(EFFECT_TEST_FIRE_PENDING_KEY, templateId);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 061i（判断 4）: **保留中のテスト表示を受け取り、同時に消す**（`EffectOverlayApp` のマウント時に 1 回）。
 *
 * ⚠⚠ **`load*` ではなく `take*` にしてあるのは「読むと消える」ことを呼び出し側に見せるため。**
 * このファイルの他の `load*` はすべて副作用が無く、旗を倒すのは
 * `saveEffectOverlayGuidePending(false)` という**別の呼び出し**である。同じ顔で片方だけ消すと、
 * 「もう一度読めば同じ値が返る」と誤読されて **2 回発火する**実装を招く。
 * ⚠ **読んだら必ず消すこと**——消さないと**窓を開くたびに同じエフェクトが出る**
 * （＝無操作で配信画面へ出る経路になる）。
 * ⚠ **値の形はここでは検査しない**（検査するのは受け取って使う `EffectOverlayApp` 側＝
 * `isEffectTemplateId`。正規表現の持ち主を増やさないため。`requestEffectTestFire` と同じ役割分担）。
 */
export function takeEffectTestFirePending(): string | null {
  try {
    const raw = localStorage.getItem(EFFECT_TEST_FIRE_PENDING_KEY);
    // ⚠ 無いときに `removeItem` を呼ばない（`storage` イベントを他窓へ撒かないため）。
    if (raw !== null) localStorage.removeItem(EFFECT_TEST_FIRE_PENDING_KEY);
    return raw;
  } catch {
    return null;
  }
}

/**
 * 061k: [`saveEffectTestFirePending`] のステージ窓版（完全に同型）。
 * ⚠ 呼ぶのは `EffectTemplateCard` の **ステージ窓が停止中のときだけ**。
 * ⚠⚠ **コーナー側とは独立に判定すること**——「コーナーは開いているがステージは停止中」で
 * 片方だけ旗が要る、が通常の状態である。
 */
export function saveStageTestFirePending(templateId: string): void {
  try {
    localStorage.setItem(STAGE_TEST_FIRE_PENDING_KEY, templateId);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 061k: [`takeEffectTestFirePending`] のステージ窓版（完全に同型）。
 *
 * ⚠⚠ **各窓は「自分の旗」だけを take すること。相手の旗を消してはいけない。**
 * 消すと「片方の窓が先にマウントして両方の旗を食う」＝**もう片方が無反応**になり、
 * 判断 8（テスト表示は 2 窓とも出す）が黙って半分だけ効く状態になる。
 */
export function takeStageTestFirePending(): string | null {
  try {
    const raw = localStorage.getItem(STAGE_TEST_FIRE_PENDING_KEY);
    // ⚠ 無いときに `removeItem` を呼ばない（`storage` イベントを他窓へ撒かないため）。
    if (raw !== null) localStorage.removeItem(STAGE_TEST_FIRE_PENDING_KEY);
    return raw;
  } catch {
    return null;
  }
}

/**
 * 060d: テーマ id として受け入れる形（uuid v4）。
 *
 * ⚠ **Rust 側と対になっている**——id を採番するのは `overlay_theme::service` の `Uuid::new_v4()` だけで、
 * 保存先を組み立てる `is_managed_file_name()` も `<uuid v4>.css` の完全一致を要求している。
 * ここで形を検査しておくと、細工された localStorage 値がそもそもコマンドまで届かない
 * （届いても Rust が `NotFound` を返すだけなので多層防御の 1 枚目という位置づけ）。
 * ⚠ **再修正トリガー＝ Rust の id 採番方式を変えるとき**（変えるとテーマが黙って適用されなくなる）。
 */
const OVERLAY_THEME_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 060d: 選択中テーマ id を読み込む。**未保存・不正な形・例外はすべて `null`（＝既定意匠）**へ倒す。
 *
 * ⚠ 失敗を `null` に倒すのは fail-safe。id が読めないときに「前のテーマを当て続ける」経路が無いので、
 * 壊れた状態からは必ず StreamDock の既定意匠に戻る。
 */
export function loadOverlayTheme(): string | null {
  try {
    const raw = localStorage.getItem(OVERLAY_THEME_KEY);
    return raw !== null && OVERLAY_THEME_ID_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 060d: 選択中テーマ id を保存する（ローカルのみ・外部送信しない）。**`null` はキーごと削除**。
 *
 * ⚠ 削除にしているのは「未保存＝既定」と「既定を選んだ」を同じ状態に潰すため（分岐を増やさない）。
 * 他窓（オーバーレイ窓）には `removeItem` でも `storage` イベントが飛ぶので、即時反映の経路は同じ。
 */
export function saveOverlayTheme(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(OVERLAY_THEME_KEY);
    else localStorage.setItem(OVERLAY_THEME_KEY, id);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する（表示は継続できる）。
  }
}
