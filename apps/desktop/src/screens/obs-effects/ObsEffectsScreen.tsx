import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadEffectObsAutoAdd,
  saveEffectObsAutoAdd,
  loadEffectOverlayEnabled,
  saveEffectOverlayEnabled,
  saveEffectOverlayGuidePending,
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
// ⚠ ディレクトリ跨ぎの再利用。トグルは `role="switch"` の a11y ごと既製なので、main 窓のために
// 別実装を起こすと**新しい px / weight を発明する**ことになる（061a の要件に反する）。
// 再修正トリガー＝3 画面目がこれを使うようになったら `components/` へ移す。
import { ToggleSwitch } from "../comment-viewer/ToggleSwitch";
import { Button } from "../../components/primitives";
import layout from "../formLayout.module.css";
import styles from "./ObsEffectsScreen.module.css";

/**
 * 061a: main 窓の「OBSエフェクト」画面（`Screen` の `obs-effects`）。ヘッダーの導線が
 * `ComingSoonScreen` ではなくここを出すようになった。
 *
 * **061a 時点で置くのは 3 つだけ**——表示トグル・OBS 自動反映トグル・前提ステータス。
 * テンプレート一覧・割り当ては 061d、エフェクトの中身とテスト発火は 061b。
 *
 * ⚠⚠ **この画面の設計を決めている構造上の制約**（061a の実装で判明した最大の論点）:
 *
 * `obs-enable` を sidecar へ送れるのは **コメビュ窓だけ**である。理由は 3 つ:
 *   ①`connectCommentStream` を呼んでいるのは `CommentViewerApp` と `OverlayApp` の 2 つだけで、
 *     WS ハンドル（`enableObs` を持つ `CommentStreamHandle`）を握っているのは前者のみ。
 *   ②sidecar のライフサイクルは**コメビュ窓に紐づく**（`open_comment_viewer_window` が `ensure_started`、
 *     窓の close で `shutdown`）＝コメビュ窓が閉じていれば sidecar はそもそも動いていない。
 *   ③main 窓から WS を張る案は採らなかった——`get_comment_stream_port` が null の間**毎秒 invoke が
 *     永久ループ**し、かつ `connectCommentStream` は `onComments` 必須なので**第三者のコメント本文が
 *     main 窓へ流れ込む**（§9 の後退）。
 *
 * したがってこの画面の役割分担はこうなっている:
 *   - **表示トグル**（窓の open/close）＝**この画面が直接 invoke する**。コメビュ窓に依存しない。
 *     アプリ定義コマンドは ACL 対象外なので main 窓からそのまま呼べる（`default.json` は差分ゼロ）。
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

export function ObsEffectsScreen() {
  // 表示トグル（＝エフェクト窓を出すか）。**永続値が正・窓が従**（046b の `pinnedOverlayEnabled` と同じ扱い）。
  // 起動時の窓復元は `App.tsx`（`MainWindowApp`）が担うので、ここはユーザー操作だけを見る。
  const [enabled, setEnabled] = useState(() => loadEffectOverlayEnabled());
  const [obsAutoAdd, setObsAutoAdd] = useState(() => loadEffectObsAutoAdd());

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
   * 表示トグル。**窓の open/close はこの画面が直接 invoke する**（コメビュ窓に依存しない）。
   *
   * ⚠ **OBS へは一切繋がない。** 反映はコメビュ窓が `storage` 購読で代行する（上のクラス JSDoc）。
   * ⚠ state と永続値を invoke の**前に**同期で立てるのは 046b と同じ判断——この state は実窓のミラーではなく
   * **永続設定**なので、成否に依らず即座にユーザーの意思を記録する。失敗しても次回起動時の復元 effect
   * （`MainWindowApp`）が実窓を設定へ追いつかせる（＝設定が正・窓が従で一貫する）。
   */
  const handleEnabledToggle = (next: boolean) => {
    setEnabled(next);
    saveEffectOverlayEnabled(next);
    // ⚠ 061a レビュー（Q-1）: **ここが「セットアップ用ガイドを出してよい」唯一の起点**（＝明示操作）。
    // `App.tsx` の起動時復元は旗を立てないので、配信直前にアプリを起動してもガイドは出ない。
    // 旗は窓側（`EffectOverlayApp`）がマウント時に読んで倒す。詳細は
    // `EFFECT_OVERLAY_GUIDE_PENDING_KEY` の JSDoc。⚠ **open を投げる前に立てる**
    //（窓のマウントは invoke の解決より後なので順序は保証されるが、依存させないため先に書く）。
    if (next) saveEffectOverlayGuidePending(true);
    effectOverlayOpRef.current = effectOverlayOpRef.current
      .then(() => (next ? openEffectOverlayWindow() : closeEffectOverlayWindow()))
      .then(refreshStatus)
      .catch(() => {});
  };

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
          <p>
            投げ銭などに合わせて配信画面へエフェクトを出すための、専用ウィンドウを用意します。
          </p>
        </div>
      </div>

      <div className={styles.stack}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>配信画面に表示</h3>
            <p>
              エフェクト専用の透明なウィンドウを開きます。OBS では「ウィンドウキャプチャ」で取り込みます。
            </p>
          </div>
          <div className={layout.panelBody}>
            <ToggleSwitch
              label="エフェクトを配信画面に表示する"
              checked={enabled}
              onChange={handleEnabledToggle}
            />
            <p className={styles.note}>
              ウィンドウは枠なし・最背面・透明で開くため、配信者の操作を邪魔しません。OBS では
              「ソースを追加 →
              ウィンドウキャプチャ」を選び、ウィンドウの一覧から「StreamDock
              エフェクト」を指定してください。
            </p>
            {/* ⚠ 061a レビュー（Q-1）: 旧文言は「（配信中には表示されません）」と断言していたが、
                起動時の窓復元経路があるため約束できなかった。ガイドは**このトグルを ON にした直後だけ**
                出る（アプリ起動時の自動復元では出ない）ので、その条件をそのまま書く。 */}
            <p className={styles.note}>
              このトグルを ON にした直後だけ、位置を確認するためのガイドが数十秒表示され、そのあと自動的に消えます
              （アプリの起動時にウィンドウが復元されたときは表示されません）。もう一度出したいときは、このトグルを一度
              OFF にしてから ON に戻してください。
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
              追加や失敗の結果はコメントビューアの画面上部に表示されます。
            </p>

            <div className={styles.statusList}>
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>エフェクトのウィンドウ</span>
                <span
                  className={`${styles.statusValue} ${effectWindowOpen === false ? styles.blocked : ""}`}
                >
                  {effectWindowOpen === null
                    ? "確認中…"
                    : effectWindowOpen
                      ? "表示中"
                      : "停止中"}
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
                OBS への反映を送れる窓が存在せず、061b 以降はエフェクトそのものも出ない。
                コメビュ窓を開いた時点で `CommentViewerApp` のマウント時 reconcile が反映を実行する。 */}
            {viewerOpen === false && (
              <div className={styles.prerequisite}>
                <p className={styles.prerequisiteText}>
                  コメントビューアが閉じているあいだは、OBS
                  への反映は行われません（エフェクトも表示されません）。コメントビューアを開くと、そのときに反映されます。
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
