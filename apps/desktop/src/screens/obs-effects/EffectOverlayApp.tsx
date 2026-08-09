import { useEffect, useState } from "react";
import {
  loadEffectOverlayGuidePending,
  saveEffectOverlayGuidePending,
} from "../../features/comment-viewer/overlaySettings";
// ⚠ **意匠のためではなく、透過の :global ルールをこの窓にも効かせるために import する。**
// 背景透過（`html[data-overlay="1"]` の `background: transparent` と `overflow: hidden`）は
// `OverlayApp.module.css` にしか定義されておらず、その 1 枚が**バンドルに含まれていること**が前提になる。
// 現状は `App.tsx` が `OverlayApp` を静的 import しているので必ず含まれるが、それは暗黙の依存で、
// 将来 `OverlayApp` を lazy 化すると**この窓だけ背景が不透明になる**（原因が非常に追いにくい）。
// 明示的に依存を書いておくことで、その事故を構造で防ぐ（`PinnedOverlayApp` も同じ 1 枚に依存している）。
import "../comment-viewer/OverlayApp.module.css";
import styles from "./EffectOverlayApp.module.css";

/**
 * 061a: セットアップ用ガイドを出しておく時間（ミリ秒）。**この窓が開いてからの経過**で測る。
 *
 * ⚠⚠ **「配信中に出ない」を満たすための仕掛けはこれ 1 つ**（061a のタスクファイルが「実装時に決めて
 * コメントに残す」と指定した論点）。他に検討したのは 2 案で、どちらも採らなかった:
 *
 * - **「`obs-effects` 画面を開いている間だけ出す」**: main 窓とこの窓は**別 webview** なので、
 *   「開いている」を伝えるには localStorage のフラグ＋`storage` が要る。⚠ **main 窓が異常終了すると
 *   フラグが立ったまま残る＝fail-open**（配信中にガイドが出続ける）。ハートビートで fail-safe にはできるが、
 *   数秒ごとの localStorage 書込が**全窓へ `storage` を撒く**ので割に合わない。
 * - **「設定トグルで消せる」**: 既定 ON だと配信中に出うる／既定 OFF だとセットアップができない。
 *
 * 採った案（時間で自動的に消す）が満たすもの:
 * - **fail-safe**——時間で必ず消えるので、**消し忘れが構造的に起きない**。
 * - **出し直せる**——表示 OFF → ON で窓が作り直されるのでもう一度出る（`ObsEffectsScreen` に明記済み）。
 *
 * ⚠⚠ **061a レビュー（Q-1）で「時間」だけでは足りないと判明した。** 当初の論証は「窓が開くのは
 * ユーザーが表示トグルを ON にした明示操作のときだけ ＝ 配信開始時にはとっくに消えている」だったが、
 * **同じ 061a が `MainWindowApp` のマウント（＝アプリ起動）で窓を開き直す経路を新設したため、この前提は偽**。
 * 本アプリは `boot_launch_presets` を持つ配信準備時のランチャなので、「設定 ON のまま配信直前に起動」で
 * ガイドが 30 秒間 OBS のキャプチャに映ってしまう。
 * → **時間による自動消灯に加えて、`EFFECT_OVERLAY_GUIDE_PENDING_KEY`（ワンショット旗）で
 * 「明示操作で開いたときだけ出す」を担保する**（下の `useState` 初期化子）。旗の設計は同キーの JSDoc が正。
 *
 * 値の根拠: OBS で「ソースを追加 → ウィンドウキャプチャ → 一覧から選ぶ → 位置合わせ」まで一巡する実測想定。
 * **再修正トリガー**＝実機で「合わせ終わる前に消える」なら伸ばす（60 秒程度まで）。
 */
const SETUP_GUIDE_VISIBLE_MS = 30_000;

/**
 * 061a: エフェクト専用の背景透過オーバーレイ（別ウィンドウ label `effect-overlay`）の描画本体。
 *
 * **この時点では何も表示しない**（エフェクトの中身は 061b）。ここにあるのは
 * ①透過窓としての体裁 ②OBS のセットアップ時に窓の位置が分かるガイド、の 2 つだけ。
 *
 * **WS へは一切接続しない**（`connectCommentStream` を呼ばない＝送受信フレームゼロ・新規外部通信ゼロ）。
 * ⚠ これは 061b の設計上の要件でもある——061b は**コメビュ窓が localStorage へ書いた `EffectRequest` を
 * `storage` 購読で受ける**（新規 WS も Tauri イベントも増やさない）。`PinnedOverlayApp` と同じ構え。
 * ⚠ **その帰結として「コメビュ窓が閉じているとエフェクトは出ない」**（`obs-enable` を送れる WS ハンドルも
 * sidecar のライフサイクルもコメビュ窓に紐づいているため）。この事実は `ObsEffectsScreen` の
 * 前提ステータスでユーザーへ明示する。
 *
 * 背景透過: `OverlayApp` / `PinnedOverlayApp` と同じく、この窓の document にだけ `data-overlay="1"` 属性を
 * 立て、`OverlayApp.module.css` の属性ガード付き `:global` ルールで透明化する（unmount で属性を外す）。
 * 透過窓の生成（transparent / decorations(false) / always_on_bottom / focused(false) / 既定サイズ）は
 * Rust の `open_effect_overlay_window` が担い、frontend からは窓を生成しない。
 *
 * ⚠⚠ **安定クラス `sd-overlay` は付けない。** 060d のカスタム CSS テーマの注入先は `comment-overlay` のみで、
 * 窓の区別をこのクラスの有無で表している（`PinnedOverlayApp` にも付いていない）。
 * 静的ガード `check-css-guards.mjs` の (10-d) がこの窓についても否定検査している。
 *
 * ⚠ **061b がここへ足すもの / 足さないもの**:
 *   足す＝`effectQueue` の購読（localStorage ＋ `storage`）・`EffectRequest` の描画・表示時間・フェード。
 *   足さない＝WS 接続／コメント本文・アバター（親 061 と 046a の判断）／マウント時に過去のエフェクトを再生すること
 *   （エフェクトは「その瞬間に出ないと意味がない」ので、届かなかったら諦める＝046b との明確な差）。
 */
export function EffectOverlayApp() {
  // ⚠ 061a レビュー（Q-1）: 初期値は**ワンショット旗の有無**で決める（旧実装は無条件 true だった）。
  // 旗を立てるのは `ObsEffectsScreen` の表示トグル ON だけなので、
  //   - 明示操作で開いた窓 → 出る（「表示 OFF → ON で出し直せる」も維持される）
  //   - `App.tsx` の起動時復元で開いた窓 → **出ない**（＝配信直前にアプリを起動しても配信画面を汚さない）
  // ⚠ **読むのは初期化子・倒すのは下の effect** と分けてある。初期化子で消すと StrictMode の
  // 二重レンダーで 2 回目が旗を見失い、dev だけガイドが出なくなる（実装時に踏みうる罠）。
  const [guideVisible, setGuideVisible] = useState(loadEffectOverlayGuidePending);

  // ⚠ 旗は**一度読んだら倒す**（次に開く窓では出ない）。同じ値の上書きなので StrictMode の
  // 二重実行でも冪等で、cleanup は要らない（旗を立て直すのは main 窓の明示操作だけ）。
  useEffect(() => {
    saveEffectOverlayGuidePending(false);
  }, []);

  // この窓の document にだけ背景透明化の目印を立てる（main / comment-viewer 窓には波及しない）。
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay", "1");
    return () => {
      root.removeAttribute("data-overlay");
    };
  }, []);

  // セットアップ用ガイドを一定時間で畳む（上の SETUP_GUIDE_VISIBLE_MS の JSDoc が判断の根拠）。
  // ⚠ cleanup で必ず取り消す（StrictMode の二重実行でもタイマーが残らない）。
  useEffect(() => {
    const timer = window.setTimeout(
      () => setGuideVisible(false),
      SETUP_GUIDE_VISIBLE_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={styles.root}>
      {guideVisible && (
        // ⚠ 破線の枠は「ここがキャプチャ範囲」を示すためのもので、061b のエフェクトの意匠ではない。
        <div className={styles.guide}>
          <p className={styles.guideTitle}>StreamDock エフェクト</p>
          <p className={styles.guideBody}>
            この枠にエフェクトが表示されます。
            <br />
            OBS で「ソースを追加 → ウィンドウキャプチャ」を選び、
            <br />
            ウィンドウの一覧から「StreamDock エフェクト」を指定してください。
          </p>
          {/* ⚠ 061a レビュー（Q-1）: 旧文言「配信中には表示されません」は、起動時の窓復元経路があるため
              約束できない断言だった。ガイドが出る条件（＝明示操作の直後だけ）をそのまま書く。 */}
          <p className={styles.guideBody}>
            このガイドは、表示を ON にした直後だけ出て自動的に消えます。
          </p>
        </div>
      )}
    </div>
  );
}
