import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadEffectObsAutoAdd,
  saveEffectObsAutoAdd,
} from "../../features/comment-viewer/overlaySettings";
import {
  closeEffectOverlayWindow,
  closeStageOverlayWindow,
  isCommentViewerOpen,
  isEffectOverlayOpen,
  isStageOverlayOpen,
  openCommentViewerWindow,
  openEffectOverlayWindow,
  openStageOverlayWindow,
} from "../../features/comment-viewer/windowApi";
import {
  detectObsWebsocketConfig,
  type ObsWsConfig,
} from "../../features/comment-viewer/obsApi";
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
  streamEventRemainingLabel,
  type StreamEventRound,
} from "../../features/obs-effects/streamEventRound";
import {
  effectConditionCount,
  EFFECT_OUTPUT_LABEL,
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

  // 前提ステータス。null = 未取得。
  // ⚠⚠ 061k: **窓ごとに 1 つずつ持つ**（片方の値でもう片方を代表させない）。
  const [effectWindowOpen, setEffectWindowOpen] = useState<boolean | null>(null);
  const [stageWindowOpen, setStageWindowOpen] = useState<boolean | null>(null);
  const [viewerOpen, setViewerOpen] = useState<boolean | null>(null);
  const [obsConfig, setObsConfig] = useState<ObsWsConfig | null>(null);
  const [obsConfigLoaded, setObsConfigLoaded] = useState(false);

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

  // OBS の WebSocket 設定は read-only 検出（044a の既存コマンドをそのまま使う）。書き込みは一切しない（§5）。
  // ⚠ ポーリングしない（OBS 側で有効化したら画面を開き直せば反映される＝コメビュ窓の設定カードと同じ扱い）。
  useEffect(() => {
    void detectObsWebsocketConfig().then((cfg) => {
      setObsConfig(cfg);
      setObsConfigLoaded(true);
    });
  }, []);

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
   * 061i: **窓を閉じる**（前提ステータスの「ウィンドウを閉じる」＝明示操作だけ・判断 1）。
   *
   * ⚠⚠ **設定（`EFFECT_OVERLAY_ENABLED_KEY`）は false にしない。** これは「条件を消す」操作ではなく
   * 「いま出ている窓を片付ける」操作で、**条件はそのまま残る**（＝アプリを開き直せばまた開く）。
   * 混ぜると「窓を閉じたら条件も無効になった」という、旧トグルと同じ二度手間へ戻る。
   */
  const closeEffectOverlay = useCallback(
    (output: EffectOutput) => {
      runOverlayOp(
        output,
        output === "stage" ? closeStageOverlayWindow : closeEffectOverlayWindow,
      );
    },
    [runOverlayOp],
  );

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
   * 061i: 前提ステータスに出す「表示する条件」の件数。⚠ 数え方の持ち主は `effectAssignments.ts`。
   *
   * ⚠⚠ **061k: 行は 1 本のまま（判断 11）だが、内訳を添える。**
   * 出力窓が 2 本になったので、合計だけだと
   * **「ステージ窓は表示中なのにステージ条件が 0 件」がどこにも出ない**——
   * テスト表示は条件が無くても 2 窓を開く（判断 8）ので、この状態は普通に発生する。
   * 061a 以来の「**黙って何も起きない状態を作らない**」を守るために内訳を出す。
   * ⚠ 行を 2 本に割らないのは、ユーザーが最初に確かめたいのが「条件を作ったか」だから（判断 11）。
   */
  const conditionCount = useMemo(
    () => effectConditionCount(effectTemplates.conditions),
    [effectTemplates.conditions],
  );
  /** 061k: 出力先ごとの件数（窓を開く判定と、上の内訳表示に使う）。 */
  const countByOutput = useMemo(
    () =>
      Object.fromEntries(
        EFFECT_OUTPUTS.map((o) => [
          o,
          effectConditionCount(effectTemplates.conditions, o),
        ]),
      ) as Record<EffectOutput, number>,
    [effectTemplates.conditions],
  );
  /**
   * 061k: 前提ステータスの「エフェクトのウィンドウ」2 行ぶんの材料。
   *
   * ⚠ 061k レビュー Q-4（受容・修正不要）: **すぐ上の 2 つと違って `useMemo` にしていない。**
   * 意図＝これは JSX へ直接流す 2 要素の並べ替えにすぎず、上の 2 つのように**別の計算の入力になる
   * 派生値ではない**（`countByOutput` を memo したのは `effectConditionCount` を 2 回回すため）。
   * 2 要素の object 生成は毎レンダーやっても測れる差にならず、memo すると
   * 「依存に `stageWindowOpen` / `effectWindowOpen` / `countByOutput` を並べる」ぶん**取りこぼしの面が増える**。
   * **再修正トリガー**＝この配列を `useEffect` の依存や `React.memo` した子へ渡すようになったとき
   * （そのとき参照の同一性が意味を持つので memo 化する）。
   */
  const windowRows = EFFECT_OUTPUTS.map((output) => ({
    output,
    open: output === "stage" ? stageWindowOpen : effectWindowOpen,
    count: countByOutput[output],
  }));

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

  // ⚠ 「未検出（null）」と「検出したが無効（enabled=false）」を同じ扱いにするのは `SettingsView` と同じ判断
  // （どちらも「OBS 側で WebSocket サーバーを有効にする」という同一の対処になるため）。
  /**
   * 061l（判断 10）: 前提ステータスの「開催中のイベント」行の値。
   * ⚠ 未知 id（アプリ更新でレジストリから消えた）のときは「開催していません」へ倒す
   * ——`parseStreamEventRound` が既に落としているので通常は到達しないが、**表示側でも同じ側へ倒す**。
   */
  const runningEvent = round === null ? null : findStreamEvent(round.eventId);
  const roundStatusText =
    round === null || runningEvent === null
      ? "開催していません"
      : `${runningEvent.title}（${streamEventRemainingLabel(round, nowMs)}）`;

  const obsWsUsable = obsConfig !== null && obsConfig.enabled;
  const obsStatusText = !obsConfigLoaded
    ? "確認中…"
    : !obsWsUsable
      ? "無効（OBS の「ツール → WebSocket サーバー設定」で有効にしてください）"
      : obsConfig.authRequired
        ? `有効（ポート ${obsConfig.port}・パスワードあり）`
        : `有効（ポート ${obsConfig.port}）`;

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>OBSエフェクト</h2>
          {/* ⚠ 061i: 旧文（「投げ銭などに合わせて…」）はタブ 2 種を踏まえると狭い。
              ⚠ 061a レビュー Q-1 の規律＝**約束できることだけ書く**ので、「配信イベント」は
              まだ中身が無いことを踏まえて「これから足す」とは書かない（枠の説明に留める）。 */}
          {/* ⚠⚠ 061l（教訓 E-2）: **「ウィンドウ」を単数で書かない**——出力窓は用途別に 2 つある。
              061k は実機で 3 件・外部レビューで 4 件目の言い落としを踏んでいる。 */}
          <p>
            コメントに反応して出すエフェクトと、視聴者参加型の配信イベントを、配信画面用の専用ウィンドウ（用途別に
            2 つ）へ出します。
          </p>
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
            {/* 061d-1: 取り込み・一覧・削除・プレビュー。⚠ 材料（テンプレート）→ 使い道（条件）
                の順に並べる。⚠ **プレビューはこの画面の中だけ**で再生する（エフェクト窓へ出さない）。
                ⚠⚠ **061h: 「配信画面でテスト表示」がこのカードの各行に入った**（旧「投げ銭でエフェクトを出す」
                section ごと廃止したため）。停止中の注記を出せるように前提ステータスを渡す。
                ⚠⚠ **061i: 窓が停止中ならこのボタンが窓を開く**（＝条件を 1 つも作らずに OBS の
                位置合わせができる）。invoke は上の直列化キューを通す（判断 4）。 */}
            <EffectTemplateCard
              {...effectTemplates}
              effectWindowOpen={effectWindowOpen}
              stageWindowOpen={stageWindowOpen}
              openEffectOverlay={openEffectOverlay}
            />

            {/* 061d-2: イベント種別ごとの割り当て（＝061i 以降の呼び方は「エフェクトを表示する条件」）。
                ⚠ **材料の直後**に置く（テンプレートを取り込んでから条件を決める、という順に画面が並ぶ）。 */}
            <EffectAssignmentCard {...effectTemplates} />
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
            「タブごとに別の窓がある」と読めてしまう。⚠ **061k で出力窓が 2 本になったら見直す。** */}
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>配信画面に表示</h3>
            {/* ⚠ 061k: 用途別に 2 つ開く（コーナー＝小さめ／全画面＝ステージ）。 */}
            <p>
              エフェクト専用の透明なウィンドウを、用途別に 2
              つ開きます。OBS では「ウィンドウキャプチャ」でそれぞれ取り込みます。
            </p>
          </div>
          <div className={layout.panelBody}>
            {/* ⚠⚠ **061i: 「エフェクトを配信画面に表示する」トグルを廃止した**（判断 1・2）。
                ⚠ **OBS への取り込み手順（下の注記）は残す**——あれは「どうやって OBS に取り込むか」の
                唯一の説明で、トグルとは独立した情報である。 */}
            {/* ⚠⚠ 061k（判断 2・9）: **ウィンドウは用途別に 2 つある**ので、
                **それぞれの実際の窓名を出す**（ユーザーは OBS の一覧をこの文字列で探す）。
                ⚠ 窓名は `EFFECT_OUTPUT_WINDOW_TITLE` から引く（直書きすると片方が必ず嘘になる。
                Rust の契約テストが実タイトルとのバイト一致を固定している）。
                ⚠ **UI 上の呼び方（「コーナー」「全画面」）と窓名は別物**——既存窓の改名は禁止なので
                （既に OBS にソースを作ったユーザーが静かに壊れる）、**両方を併記する**。 */}
            <p className={styles.note}>
              ウィンドウは枠なし・最背面・透明で開くため、配信者の操作を邪魔しません。OBS では
              「ソースを追加 →
              ウィンドウキャプチャ」を選び、ウィンドウの一覧から次の名前を指定してください。
            </p>
            <ul className={styles.note}>
              {EFFECT_OUTPUTS.map((output) => (
                <li key={output}>
                  {EFFECT_OUTPUT_LABEL[output]}…「
                  {EFFECT_OUTPUT_WINDOW_TITLE[output]}」
                </li>
              ))}
            </ul>
            {/* ⚠⚠ 061k（判断 9 の受容）: テンプレートの大きさは**絶対 px** なので、
                コーナー用に作ったものを全画面へ出すと**相対的に小さく見える**。
                ⚠ **`fitScale` / `transform: scale()` は持ち込まない**（061d-1 レビュー Q-1 が
                「比率が同じでも枠の実寸が違えば見え方が変わる」を既に受容している）。⇒ 1 文で説明する。 */}
            <p className={styles.note}>
              2 つのウィンドウは大きさが違うため、同じエフェクトでも全画面のほうでは小さく見えます（エフェクトの大きさはテンプレート側で決まります）。
            </p>
            {/* ⚠ 061a レビュー（Q-1）: 旧文言は「（配信中には表示されません）」と断言していたが、
                起動時の窓復元経路があるため約束できなかった。ガイドが出る条件をそのまま書く。
                ⚠⚠ **061i（判断 3）で起点が変わった**——表示トグルが消えたので、ガイドを出すのは
                「配信画面でテスト表示」でウィンドウを開いたときだけ。**条件を設定して自動で開いたときは
                出さない**（＝条件を足すたびにガイドが OBS へ映るのを避ける）。 */}
            <p className={styles.note}>
              ウィンドウが停止中のときに「配信画面でテスト表示」を押すと、ウィンドウを開いたうえで、位置を確認するためのガイドが数十秒表示され、そのあと自動的に消えます（条件を設定してウィンドウが自動で開いたときや、アプリの起動時に復元されたときは表示されません）。
            </p>
          </div>
        </section>

        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>OBS へ自動で反映</h3>
            {/* ⚠⚠ 061k: **窓が 2 つになったので、片方だけ名指しすると嘘になる**（実機確認で発見）。
                ⚠ 窓名は表から引く（直書きすると片方が必ず古くなる）。 */}
            <p>
              OBS に
              {EFFECT_OUTPUTS.map((o) => `「${EFFECT_OUTPUT_WINDOW_TITLE[o]}」`).join(
                "と",
              )}
              のウィンドウキャプチャを自動で追加します（既にあれば再利用します）。
            </p>
          </div>
          <div className={layout.panelBody}>
            <ToggleSwitch
              label="エフェクトのウィンドウを OBS へ自動で追加する"
              checked={obsAutoAdd}
              onChange={handleObsAutoAddToggle}
            />
            <p className={styles.note}>
              この設定はエフェクトのウィンドウにだけ使われます（コメント一覧・固定コメントの自動追加は、コメントビューアの設定にある別の項目です）。
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
                がありうる。それでもこの書き方に留めるのは、②は**すぐ下の前提ステータス**
                （「エフェクトのウィンドウ＝停止中」）が拾っており、①は wire を変えない限り塞げない
                既知の受容事項（046d / 061a Q-2）で、ここに書くと**注記が言い訳だらけになって
                本来伝えたい 3 要素が埋もれる**から。⚠ 061a Q-1 の規律（約束できることだけ書く）に対しては
                「確認できる場所」までは真、という線で受容している。
                **再修正トリガー**＝「設定カードを見たのにエフェクトの結果が分からない」という
                問い合わせが実際に出たとき（＝ 046d / 061a Q-2 のトリガーと同じ。wire を広げるときに
                この注記も種別つきの文へ書き換える）。 */}
            <p className={styles.note}>
              OBS
              への追加に失敗したときだけ、コメントビューアのコメント画面の上部に赤い文字が出ます（成功したときは何も出ません）。追加できたかどうかは、コメントビューアの設定（歯車ボタン）にある「OBSに表示」で確認できます。コメントビューアを開いていないあいだは反映そのものが行われないため、どちらも出ません。
            </p>

            <div className={styles.statusList}>
              {/* ⚠⚠ 061i: **「表示する条件」行**（(3)）。表示トグルを消した以上、
                  「条件が 0 件だから何も出ない」という状態を**ここでしか観測できない**
                  ——061a 以来の規律「黙って何も起きない状態を作らない」の維持である。
                  ⚠ 数え方の持ち主は `effectAssignments.ts`（061j で保存形が変わってもここは無改変）。 */}
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>表示する条件</span>
                <span
                  className={`${styles.statusValue} ${conditionCount === 0 ? styles.blocked : ""}`}
                >
                  {conditionCount === 0
                    ? "設定されていません"
                    : `${conditionCount} 件（${EFFECT_OUTPUTS.map(
                        (o) => `${EFFECT_OUTPUT_LABEL[o]} ${countByOutput[o]}`,
                      ).join("・")}）`}
                </span>
              </div>
              {/* ⚠⚠ 061k（判断 11）: **出力窓が 2 本になったので行も 2 本**。
                  各行に「ウィンドウを閉じる」／「ウィンドウを開く」（061i レビュー Q-2 の非対称の
                  埋め合わせも 2 組）を持たせる。⚠ **窓の状態も件数も出力先ごとに独立**で、
                  片方の値でもう片方を代表させない。 */}
              {windowRows.map(({ output, open, count }) => (
                <div key={output} className={styles.statusRow}>
                  {/* ⚠ **1 つのテキストノードとして組む**（`{"..."}{label}{"..."}` と分けると
                      DOM 上で 3 ノードに割れ、`getByText` の完全一致が効かなくなる）。 */}
                  <span className={styles.statusLabel}>
                    {`エフェクトのウィンドウ（${EFFECT_OUTPUT_LABEL[output]}）`}
                  </span>
                  <span className={styles.statusValueGroup}>
                    <span
                      className={`${styles.statusValue} ${open === false ? styles.blocked : ""}`}
                    >
                      {open === null ? "確認中…" : open ? "表示中" : "停止中"}
                    </span>
                    {/* ⚠⚠ 061i（判断 1）: **閉じるのは明示操作だけ**——「条件が全部『出さない』に
                        なったら自動で閉じる」は作らない（窓が消えると OBS のウィンドウキャプチャが
                        真っ黒になる・親 046 の規律）。⚠ トグルではなく**アクション**にしてあるのが要点で、
                        押しても**条件（設定）は消えない**＝アプリを開き直せばまた開く。
                        ⚠ 表示中のときだけ出す（停止中に「閉じる」を出しても押せることが無い）。
                        ⚠⚠ **061k: これは `docs/security.md` §1 が名指しする停止導線でもある**——
                        **両方**を閉じたときに sidecar が落ちる（＝コメント取得が止まる）。 */}
                    {open === true && (
                      // ⚠⚠ 061k: **ボタンが 2 つ並ぶので、アクセシブル名でどちらか分かるようにする。**
                      //   見た目の文言は短いまま（行の左のラベルで文脈が読める）だが、
                      //   スクリーンリーダーは行を跨いで読まないので `aria-label` で窓名を足す。
                      <Button
                        type="button"
                        aria-label={`${EFFECT_OUTPUT_LABEL[output]}のウィンドウを閉じる`}
                        onClick={() => closeEffectOverlay(output)}
                      >
                        ウィンドウを閉じる
                      </Button>
                    )}
                    {/* ⚠⚠ 061i レビュー Q-2: **「閉じる」だけあって「開く」が無い**非対称を埋める。
                        自動 open の契機は **0 → 1 件の遷移だけ**なので、条件が既に 1 件以上ある状態では
                        **何をしても窓が開かない**（アプリを再起動するか、テスト表示を押すしかない）。
                        ⚠ **条件が 0 件のときは出さない**——出しても「開いたのに何も出ない」窓を
                        作るだけで、そのときの正しい行動は条件を設定すること（上のカードへ誘導する）。
                        ⚠⚠ **061k: 判定は「その出力先の件数」**（合計だと「コーナー条件しか無いのに
                        ステージ窓を開く」ボタンが出て、まさに「開いたのに何も出ない窓」になる）。
                        ⚠ **ガイド旗は立てない**（判断 3 の起点は「テスト表示」だけに保つ）。 */}
                    {open === false && count > 0 && (
                      <Button
                        type="button"
                        aria-label={`${EFFECT_OUTPUT_LABEL[output]}のウィンドウを開く`}
                        onClick={() => openEffectOverlay(output)}
                      >
                        ウィンドウを開く
                      </Button>
                    )}
                  </span>
                </div>
              ))}
              {/* ⚠⚠ 061l（判断 10）: **「開催中のイベント」行を 1 本**。
                  061a 以来の規律「黙って何も起きない状態を作らない」——「開始したのにステージ窓が停止中」を
                  **観測できる場所**が要る。⚠ **行は 1 本だけ**（061k で既に 4 行あるので増やしすぎない）。
                  ⚠⚠ **ここで「ステージ窓が停止中」を二重に警告しない**——**すぐ上の
                  「エフェクトのウィンドウ（全画面（ステージ））」行が既に「停止中」を語っている**。
                  ⚠ `.blocked` を付けないのも同じ理由（「開催していません」は不足ではなく通常の状態）。
                  ⚠ 残りは**分まで**（秒を出すと毎秒再描画になる・判断 10）。 */}
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>開催中のイベント</span>
                <span className={styles.statusValue}>{roundStatusText}</span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>コメントビューア</span>
                <span
                  className={`${styles.statusValue} ${viewerOpen === false ? styles.blocked : ""}`}
                >
                  {viewerOpen === null
                    ? "確認中…"
                    : viewerOpen
                      ? "開いています"
                      : "閉じています"}
                </span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>OBS の WebSocket</span>
                <span
                  className={`${styles.statusValue} ${obsConfigLoaded && !obsWsUsable ? styles.blocked : ""}`}
                >
                  {obsStatusText}
                </span>
              </div>
            </div>

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
            {viewerOpen === false && (
              <div className={styles.prerequisite}>
                <p className={styles.prerequisiteText}>
                  コメントビューアが閉じているあいだは、OBS
                  への反映は行われません。コメントビューアを開くと、そのときに反映されます。
                </p>
                {/* ⚠⚠ **061i レビュー S-1: 停止手段の名前が変わったので書き換えた。**
                    旧文は「エフェクトの表示を OFF にしてください」と書いていたが、そのトグルは
                    **061i で廃止した**——docs/security.md §1「取得の停止条件」が
                    「取得が続いていることと**その止め方**を明示する導線を必ず保つこと」を要求しており、
                    **存在しない操作を案内するのはその導線を壊すのと同じ**である
                    （061a Q-1「約束できることだけ書く」の、より強い形の違反）。
                    ⚠ 新しい止め方＝**すぐ上の「エフェクトのウィンドウ」行の「ウィンドウを閉じる」**。
                    ⚠ 同じ文言をツール管理側（`MainScreen` の停止フィードバック）も持っているので、
                    **片方だけ直さないこと**（§1 が導線として名指ししているのは 2 か所ある）。 */}
                {/* ⚠⚠ **061k: 「ウィンドウを閉じる」が 2 つになったので条件も 2 窓ぶんになった。**
                    `docs/security.md` §1「取得の停止条件」は
                    「**どちらか 1 つでも開いていれば取得が続く**」なので、
                    **「両方閉じる」と書かないと嘘になる**（片方だけ閉じても止まらない）。
                    ⚠ 同じ文言をツール管理側（`MainScreen` の停止フィードバック）も持っている。
                    **片方だけ直さないこと**（§1 が導線として名指ししているのは 2 か所ある）。 */}
                {/* ⚠ 061k レビュー Q-3（修正）: 呼び方は直書きせず `EFFECT_OUTPUT_LABEL` から引く
                    （直書きだと、表を直したときにここだけ古くなる＝061k が窓名で塞いだのと同じ穴を
                    「呼び方」で作ることになる）。⚠ 窓名（`EFFECT_OUTPUT_WINDOW_TITLE`）とは別物。 */}
                <p className={styles.prerequisiteText}>
                  {`エフェクトのウィンドウ（${EFFECT_OUTPUTS.map(
                    (o) => EFFECT_OUTPUT_LABEL[o],
                  ).join("・")}のどちらか）を表示したままコメントビューアを閉じた場合は、エフェクトの表示とコメントの取得がそのまま続きます。取得を止めたいときは、コメントビューアを開いて取得を停止するか、上の「エフェクトのウィンドウ」にある「ウィンドウを閉じる」を`}
                  <strong>2 つとも</strong>押してください。
                </p>
                <p className={styles.prerequisiteText}>
                  エフェクトのウィンドウを 2
                  つとも表示していない状態でコメントビューアを閉じたときは、コメントの取得も止まります（取得の開始はコメントビューアから行います）。
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
