import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  loadPinned,
  PINNED_COMMENTS_KEY,
  type PinnedComment,
} from "../../features/comment-viewer/pinnedComments";
import {
  loadOverlayFont,
  loadOverlayShowSource,
  resolveOverlayFontStack,
  OVERLAY_FONT_KEY,
  OVERLAY_SHOW_SOURCE_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { fitScale } from "../../features/comment-viewer/overlayFit";
import { CommentList } from "./CommentList";
import styles from "./OverlayApp.module.css";
import fitStyles from "./PinnedOverlayApp.module.css";

/**
 * 046c: 縮小スケールを DOM へ当てる / 外す。**この 3 プロパティ（transform / width / height）は
 * `useLayoutEffect` の排他所有**で、JSX の `style` には載せない（載せると React の内部前回値と
 * 実 DOM がズレたとき diff が一致して書き込みがスキップされる事故が起きる）。
 *
 * `width/height: ${100/k}%` の**サイズ補正が本体**で、transform は見た目を戻すだけ。transform は
 * レイアウトに影響しないため、補正が無いと `ol` の `clientHeight`/`scrollHeight` が一切変わらず
 * **収まり判定が永久に動かない**（クリップ済みの絵が縮むだけになる）。補正すると内容が W/k × H/k で
 * レイアウトされ、本文が広い幅で再フローして行数が減る＝縮小が効率よく効く。
 *
 * 等倍（k>=1）のときは**プロパティを一切書かない**（`scale(1)` すら残さない）。短文では DOM が
 * 046b 時点と完全に同一になり、「既存の見た目を変えない」ことを構造で保証できる。
 */
function applyFitScale(el: HTMLElement, scale: number): void {
  if (scale >= 1) {
    el.style.transform = "";
    el.style.transformOrigin = "";
    el.style.width = "";
    el.style.height = "";
    return;
  }
  const size = `${100 / scale}%`;
  el.style.transformOrigin = "top left";
  el.style.transform = `scale(${scale})`;
  el.style.width = size;
  el.style.height = size;
}

/**
 * 046b: 固定コメント（046a のピン留め）専用の背景透過オーバーレイ（別ウィンドウ label `pinned-overlay`）の描画本体。
 *
 * 既存のコメント一覧オーバーレイ（`OverlayApp` / label `comment-overlay`）とは**独立した別窓**で、OBS では
 * 別ソースとして取り込む。**WS へは一切接続しない**（`connectCommentStream` を呼ばない＝送受信フレームゼロ・
 * 新規外部通信ゼロ）。046a が localStorage のピンストアへ書いた固定コメントを **read-on-mount ＋ `storage` 購読**で
 * 読むだけ＝表示専用・通信面ゼロ（親 046 の設計判断: 窓間伝達は localStorage で完結させ、新規 WS / Rust emit /
 * 外部通信 / 依存を増やさない）。
 *
 * 背景透過: `OverlayApp` と同じく、この窓の document にだけ `data-overlay="1"` 属性を立て、
 * `OverlayApp.module.css` の属性ガード付き `:global` ルールで透明化する（unmount で属性を外す）。
 * 透過窓の生成（transparent / decorations(false) / always_on_bottom / focused(false)）は Rust の
 * `open_pinned_overlay_window` が担い、frontend からは窓を生成しない。
 *
 * アイコンは**イニシャル丸**になる（046a が `author.avatar` を保存しないため・この窓は WS へ繋がず再取得もしない）。
 * 外部 URL を踏む経路は存在しない。
 *
 * 046b レビュー（修正不要・重複の許容）: `data-overlay` の付与/除去と font / showSource の `storage` 購読は
 * `OverlayApp` とほぼ同じコードで、共通フックに括り出せる。それをしないのは、括り出すと既存 `comment-overlay`
 * （033f/034e で実機調整済み・見た目の回帰が怖い）に手を入れることになり、本タスクの「既存 overlay を
 * 差分ゼロに保つ」要件と引き換えにするほどの利得が無いため。
 * 再修正トリガー＝①`overlaySettings.ts` にオーバーレイ設定キーを 3 つ目以降として足すとき（片方だけ購読を
 * 更新する事故が起きる）②3 つ目のオーバーレイ窓を作るとき。そのとき `useOverlayPresentation()` に括り出す。
 *
 * 046b レビュー（注意・CSS の共有範囲）: この窓も `data-overlay="1"` を立てるため、`OverlayApp.module.css` の
 * `:global(html[data-overlay="1"] ol)::-webkit-scrollbar`（034b）が**この窓にも効く**。同 CSS のコメントは
 * 「overlay 窓の `<ol>` は一覧の 1 つだけ」と単数前提で書かれているが、この窓の `<ol>` も `CommentList` の
 * 1 つだけなので前提は崩れていない（CSS は無改変）。
 * 再修正トリガー＝この窓に別のスクロール可能な `<ol>` を足すとき（同 CSS のコメントどおり目印属性で絞る）。
 */
export function PinnedOverlayApp() {
  // 046a のピンストア（先頭＝最新・最大 PINNED_LIMIT 件）。保存形は上限 N に依らず JSON 配列なので、
  // ここは「配列を描く」実装のままにして PINNED_LIMIT が増えてもそのまま追随できるようにする（1 件決め打ちにしない）。
  const [pinned, setPinned] = useState<PinnedComment[]>(() => loadPinned());

  // 034e: オーバーレイの表示設定（フォント / サイト名表示）を既存 `comment-overlay` と共有する。
  // 同じ OBS 画面に 2 窓を並べるため、書体・サイト名の有無が食い違わないようにする（設定項目自体は増やさない＝
  // 書き手は従来どおり設定ビューだけ）。
  const [font, setFont] = useState(() => loadOverlayFont());
  const [showSource, setShowSource] = useState(() => loadOverlayShowSource());

  // 046c: 縮小フィットの対象（＝既存 `.root`）。0 件時は描画しないので null のまま。
  const rootRef = useRef<HTMLDivElement>(null);

  // この窓の document にだけ背景透明化の目印を立てる（main/comment-viewer 窓には波及しない）。
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay", "1");
    return () => {
      root.removeAttribute("data-overlay");
    };
  }, []);

  // ピンストアの再読込。`storage` 購読から呼ぶ唯一の入口にしておく（下の注記の代替案＝ポーリングを
  // 足すことになっても、この関数を別契機から呼ぶだけで済む形にする）。
  const reloadPinned = useCallback(() => setPinned(loadPinned()), []);

  // 046a の固定/固定解除を、開いたままのこの窓へ即反映する。`storage` イベントは「他窓（コメビュ本体）での
  // localStorage 書換」で発火する（自窓の書換では発火しない）。書き手は本体窓だけなのでここでは必ず発火する。
  // clear() 時は e.key===null で来るため、その場合も読み直す。
  // **固定解除は `"[]"` の書込として届く**（046a はキーを消さない＝newValue が null にならないので、
  // 「未保存」と「解除」を取り違えない）。
  //
  // 034e(review M1) と同じ未検証点をこの機能も踏む: 別 webview（comment-viewer → pinned-overlay）間で
  // `storage` イベントが跨って届くかはプラットフォーム依存で未検証。設計は二段構えで、
  //   ・保証ベースライン＝read-on-mount（上の lazy useState 初期化）。窓を開き直せば必ず最新のピンが出る。
  //   ・即時反映＝この `storage` 購読（ベストエフォート）。
  // ただし 034e（設定値）と違い、046b では**即時反映が完了条件**（配信中に固定するたび窓を開き直す運用は
  // OBS ソースが一瞬切れるため実用に耐えない）。**再修正トリガー＝実機で「届かない」と判明したとき**。
  // そのときは親 046 の制約（新規 WS / Rust emit / 外部通信 / 依存を増やさない）内で、
  // localStorage の定期ポーリング（生文字列を前回値と比較し、変化時だけ `reloadPinned()`）を足す。
  // BroadcastChannel は `storage` と同じ前提（同一オリジンの別 webview 間で届くか）に依存するため代替にならず、
  // Tauri の emit/listen は親 046 の線引き改訂と security-review のやり直しを伴うので採らない。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PINNED_COMMENTS_KEY || e.key === null) {
        reloadPinned();
      }
      if (e.key === OVERLAY_FONT_KEY || e.key === null) {
        setFont(loadOverlayFont());
      }
      if (e.key === OVERLAY_SHOW_SOURCE_KEY || e.key === null) {
        setShowSource(loadOverlayShowSource());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [reloadPinned]);

  // 046c: 内容が窓に収まるまで縮小する。窓の高さ（Rust の `open_pinned_overlay_window`）は 290 字の長文が
  // 等倍で収まる値にしてあるので、これは**それを超える長文のための保険**（通常は等倍のまま何も起きない）。
  //
  // 測定対象を `querySelector("ol")` で取るのは、`CommentList` が共有コンポーネントで ref を受け取らないため。
  // **既存 CSS が同じ理由で `ol` 要素セレクタを使っている**前例に揃えてある
  //（`OverlayApp.module.css` の `:global(html[data-overlay="1"] ol)::-webkit-scrollbar` とその注記）。
  // 再修正トリガー＝この窓に別のスクロール可能な `<ol>` を足すとき。そのときは同 CSS のコメントどおり
  // 目印属性（`ol[data-…]`）で絞るか、`CommentList` に ref prop を足す。
  //
  // 測定は `scrollHeight` / `clientHeight` に統一する。**`getBoundingClientRect()` は使わない**
  //（transform 適用後の視覚値を返すため、変換前の値と混ぜると二重補正になる）。
  //
  // 依存: `li.item { flex-shrink: 0 }`（`OverlayComment.module.css` の 043c 追修正）。これが外れると
  // `li` が縦圧縮されて `scrollHeight === clientHeight` になり、カードが潰れたまま「収まっている」と
  // 誤判定してこの機能が恒久 no-op になる。
  const applyFit = useCallback(() => {
    const root = rootRef.current;
    const list = root?.querySelector("ol");
    if (!root || !list) return;
    // fitScale は k=1 から測り始める＝毎回等倍へリセットされるので、前回の縮小が累積しない
    //（StrictMode の二重実行でも冪等）。return 時点で DOM には確定した scale が当たっている。
    fitScale((scale) => {
      applyFitScale(root, scale);
      return { content: list.scrollHeight, available: list.clientHeight };
    });
  }, []);

  useLayoutEffect(() => {
    applyFit();
  }, [applyFit, pinned, font, showSource]);

  // 窓のリサイズ（`decorations(false)` でも `resizable` 既定 true＝縁ドラッグで変わりうる）に追従する。
  // rAF でコアレスするのは `TutorialOverlay` の再計測と同じ作法。
  //
  // **`ResizeObserver` は使わない**: ①再測定が要る非同期要因が無い（オーバーレイのフォントは全て OS 標準＝
  // FOUT が無く、`toPinned` が avatar を落とすので画像ロードも無い）②`.root` を observe すると自分で
  // width/height を変えるたび再通知＝自己ループ。しかもこの窓は `background_throttling(Disabled)` なので
  // 裏に回っても回り続け、配信中の CPU を焼く。
  useEffect(() => {
    let raf: number | null = null;
    const onResize = () => {
      if (typeof requestAnimationFrame === "undefined") {
        applyFit();
        return;
      }
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        applyFit();
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(raf);
      }
    };
  }, [applyFit]);

  // 固定 0 件のときは**何も描かない**（完全透明）。既存 `comment-overlay` は 0 件時に
  // `CommentList` の「コメントはまだありません」を意図的に許容しているが、あちらは接続前にキャプチャ範囲を
  // 確認できるという**セットアップ時の一度きり**の利点。こちらは親 046 が自動で窓を閉じることを禁じており
  // （閉じると OBS のウィンドウキャプチャソースが壊れる）、**0 件が通常状態**なので同じ文言が配信画面に
  // 出続けてしまう。本体の固定帯（`PinnedCommentBar`）が 0 件で null を返すのと同じ扱いに揃える。
  if (pinned.length === 0) return null;

  return (
    // 046c: 縮小時に `.root` のレイアウトボックスが窓（#root）を超えるため、外側でクリップして
    // body スクロールバーが OBS に映るのを防ぐ（`PinnedOverlayApp.module.css` の注記）。
    // 0 件時は上で null を返すので、このラッパごと描かれない。
    <div className={fitStyles.fit}>
      {/* 意匠・レイアウトは既存オーバーレイの流用（`OverlayApp.module.css` の .root ＋ CommentList の
          variant="overlay"）。CSS は**参照するだけで一切変更しない**ので、既存 `comment-overlay` の見た目は不変。
          style に載せるのは fontFamily だけ（transform/width/height は applyFitScale の排他所有）。 */}
      <div
        ref={rootRef}
        className={styles.root}
        style={{ fontFamily: resolveOverlayFontStack(font) }}
      >
      {/* `PinnedComment` は `CommentAuthor.avatar` が optional なので `CommentViewDto` へ構造的に代入可＝
          そのまま渡せる（`pinnedComments.ts` の型注記）。
          046b レビュー（修正不要・将来の見え方ズレ）: `CommentViewDto` に**必須**フィールドが増えた場合は
          `parsePinned` / `toPinned` が型エラーになり明示判断を強制できるが、**任意**フィールドが増えた場合は
          `toPinned` が黙って落とすため、`CommentList` がそれを描くようになると「本体の一覧と見え方が
          食い違わない」というこの窓の前提が静かに崩れる（保存項目を増やすのは 046a 側の判断なのでここでは触らない）。
          再修正トリガー＝`CommentViewDto` に表示へ効く任意フィールドを足すとき、`toPinned` の列挙に足すか
          「固定では出さない」かを必ず決める。 */}
      {/* 件数見出しは出さず（showCount=false）、
          追従も付けない（followMode は既定 "off"＝useFollowScroll は no-op。固定は最大 PINNED_LIMIT 件で
          流れていかないため）。投げ銭カードのティア配色・要約文言は本体の一覧と同じ描画を通るので、
          「本体に出ている固定」と「OBS に出ている固定」の見え方が食い違わない。 */}
        <CommentList
          comments={pinned}
          showCount={false}
          variant="overlay"
          showSource={showSource}
        />
      </div>
    </div>
  );
}
