import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadEffectObsAutoAdd,
  saveEffectObsAutoAdd,
} from "../../features/comment-viewer/overlaySettings";
// ⚠⚠ 061p: **`closeEffectOverlayWindow` / `closeStageOverlayWindow` の import を外した**
//   （前提ステータスの「ウィンドウを閉じる」ごと削除したため。⚠ `windowApi` 側の口と Rust の
//   コマンドは残っている＝呼び手が 1 つも無い状態である。詳細は下の `closeEffectOverlay` 跡地の注記）。
// ⚠ **`detectObsWebsocketConfig` の import も外した**（「OBS の WebSocket」行の消滅に伴う）。
import {
  isCommentViewerOpen,
  isEffectOverlayOpen,
  isStageOverlayOpen,
  openCommentViewerWindow,
  openEffectOverlayWindow,
  openStageOverlayWindow,
} from "../../features/comment-viewer/windowApi";
// 共通部品の再利用。トグルは `role="switch"` の a11y ごと既製なので、main 窓のために
// 別実装を起こすと**新しい px / weight を発明する**ことになる（061a の要件に反する）。
// ⚠ **061g で移設済み**（発火した再修正トリガーの後始末）。`ToggleSwitch` / `Select` / `ConfirmDialog` は
// `screens/comment-viewer/` ではなく **`components/`** にあり、意匠も `CommentViewerApp.module.css` から
// 切り出して `components/*.module.css` へ移した＝**この画面はもうコメビュ窓の CSS に依存していない**。
// ⚠⚠ **以後は「跨いだら移す」という後追いをしない**——**画面を跨ぐ部品は最初から `components/` に置くこと**
// （docs/task-board.md の 061g に明文化してある）。
import { ToggleSwitch } from "../../components/ToggleSwitch";
import { Button } from "../../components/primitives";
// ⚠ 061i: タブ部品は **`components/` に新設**した（061g の規律＝画面を跨ぐ部品は最初からあちらへ。
//   061l で「配信イベント」の一覧／詳細が入ると確実に生き続けるので、ここへ置いて後から移さない）。
import { Tabs, type TabItem } from "../../components/Tabs";
// ⚠ 061h: 「テスト表示」は**テンプレート行**（`EffectTemplateCard`）へ移した。
//   この画面が持っているのは「エフェクト窓が開いているか」という前提ステータスだけなので、
//   停止中の注記を出せるように `effectWindowOpen` をあちらへ渡す。
import { EffectAssignmentCard } from "./EffectAssignmentCard";
import { EffectTemplateCard } from "./EffectTemplateCard";
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
//   ⚠ **窓名（`EFFECT_OUTPUT_WINDOW_TITLE`）は残る**——OBS で手動追加する人が探す文字列で、
//   この画面が出す最後の 1 か所になった（直書きしないこと）。
import {
  EFFECT_OUTPUT_WINDOW_TITLE,
  EFFECT_OUTPUTS,
  type EffectOutput,
} from "./effectAssignments";
import { useEffectTemplates } from "./useEffectTemplates";
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
  const [obsAutoAdd, setObsAutoAdd] = useState(() => loadEffectObsAutoAdd());
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
  const [effectWindowOpen, setEffectWindowOpen] = useState<boolean | null>(null);
  const [stageWindowOpen, setStageWindowOpen] = useState<boolean | null>(null);
  const [viewerOpen, setViewerOpen] = useState<boolean | null>(null);

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
  const effectOverlayOpRef = useRef<Promise<void>>(Promise.resolve());
  const stageOverlayOpRef = useRef<Promise<void>>(Promise.resolve());

  // ⚠ 061k レビュー S-6（受容・修正不要）: **`.then` に `.catch` を付けていない**（033f/061a から同じ形）。
  //   意図＝ここで拾えるのは「引数なしの読み取り専用 invoke が reject した」だけで、**握りつぶすと
  //   前提ステータスが「確認中…」のまま固まる**（＝黙って何も起きない）。未処理 rejection として
  //   dev の console に出るほうが、この 3 本の性質（登録済みコマンド・引数なし・reject 経路が実質無い）に
  //   照らして観測しやすい。⚠ 落ちても 2 秒ポーリングが次の周期で実態へ引き戻す。
  //   **再修正トリガー**＝実機でこの reject が観測されたとき（そのときは「確認できません」という
  //   第 3 の表示を足す。`null`＝未取得と混ぜないこと）。
  const refreshStatus = useCallback(() => {
    void isEffectOverlayOpen().then(setEffectWindowOpen);
    void isStageOverlayOpen().then(setStageWindowOpen);
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
    (output: EffectOutput, op: () => Promise<void>) => {
      // ⚠ 061k: **窓ごとに別の ref**（上の注記）。
      const ref = output === "stage" ? stageOverlayOpRef : effectOverlayOpRef;
      ref.current = ref.current
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
  const openEffectOverlay = useCallback(
    (output: EffectOutput) => {
      // ⚠ 061k: 楽観更新も**その窓の state だけ**（もう片方を巻き添えに true へ倒さない）。
      if (output === "stage") {
        setStageWindowOpen(true);
        runOverlayOp("stage", openStageOverlayWindow);
        return;
      }
      setEffectWindowOpen(true);
      runOverlayOp("corner", openEffectOverlayWindow);
    },
    [runOverlayOp],
  );

  /**
   * ⚠⚠⚠ **061p: `closeEffectOverlay`（前提ステータスの「ウィンドウを閉じる」）を削除した。**
   *
   * 指示は「ステータスは全ていらない（ボタンも含めて）」で、**このアプリからエフェクトの出力窓を
   * 閉じる導線は 1 つも無くなった**（＝窓が消えるのはアプリの終了時だけ）。
   * ⚠ **`close_effect_overlay_window` / `close_stage_overlay_window`（Rust）と
   * `windowApi` の口は残してある**——`docs/security.md` の 061a 節が停止条件の説明で名指ししており、
   * かつ**呼び手を戻すときに口から作り直すのは無駄**だから。⚠ **いま呼ぶ画面は 1 つも無い。**
   * ⚠⚠ **`docs/security.md` §1「取得の停止条件」は 061p で改訂済み**
   * （止め方＝コメントビューアを開いて取得を停止する）。**復活させるときは §1 も戻すこと。**
   */

  /**
   * 061l（判断 5・6）: **開催を始める**。
   *
   * 3 つを同時にやる: ①開催キーを書く ②画面の状態を進める ③**ステージ窓を開く**。
   * ⚠⚠ **コーナー窓は開かない**（イベントはステージ窓にしか出ない・判断 7）。
   * ⚠ 窓を開くのは既存の `openEffectOverlay("stage")`＝**この画面のキューを通る**（061k 判断 11）ので、
   *   **新しい invoke の経路も新しいキューも増えていない**。
   * ⚠ **`EFFECT_OVERLAY_ENABLED_KEY` / `STAGE_OVERLAY_ENABLED_KEY` は書かない**——
   *   あの 2 本の意味は「**その出力先の条件が 1 件以上あるか**」で、書き手は `useEffectTemplates` だけ
   *   （061i 判断 2・061k 判断 6 の不変条件）。⚠ 帰結＝**開催中にアプリを再起動しても窓は復元されない**
   *   （条件が無ければ）。⚠ **これは意図した挙動**で、開催そのものも期限切れで復活しない。
   *   ⚠⚠ **裏返しの経路は在る**（061l レビュー S-2・受容）——**ステージ出力の条件が 1 件以上ある**状態で
   *   **期限内の開催を残したままアプリを再起動する**と、`effectOverlayRestore` が
   *   （061a 以来の既存挙動として）ステージ窓を開き直し、その窓が**マウント時に開催キーを読んで
   *   ユーザー操作ゼロでイベントを描く**。⚠ **受容する**——描くのは
   *   **自前のイベント名と `0` と残り時間だけ**（第三者データは 1 バイトも無い＝046b S-1 が問題にした
   *   「永続した第三者の個人データが無操作で配信面に出る」には当たらない）で、
   *   最長でも `defaultDurationMs`（5 分）で自然に消える。
   *   ⚠ **再修正トリガー＝イベントの描画が第三者データを持つようになったとき**
   *   （＝`StreamEventProgress` にキーを足すとき）。そのときは 046b S-1 と同じ議論をやり直すこと。
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
      openEffectOverlay("stage");
    },
    [openEffectOverlay],
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
   */
  useEffect(() => {
    if (round === null) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now >= round.endsAt) {
        clearStreamEventRound();
        setRound(null);
        return;
      }
      setNowMs(now);
    }, STREAM_EVENT_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [round]);

  // ⚠⚠ 061d-2: テンプレート一覧と割り当ての state は**この画面が 1 つだけ持つ**（061d-1 レビュー Q-9）。
  //   削除は「一覧」と「割り当て」の両方を書き換えるので、2 つのカードが別々に持つと片方が古くなる。
  // ⚠ 061i: 「条件が 0 → 1 件になったら窓を開く」の**判断はこの hook**（割り当ての保存経路を
  //   全部知っているのはあちらだけ）。**invoke と直列化はこの画面**（上の `runEffectOverlayOp`）。
  const effectTemplates = useEffectTemplates({ openEffectOverlay });

  /**
   * ⚠⚠ **061p: 前提ステータス用の派生値を 3 つとも削除した**
   * （`conditionCount`＝条件の合計件数／`countByOutput`＝出力先ごとの件数／
   * `windowRows`＝「エフェクトのウィンドウ」2 行ぶんの材料）。
   * ⚠ **数え方の持ち主（`effectConditionCount`）は `effectAssignments.ts` に残っている**
   * ——`useEffectTemplates` が「条件が 0 → 1 件になったら窓を開く」の判定で使っており、
   * **この画面が数えなくなっただけ**である（＝自動 open の挙動は 1 ミリも変わっていない）。
   */

  /**
   * OBS 自動反映トグル。⚠⚠ **設定を立てるだけ**（045c の規律。窓も開かないし OBS へも繋がない）。
   * 045c は「自動反映 ON が窓を開く経路」を回帰として削除している。この画面では main 窓に WS が無いため、
   * その規律が**構造として**守られている（破りようがない）。
   */
  const handleObsAutoAddToggle = (next: boolean) => {
    setObsAutoAdd(next);
    saveEffectObsAutoAdd(next);
  };

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
              ⚠⚠ 061l（教訓 E-2）: **「ウィンドウ」を単数で書かない**——出力窓は用途別に 2 つある。
              ⚠ 061p: 1 文に短縮（指示）。**窓が 2 つある事実は「OBS へ自動で反映」のカードが持つ。** */}
          <p>コメントに反応するエフェクトを、配信画面に出します。</p>
        </div>
      </div>

      <div className={styles.stack}>
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
            {/* 061d-2: イベント種別ごとの割り当て（＝061i 以降の呼び方は「エフェクトを表示する条件」）。
                ⚠⚠ **061p で並びを反転した**（旧: テンプレート → 条件）。指示は
                「エフェクトのインポートのカードは一番下へ」で、⚠ **061d-1 の「材料 → 使い道」という
                並びの根拠（取り込んでから条件を決める）は捨てている**——取り込みは**最初の 1 回だけ**の
                操作で、日常的に触るのは条件のほうだから。 */}
            <EffectAssignmentCard {...effectTemplates} />

            {/* 061d-1: 取り込み・一覧・削除・プレビュー。⚠ **プレビューはこの画面の中だけ**で
                再生する（エフェクト窓へ出さない）。
                ⚠⚠ **061h: 「配信画面でテスト表示」がこのカードの各行に入った**（旧「投げ銭でエフェクトを出す」
                section ごと廃止したため）。停止中の注記と経路の分岐に使うので窓の状態を渡す。
                ⚠⚠ **061i: 窓が停止中ならこのボタンが窓を開く**（＝条件を 1 つも作らずに OBS の
                位置合わせができる）。invoke は上の直列化キューを通す（判断 4）。
                ⚠⚠ **061p: 窓の状態は画面に出さなくなった（前提ステータスを削除）が、
                `effectWindowOpen` / `stageWindowOpen` のポーリングは残す**——この 2 つは
                **表示用ではなくテスト表示の経路分岐**（停止中の窓には旗を立てて開く／開いている窓へは
                `storage` を撒く）に要る。⚠ **「もう表示していないから」とポーリングを消さないこと。** */}
            <EffectTemplateCard
              {...effectTemplates}
              effectWindowOpen={effectWindowOpen}
              stageWindowOpen={stageWindowOpen}
              openEffectOverlay={openEffectOverlay}
            />
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

        {/* ⚠⚠ 061i: ここから下は**両タブの外**（画面下部の共通領域）。
            どちらのタブで使うエフェクトも**同じ窓・同じ OBS ソース**に出るため、タブの中に入れると
            「タブごとに別の窓がある」と読めてしまう。
            ⚠⚠ **061p で「配信画面に表示」section を丸ごと削除した**（指示＝説明しか無くて変）。
            あの section は **061i で表示トグルを失って以降、note 4 本だけのカード**になっていた。
            ⚠ **消えた情報のうち残したもの＝ OBS で探すウィンドウ名**（下の「OBS へ自動で反映」の
            note 1 行へ畳んだ。ユーザーは OBS の一覧を**この文字列で探す**ので、
            手動で「ウィンドウキャプチャ」を追加する人が探せなくなる）。
            ⚠ **落としたもの**＝窓の性質（枠なし・最背面・透明）／全画面では小さく見える旨／
            テスト表示のガイドが数十秒出る旨（ガイド自体は**実装も挙動も無改変**）。 */}
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>OBS へ自動で反映</h3>
            {/* ⚠⚠ 061k: **窓が 2 つになったので、片方だけ名指しすると嘘になる**（実機確認で発見）。
                ⚠ 061p: **窓名は下の note 1 か所だけに出す**（見出しの説明と note の両方に並べると
                同じ 2 つの固有名詞が画面に 2 回出て、まさに「説明が長い」状態になる）。 */}
            <p>
              エフェクト用の 2
              つのウィンドウを、OBS のウィンドウキャプチャとして自動で追加します（既にあれば再利用します）。
            </p>
          </div>
          <div className={layout.panelBody}>
            <ToggleSwitch
              label="エフェクトのウィンドウを OBS へ自動で追加する"
              checked={obsAutoAdd}
              onChange={handleObsAutoAddToggle}
            />
            {/* ⚠⚠ 061p: **削除した「配信画面に表示」カードから引き継いだ唯一の情報＝窓名**。
                手動で「ウィンドウキャプチャ」を追加する人はこの文字列で OBS の一覧を探すので、
                どこにも書かないと**探せなくなる**（061k が実機で 3 件・外部レビューで 4 件目の
                言い落としを踏んだのと同じ穴）。
                ⚠ 窓名は `EFFECT_OUTPUT_WINDOW_TITLE` から引く（直書きすると片方が必ず古くなる。
                Rust の契約テストが実タイトルとのバイト一致を固定している）。
                ⚠ **UI 上の呼び方（「小さく」「大きく」）と窓名は別物**——既存窓の改名は禁止なので
                （既に OBS にソースを作ったユーザーが静かに壊れる）、ここでは**窓名だけ**を出す。 */}
            <p className={styles.note}>
              手動で追加するときは、OBS の「ウィンドウキャプチャ」で
              {EFFECT_OUTPUTS.map((o) => `「${EFFECT_OUTPUT_WINDOW_TITLE[o]}」`).join(
                "と",
              )}
              を選びます。
            </p>
            {/* ⚠⚠ 061e(4): 旧文は「追加や失敗の結果はコメントビューアの画面上部に表示されます。」だったが
                **事実と違った**——ツールバーに出るのは**失敗の赤字だけ**で、成功時は何も出ない（045c が
                「配信中のツールバーを騒がしくしない」として意図的にそう決めている）。全状態が見えるのは
                コメビュ窓の ⚙設定 →「OBSに表示」カードのほう。旧文のままだと「成功したはずなのに何も出ない」＝
                **壊れていると誤解する**。⚠ 061a レビュー Q-1 と同じ規律で**約束できることだけ書く**。
                ⚠ 「コメント画面の上部」と限定しているのは、コメビュ窓で設定/視聴者ビューを開いている間は
                ツールバーごと差し替わるため（045c/059a の既知の割り切り）。
                ⚠ **どの種別の失敗かは書けない**（`obs.state` が種別を運ばないので赤字は 3 種別で共有）。
                ⚠⚠ **下の前提案内（`.prerequisite`）との書き分け（061e 穴 2 の結論）**:
                  - **この注記＝常時表示**。役割は「**結果がどこに出るか**」（このカードの意味論）。
                  - **前提案内＝`viewerOpen === false` のときだけ**。役割は「**いま何が足りないか・どうすればよいか**」
                    （対処と導線、061b の非対称）。
                最後の 1 文が「コメビュ窓が要る」に触れるのは**結果の観点**（＝だから何も出ない）に限り、
                前提案内の**指示**（「コメントビューアを開くと、そのときに反映されます」）は**ここに書かない**
                ——同じことを 2 か所に別の言葉で載せない（061a Q-1 が戒めた形）。
                ⚠ **赤字の消し方は書かない**: 赤字が出ている間は「OBS へ繋がらない」が**現に真**で、
                ユーザーが取る行動はどの種別でも同じ＝OBS を起動する（059b）。消し方を案内すると
                「直す」より「消す」へ誘導してしまう。
                ⚠⚠ **061e レビュー Q-5（修正不要・限界の明示）: 「「OBSに表示」で確認できます」は
                共有 `obsState` の下ではやや強い。** あのカードは 3 種別で 1 本なので、
                ①エフェクトの結果を見に行ったのに**コメント一覧/固定コメント側の結果**が出ている
                ②エフェクト窓が停止中で `requestEffectObsAutoAddIfOpen` が送らず**何も出ない**（idle）、
                がありうる。⚠⚠ **061p で②の補いが消えた**——旧文はこの限界を
                「②は**すぐ下の前提ステータス**（「エフェクトのウィンドウ＝停止中」）が拾っている」
                として受容していたが、**その行ごと削除した**（指示）。⇒ ②は
                「OBSに表示が idle のまま」としてユーザーからは区別できない。
                ⚠ それでもこの 1 文に留めるのは、注記を増やすと 061p の指示（説明が長すぎる）に
                真っ向から反するため。**再修正トリガー**＝「設定カードを見たのにエフェクトの結果が
                分からない」という問い合わせが実際に出たとき（＝ 046d / 061a Q-2 と同じトリガー）。 */}
            {/* ⚠ 「**コメント画面の**上部」という限定は落とさないこと（061e レビュー Q-3）——
                コメビュ窓で設定/視聴者ビューを開いている間はツールバーごと差し替わるので、
                限定を外すと「いつでも赤字が出る」という**別の言い回しの嘘**になる。 */}
            <p className={styles.note}>
              OBS
              への追加に失敗したときだけ、コメントビューアのコメント画面の上部に赤い文字が出ます。
            </p>

            {/* ⚠⚠⚠ **061p: 前提ステータス（6 行）とその中のボタンを丸ごと削除した。**
                消えたのは「表示する条件」「エフェクトのウィンドウ（×2・ボタン付き）」
                「開催中のイベント」「コメントビューア」「OBS の WebSocket」。
                指示は「**このステータスは全ていらない・情報が増えて UX が下がる**」で、
                **061i〜061l がここへ足し続けた観測手段を全部畳んだ**ことになる。
                ⚠⚠ **失ったもの（受容する。復活させるときは 4 つまとめて考えること）**:
                  1. **「条件が 0 件だから何も出ない」を観測する場所**（061a 以来の規律の一部）。
                  2. **「窓が停止中」を観測する場所**（＝ OBS 自動反映が idle の理由・上の Q-5 注記）。
                  3. ⚠⚠ **「ウィンドウを閉じる」＝ `docs/security.md` §1 が名指ししていた停止導線**。
                     ⇒ **§1 側を 061p で改訂した**（止め方は「コメントビューアを開いて取得を停止」）。
                     ⚠ **`close_effect_overlay_window` / `close_stage_overlay_window` を呼ぶ画面は
                     もう無い**（Rust のコマンドと `windowApi` の口は残してある）。
                     ⇒ **エフェクト窓を閉じる手段はアプリの終了だけ**になった。
                  4. **「ウィンドウを開く」**（061i レビュー Q-2 の非対称の埋め合わせ）。
                     ⇒ 条件が既に 1 件以上ある状態で窓を開き直す手段は
                     **「配信画面でテスト表示」とアプリの再起動**だけになった。
                ⚠ **同じ文言を持つツール管理側（`MainScreen` の停止フィードバック）も 061p で
                    書き換えてある。片方だけ直さないこと**（§1 が導線として名指しするのは 2 か所）。 */}

            {/* ⚠⚠ **この案内が「黙って何も起きない」を防いでいる。** コメビュ窓が閉じている間は
                OBS への反映（ソースの自動追加）を送れる窓が存在しない。
                コメビュ窓を開いた時点で `CommentViewerApp` のマウント時 reconcile が反映を実行する。
                ⚠⚠ **061b で「エフェクトも表示されません」を削った。** あれは 061b で**嘘になった**——
                エフェクト窓が sidecar の WS を直接張るようになり、sidecar もエフェクト窓が生きている間は
                落ちないので、**コメント取得を開始したあとならコメビュ窓を閉じてもエフェクトは出続ける**。
                ⚠ 残るねじれ（エフェクトは出るが OBS への自動追加はコメビュ窓が要る）は、
                `obs-enable` の送出がコメビュ窓のままだから。所有者を移すのは別タスク。

                ⚠⚠ **061b レビュー（Q-1 / S-1）で 2 文目を書き直した。** 差し替え前は
                「取得を開始したあとであれば、コメビュ窓を閉じても続きます」と書いていたが、
                **エフェクト窓が開いていること**という必須条件が抜けており、061a の
                「配信中には表示されません」（Q-1）と**同じ失敗モード**だった——この案内が出るのは
                `viewerOpen === false` のときだけで、そこには「エフェクト表示 OFF のままコメビュ窓を
                閉じた（＝sidecar は既に死んでいる）」ユーザーも含まれる。あの文を読んで表示トグルを
                ON にしても、sidecar もセッションも無いので**何も起きない**。
                いまは条件（表示したまま閉じたか／表示せずに閉じたか）を両方書き、
                **取得＝外部通信が続くことと、その止め方**も併せて出している（docs/security.md §1 の
                「取得の停止条件」）。⚠ **約束できることだけを書く**こと。 */}
            {/* ⚠⚠⚠ **061p: ここが `docs/security.md` §1 の停止導線の「main 窓側 1 か所」になった。**
                061i〜061k は止め方を「エフェクトのウィンドウを **2 つとも**閉じる」と案内していたが、
                **061p でそのボタンごと消えた**ので、そのままだと**存在しない操作の案内**になる
                （§1 が「導線を壊すのと同じ」として明確に禁じている形・061i レビュー S-1）。
                ⇒ ⚠ **新しい止め方＝「コメントビューアを開いて取得を停止する」**（`stop-session`）。
                これは**窓の開閉に依存せずいつでも効く**ので、条件分岐なしに 1 文で書ける。
                ⚠⚠ **「エフェクトのウィンドウが開いている間は取得が続く」という事実は残す**
                （§1 が要求しているのは「取得が続いていること」と「その止め方」の 2 つ）。
                ⚠ 同じ文言をツール管理側（`MainScreen` の停止フィードバック）も持っている。
                **片方だけ直さないこと。** */}
            {viewerOpen === false && (
              <div className={styles.prerequisite}>
                <p className={styles.prerequisiteText}>
                  コメントビューアが閉じているあいだは、OBS
                  への反映は行われません（開くとそのときに反映されます）。エフェクトのウィンドウが開いているあいだはコメントの取得が続くので、止めたいときはコメントビューアを開いて取得を停止してください。
                </p>
                <Button type="button" onClick={handleOpenCommentViewer}>
                  コメントビューアを開く
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
