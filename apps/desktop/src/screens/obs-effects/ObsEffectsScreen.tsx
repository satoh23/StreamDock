import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadEffectObsAutoAdd,
  saveEffectObsAutoAdd,
} from "../../features/comment-viewer/overlaySettings";
import {
  closeEffectOverlayWindow,
  isCommentViewerOpen,
  isEffectOverlayOpen,
  openCommentViewerWindow,
  openEffectOverlayWindow,
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
import { effectConditionCount } from "./effectAssignments";
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
 * - **タブ**（[`Tabs`]）… 「コメントで出すエフェクト」＝テンプレートと条件／「配信イベント」＝**061l まで枠だけ**。
 *   ⚠ **`ComingSoonScreen` は流用しない**（あれは画面まるごと用のダミーページで、ヘッダー導線の意味論を持つ）。
 * - **共通の下部**（両タブの外）… 「配信画面に表示」（OBS への取り込み手順）／「OBS へ自動で反映」／前提ステータス。
 *   ⚠ **どちらのタブで使うエフェクトも同じ窓・同じ OBS ソースに出る**ので、タブの中に入れると
 *   「タブごとに別の窓がある」と読めてしまう。⚠ **061k で出力窓が 2 本になったらここを見直す。**
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
 * 061i: タブの定義（判断 6・(2)）。
 * ⚠ **「配信イベント」は 061l まで中身が無い**が、**枠はここで用意する**——
 * 用途の違う 2 種類（コメント条件に反応する演出／視聴者参加型の配信イベント）を分ける器が無いと、
 * 061l で画面が「条件の表の下にイベント一覧がぶら下がる」形になってしまう。
 */
const EFFECT_TABS: readonly TabItem[] = [
  { id: "comment", label: "コメントで出すエフェクト" },
  { id: "event", label: "配信イベント" },
];

export function ObsEffectsScreen() {
  const [obsAutoAdd, setObsAutoAdd] = useState(() => loadEffectObsAutoAdd());
  /** いま出しているタブ。⚠ 061i: **状態はこの画面が持つ**（`Tabs` は表示専用）。 */
  const [tab, setTab] = useState<string>(EFFECT_TABS[0].id);

  // 前提ステータス。null = 未取得。
  const [effectWindowOpen, setEffectWindowOpen] = useState<boolean | null>(null);
  const [viewerOpen, setViewerOpen] = useState<boolean | null>(null);
  const [obsConfig, setObsConfig] = useState<ObsWsConfig | null>(null);
  const [obsConfigLoaded, setObsConfigLoaded] = useState(false);

  // 046b レビューと同じ連打レース対策: `open_effect_overlay_window` は `#[tauri::command(async)]`
  // （別スレッド・窓生成で数百 ms）、`close_effect_overlay_window` は同期コマンドなので、素の
  // `void invoke()` だと ON→OFF 連打で「close が『窓なし＝no-op』で先に流れ、その後 open が窓を作る」
  // 順序が起こりうる。この機能も自動 close 経路を持たないため、その状態は**セッション中に解消せず**
  // 「設定 OFF なのにエフェクト窓が OBS に映り続ける」になる。前の要求の完了後に次を流す。
  // `.catch` はキューを詰まらせないための握りつぶし（reject を伝播させると以降の開閉要求が全て死ぬ）。
  const effectOverlayOpRef = useRef<Promise<void>>(Promise.resolve());

  const refreshStatus = useCallback(() => {
    void isEffectOverlayOpen().then(setEffectWindowOpen);
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
  const runEffectOverlayOp = useCallback(
    (op: () => Promise<void>) => {
      effectOverlayOpRef.current = effectOverlayOpRef.current
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
  const openEffectOverlay = useCallback(() => {
    setEffectWindowOpen(true);
    runEffectOverlayOp(openEffectOverlayWindow);
  }, [runEffectOverlayOp]);

  /**
   * 061i: **窓を閉じる**（前提ステータスの「ウィンドウを閉じる」＝明示操作だけ・判断 1）。
   *
   * ⚠⚠ **設定（`EFFECT_OVERLAY_ENABLED_KEY`）は false にしない。** これは「条件を消す」操作ではなく
   * 「いま出ている窓を片付ける」操作で、**条件はそのまま残る**（＝アプリを開き直せばまた開く）。
   * 混ぜると「窓を閉じたら条件も無効になった」という、旧トグルと同じ二度手間へ戻る。
   */
  const closeEffectOverlay = useCallback(() => {
    runEffectOverlayOp(closeEffectOverlayWindow);
  }, [runEffectOverlayOp]);

  // ⚠⚠ 061d-2: テンプレート一覧と割り当ての state は**この画面が 1 つだけ持つ**（061d-1 レビュー Q-9）。
  //   削除は「一覧」と「割り当て」の両方を書き換えるので、2 つのカードが別々に持つと片方が古くなる。
  // ⚠ 061i: 「条件が 0 → 1 件になったら窓を開く」の**判断はこの hook**（割り当ての保存経路を
  //   全部知っているのはあちらだけ）。**invoke と直列化はこの画面**（上の `runEffectOverlayOp`）。
  const effectTemplates = useEffectTemplates({ openEffectOverlay });

  /** 061i: 前提ステータスに出す「表示する条件」の件数。⚠ 数え方の持ち主は `effectAssignments.ts`。 */
  const conditionCount = useMemo(
    () => effectConditionCount(effectTemplates.assignments),
    [effectTemplates.assignments],
  );

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
          <p>
            コメントに反応して出すエフェクトと、視聴者参加型の配信イベントを、配信画面用の専用ウィンドウへ出します。
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
              openEffectOverlay={openEffectOverlay}
            />

            {/* 061d-2: イベント種別ごとの割り当て（＝061i 以降の呼び方は「エフェクトを表示する条件」）。
                ⚠ **材料の直後**に置く（テンプレートを取り込んでから条件を決める、という順に画面が並ぶ）。 */}
            <EffectAssignmentCard {...effectTemplates} />
          </div>
        ) : (
          <div className={styles.stack} role="tabpanel">
            <section className={layout.panel}>
              <div className={layout.panelHead}>
                <h3>配信イベント</h3>
                <p>視聴者が参加できるイベントを配信画面に出す機能です。</p>
              </div>
              <div className={layout.panelBody}>
                {/* ⚠⚠ **061l まで枠だけ**（タスクファイルの (2)）。⚠ `ComingSoonScreen` は
                    「画面まるごとが未実装」を表すダミーページなので流用しない
                    （ヘッダーのセクション導線の意味論を持っており、`headerSections` の
                    「OBSエフェクトは準備中ページを出さない」という担保と衝突する）。
                    ⚠ 061a Q-1 の規律で**約束できることだけ書く**＝時期も内容も断言しない。 */}
                <p className={styles.note}>
                  この機能は準備中です。コメントに反応して出すエフェクトは、左のタブから設定できます。
                </p>
              </div>
            </section>
          </div>
        )}

        {/* ⚠⚠ 061i: ここから下は**両タブの外**（画面下部の共通領域）。
            どちらのタブで使うエフェクトも**同じ窓・同じ OBS ソース**に出るため、タブの中に入れると
            「タブごとに別の窓がある」と読めてしまう。⚠ **061k で出力窓が 2 本になったら見直す。** */}
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>配信画面に表示</h3>
            <p>
              エフェクト専用の透明なウィンドウを開きます。OBS では「ウィンドウキャプチャ」で取り込みます。
            </p>
          </div>
          <div className={layout.panelBody}>
            {/* ⚠⚠ **061i: 「エフェクトを配信画面に表示する」トグルを廃止した**（判断 1・2）。
                ⚠ **OBS への取り込み手順（下の注記）は残す**——あれは「どうやって OBS に取り込むか」の
                唯一の説明で、トグルとは独立した情報である。 */}
            <p className={styles.note}>
              ウィンドウは枠なし・最背面・透明で開くため、配信者の操作を邪魔しません。OBS では
              「ソースを追加 →
              ウィンドウキャプチャ」を選び、ウィンドウの一覧から「StreamDock
              エフェクト」を指定してください。
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
            <p>
              OBS
              に「StreamDock エフェクト」のウィンドウキャプチャを自動で追加します（既にあれば再利用します）。
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
                    : `${conditionCount} 件`}
                </span>
              </div>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>エフェクトのウィンドウ</span>
                <span className={styles.statusValueGroup}>
                  <span
                    className={`${styles.statusValue} ${effectWindowOpen === false ? styles.blocked : ""}`}
                  >
                    {effectWindowOpen === null
                      ? "確認中…"
                      : effectWindowOpen
                        ? "表示中"
                        : "停止中"}
                  </span>
                  {/* ⚠⚠ 061i（判断 1）: **閉じるのは明示操作だけ**——「条件が全部『出さない』に
                      なったら自動で閉じる」は作らない（窓が消えると OBS のウィンドウキャプチャが
                      真っ黒になる・親 046 の規律）。⚠ トグルではなく**アクション**にしてあるのが要点で、
                      押しても**条件（設定）は消えない**＝アプリを開き直せばまた開く。
                      ⚠ 表示中のときだけ出す（停止中に「閉じる」を出しても押せることが無い）。 */}
                  {effectWindowOpen === true && (
                    <Button type="button" onClick={closeEffectOverlay}>
                      ウィンドウを閉じる
                    </Button>
                  )}
                  {/* ⚠⚠ 061i レビュー Q-2: **「閉じる」だけあって「開く」が無い**非対称を埋める。
                      自動 open の契機は **0 → 1 件の遷移だけ**なので、条件が既に 1 件以上ある状態では
                      **何をしても窓が開かない**（アプリを再起動するか、テスト表示を押すしかない）。
                      ⚠ 061h から「条件あり・表示トグル OFF」で持ち越したユーザー（＝061i が
                      救おうとしている当のユーザー）は、まさにこの状態で画面に入ってくる。
                      ⚠ **条件が 0 件のときは出さない**——出しても「開いたのに何も出ない」窓を
                      作るだけで、そのときの正しい行動は条件を設定すること（上のカードへ誘導する）。
                      ⚠ **ガイド旗は立てない**（判断 3 の起点は「テスト表示」だけに保つ）。 */}
                  {effectWindowOpen === false && conditionCount > 0 && (
                    <Button type="button" onClick={openEffectOverlay}>
                      ウィンドウを開く
                    </Button>
                  )}
                </span>
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
                <p className={styles.prerequisiteText}>
                  エフェクトのウィンドウを表示したままコメントビューアを閉じた場合は、エフェクトの表示とコメントの取得がそのまま続きます。取得を止めたいときは、コメントビューアを開いて取得を停止するか、上の「エフェクトのウィンドウ」にある「ウィンドウを閉じる」を押してください。
                </p>
                <p className={styles.prerequisiteText}>
                  エフェクトのウィンドウを表示していない状態でコメントビューアを閉じたときは、コメントの取得も止まります（取得の開始はコメントビューアから行います）。
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
