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
 * 066: **チャットへの書き込みを許可する**トグル（⚠⚠ **既定 OFF**・値は `"1"` のみ）。
 *
 * ⚠⚠⚠ **これは同意であって、壁ではない。** 壁は sidecar 側のチケット照合
 * （`chat-send/chat-send-frame.ts`）で、そちらが未認証の loopback WS からの投稿を塞いでいる。
 * ⚠ **このキーを見て送信を止める判断は frontend 側だけの話**なので、
 * 「これがあるから安全」と読まないこと。
 * ⚠ OFF は**キーごと削除**する（「未保存＝OFF」と「明示的に OFF」を潰す）。
 */
export const CHAT_SEND_ENABLED_KEY =
  "stream-dock.comment-viewer.chat-send-enabled";
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
 * ⚠⚠⚠ **064 レビュー S-6: `EFFECT_OVERLAY_ENABLED_KEY`（コーナー窓を出すかの派生値）を削除した。**
 *
 * 061a〜061k のあいだ、この旗は「`output === "corner"` の条件が 1 件以上あるか」を表し、
 * 書き手は `useEffectTemplates`・読み手は `effectOverlayRestore` / `CommentViewerApp` だった。
 * ⚠ **064d でコーナー窓（`effect-overlay`）を窓ごと廃止**し、書き手も読み手も同時に消えたのに、
 * **キーと `load*` / `save*` だけが残っていた**（呼び手ゼロのまま `grep` に出続ける状態）。
 * ⇒ 064d の削除の取りこぼしとして回収する。
 *
 * ⚠ 旧キーの値は localStorage に残りうるが、**読み手が 1 人も居ない**ので無害
 * （§9 の一括削除・エクスポートの対象は 1 本減った。`EFFECT_OBS_AUTO_ADD_KEY` と同じ扱い）。
 * ⚠ ステージ窓ぶんは [`STAGE_OVERLAY_ENABLED_KEY`] が持っており、**そちらは現役**である。
 */
/**
 * 061k / **064d**: **ステージ演出窓（label `stage-overlay`）を出すかの旗**（既定 OFF・値は `"true"` / `"false"`）。
 *
 * ⚠⚠ **064d で意味が変わった**——旧「`output === "stage"` の条件が 1 件以上あるか」（派生値）→
 * 新「**いま配信イベントでステージ窓を使っているか**」（開催状態の写し）。
 * 派生値の計算元だった `useEffectTemplates` が 064d で消えたための移設である。
 *
 * ## ⚠⚠⚠ このキーは `docs/security.md` §1（044a 例外）を守るガードの**片方**である
 *
 * 064e で「OBS へ自動で反映」トグルを削除した結果、**OBS へ繋ぐかどうかを決めているのはこの旗だけ**に
 * なった。§1 の 064e 追補は「**旗 true ＝ ユーザーが『開始』ボタンを押した**」という**同値**を根拠に
 * しているので、⚠⚠ **その同値を壊す書き方をしないこと。**
 *
 * - **書き手は `ObsEffectsScreen` だけ**（`grep -rn "saveStageOverlayEnabled" src` で確認できる）。
 *   ⚠⚠ **契機は 3 種類・呼び出しは 4 か所**である（§1 の 063c 追補で数え方を揃えた。
 *   旧記述の「3 か所」は種類を数えていて、`grep` の件数と一致していなかった）:
 *   ①`handleStartRound`（開始 → true）②`handleEndRound`（終了 → false）
 *   ③⚠⚠ **064 レビュー S-1 で足した 2 つの掃除**（期限切れ tick ／ マウント時の取り残し修復 → false）。
 *   ⚠ ③が無いと「**終了を押さずに時間切れ**」で旗が永久に true のまま残り、
 *   **再起動時に無操作でステージ窓が復元され OBS へ繋ぐ**（＝上の同値が偽になる）。
 * - **読み手は [`isStageOverlayRequired`]（`screens/obs-effects/stageOverlayGuard.ts`）だけ**である。
 *   ⚠⚠ **063c 段 1 で読み手を 1 本に集約した**——旧: `effectOverlayRestore` と `CommentViewerApp` が
 *   それぞれこの `load*` を直に呼んでいた。旗が 2 本になったので、**どちらも同じ 1 本のガードを通す**
 *   （＝ §1 が「ガードは 1 つの関数」と指せる状態を保つ）。
 *
 * ## ⚠⚠⚠ 063c 段 1: **旗は 2 本になった。ここへ相乗りさせないこと。**
 *
 * ガチャ演出ぶんは [`GACHA_STAGE_ENABLED_KEY`] が持つ。⚠ **共用してはいけない**（実害が 2 つある）:
 *   1. 上の旗を `false` へ倒す呼び出しが 3 か所ある（終了／期限切れ tick／マウント時の取り残し修復）ので、
 *      **配信イベントを終えるとガチャ演出が黙って止まる**。
 *      ⚠ **063c 段 1 レビュー S-2（訂正）: ここは「掃除 3 経路」と書いていた。**
 *      同じ回で「**契機は 3 種類・呼び出しは 4 か所**」へ数え方を揃えたばかりなのに、
 *      **「掃除」を「`false` を書く 3 経路の総称」という第 3 の意味で使っていた**
 *      （上の①〜③では「掃除」＝3 契機のうちの 1 つ）。⇒ **語ではなく機能で書く。**
 *   2. マウント時の取り残し修復は `round === null` で発火するので、
 *      **`obs-effects` 画面を開くたびにガチャ用の旗が消える**。
 * ⚠ `ObsEffectsScreen` の取り残し修復 JSDoc が「再修正トリガー＝旗の書き手が 3 か所目を持ったとき、
 * 開催キーからの派生値に寄せるかを決め直すこと」と書いていたが、**063c 段 1 の答えは「寄せない」**である
 * ——2 本の旗は**意味も寿命も違う**（開催中だけ／ユーザーが OFF にするまで）。
 *
 * ⚠ **旧ビルドへ戻したときはこのキーが誰にも読まれないだけ**（ステージ窓は開かない＝安全側）。
 */
export const STAGE_OVERLAY_ENABLED_KEY =
  "stream-dock.comment-viewer.stage-overlay-enabled";
/**
 * 063c 段 1: **ガチャの演出を配信画面（ステージ窓）に出すかの明示トグル**
 * （既定 OFF・値は `"true"` / `"false"`）。
 *
 * ## ⚠⚠⚠ これは `docs/security.md` §1（044a 例外）を守るガードの**もう片方**である
 *
 * §1 の **063c 追補**が正。要点だけ再掲する:
 *
 * - ⚠⚠ **`true` にしてよいのはユーザーの明示操作のときだけ**（[`GachaLibraryCard`] のトグル）。
 *   ⚠⚠⚠ **「ガチャを条件に割り当てたら自動で ON」は作らないこと**——それは 061i にあり
 *   **064d が hook（`useEffectTemplates`）ごと削除**した形で、064c も
 *   「画面を開くだけで OBS へ TCP 接続を張る」として**意図的に却下**している。
 * - ⚠⚠ **常設である**（開催状態の写しである [`STAGE_OVERLAY_ENABLED_KEY`] と**寿命が違う**）。
 *   ⇒ ON のまま再起動すると `effectOverlayRestore` が窓を復元し OBS へ繋ぐ。
 *   ⚠ これは 044a が comments / pinned に既に認めている形と**同型**である
 *   （[`OBS_AUTO_ADD_KEY`] / [`PINNED_OVERLAY_ENABLED_KEY`]。「毎回 ON にし直させると
 *   配信開始時に OBS ソースが取り込めない窓なし状態から始まる」という同じ理由）。
 * - ⚠⚠⚠ **この旗だけでは窓は開かない。** [`isStageOverlayRequired`] が
 *   **「旗 true」かつ「ガチャを指す条件が 1 件以上ある」**の連言を取る。
 *   ⚠ **連言は接続を増やす方向へは決して働かない**（明示操作なしに true にならない）ので、
 *   064d が消した派生値の復活には当たらない。⚠ 副次的に
 *   **「条件からガチャの割り当てを全部外したら接続が残り続けない」**も満たす。
 *   ⚠⚠ **063c 段 1 レビュー S-7（訂正）: 「割り当てを全部消したら」は言い過ぎだった**
 *   （**ガチャ本体を一覧から消しても条件は残る**ので、参照切れの条件だけで連言は true のまま）。
 *   詳細と再修正トリガーは [`isStageOverlayRequired`] の JSDoc が正。
 * - ⚠ **`false` にする契機を減らさないこと**（旗が残ると次回起動時に無操作で OBS へ繋ぐ）。
 *
 * ⚠ **旧ビルドへ戻したときはこのキーが誰にも読まれないだけ**（ステージ窓は開かない＝安全側）。
 * ⚠ **§9**: 値は `"true"` / `"false"` の 2 値のみ＝**非機密**（一括削除・エクスポートの対象が 1 本増えた）。
 */
export const GACHA_STAGE_ENABLED_KEY =
  "stream-dock.comment-viewer.gacha-stage-enabled";

/**
 * ⚠⚠⚠ **063c 段 4-a: `GACHA_SPIN_MS_KEY`（抽選中の長さ）を削除した。**
 *
 * 依頼者の指示＝「**ガチャを回す速度の設定はいらない。常にデフォルトで良い。
 * この設定値を変えることによるメリットが配信者になく、逆に項目が増えることで画面が複雑になってしまっている**」。
 * ⚠ 長さは [`GACHA_SPIN_MS`]（`gachaStagePlayback.ts`）の定数になった。
 *
 * ⚠⚠ **既に保存されている `stream-dock.comment-viewer.gacha-spin-ms` は読まれないまま残る。**
 * 消す仕組みは作らない（**非機密の数値 1 つ**で、移行スクリプトを 1 本作るほうが害が大きい）。
 * ⚠ 一括削除・エクスポートを作るときは、**このキーが残っている端末がある**ことだけ覚えておくこと。
 */

/**
 * ⚠⚠ **063c 段 4-c: ガチャ演出を配信画面のどこへ出すか。**
 *
 * ## ⚠ これは**ガードではない**（[`GACHA_STAGE_ENABLED_KEY`] と混同しないこと）
 *
 * 隣に並ぶ 2 本の旗は `docs/security.md` §1（044a 例外）を守るガードだが、
 * ⚠⚠ **このキーは「見た目の位置」だけ**で、**OBS へ繋ぐかどうかに 1 ミリも関与しない**。
 * ⇒ `isStageOverlayRequired()` は**このキーを読まない**（読ませないこと＝ガードの入力を増やさない）。
 *
 * ⚠⚠⚠ **自由座標にしていない理由**＝ ①座標入力は「範囲外を打たれたとき」の受け皿が要り、
 * **063a-2 が捨てられた「フォーム側が補正される」形**を新しく作ることになる
 * ②**OBS 側でソースそのものを動かせる**ので、自由座標は二重管理になる。
 *
 * ⚠ §9: 値は **3 つの id のどれか**で、第三者データは 1 バイトも載らない。
 */
export const GACHA_PLACEMENT_KEY = "stream-dock.comment-viewer.gacha-placement";

/** 063c 段 4-c: 配置の id（⚠ **保存される文字列そのもの**なので、変えると既存の設定が既定へ倒れる）。 */
export type GachaPlacement = "left" | "center" | "right";

/** 063c 段 4-c: 選べる配置（⚠ **表示の並び順がそのまま画面の並び**）。 */
export const GACHA_PLACEMENTS: readonly {
  id: GachaPlacement;
  label: string;
}[] = [
  { id: "left", label: "左寄せ" },
  { id: "center", label: "中央" },
  { id: "right", label: "右寄せ" },
];

/** 063c 段 4-c: 既定の配置。⚠ **中央**＝段 3 までの見え方（設定を足しただけで絵が動かない）。 */
export const GACHA_PLACEMENT_DEFAULT: GachaPlacement = "center";

/**
 * ⚠⚠ **063c 段 4-b / 段 5-e: 景品名の文字色。**
 *
 * ## ⚠⚠⚠ **段 5-e で「6 択の id」から「自由な色」へ変えた**
 *
 * 依頼者の指示＝「**色はユーザーが指定できるようにするべき。例えばカラーパレットが出せるなら
 * それが最も UX が良い**」。⇒ 保存するのは **`#rrggbb` の 16 進 6 桁だけ**である。
 *
 * ## ⚠⚠ 段 4-b が id を保存していた理由の**片方は、いまも守られている**
 *
 * 守っているもの＝「**localStorage の中身が `style` へそのまま届く経路を作らない**」。
 * ⚠⚠⚠ **[`parseGachaPrizeColor`] を通らない値は 1 バイトも `style` へ行かない**し、
 * 通る値の文法は **`#` ＋ 16 進 6 桁**だけで、`url(…)` も `var(…)` も `;` も**表現できない**
 * （＝ CSS 値の注入が成立しない）。⚠ **読む側も書く側も、必ずこの関門を通すこと。**
 *
 * ⚠⚠ **捨てたのはもう片方**＝「選べる色すべてに縁取りとの相性を確認できる」。
 * ⇒ **読めない色（黒など）も選べるようになった。** 依頼者が受け入れた上での変更である。
 * 緩和は 2 つだけ: **既定はゴールド**／**[`GACHA_PRIZE_COLORS`] を見本として画面に並べる**。
 *
 * ⚠⚠ **これは「読めない」の主因ではない。** 主因は**下地と縁取りが無かったこと**で、
 * そちらは CSS 側（`EffectOverlayApp.module.css`）が直している。
 * ⚠⚠⚠ **色だけ足して縁取りを外さないこと**——外すと**どの色を選んでも背景次第で負ける**。
 *
 * ⚠ §9: 値は **色 1 つ**で、第三者データは 1 バイトも載らない（＝非機密の表示設定）。
 */
export const GACHA_PRIZE_COLOR_KEY =
  "stream-dock.comment-viewer.gacha-prize-color";

/**
 * 見本の色の id。
 *
 * ⚠⚠ **段 5-e 以降、これは「保存される値」ではない。** 保存されるのは色そのもの（`#rrggbb`）で、
 * この id が残っているのは **段 4-b で保存された古い値を移行するため**である
 * （[`parseGachaPrizeColor`] の後半）。⚠ **新しい id を足しても保存形は変わらない。**
 */
export type GachaPrizeColorId =
  "gold" | "white" | "sky" | "pink" | "lime" | "orange";

/**
 * 063c 段 4-b / 段 5-e: **見本の色**（＝設定画面に並べるプリセット）。
 *
 * ⚠⚠ **`css` に生の hex が書いてあるのはここだけ**である。
 * `EffectOverlayApp.module.css` は「生 hex / rgba() を書かない（`theme.css` のトークンのみ）」を
 * 守っており、⚠ **この表の値は CSS 変数 `--gacha-prize-color` 経由で流し込む**。
 * ⚠⚠⚠ **`theme.css` のトークンを使わない理由**＝ あれは**アプリ画面の明暗に追従する**ので、
 * **配信画面（背景が視聴者ごとに違う透過窓）では意味が変わってしまう**
 * ——実際に段 3 までの `--accent-text` が**金の光に負けて読めなかった**のがその実例である。
 * ⇒ **配信画面の色は、アプリのテーマから独立させる。**
 *
 * ⚠ どれも**縁取り（濃い影）と組み合わせる前提**で選んである（明度が高い色に寄せてある）。
 * ⚠⚠ **段 5-e 以降、この表は「選べる色の全部」ではなく「押せば入る見本」**である
 * （自由入力があるので、ここに無い色も保存されうる）。
 */
export const GACHA_PRIZE_COLORS: readonly {
  id: GachaPrizeColorId;
  label: string;
  css: string;
}[] = [
  { id: "gold", label: "ゴールド", css: "#ffd76a" },
  { id: "white", label: "ホワイト", css: "#ffffff" },
  { id: "sky", label: "スカイブルー", css: "#7fd4ff" },
  { id: "pink", label: "ピンク", css: "#ff9ecb" },
  { id: "lime", label: "ライム", css: "#b6f36a" },
  { id: "orange", label: "オレンジ", css: "#ffab5c" },
];

/**
 * 063c 段 5-e: **受け付ける色の文法**（⚠⚠⚠ **これが唯一の関門である**）。
 *
 * ⚠ `#` ＋ 16 進 6 桁のみ。⚠⚠ **3 桁（`#fff`）も 8 桁（透明度つき）も受けない**——
 * 受ける形を増やすほど「`style` に入りうる文字列の集合」が広がるし、
 * **透明度は演出の読みやすさを黙って壊す**（薄い色を選べてしまう）。
 */
const GACHA_PRIZE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** 063c 段 5-e: 既定の文字色。⚠ **ゴールド**＝演出の金の光と喧嘩せず、縁取りと合わせて最も読める。 */
export const GACHA_PRIZE_COLOR_DEFAULT = "#ffd76a";
/**
 * ⚠⚠⚠ **064e: `EFFECT_OBS_AUTO_ADD_KEY`（エフェクト窓を OBS へ自動反映する ON/OFF）を削除した。**
 *
 * 依頼者の指示＝「**OBS に自動で反映はデフォルト機能にします**」。
 * ⇒ ステージ窓の OBS 追加は**配信イベントを開始したら必ず走る**（`CommentViewerApp` の
 * `STAGE_OVERLAY_ENABLED_KEY` 分岐と WS 接続時 reconcile が無条件になった）。
 * ⚠⚠ **明示操作が 2 段（トグル ＋ 開始）から 1 段（開始）になった**＝
 * `docs/security.md` §1 の 044a 例外に対する姿勢変更で、**§1 に 064e 追補がある**。
 *
 * ⚠ **044a の [`OBS_AUTO_ADD_KEY`]（コメント一覧＋固定コメント用）は残っている。**
 * あちらは**常設のオーバーレイ窓**が対象で、「開始ボタン」のような明示操作に紐づいていないため、
 * 同じ理屈で既定 ON にはできない（＝ 061a が 2 キーに分けた判断は、片方が消えた形で決着した）。
 *
 * ⚠ 旧キーの値は localStorage に残りうるが、**読み手が 1 人も居ない**ので無害
 * （§9 の一括削除・エクスポートの対象は 1 本減った）。
 */
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
 * **書き手＝明示操作だけ**（⚠ **061i で起点が移り、064d でさらに移った**。下記）。
 * **読み手＝`EffectOverlayApp`** で、マウント時に読み、直後に false へ倒す（次に開くときは出ない）。
 * 起動時の窓復元（`App.tsx`）は**この旗を立てない**ので、復元経路ではガイドが出ない。
 *
 * ## ⚠⚠⚠ 063c 段 1: 起点が **2 つ**になった
 *
 * `ObsEffectsScreen` の **①`handleStartRound`（配信イベントの開始）**と
 * **②`handleGachaStageToggle`（「ガチャの演出を配信画面に出す」を ON）**。
 * ⚠ **どちらも「明示操作で窓を開くとき」**なので、下の Q-1 の規律をそのまま満たしている。
 * ⚠⚠ **`docs/security.md` §1 の 044a 例外が認める明示操作の集合と 1 対 1 で対応している**
 * （＝ 旗を立てる場所が増えたら、それは §1 の追補が要る変更である、という対応関係）。
 * ⚠ **`isStageOverlayRequired()` が true になる契機と混同しないこと**——
 * あちらは AND ゲート（条件が 0 件なら false）を含むが、**ガイド旗は明示操作だけで立つ**。
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
 * ⚠⚠⚠ **064 レビュー S-6: テスト発火まわりの 3 キーを削除した**
 * （`EFFECT_TEST_FIRE_KEY` / `EFFECT_TEST_FIRE_PENDING_KEY` / `STAGE_TEST_FIRE_PENDING_KEY`）。
 *
 * 3 本とも**唯一の書き手が `EffectTemplateCard`**（＝「配信画面でテスト表示」）で、
 * **唯一の読み手が `EffectOverlayApp` のテンプレート描画**だった。
 * ⚠ **064d でテスト表示ごと削除**され、書き手も読み手も同時に消えたが、
 * **キーと `request*` / `save*` / `take*` の 5 関数だけが残っていた**（呼び手ゼロ）。
 * ⇒ 064d の削除の取りこぼしとして回収する。
 *
 * ⚠ 064 以降の「手動で 1 回出す」は **OBS 側のソースを鳴らす経路**（[`OBS_SOURCE_TEST_FIRE_KEY`]）
 * が担っており、**localStorage 経由という形だけが引き継がれている**（値の形も宛先も別物）。
 * ⚠ 旧キーの値は残りうるが読み手ゼロで無害（§9 の対象は 3 本減った）。
 */
/**
 * 064a: **鳴らせる OBS ソースの一覧**（コメビュ窓 → main 窓）。
 *
 * ⚠⚠ **なぜ localStorage 経由なのか**: OBS へ繋いでいるのは **sidecar と WS で繋がっているコメビュ窓だけ**で、
 * main 窓は WS ハンドルを持たない（`ObsEffectsScreen` の JSDoc が「**構造として**そうならざるを得ない」と
 * 書いているとおり）。⇒ **061a が予告していた再修正トリガー**
 * 「**main 窓でも結果を見たくなったら、コメビュ窓が localStorage へ書くキーを足す**」が
 * 064a で発火した、というのが本キーの位置づけである。
 *
 * 値は `{"at":<epoch ms>,"ok":<boolean>,"sources":[{"name":…,"kind":…}]}` の JSON。
 * ⚠ **`at` を入れるのは「いつ時点の一覧か」を画面に出すため**（古い一覧を新しいものと誤認させない）。
 * ⚠⚠ **064c で `ok` が増えた**——「OBS へ繋がらなかった」と「繋がったが 0 件」は
 * **画面での案内が正反対**になるため（[`ObsSourceListSnapshot`] の JSDoc が正）。
 *
 * ⚠ §9: 載るのは**ユーザー自身が OBS で付けたソース名と種別**だけである（ファイルパスも設定値も
 * sidecar 側で落としている）。第三者の個人データは 1 バイトも入らない。
 * ⚠ **一括削除・エクスポートを作るときの対象が 1 本増えた。**
 */
export const OBS_SOURCE_LIST_KEY = "stream-dock.comment-viewer.obs-source-list";
/**
 * 064a: **一覧を取り直してほしい**（main 窓 → コメビュ窓）。値は nonce だけ。
 *
 * ⚠ `EFFECT_TEST_FIRE_KEY` と同じ idiom（**値を変えて `storage` を撒く**）。
 * ⚠ 伝達は `storage` イベント＝**別 webview 間ではベストエフォート**。届かなくても壊れ方は
 * 「**更新ボタンが効かない**」という観測可能なものに留まる。
 */
export const OBS_SOURCE_LIST_REQUEST_KEY =
  "stream-dock.comment-viewer.obs-source-list-request";
/**
 * 064a: **このソースを 1 回鳴らしてほしい**（main 窓 → コメビュ窓）。
 * 値は `<nonce>:<durationMs>:<sourceName>`。
 *
 * ⚠⚠ **ここに載るソース名を「検証済み」と読まないこと。** localStorage は**他窓からも書ける**ので、
 * 読み手（コメビュ窓）は受け取った文字列をそのまま sidecar へ流すだけであり、
 * **実際の壁は sidecar 側の 2 枚**（形式検査 ＋ `GetInputList` との実在照合）である。
 * ⚠ この向きは `EFFECT_TEST_FIRE_PENDING_KEY` が「値を `isEffectTemplateId()` で検証してから使う」
 * と書いているのと**同じ姿勢**（localStorage を信用しない）で、検証の場所が sidecar なだけである。
 *
 * ⚠ §9: 載るのは**ユーザー自身が OBS で付けた名前**だけ。
 */
export const OBS_SOURCE_TEST_FIRE_KEY =
  "stream-dock.comment-viewer.obs-source-test-fire";
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
 * ⚠⚠⚠ 063e 段 3: **最近届いたチャンネルポイント報酬の名前**（新しい順・最大
 * [`CHANNEL_POINT_REWARDS_MAX`] 件）。⚠ **設定ではなく観測値**である。
 *
 * ## ⚠⚠ なぜ要るのか（＝ 依頼者の「極力画面操作は少なく」への答え）
 *
 * エフェクト画面の「チャンネルポイント」ブロックには、**カスタム報酬ごとの行**が並び、
 * 各行に**対象の報酬名**を打つ欄がある（`effectAssignments.ts` の `when.rewardTitle`）。
 * ⚠ 段 3 はここが「条件表の『チャンネルポイント』行の下に開く絞り込み欄」だったが、
 * **段 3-b で行の形へ、段 3-c で唯一の入口へ変わった**（書き戻さないこと）。
 * ⚠⚠⚠ **打ち間違えると黙って鳴らない**ので、
 * **実際に届いた報酬名をそのまま押せる**形にした。⇒ 操作は「チップを 1 回押すだけ」になる。
 *
 * ⚠ **書き手はコメビュ窓、読み手は main 窓の割り当て画面**である
 * （[`OBS_SOURCE_LIST_KEY`] とまったく同じ非対称——sidecar と繋がっているのはコメビュ窓だけ）。
 * 伝達は `storage` イベント＝**別 webview 間ではベストエフォート**。届かなくても壊れ方は
 * 「**チップが増えるのが次に画面を開いたときになる**」に留まる（手入力は常に効く）。
 *
 * ## ⚠⚠ プルダウンにしなかった理由（＝ Twitch から一覧を取らない理由）
 *
 * 報酬一覧は Helix で取れるが、**接続していないとき・他人のチャンネルに繋いでいるときに空になる**
 * ——⚠⚠⚠ **設定したい場面でちょうど使えない**。⇒ 一覧は取らず、
 * **手入力を主・届いた名前を補助**にした（`REWARD_TITLE_MAX_LENGTH` 側の注記も参照）。
 * ⚠ 副産物として **Helix の新エンドポイントを 1 つも増やしていない**（新規 egress ゼロ）。
 *
 * ## §9
 *
 * ⚠⚠ 載るのは **`reward.title`＝配信者自身が Twitch で付けた名前**だけである。
 * ⚠ **引き換えた視聴者の名前も本文（`user_input`）も 1 バイトも載せない**——
 * あちらは第三者データで、載せた瞬間に「コメント本文が localStorage に残る」ことになる。
 * ⚠ **一括削除・エクスポートを作るときの対象が 1 本増えた。**
 */
export const CHANNEL_POINT_REWARDS_KEY =
  "stream-dock.comment-viewer.channel-point-rewards";
/**
 * 063d: **名前付きのガチャの一覧**（`GachaDefinition[]`）の保存キー。
 *
 * ⚠⚠⚠ **[`EFFECT_ASSIGNMENTS_KEY`] と分けてある理由＝あちらは「条件が空になるとキーごと削除される」**
 * （`saveEffectConditions`）。1 本にまとめると **条件を全部消しただけでガチャまで消える**。
 * ⚠ **1 本にしないこと**（063d 穴 S）。
 *
 * ⚠ 中身は**ユーザー自身の UI 設定値**だけ（ガチャ名・景品名・重み・OBS のソース名）で、
 * §9 追補（046a）が対象とする第三者の個人データ（コメント本文・表示名・金額）は 1 バイトも入らない。
 * ⚠⚠ **抽選履歴・当選者は保存しない**（063a から継承・テスト抽選の結果は窓の state のみ）。
 * ⚠ 読み書きのロジックは `screens/obs-effects/effectAssignments.ts` が持つ——ここに置くのは**キーだけ**。
 *
 * ## ⚠⚠ レビュー Q-7: **接頭辞が `obs-effects` なのは既存 8 本への意図的な例外である**
 *
 * すぐ上の [`EFFECT_ASSIGNMENTS_KEY`] の JSDoc は「⚠⚠ 接頭辞が `comment-viewer` なのは既存 8 本と
 * 揃えるため（**`obs-effects.*` という 2 つ目の名前空間を作らない**）」と書いている。
 * ⚠ **本キーはその規約の初めての例外**で、**黙って破ったわけではない**ことをここに残す。
 *
 * ⚠ **例外にする理由**＝ `comment-viewer.*` は「コメビュ窓が読む値」という括りだが、
 * **ガチャの一覧をコメビュ窓は 1 度も読まない**（063d では発火せず、063b でも読むのは条件の側）。
 * 揃えると「コメビュ窓の設定」という括りのほうが嘘になる。
 * ⚠⚠ **`comment-viewer.*` へ揃え直すなら、まだリリースしていない今だけが無料**である
 * （後からだとキーの移行コードが要る）。⚠ **再修正トリガー＝`obs-effects.*` が
 * 3 本目・4 本目と増えたとき**——そのときは規約側（[`EFFECT_ASSIGNMENTS_KEY`] の JSDoc）を
 * 「窓ではなく画面で分ける」へ書き換え、既存 8 本の扱いも併せて決めること。
 *
 * ⚠ **宣言をこの位置（`EFFECT_ASSIGNMENTS_KEY` の後ろ）から動かさないこと。**
 * 実装直後は**前**に置いていたため、061d-2 の 22 行の JSDoc が
 * `EFFECT_ASSIGNMENTS_KEY` から切り離されて**どのシンボルにも付かない孤児**になっていた
 * （レビュー Q-7・IDE の hover から設計記録が消えていた）。
 */
export const GACHA_LIBRARY_KEY = "stream-dock.obs-effects.gachas";
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

/* ⚠ 064 レビュー S-6: `loadEffectOverlayEnabled` / `saveEffectOverlayEnabled` を削除した
   （コーナー窓ごと消えて呼び手が 0 になっていた。理由は上の `EFFECT_OVERLAY_ENABLED_KEY` 跡地の JSDoc が正）。 */

/**
 * 061k: ステージ演出窓を出すか（未保存・例外は false へフォールバック）。
 * ⚠ 意味は 064d 以降「**いま配信イベントを開催しているか**」（キーの JSDoc が正）。
 * ⚠⚠ **063c 段 1: 読み手は [`isStageOverlayRequired`] と `ObsEffectsScreen`（⚠ 旗の取り残しを
 * 直すためだけに読む・064 レビュー S-1）の 2 つになった。**
 * 旧: `effectOverlayRestore.ts` / `CommentViewerApp` が直に呼んでいたが、
 * **旗が 2 本になったので、あの 2 者はガード 1 本を通す形へ寄せた**。
 * ⚠⚠ **この false 側フォールバックが §1 の fail-closed 方向である**（読めなければ OBS へ繋がない）。
 */
export function loadStageOverlayEnabled(): boolean {
  try {
    return localStorage.getItem(STAGE_OVERLAY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 061k / 064d: ステージ演出窓を出すかを保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠⚠⚠ **これは `docs/security.md` §1 を守るガードの片方（061l ぶん）の書き手である**（キーの JSDoc が正）。
 * **呼んでよいのは `ObsEffectsScreen` の中だけ**で、⚠ **契機は 3 種類・呼び出しは 4 か所**——
 * ①開始（true）②終了（false）③⚠ **064 レビュー S-1 の掃除 2 つ**（期限切れ／取り残し修復・false）。
 * ⚠⚠ **`true` にしてよいのは「ユーザーが『開始』を押した」瞬間だけ**である。
 * ここを増やすと「開催していないのに OBS へ繋ぐ」＝ §1 の 044a 例外を本当に破る。
 * ⚠ **`false` にする契機を減らさないこと**——旗が残ると、次回起動時に**無操作で OBS へ繋ぐ**。
 * ⚠ 不変条件の確認は `grep -rn "saveStageOverlayEnabled" src` で、
 * 実装側のヒットが本ファイルと `ObsEffectsScreen` の 4 呼び出しに限られること。
 * ⚠⚠ **063c 段 1 でも、この 4 呼び出しは 1 文字も変えていない**（ガチャぶんは別の旗が持つ）。
 */
export function saveStageOverlayEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STAGE_OVERLAY_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 063c 段 1: ガチャ演出を配信画面に出すか（未保存・例外は false へフォールバック）。
 *
 * ⚠⚠ **単独で読んでよいのは [`GachaLibraryCard`]（トグルの現在値の表示）だけ**である。
 * ⚠⚠⚠ **「OBS へ繋いでよいか」の判定にこれを直接使わないこと**——
 * その判定の持ち主は [`isStageOverlayRequired`] 1 本で、あちらは
 * **「ガチャを指す条件が 1 件以上ある」との連言**を取る（§1 の 063c 追補が正）。
 * ⚠⚠ **この false 側フォールバックが §1 の fail-closed 方向である**（読めなければ OBS へ繋がない）。
 */
export function loadGachaStageEnabled(): boolean {
  try {
    return localStorage.getItem(GACHA_STAGE_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * 063c 段 1: 上記を保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠⚠⚠ **これは `docs/security.md` §1 を守るガードのもう片方（063c ぶん）の書き手である。**
 * **呼んでよいのは `ObsEffectsScreen` の中だけ**で、⚠ **呼び出しは 1 か所**
 * （[`GachaLibraryCard`] のトグルから上がってくるハンドラ）。
 * ⚠⚠ **`true` にしてよいのは「ユーザーがトグルを ON にした」瞬間だけ**である。
 * ⚠⚠⚠ **派生値から立てないこと**——「ガチャを条件に割り当てたら ON」は
 * **064d が hook ごと削除した形**であり、064c が明示的に却下した線でもある。
 * ⚠ **`false` にする契機を減らさないこと**——旗が残ると、次回起動時に**無操作で OBS へ繋ぐ**。
 * ⚠ 不変条件の確認は `grep -rn "saveGachaStageEnabled" src` で、
 * 実装側のヒットが本ファイルと `ObsEffectsScreen` の 1 呼び出しに限られること。
 */
export function saveGachaStageEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(GACHA_STAGE_ENABLED_KEY, String(enabled));
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 063c 段 4-c: 配置を読む。⚠ **未保存・未知の id はすべて既定（中央）へ倒す**。
 *
 * ⚠⚠ **「知らない値は既定へ」が唯一の規則**である（`parseGachaPrizeOutput` の未知 `kind` と同じ規律）。
 * ⚠ 倒す先を「左」などにしないこと——**設定した覚えのない位置に出る**のは、中央に出るより分かりにくい。
 */
export function loadGachaPlacement(): GachaPlacement {
  try {
    const raw = localStorage.getItem(GACHA_PLACEMENT_KEY);
    const hit = GACHA_PLACEMENTS.find((p) => p.id === raw);
    return hit?.id ?? GACHA_PLACEMENT_DEFAULT;
  } catch {
    return GACHA_PLACEMENT_DEFAULT;
  }
}

/**
 * 063c 段 4-c: 配置を保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠ **一覧に無い id は保存しない**（読み込み側と同じ 1 つの表を使う＝検査を 2 通りに分けない）。
 * ⚠⚠ **これは §1 のガードではない**ので、`saveGachaStageEnabled` のような
 * 「呼び出しは 1 か所」という不変条件は無い（OBS へ繋ぐかどうかに関与しないため）。
 */
export function saveGachaPlacement(placement: GachaPlacement): void {
  if (!GACHA_PLACEMENTS.some((p) => p.id === placement)) return;
  try {
    localStorage.setItem(GACHA_PLACEMENT_KEY, placement);
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/**
 * 063c 段 5-e: **保存値 → 実際に使ってよい色**。
 *
 * ⚠⚠⚠ **`style` へ届く色は必ずここを通る**（`localStorage` の生の値が直接届く経路は無い）。
 * ⚠ 未保存・壊れた値・古い id はすべて**既定へ倒す**（`undefined` を返さない——
 * 返すと `style` から色ごと消え、**テーマ由来の読めない色へ戻る**＝段 3 までの不具合そのもの）。
 *
 * ⚠⚠ **後半の移行は段 4-b の保存値のためだけに在る**（`"sky"` などの id）。
 * ⚠ 消してよいのは「段 4-b を使ったユーザーがもう居ない」と言い切れるときだけである。
 */
export function parseGachaPrizeColor(raw: string | null): string {
  if (raw === null) return GACHA_PRIZE_COLOR_DEFAULT;
  if (GACHA_PRIZE_COLOR_PATTERN.test(raw)) return raw.toLowerCase();
  const legacy = GACHA_PRIZE_COLORS.find((c) => c.id === raw);
  return legacy?.css ?? GACHA_PRIZE_COLOR_DEFAULT;
}

/** 063c 段 5-e: 景品名の色を読む。⚠ 検査は [`parseGachaPrizeColor`] 1 か所（2 通りに書かない）。 */
export function loadGachaPrizeColor(): string {
  try {
    return parseGachaPrizeColor(localStorage.getItem(GACHA_PRIZE_COLOR_KEY));
  } catch {
    return GACHA_PRIZE_COLOR_DEFAULT;
  }
}

/**
 * 063c 段 5-e: 景品名の色を保存する（ローカルのみ・非機密・外部送信しない）。
 *
 * ⚠⚠⚠ **文法に合わない値は保存しない**（読み込み側と**同じ 1 つの正規表現**を使う＝
 * 検査を 2 通りに分けない）。⚠ 大文字で来ても**小文字に正規化して**入れる
 * （`#FFD76A` と `#ffd76a` が別の保存値になると、見本の選択状態が一致しなくなる）。
 * ⚠ **これは §1 のガードではない**ので、`saveGachaStageEnabled` のような
 * 「呼び出しは 1 か所」という不変条件は無い（OBS へ繋ぐかどうかに関与しないため）。
 */
export function saveGachaPrizeColor(color: string): void {
  if (!GACHA_PRIZE_COLOR_PATTERN.test(color)) return;
  try {
    localStorage.setItem(GACHA_PRIZE_COLOR_KEY, color.toLowerCase());
  } catch {
    // プライベートモード等で書けない場合は黙って無視する。
  }
}

/* ⚠ 064e: `loadEffectObsAutoAdd` / `saveEffectObsAutoAdd` を削除した
   （設定そのものが消えた。理由は上の `EFFECT_OBS_AUTO_ADD_KEY` 跡地の JSDoc が正）。 */

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

/* ⚠ 064 レビュー S-6: テスト発火の 5 関数（`requestEffectTestFire` / `saveEffectTestFirePending` /
   `takeEffectTestFirePending` / `saveStageTestFirePending` / `takeStageTestFirePending`）を削除した
   （テスト表示ごと消えて呼び手が 0 になっていた。理由は上の `EFFECT_TEST_FIRE_KEY` 跡地の JSDoc が正）。 */

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

// --- 064a: OBS のソースを鳴らす方式（main 窓 ⇄ コメビュ窓）-----------------------------------------

/** 064a: 一覧の 1 件。⚠ **名前と種別だけ**（`obs.sources` フレームと同じ形）。 */
export interface ObsSourceEntry {
  name: string;
  kind: string;
}

/**
 * 064b: **OBS が長さを教えてくれなかったときに出しておく時間**（ミリ秒）。
 *
 * ⚠⚠ **これは「エフェクトの長さ」ではない。** 実際の長さは **OBS 側のメディアが持っている**ので、
 * sidecar が `GetMediaInputStatus` で聞いて使う（`resolveObsFireDurationMs`）。
 * ここが効くのは **画像ソース**と、**長さを聞けなかったとき**（未ロード等）だけである。
 *
 * ⚠ **持ち主を 1 か所にするために `features/` へ置いた**——値を使うのは
 * ①064a のテスト発火（main 窓の `ObsSourceCard`）②064b の自動発火（コメビュ窓）の 2 か所で、
 * **どちらも同じ「分からなかったときの長さ」**である。2 か所に書くと片方だけ変わる。
 * ⚠ sidecar 側は受け取った値を必ずクランプする（500〜15000）ので、ここが壊れても消え残らない。
 */
export const OBS_SOURCE_FALLBACK_DURATION_MS = 5000;

let obsSourceSeq = 0;

/** 064a: main 窓から「一覧を取り直して」と頼む。⚠ 失敗しても**ボタンが効かないだけ**。 */
export function requestObsSourceList(): void {
  try {
    obsSourceSeq += 1;
    localStorage.setItem(
      OBS_SOURCE_LIST_REQUEST_KEY,
      `${Date.now()}-${obsSourceSeq}`,
    );
  } catch {
    // 書けない環境では更新ボタンが効かないだけ（本番の発火には影響しない）。
  }
}

/**
 * 064a: main 窓から「このソースを 1 回鳴らして」と頼む。
 * ⚠ **検証はしない**（壁は sidecar 側・キーの JSDoc が正）。ここは値を組むだけ。
 */
export function requestObsSourceTestFire(
  sourceName: string,
  durationMs: number,
): void {
  try {
    obsSourceSeq += 1;
    localStorage.setItem(
      OBS_SOURCE_TEST_FIRE_KEY,
      `${Date.now()}-${obsSourceSeq}:${durationMs}:${sourceName}`,
    );
  } catch {
    // 同上。
  }
}

/**
 * 064a: [`OBS_SOURCE_TEST_FIRE_KEY`] の値を分解する（コメビュ窓が使う）。
 *
 * ⚠ **`sourceName` に `:` が含まれうる**ので、**先頭 2 つの `:` だけで切る**
 * （`split(":")` で全部割ると名前に `:` を含むソースが鳴らせなくなる）。
 * ⚠ 壊れた値は `null`（＝何もしない）。
 */
export function parseObsSourceTestFire(
  raw: string | null,
): { sourceName: string; durationMs: number } | null {
  if (raw === null) return null;
  const first = raw.indexOf(":");
  if (first < 0) return null;
  const second = raw.indexOf(":", first + 1);
  if (second < 0) return null;
  const durationMs = Number(raw.slice(first + 1, second));
  const sourceName = raw.slice(second + 1);
  if (!Number.isFinite(durationMs) || sourceName.length === 0) return null;
  return { sourceName, durationMs };
}

/**
 * 064c: main 窓が読む一覧のスナップショット。
 *
 * ⚠⚠ **`ok` が「OBS へ繋がったか」で、`sources.length` が「鳴らせるものがあるか」である。**
 * この 2 つを混ぜると、OBS が起動していないユーザーへ
 * 「OBS のシーンにソースを追加してください」という**間違った対処**を案内することになる
 * （064a がまさにそうなっていた）。⚠ **どちらか一方で代表させないこと。**
 */
export interface ObsSourceListSnapshot {
  /** いつ時点の一覧か（epoch ms）。⚠ **「取得中」の判定にも使う**（要求時刻より新しければ返事が来た）。 */
  at: number;
  /** `true` ＝ OBS へ繋がって一覧を取れた（**0 件でも `true`**）。 */
  ok: boolean;
  sources: ObsSourceEntry[];
}

/**
 * 064a: コメビュ窓が取れた一覧を main 窓へ渡す。⚠ **保存するのは名前と種別だけ**（§9）。
 * ⚠ 064c: **`ok`（取れたのか）も一緒に書く**（[`ObsSourceListSnapshot`] の JSDoc が正）。
 */
export function saveObsSourceList(
  sources: ObsSourceEntry[],
  ok: boolean,
): void {
  try {
    localStorage.setItem(
      OBS_SOURCE_LIST_KEY,
      JSON.stringify({ at: Date.now(), ok, sources }),
    );
  } catch {
    // 書けない環境では main 窓に一覧が出ないだけ。
  }
}

/**
 * 064a: main 窓が一覧を読む。⚠ **読み取れない・形が違う値はすべて「まだ無い」へ倒す**
 * （localStorage は他窓からも書けるので、形を信用しない＝ `loadEffectConditions` と同じ姿勢）。
 *
 * ⚠⚠ 064c: **`ok` が boolean でなければ `false`**（＝「取れた」と断言しない）。
 * WS 境界（`commentStream.ts`）と**同じ規則をここでも書いている**のは、このキーが
 * **他窓からも書ける**からで、片方だけ緩めると誤案内が戻る経路が 1 本開く。
 */
export function loadObsSourceList(): ObsSourceListSnapshot | null {
  try {
    const raw = localStorage.getItem(OBS_SOURCE_LIST_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { at, ok, sources } = parsed as {
      at?: unknown;
      ok?: unknown;
      sources?: unknown;
    };
    if (typeof at !== "number" || !Array.isArray(sources)) return null;
    return {
      at,
      ok: typeof ok === "boolean" ? ok : false,
      sources: sources.filter(
        (s): s is ObsSourceEntry =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as { name?: unknown }).name === "string" &&
          typeof (s as { kind?: unknown }).kind === "string",
      ),
    };
  } catch {
    return null;
  }
}
