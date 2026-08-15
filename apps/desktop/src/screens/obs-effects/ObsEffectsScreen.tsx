import { useCallback, useEffect, useRef, useState } from "react";
import {
  // ⚠⚠ 064d: この 2 本の**唯一の書き手**がこの画面になった（`handleStartRound` の JSDoc が正）。
  //   ⚠ 064e: `loadEffectObsAutoAdd` / `saveEffectObsAutoAdd` の import を外した
  //     （自動反映が既定になり、**設定そのものが消えた**）。
  //   ⚠⚠ 064 レビュー S-1: `loadStageOverlayEnabled` を足した（**旗の取り残しを直すためだけ**に読む。
  //     下の「旗の掃除」effect が正）。
  loadStageOverlayEnabled,
  saveEffectOverlayGuidePending,
  saveStageOverlayEnabled,
} from "../../features/comment-viewer/overlaySettings";
// ⚠⚠ 061p: **`closeEffectOverlayWindow` / `closeStageOverlayWindow` の import を外した**
//   （前提ステータスの「ウィンドウを閉じる」ごと削除したため。⚠ `windowApi` 側の口と Rust の
//   コマンドは残っている＝呼び手が 1 つも無い状態である。詳細は下の `closeEffectOverlay` 跡地の注記）。
// ⚠ **`detectObsWebsocketConfig` の import も外した**（「OBS の WebSocket」行の消滅に伴う）。
import {
  isCommentViewerOpen,
  openCommentViewerWindow,
  openStageOverlayWindow,
} from "../../features/comment-viewer/windowApi";
// 共通部品の再利用。トグルは `role="switch"` の a11y ごと既製なので、main 窓のために
// 別実装を起こすと**新しい px / weight を発明する**ことになる（061a の要件に反する）。
// ⚠ **061g で移設済み**（発火した再修正トリガーの後始末）。`ToggleSwitch` / `Select` / `ConfirmDialog` は
// `screens/comment-viewer/` ではなく **`components/`** にあり、意匠も `CommentViewerApp.module.css` から
// 切り出して `components/*.module.css` へ移した＝**この画面はもうコメビュ窓の CSS に依存していない**。
// ⚠⚠ **以後は「跨いだら移す」という後追いをしない**——**画面を跨ぐ部品は最初から `components/` に置くこと**
// （docs/task-board.md の 061g に明文化してある）。
// ⚠ 064e: `ToggleSwitch` の import を外した（この画面のトグルは 0 個になった——061i で
//   「配信画面に表示」が、064e で「OBS へ自動で反映」が消えた）。
import { Button } from "../../components/primitives";
// ⚠ 061i: タブ部品は **`components/` に新設**した（061g の規律＝画面を跨ぐ部品は最初からあちらへ。
//   061l で「配信イベント」の一覧／詳細が入ると確実に生き続けるので、ここへ置いて後から移さない）。
import { Tabs, type TabItem } from "../../components/Tabs";
// ⚠ 064d: 取り込み機能ごと `EffectTemplateCard` を削除した。
//   この画面が持っているのは「エフェクト窓が開いているか」という前提ステータスだけなので、
//   停止中の注記を出せるように `effectWindowOpen` をあちらへ渡す。
import { EffectAssignmentCard } from "./EffectAssignmentCard";
// 064a: OBS 側のソースを再生する方式（064d 以降、エフェクトの唯一の出し方）。
// ⚠⚠ 064f: **一覧の状態はこの画面が持つ**（取得ボタンがタイトル行へ移り、カードと 2 か所で読むため）。
import { ObsSourceCard } from "./ObsSourceCard";
import { useObsSourceList } from "./useObsSourceList";
// ⚠ 061l: 「配信イベント」タブの中身（061i から枠だけだった場所）。
//   ⚠⚠ **開催状態はこの画面が持ち、タブへ渡す**（前提ステータスの行と同じ値を出すため・下の JSDoc）。
import { StreamEventTab } from "./StreamEventTab";
import { findStreamEvent } from "../../features/obs-effects/streamEventRegistry";
import {
  clearStreamEventRound,
  loadStreamEventRound,
  saveStreamEventRound,
  startStreamEventRound,
  type StreamEventRound,
} from "../../features/obs-effects/streamEventRound";
// ⚠ 061p: `effectConditionCount` / `EFFECT_OUTPUT_LABEL` の import を外した（前提ステータスの消滅に伴う）。
// ⚠⚠ **064e: `STAGE_OVERLAY_WINDOW_TITLE` の import も外した。** 061p は「窓名を出す最後の 1 か所」と
//   書いていたが、それは「OBS へ自動で反映」カードの note のことで、**064e でカードごと消えた**。
//   ⇒ ⚠ **窓名を出すのは [`StreamEventTab`]（「『開始』を押すと、配信画面用のウィンドウ（「…」）が…」）
//   1 か所になった**＝ **実際に窓が開く場所で名乗る**形なので、位置としてはむしろ正しい。
//   ⚠ **直書きしないこと**（Rust の契約テストが実タイトルとのバイト一致を固定している）。
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061a: main 窓の「OBSエフェクト」画面（`Screen` の `obs-effects`）。ヘッダーの導線が
 * `ComingSoonScreen` ではなくここを出すようになった。
 *
 * **061a 時点で置くのは 3 つだけ**——表示トグル・OBS 自動反映トグル・前提ステータス。
 * エフェクトの中身とテスト発火は 061b が足した。
 * ⚠ **061d-1 でテンプレートの取り込み・一覧・プレビュー（[`EffectTemplateCard`]）が加わった。**
 * イベント種別ごとの割り当てと、エフェクト窓でのテンプレート描画は **061d-2**。
 * ＝ **061d-1 の時点ではテンプレートを配信画面へ出すことはできない**（取り込んで中身を確かめるまで）。
 *
 * ⚠⚠ **061h で「投げ銭でエフェクトを出す」section を丸ごと削除した。** あのトグルの本体は
 * 組み込み演出（「〇〇さんが ¥1,000」）の ON/OFF で、組み込みを廃止した時点で意味が無くなる。
 * ⚠ さらに実機で破綻していた最大の原因が「**ON/OFF の軸が 3 つ（表示・投げ銭・割り当て）に割れ、
 * どれか 1 つ忘れると黙って何も出ない**」だったので、軸を減らすこと自体が目的でもある
 * （表示トグルの削除は 061i の担当）。
 * ⚠ section の中にあった**テスト表示は [`EffectTemplateCard`] の各行へ移した**——
 * 「どのエフェクトの位置合わせをしているのか」を選べないのが旧設計の弱点だったため。
 *
 * ## ⚠⚠ 061i でこの画面は「タブ 2 枚 ＋ 共通の下部」になり、表示トグルが消えた
 *
 * - **タブ**（[`Tabs`]）… 「コメントで出すエフェクト」＝テンプレートと条件／「配信イベント」＝
 *   ⚠⚠ **061l で中身が入った**（[`StreamEventTab`]＝一覧 → 詳細 → 適用 → 開始/終了）。
 *   ⚠ **`ComingSoonScreen` は流用しない**（あれは画面まるごと用のダミーページで、ヘッダー導線の意味論を持つ）。
 * - **共通の下部**（両タブの外）… 「配信画面に表示」（OBS への取り込み手順）／「OBS へ自動で反映」／前提ステータス。
 *   ⚠ **どちらのタブで使うエフェクトも同じ 2 つの出力窓へ出る**ので、タブの中に入れると
 *   「タブごとに別の窓がある」と読めてしまう。
 *   ⚠⚠ **061k で見直した結果＝共通の下部のまま**（窓が 2 本になったのは「用途別（コーナー／全画面）」
 *   という軸であって「タブ別」ではない。061l の配信イベントも同じ 2 窓へ出る）。
 *   ⇒ 変わったのは**前提ステータスの「エフェクトのウィンドウ」行が 2 本になった**ことだけ。
 *
 * ## ⚠⚠ 061k: 出力窓が用途別に 2 本になった
 *
 * - **窓の open/close は窓ごとに別のキュー**（判断 11）。1 本に混ぜると片方の open がもう片方の
 *   close の完了を待つ（061i がキューを作った理由は「**同じ窓**への close/open の順序」だけ）。
 * - **前提ステータスは「エフェクトのウィンドウ（コーナー）／（全画面）」の 2 行**。
 *   各行に「ウィンドウを閉じる」「ウィンドウを開く」があり、**開く判定はその出力先の件数**である
 *   （合計で判定すると「コーナー条件しか無いのにステージ窓を開く」＝**開いたのに何も出ない窓**になる）。
 * - **「表示する条件」は合計 1 行のまま**（判断 11）。⚠ ただし**内訳を添える**——
 *   テスト表示は条件が無くても 2 窓を開く（判断 8）ので、「ステージ窓は表示中なのに
 *   ステージ条件が 0 件」が普通に起きる。061a 以来の「黙って何も起きない状態を作らない」を守るため。
 * - ⚠⚠ **`docs/security.md` §1 の停止導線はここと `MainScreen` の 2 か所**で、
 *   061k では「**2 つとも**閉じないと取得は止まらない」へ書き換えた。**片方だけ直さないこと。**
 * - ⚠⚠ **「エフェクトを配信画面に表示する」トグルを廃止した**（判断 1・2）。**二度手間**だったため
 *   ——条件を設定した時点で「配信画面に出したい」ことは自明なのに、別に ON にしないと何も出なかった。
 *   ⚠ **061h で既定が「出さない」になったから初めてこの自動化が成立する**（既定が組み込みのままだと
 *   「条件が 1 つでも有効」が常に真になり、トグルを消しても意味が無い）。
 *   | 契機 | 挙動 |
 *   |---|---|
 *   | 条件が **0 件 → 1 件以上** | **窓を開く**（`useEffectTemplates` が判断し、この画面が invoke する） |
 *   | 条件が 1 件以上のまま起動 | **窓を復元する**（`App.tsx` → `restoreEffectOverlayWindow`・**無改変**） |
 *   | 条件が**全部「出さない」** | ⚠ **窓は閉じない**。OBS 側のソースだけ非表示になる（派生値が false → コメビュ窓が `hideObs`） |
 *   | 明示的に閉じたい | 前提ステータスの**「ウィンドウを閉じる」ボタン**（＝トグルではなくアクション） |
 *   ⚠⚠ **自動 close は作らない**（判断 1）。配信中に窓が消えると **OBS のウィンドウキャプチャが
 *   真っ黒**になり、配信者は原因に気づけない（親 046 の規律＝`effectOverlayRestore.ts` の JSDoc）。
 *   ⚠ ユーザーの不満は「**毎回の**二度手間」であって「閉じられること」ではないので、**脱出路は残す**。
 *
 * ⚠⚠ **この画面の設計を決めている構造上の制約**（061a の実装で判明した最大の論点。⚠ **061b で①②が変わった**）:
 *
 * `obs-enable` を sidecar へ送れるのは **コメビュ窓だけ**である。理由:
 *   ①`connectCommentStream` を呼んでいるアプリコードは `CommentViewerApp` / `OverlayApp` /
 *     **`EffectOverlayApp`（061b で 3 つ目）** だが、**WS ハンドル（`enableObs` を持つ
 *     `CommentStreamHandle`）を握って制御フレームを送るのは `CommentViewerApp` だけ**
 *     （残り 2 つは `onComments` しか使わない読み取り専用接続で、戻り値も `disconnect` しか触らない）。
 *   ②~~sidecar のライフサイクルはコメビュ窓に紐づく~~ → ⚠ **061b で「コメビュ窓 or エフェクト窓の
 *     どちらかが生きている間」へ広がった**（`lib.rs` の `SIDECAR_CONSUMER_LABELS`）。
 *     ただし **sidecar を起動するのは依然コメビュ窓だけ**なので、「コメビュ窓を一度も開いていない」状態では
 *     やはり sidecar が動いておらず `obs-enable` の送り先も無い。
 *   ③main 窓から WS を張る案は採らなかった——`get_comment_stream_port` が null の間**毎秒 invoke が
 *     永久ループ**し、かつ `connectCommentStream` は `onComments` 必須なので**第三者のコメント本文が
 *     main 窓へ流れ込む**（§9 の後退）。
 *     ⚠ **061b でこの 2 つの性質はエフェクト窓に現れた**（＝理由③は「main 窓では嫌だ」であって
 *     「どの窓でも嫌だ」ではない）。エフェクト窓で受容できるのは、あちらが**透過・最背面・非フォーカスの
 *     表示専用窓**で `OverlayApp` と同じ立場だから。**main 窓は特権 UI**（OBS パスワード入力・
 *     視聴者メモリの削除導線・テーマの「既定に戻す」）なので、同じ受容はしない。
 *
 * したがってこの画面の役割分担はこうなっている:
 *   - **窓の open/close** ＝**この画面が直接 invoke する**。コメビュ窓に依存しない。
 *     アプリ定義コマンドは ACL 対象外なので main 窓からそのまま呼べる（`default.json` は差分ゼロ）。
 *     ⚠⚠ **061i: 契機は 3 つになったが、invoke するのは相変わらずこの画面 1 か所だけ**
 *     （条件の自動 open ／ テスト表示の open ／ 「ウィンドウを閉じる」）。
 *     判断は他所（hook・テンプレートカード）にあり、**実行と直列化はここに集約**してある。
 *   - **OBS 自動反映トグル**＝**localStorage に設定を書くだけ**。実際の `enableObs("effects")` は
 *     コメビュ窓（`CommentViewerApp`）が 046b と同じ二段構え（マウント時の reconcile ＋ `storage` 購読）で代行する。
 *     ⚠ これは 045c の「自動反映トグルは設定を立てるだけ・反映の契機は表示 ON」という規律とも一致する
 *     （main 窓は WS を持たないので、**構造として**そうならざるを得ない）。
 *   - **前提ステータス**＝「いま何が足りないか」を出す。⚠ **黙って何も起きない状態を作らない**ことが目的。
 *
 * ⚠ **OBS 連携の結果（added / reused / failed）はこの画面には出せない。** あれは sidecar からの
 * `obs.state` 通知で、受け取れるのは WS に繋がっているコメビュ窓だけだから。結果表示は従来どおり
 * コメビュ本体のツールバーに出る（この非対称は下の注記でユーザーへ明示する）。
 * **再修正トリガー**＝「main 窓でも成否を見たい」となったら、コメビュ窓が `obs.state` を localStorage へ
 * 書く 1 キーを足す（061a では増やさない）。
 */

/** 前提ステータスを取り直す間隔（ミリ秒）。⚠ 窓の開閉は他窓の操作でも起きるので、画面を開いている間だけ追う。 */
const STATUS_POLL_INTERVAL_MS = 2000;

/**
 * 061l: **開催中の配信イベントの残り時間を見直す間隔**（ミリ秒）。
 *
 * ⚠ **秒ではなく 10 秒**にしてあるのは、この窓が出すのが「残り N 分」だから（判断 10＝
 * 前提ステータスとタブを毎秒再描画しない）。⚠ **期限切れに気づくのも最大 10 秒遅れる**が、
 * **配信画面の表示はステージ窓が自分の時計で消す**ので、遅れるのは main 窓の表示と掃除だけである。
 * ⚠⚠ **開催していない間はタイマーを張らない**（061a 以来「配信中にタイマーを残さない」）。
 */
const STREAM_EVENT_TICK_MS = 10_000;

/**
 * 061i: タブの定義（判断 6・(2)）。
 * ⚠ 用途の違う 2 種類（コメント条件に反応する演出／視聴者参加型の配信イベント）を分ける器で、
 * これが無いと画面が「条件の表の下にイベント一覧がぶら下がる」形になる。
 * ⚠⚠ **061l で「配信イベント」側に中身（[`StreamEventTab`]）が入った。**
 * ⚠ **どちらのタブも同じ 2 つの出力窓へ出る**（窓を分けた軸は「タブ別」ではなく**用途別**）ので、
 * 共通の下部（配信画面に表示／OBS へ自動で反映／前提ステータス）は**両タブの外**のままである。
 */
const EFFECT_TABS: readonly TabItem[] = [
  { id: "comment", label: "コメントで出すエフェクト" },
  { id: "event", label: "配信イベント" },
];

export function ObsEffectsScreen() {
  /** いま出しているタブ。⚠ 061i: **状態はこの画面が持つ**（`Tabs` は表示専用）。 */
  const [tab, setTab] = useState<string>(EFFECT_TABS[0].id);

  /**
   * 061l: **開催中の配信イベント**（`null`＝開催していない・判断 5）。
   *
   * ⚠⚠ **状態の持ち主をこの画面にしてある**（`StreamEventTab` ではない）。理由は 2 つ:
   *   1. **前提ステータスの「開催中のイベント」行**（判断 10）が同じ値を出すので、
   *      タブと画面が別々に持つと**片方が古くなる**（061d-2 レビュー Q-9 と同型）。
   *   2. ⚠⚠ **開始でステージ窓を開く invoke は、この画面の `stage` 用キュー**を通す（061k 判断 11）。
   * ⚠ **マウント時に localStorage から読む**（`storage` に依存しない＝判断 5）。期限切れはここで落ちる。
   * ⚠⚠ **開催キーを書く（消す）のはこの画面の 2 つのハンドラと下の掃除だけ**
   *    ——ステージ窓は**読むだけ**である（061i 判断 2 の「書き手を 1 か所に閉じる」規律）。
   */
  const [round, setRound] = useState<StreamEventRound | null>(() =>
    loadStreamEventRound(Date.now()),
  );
  /**
   * 061l: 残り時間を計算するための「いま」。⚠⚠ **時計は 1 つ**（判断 5）——
   * 前提ステータスの行とタブが別々に `Date.now()` を呼ぶと、同じ画面で 1 テック分ずれた値が並ぶ。
   */
  const [nowMs, setNowMs] = useState(() => Date.now());

  // 窓の状態。null = 未取得。⚠⚠ 061k: **窓ごとに 1 つずつ持つ**（片方の値でもう片方を代表させない）。
  //
  // ⚠⚠ **061p: これらはもう画面に出さない**（前提ステータスを削除した）。
  //   ⚠ **それでも保持し続ける理由**:
  //     - `effectWindowOpen` / `stageWindowOpen` … **「配信画面でテスト表示」の経路分岐**
  //       （停止中の窓には保留旗を立てて開く／開いている窓へは `storage` を撒く）。
  //       ⚠⚠ **`null` と `false` の区別に意味がある**（`EffectTemplateCard` の JSDoc の表が正）。
  //     - `viewerOpen` … 下の**前提案内**（`docs/security.md` §1 の停止導線）の出し分け。
  //   ⚠ **「表示していないから」と消さないこと。** 消すと `EffectTemplateCard` が
  //     常に `storage` 経路へ倒れ、停止中の窓に対する「押しても出ない」が戻る。
  const [viewerOpen, setViewerOpen] = useState<boolean | null>(null);

  /**
   * 064f: **OBS のソース一覧の状態**（取得の依頼・返事待ち・書き戻しの購読）。
   *
   * ⚠⚠ **持ち主をこの画面にしてある**——取得ボタンが**タイトル行**、一覧と案内が
   * **[`ObsSourceCard`]** と、**同じ状態を 2 か所が読む**ようになったため。
   * どちらか片方に state を置くと「押したのにカードが『取得中』にならない」という食い違いが
   * 構造的に作れてしまう（061d-2 レビュー Q-9 と同型）。
   * ⚠ 状態の決め方（7 つのどれか）は `obsSourceListStatus`（純関数）が持ったまま。
   *
   * ⚠ **064 レビュー Q-8（修正不要・範囲の明示）: 「持ち主は 1 つ」が指すのは
   * 「取得ボタンと [`ObsSourceCard`]」の 2 者だけ**である。
   * [`EffectAssignmentCard`] は**独自に `loadObsSourceList()` と `storage` 購読を持つ**
   * （＝main 窓の中に一覧の読み手が 2 系統ある）。
   * 修正不要の理由＝ 2 者は**同じ `storage` イベントで同時に更新される**ので食い違いが作れず、
   * かつ**あちらは `status`（7 状態）を必要としない**——要るのは `<select>` に並べる名前だけで、
   * `useObsSourceList` を props で配ると「取得中」「応答なし」まで一緒に運ぶことになる。
   * ⚠ **再修正トリガー＝`EffectAssignmentCard` が「取得中は選べない」等、状態そのものを
   * 出す必要が生じたとき**（そのとき `useObsSourceList` を props で渡す形へ寄せること）。
   */
  const obsSources = useObsSourceList(viewerOpen);

  // 046b レビューと同じ連打レース対策: `open_effect_overlay_window` は `#[tauri::command(async)]`
  // （別スレッド・窓生成で数百 ms）、`close_effect_overlay_window` は同期コマンドなので、素の
  // `void invoke()` だと ON→OFF 連打で「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」
  // 順序が起こりうる。この機能も自動 close 経路を持たないため、その状態は**セッション中に解消せず**
  // 「設定 OFF なのにエフェクト窓が OBS に映り続ける」になる。前の要求の完了後に次を流す。
  // `.catch` はキューを詰まらせないための握りつぶし（reject を伝播させると以降の開閉要求が全て死ぬ）。
  //
  // ⚠⚠ **061k（判断 11）: キューは窓ごとに 1 本ずつ持つ。**
  // 1 本に混ぜると **片方の窓の open が、もう片方の close の完了を待つ**——061i がこのキューを
  // 作った理由は「**同じ窓**への close と open の順序が入れ替わる」ことであって、
  // **別の窓を直列化する理由は無い**（待たされている間に「ステージ窓を開いたのに出ない」が起きる）。
  // ⚠ **Rust 側の窓生成は `WINDOW_OPEN_LOCK` で全窓共有＝どのみち直列**だが、それとは別の話である
  // （あちらは窓生成の排他、ここは同一窓に対する要求の順序）。
  const stageOverlayOpRef = useRef<Promise<void>>(Promise.resolve());

  // ⚠ 061k レビュー S-6（受容・修正不要）: **`.then` に `.catch` を付けていない**（033f/061a から同じ形）。
  //   意図＝ここで拾えるのは「引数なしの読み取り専用 invoke が reject した」だけで、**握りつぶすと
  //   前提ステータスが「確認中…」のまま固まる**（＝黙って何も起きない）。未処理 rejection として
  //   dev の console に出るほうが、この 3 本の性質（登録済みコマンド・引数なし・reject 経路が実質無い）に
  //   照らして観測しやすい。⚠ 落ちても 2 秒ポーリングが次の周期で実態へ引き戻す。
  //   **再修正トリガー**＝実機でこの reject が観測されたとき（そのときは「確認できません」という
  //   第 3 の表示を足す。`null`＝未取得と混ぜないこと）。
  const refreshStatus = useCallback(() => {
    void isCommentViewerOpen().then(setViewerOpen);
  }, []);

  // 前提ステータスを画面を開いている間だけ追う。⚠ ポーリングにしているのは、コメビュ窓もエフェクト窓も
  // **この画面の外**（ツール管理・窓の × ・他窓の操作）で開閉されうるため。窓の存在を見るだけの
  // 読み取り専用コマンド 2 本で副作用は無い。⚠ アンマウントで必ず止める（配信中に回り続けさせない）。
  useEffect(() => {
    refreshStatus();
    const timer = window.setInterval(refreshStatus, STATUS_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshStatus]);

  // ⚠⚠ **061p: OBS の WebSocket 設定の read-only 検出（`detectObsWebsocketConfig`）を外した。**
  //   唯一の用途が前提ステータスの「OBS の WebSocket」行の表示で、その行ごと消えたため。
  //   ⚠ **帰結＝ OBS 側で WebSocket サーバーが無効なとき、この画面では気づけない**
  //   （自動反映が黙って効かない。失敗の赤字はコメビュ窓のコメント画面上部に出る）。
  //   ⚠ **同じ検出はコメビュ窓の設定（`CommentViewerApp`）が持っており、あちらは無改変。**
  //   ⚠ 再修正トリガー＝「自動反映が効かない理由が分からない」と実機で言われたとき。

  /**
   * 061i: **エフェクト窓の開閉要求を 1 本のキューに流す**（判断 1）。
   *
   * ⚠⚠ **061a の表示トグルが消えても直列化は残す**——契機はむしろ増えた（条件の自動 open／
   * テスト表示の open／「ウィンドウを閉じる」）ので、**別々に `void invoke()` すると
   * 「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」順序が起こりうる**。
   * この機能は**自動 close 経路を持たない**ため、その状態は**セッション中に解消せず**
   * 「閉じたはずのエフェクト窓が OBS に映り続ける」になる（046b レビューの連打レース対策と同型）。
   * ⚠ **判断（いつ開閉するか）は呼び出し側にあり、ここは実行と直列化だけ**を担う。
   * ⚠ `.catch` はキューを詰まらせないための握りつぶし（reject を伝播させると以降の要求が全て死ぬ）。
   * ⚠ 完了後に `refreshStatus` を挟むので、前提ステータス（「表示中」／注記）が実態へ追いつく。
   */
  const runOverlayOp = useCallback(
    (op: () => Promise<void>) => {
      stageOverlayOpRef.current = stageOverlayOpRef.current
        .then(op)
        .then(refreshStatus)
        .catch(() => {});
    },
    [refreshStatus],
  );

  /**
   * 061i: **窓を開く**（条件が 0 → 1 件になったとき・テスト表示で停止中だったとき）。
   *
   * ⚠ **`EFFECT_OVERLAY_ENABLED_KEY` はここでは書かない**（判断 2）——あの値の書き手は
   * `useEffectTemplates` の割り当て保存経路**だけ**である（＝「2 つの真実」を作らない）。
   * ⚠ **セットアップ用ガイドの旗もここでは立てない**（判断 3）。立てるのは
   * 「配信画面でテスト表示」で窓を開いたとき**だけ**で、その判断は `EffectTemplateCard` にある
   * ——ここで立てると**条件を編集して自動で開くたび**にガイドが 30 秒 OBS へ映る（061a Q-1 の再発）。
   *
   * ⚠⚠ **061i レビュー S-4: 前提ステータスを楽観的に「表示中」へ倒す。**
   * `effectWindowOpen` は 2 秒ポーリングの値なので、**自動 open の直後は「停止中」のまま**である。
   * その隙間に「配信画面でテスト表示」を押すと `EffectTemplateCard` が**旗経路**へ倒れるが、
   * 既存窓は `show()` されるだけで**再マウントしない**＝旗を読み直さないので、
   * **保留旗とガイド旗が消えない残骸になる**（次に窓が開いた瞬間＝アプリ再起動時の復元で、
   * **無操作でエフェクトが 1 回出て、ガイドが 30 秒 OBS へ映る**＝061a Q-1 が最も嫌った形）。
   * ⚠ **close 側は楽観更新しない**（非対称なのは意図的）——close 中に押した場合の壊れ方は
   * 「押しても出ない」で、旗の残骸より軽いほうへ倒れるため。
   * ⚠ open が失敗しても `refreshStatus`（完了時＋2 秒ポーリング）が実態へ引き戻す。
   */
  const openStageOverlay = useCallback(() => {
    runOverlayOp(openStageOverlayWindow);
  }, [runOverlayOp]);

  /**
   * ⚠⚠⚠ **061p: `closeEffectOverlay`（前提ステータスの「ウィンドウを閉じる」）を削除した。**
   *
   * 指示は「ステータスは全ていらない（ボタンも含めて）」で、**このアプリからエフェクトの出力窓を
   * 閉じる導線は 1 つも無くなった**（＝窓が消えるのはアプリの終了時だけ）。
   * ⚠⚠ **064 レビュー S-4（訂正）: 残っている口は `close_stage_overlay_window` の 1 本だけ**である
   * （`close_effect_overlay_window` は **064d でコーナー窓ごと削除済み**。この段落は 061p 当時の
   * 記述を引きずっていた）。⚠ **いま呼ぶ画面は 1 つも無い**が、口は残す——
   * `docs/security.md` が停止条件の説明で名指ししており、呼び手を戻すときに口から作り直すのは無駄だから。
   * ⚠⚠ **`docs/security.md` §1「取得の停止条件」は 064f で「導線は `MainScreen` の 1 か所」へ改訂済み**
   * （止め方＝コメントビューアを開いて取得を停止する）。**復活させるときは §1 も戻すこと。**
   */

  /**
   * 061l（判断 5・6）: **開催を始める**。
   *
   * 3 つを同時にやる: ①開催キーを書く ②画面の状態を進める ③**ステージ窓を開く**。
   * ⚠⚠ **コーナー窓は開かない**（イベントはステージ窓にしか出ない・判断 7）。
   * ⚠ 窓を開くのは既存の `openEffectOverlay("stage")`＝**この画面のキューを通る**（061k 判断 11）ので、
   *   **新しい invoke の経路も新しいキューも増えていない**。
   * ## ⚠⚠ 064d: ここが `STAGE_OVERLAY_ENABLED_KEY` とガイド旗の**唯一の書き手**になった
   *
   * 旧: あの旗の意味は「**stage 出力の条件が 1 件以上あるか**」で、書き手は `useEffectTemplates` だった。
   * 064d でテンプレートごと消えたので、**書き手が 1 人も居なくなった**——放っておくと
   * ①ステージ窓が OBS へ自動追加されない ②セットアップ用ガイドが二度と出ない
   * （＝**ユーザーが OBS でこの窓を見つけられない**）という、どちらも黙って壊れる形になる。
   *
   * ⇒ **旗の意味を「いま配信イベントでステージ窓を使っているか」へ移した**:
   *   - **開始で `true`**（＋ ガイドのワンショット旗）… OBS への自動追加とガイドがここで動く
   *   - **終了で `false`**（下の `handleEndRound`）… OBS 側のソースは**非表示になるだけ**（削除されない）
   * ⚠ 帰結＝**開催していない状態でアプリを再起動しても窓は復元されない**（意図した挙動）。
   * ⚠⚠ **ガイド旗を立ててよいのは「明示操作で窓を開くとき」だけ**（061a Q-1）。
   *   064d 以降、窓を開く経路は**この関数だけ**なので条件は自動的に満たされる。
   *   ⚠ **窓を開く経路を増やすなら、そこで旗を立ててよいかを必ず考え直すこと。**
   */
  const handleStartRound = useCallback(
    (eventId: string) => {
      const event = findStreamEvent(eventId);
      // ⚠ 未知 id は何もしない（レジストリから消えた id を掴んだ状態でボタンが押されうる）。
      if (event === null) return;
      const now = Date.now();
      const next = startStreamEventRound(event, now);
      saveStreamEventRound(next);
      setRound(next);
      setNowMs(now);
      // ⚠⚠ 064d: 窓を開く**前**に旗を立てる（窓はマウント時に旗を読む）。
      saveStageOverlayEnabled(true);
      saveEffectOverlayGuidePending(true);
      openStageOverlay();
    },
    [openStageOverlay],
  );

  /**
   * 061l（判断 5）: **開催を終える**。
   *
   * ⚠⚠ **窓は閉じない。** 「開くのは自動・閉じるのは明示」（061i 判断 1）であり、
   * 配信中に窓が消えると **OBS のウィンドウキャプチャが真っ黒**になる（親 046 の規律）。
   * ⚠ **ここに `closeStageOverlayWindow` を足さないこと**（新規 6 と変異②が固定している）。
   */
  const handleEndRound = useCallback(() => {
    clearStreamEventRound();
    // ⚠⚠ 064d: OBS 側のソースは**非表示になるだけ**（削除されない）＝次の開催でそのまま戻る。
    //   ⚠ **窓は閉じない**（親 046 の規律。閉じると OBS のキャプチャが真っ黒になる）。
    saveStageOverlayEnabled(false);
    setRound(null);
  }, []);

  /**
   * 061l（判断 5）: 開催中だけ回る tick。**残り時間の表示を進め、期限切れなら掃除する。**
   *
   * ⚠⚠ **掃除（`clearStreamEventRound`）は「main 窓がこの画面を開いているときの best-effort」**である。
   * ⚠ **正しさをここに預けていない**——`parseStreamEventRound` が期限切れを必ず落とすので、
   *   掃除が走らなくても「終了時刻を過ぎたら開催していない」は成立する
   *   （＝「main 窓が閉じていると消えない」「両窓が競合して 2 回消す」を作らない・判断 5）。
   * ⚠ **開催していない間はタイマーを張らない**／⚠ **アンマウントで必ず止める**（判断 11 の対称）。
   *
   * ## ⚠⚠⚠ 064 レビュー S-1（修正）: 期限切れでも `STAGE_OVERLAY_ENABLED_KEY` を落とす
   *
   * 旧実装は開催キーだけを消して**旗を落としていなかった**。旗の書き手は
   * `handleStartRound`（true）と `handleEndRound`（false）の 2 つだけなので、
   * **「終了」を押さずに時間切れになると旗が永久に true のまま**になっていた。
   * ⚠⚠ **これは `docs/security.md` §1 の 044a 例外を守る唯一のガードの前提を壊す**——
   * 064e の追補は「旗 true ＝ ユーザーが『開始』を押した」という**同値**に全体重を乗せているが、
   * その同値がここで成立していなかった。壊れ方は
   * 「再起動 → `restoreEffectOverlayWindow` がステージ窓を復元 → WS 接続時 reconcile が
   * `enableObs("stage")` を送る」＝ **そのセッションでの明示操作ゼロで OBS へ繋ぐ**。
   * ⚠ **`handleEndRound` と同じ 2 行を書くこと**（開催キーと旗は必ず対で動かす）。
   */
  useEffect(() => {
    if (round === null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now >= round.endsAt) {
        clearStreamEventRound();
        // ⚠⚠⚠ S-1: 開催キーと**対で**落とす（上の JSDoc が正）。
        saveStageOverlayEnabled(false);
        setRound(null);
        return;
      }
      setNowMs(now);
    }, STREAM_EVENT_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [round]);

  /**
   * ⚠⚠⚠ 064 レビュー S-1（修正）: **マウント時に旗の取り残しを直す。**
   *
   * 上の tick は「main 窓がこの画面を開いている間」しか回らないので、
   * **開催中に main 窓を閉じた／アプリを終了した**ケースでは期限切れの掃除が走らない。
   * ⇒ この画面を開いた最初の 1 回だけ、**開催していないのに旗が立っている**状態を直す。
   * ⚠ `round` は初期化子で `loadStreamEventRound(Date.now())` を読んでおり、
   *   **期限切れは既に落ちている**ので `round === null` ＝「開催していない」で正しい。
   *
   * ⚠⚠ **`loadStageOverlayEnabled()` で差分を見てから書くこと（無条件に書かない）。**
   *   `saveStageOverlayEnabled(false)` を毎マウント打つと、コメビュ窓の `storage` 購読が
   *   **画面を開くたびに `hideObs("stage")` を OBS へ送る**（＝ユーザーが何もしていないのに
   *   OBS を触りに行く。§1 の姿勢に反する）。
   * ⚠ 再修正トリガー＝旗の書き手が 3 か所目を持ったとき（そのときは「開催キーからの派生値」に
   *   寄せるかを決め直すこと。いまは書き手 3 か所＋掃除 1 か所で読み切れる）。
   */
  useEffect(() => {
    if (round === null && loadStageOverlayEnabled()) {
      saveStageOverlayEnabled(false);
    }
    // ⚠ **マウント時 1 回だけ**（`round` を deps に載せると `handleEndRound` と二重に書く）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⚠⚠ 064d: **条件の state は `EffectAssignmentCard` が自分で持つ**ようになった。
  //   旧 `useEffectTemplates` は「テンプレートを削除したら、それを指す条件を戻す」という
  //   一覧と割り当ての**継ぎ目**のために在ったが、取り込み機能ごと消えたので継ぎ目も消えた。

  /**
   * ⚠⚠ **061p: 前提ステータス用の派生値を 3 つとも削除した**
   * （`conditionCount`＝条件の合計件数／`countByOutput`＝出力先ごとの件数／
   * `windowRows`＝「エフェクトのウィンドウ」2 行ぶんの材料）。
   *
   * ⚠⚠⚠ **064 レビュー S-4（訂正）: 「自動 open の挙動は 1 ミリも変わっていない」は偽だった。**
   * 旧文は「数え方の持ち主（`effectConditionCount`）は残っており、`useEffectTemplates` が
   * 『条件が 0 → 1 件になったら窓を開く』の判定で使っている」と書いていたが、
   * **`useEffectTemplates` は 064d で削除済み**で、`effectConditionCount` の**呼び手は 0 本**、
   * **条件による窓の自動 open も存在しない**。
   * ⚠ 064d 以降、**窓が開く契機は [`handleStartRound`]（配信イベントの開始）1 つだけ**である。
   */

  /**
   * ⚠⚠⚠ **064e: `handleObsAutoAddToggle`（OBS 自動反映トグル）を削除した。**
   *
   * 045c の規律「**自動反映トグルは設定を立てるだけ**（窓も開かないし OBS へも繋がない）」は
   * **トグルが存在しなくなったので適用対象を失った**。
   * ⇒ いま OBS への追加を起こすのは **配信イベントの開始 1 つだけ**で、それを受けて
   * `CommentViewerApp` が `scheduleObsAutoAdd("stage")` を無条件に走らせる。
   * ⚠ **この画面が OBS へ繋ぐ経路は相変わらず 0 本**（main 窓に WS が無いという構造は不変）。
   */

  const handleOpenCommentViewer = () => {
    void openCommentViewerWindow()
      .then(refreshStatus)
      .catch(() => {});
  };

  /**
   * ⚠⚠ **061p: 前提ステータスの「開催中のイベント」行（`roundStatusText`）と
   * 「OBS の WebSocket」行（`obsStatusText`）の組み立てを削除した。**
   * ⚠ **開催状態（`round`）自体はこの画面が持ち続ける**——[`StreamEventTab`] へ渡し、
   * 開始でステージ窓を開く invoke もこの画面のキューを通る（061l の持ち主の規律は不変）。
   */

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>OBSエフェクト</h2>
          {/* ⚠ 061a レビュー Q-1 の規律＝**約束できることだけ書く**。
              ⚠ 061p: 1 文に短縮（指示）。 */}
          <p>コメントに反応するエフェクトを、配信画面に出します。</p>
        </div>
        {/* ⚠⚠⚠ **064f: 取得ボタンをタイトル行の右へ移した**（依頼者の指示）。
            ⚠ **カードの中にあった 064c〜064e の位置から動かした**理由＝この操作は
            「**このカードの操作**」ではなく「**画面全体の材料を最新にする**」もので、
            結果は**下の 2 枚（手動再生の一覧・条件の `<select>`）の両方**に効くから。
            ⚠ 名前も「OBS のソースを取得」→「**最新のOBSのソースを取得**」（依頼者の指示）。
            ⚠⚠ **状態の持ち主は [`useObsSourceList`]**——ボタンとカードが別々の state を持つと
            「押したのにカードが『取得中』にならない」という食い違いが構造的に作れてしまう。
            ⚠ `layout.actions` は既製の右寄せ枠（`RakurakuToolsScreen` などと同じ）＝
            **新しい px を発明しない**（061a の要件）。 */}
        <div className={layout.actions}>
          <Button
            type="button"
            variant="primary"
            onClick={obsSources.refresh}
            // ⚠ コメビュ窓が無いと依頼が誰にも届かない／返事待ちの二度押しも防ぐ。
            disabled={obsSources.blocked || obsSources.status === "pending"}
          >
            最新のOBSのソースを取得
          </Button>
        </div>
      </div>

      <div className={styles.stack}>
        {/* ⚠⚠⚠ **064f: `docs/security.md` §1 の停止導線（前提案内）と入れ替わりでここへ来た案内。**
            依頼者の指示＝「**裏の処理をユーザーに意識させる必要がない**」ので、
            旧文（OBS への操作が行われない／取得が続く／止め方）を**丸ごと削除**し、
            **この機能を使うのに何が要るか**だけを出す。
            ⚠⚠ **§1 側は改訂済み**（導線は `MainScreen` の 1 か所）。理由＝旧案内は
            `viewerOpen === false` なら**無条件に**「取得が続く」と言っていたが、
            **実際に続くのはステージ窓が開いているときだけ**で、`MainScreen` は
            `isStageOverlayOpen()` を実際に見て出し分けている（＝**精度の高いほうを残した**）。
            ⚠ **`MainScreen` 側の文言は無改変**。片方だけ直さない、の対象がこの 1 か所になった。

            ⚠ **出すのは `viewerOpen === false` のときだけ**——開いているのに「起動してください」は
            嘘になる（061a レビュー Q-1 の「約束できることだけ書く」）。
            ⚠ 窓名は Rust の `.title(…)` と一致させること（`AddToolScreen` にも同じ直書きがある）。 */}
        {viewerOpen === false && (
          <div className={styles.prerequisite}>
            <p className={styles.prerequisiteText}>
              OBSエフェクトは「コメントビューア for
              StreamDock」の専用機能です。ご利用の際はコメントビューアを起動し、配信に接続してください。
            </p>
            <Button type="button" onClick={handleOpenCommentViewer}>
              コメントビューアを開く
            </Button>
          </div>
        )}

        {/* 061i（判断 6）: 用途の違う 2 種類を分ける器。⚠ 状態はこの画面が持つ（`Tabs` は表示専用）。 */}
        <Tabs
          items={EFFECT_TABS}
          activeId={tab}
          onChange={setTab}
          ariaLabel="エフェクトの種類"
        />

        {tab === "comment" ? (
          // ⚠ `role="tabpanel"` は呼び出し側（ここ）が付ける（`Tabs` は中身を包まない）。
          <div className={styles.stack} role="tabpanel">
            {/* ⚠⚠ **064c で並びを反転した**（旧: 条件 → OBS のソース）。
                ⚠ **061p が「取り込みのカードは一番下へ」とした根拠は「取り込みは最初の 1 回だけ」**
                だったが、**064d でその取り込み自体が消えた**。いま上にあるのは
                「**OBS の一覧を取る**」という、①先にやらないと条件で何も選べず
                ②OBS 側を編集するたびにやり直す操作である。
                ⇒ 逆順のままだと**空の `<select>` を先に見せて、その理由を下に書く**ことになる。
                ⚠⚠ **064f: 状態はこの画面が持ち、カードは表示専用になった**（取得ボタンが
                タイトル行へ移り、**同じ状態を 2 か所が読む**ようになったため）。 */}
            <ObsSourceCard state={obsSources} />

            {/* 061d-2: イベント種別ごとの割り当て（＝061i 以降の呼び方は「エフェクトを表示する条件」）。 */}
            <EffectAssignmentCard />
          </div>
        ) : (
          <div className={styles.stack} role="tabpanel">
            {/* ⚠⚠ **061l: 061i から枠だけだった場所の中身**（一覧 → 詳細 → 適用 → 開始/終了の器）。
                ⚠ `ComingSoonScreen` は流用しない（「画面まるごとが未実装」を表すダミーページで、
                ヘッダーのセクション導線の意味論を持っており、`headerSections` の
                「OBSエフェクトは準備中ページを出さない」という担保と衝突する）。
                ⚠⚠ **開催状態はこの画面が持つ**（上の `round` の JSDoc）。タブは表示と操作だけを担う。 */}
            <StreamEventTab
              round={round}
              nowMs={nowMs}
              onStartRound={handleStartRound}
              onEndRound={handleEndRound}
            />
          </div>
        )}

        {/* ⚠⚠⚠ **064e: 「OBS へ自動で反映」カードを丸ごと削除した**（依頼者の指示＝
            「そもそも OBS に作成した物を自動で再生する機能に変わったのでいらないのでは？」）。

            ## ⚠⚠ 指摘は当たっていた——このトグルは**何も起こしていなかった**

            あのトグル（`EFFECT_OBS_AUTO_ADD_KEY`）が有効化していたのは
            **「ステージ窓を OBS のウィンドウキャプチャとして自動追加する」**ことだけで、
            ⚠ **ステージ窓が開く契機は 064d 以降「配信イベントの開始」だけ**である。
            ところが `STREAM_EVENT_REGISTRY` は **061p で空になっている**（見本を削除した）＝
            **「開始」ボタンが 1 つも存在しない** ⇒ ステージ窓は開きようがなく、
            トグルを ON にしても**最後まで何も起きない**。

            ## ⚠⚠⚠ ただし「削除」ではなく「**既定 ON 化**」である（依頼者の指示）

            機能そのものは玉入れ（061l の続き）で必要になるので、**反映処理は残し、
            ゲート（トグル）だけを外した**。⚠ 帰結＝ **配信イベントを開始したら必ず OBS へ追加する。**
            ⚠⚠ **これは `docs/security.md` §1 の 044a 例外に対する姿勢変更である**
            （明示操作が 2 段 → 1 段）。**§1 に 064e 追補を書いてある。**
            ⚠ 044a の comments / pinned 側のトグル（`OBS_AUTO_ADD_KEY`・コメビュ窓の設定カード）は
            **無改変**——あちらは常設の窓が対象で、開始ボタンのような明示操作に紐づいていない。

            ## ⚠ 一緒に消えたもの（受容する）

            - **手動追加のための窓名**（「OBS の『ウィンドウキャプチャ』で「…」を選びます」）
              ⇒ ⚠ **[`StreamEventTab`] の「『開始』を押すと、配信画面用のウィンドウ（「…」）が…」が
              引き続き出す**（＝ 実際に窓が開く場所で名乗る形になった。むしろ正しい位置）。
            - **061e(4) の「失敗したときだけ赤字が出る」注記** ⇒ 反映が既定になったので
              「このカードの結果がどこに出るか」を説明する対象そのものが無い。
              ⚠ **赤字自体は無改変**（コメビュ窓のコメント画面上部に出続ける）。 */}

        {/* ⚠⚠⚠ **064f: ここにあった `docs/security.md` §1 の停止導線を削除した**
            （依頼者の指示＝「裏の処理をユーザーに意識させる必要がない」）。
            消したのは「コメントビューアが閉じているあいだは、OBS への操作は行われません…
            エフェクトのウィンドウが開いているあいだはコメントの取得が続くので、止めたいときは
            コメントビューアを開いて取得を停止してください。」＋ 同じ位置のボタン。

            ## ⚠⚠ §1 を後退させずに消せた理由（**§1 側も改訂済み**）

            §1 が要求するのは「**取得が続いていることと、その止め方**を明示する導線を保つこと」で、
            061k 以降その導線は**この画面と `MainScreen` の 2 か所**にあった。
            ⚠⚠ **こちらは `viewerOpen === false` のときに「取得が続く」と無条件に言っていた**が、
            **実際に続くのはステージ窓が開いているときだけ**である（sidecar の消費者は
            `comment-viewer` と `stage-overlay` の 2 つ）。⇒ **ほとんどの場合、案内は不正確だった。**
            一方 `MainScreen` は `isStageOverlayOpen()` を**実際に見て**文言を出し分けている＝**正確**。
            ⇒ **精度の低い方を消し、高い方だけを残した**（§1 は「導線は `MainScreen` の 1 か所」へ改訂）。
            ⚠ **`MainScreen` 側は無改変**。⚠⚠ **「片方だけ直さない」の対象がその 1 か所になった。**

            ⚠ 代わりに置いたのは**画面上部の「専用機能です」の案内**（上の JSDoc）で、
            あちらは**この機能を使うのに何が要るか**だけを言う（裏の処理には触れない）。 */}
      </div>
    </>
  );
}
