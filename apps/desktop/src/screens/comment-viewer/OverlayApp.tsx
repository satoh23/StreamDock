import { useEffect, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import { mergeComments } from "../../features/comment-viewer/mergeComments";
import {
  loadOverlayFont,
  loadOverlayShowSource,
  loadOverlayTheme,
  resolveOverlayFontStack,
  OVERLAY_FONT_KEY,
  OVERLAY_SHOW_SOURCE_KEY,
  OVERLAY_THEME_KEY,
} from "../../features/comment-viewer/overlaySettings";
import { rewriteSelectors } from "../../features/comment-viewer/cssCompat";
import {
  OVERLAY_ROOT_SELECTOR,
  rewriteRootLike,
} from "../../features/comment-viewer/cssScope";
import { withDecorationReset } from "../../features/comment-viewer/overlayThemeReset";
import { getOverlayThemeCss } from "../../features/comment-viewer/overlayThemeApi";
import { CommentList } from "./CommentList";
import styles from "./OverlayApp.module.css";

/**
 * 033f: OBS 用の背景透過オーバーレイ（別ウィンドウ label `comment-overlay`）の描画本体。
 *
 * コメビュ本体と**同じ** loopback sidecar WS（`ws://127.0.0.1:<port>`）へ `connectCommentStream` で
 * **読み取り専用接続**する（`onComments` のみ使用・制御フレームメソッド `startLogin`/`startSession`/`stopSession` は
 * 一切呼ばない＝送信フレームゼロ・新規外部通信ゼロ）。受信は共有 `mergeComments`（append＋id 重複排除＋
 * 200 件クランプ）で蓄積し、`CommentList`（033b 分割）で一覧表示する。**表示専用**で操作 UI（接続・設定・トグル）は
 * 持たない。sidecar の起動/停止には関与せず、cleanup の `disconnect()` もクライアント側 close のみ
 * （no-orphan kill 契機はコメビュ窓に集約のまま）。
 *
 * 背景透過: 同一 Vite バンドルを全窓が読むため、`html`/`body`/`#root` を透明化する CSS が他窓（main /
 * comment-viewer）へ波及しないよう、この窓の document にだけ `data-overlay="1"` 属性を立て、
 * `OverlayApp.module.css` の属性ガード付き `:global` ルールで透明化する（unmount で属性を外す）。透過窓生成
 * （transparent / decorations(false) / always_on_bottom＝最背面・focused(false)＝非フォーカス。追修正①で最前面→最背面に変更）は
 * Rust の `open_comment_overlay_window` が担い、frontend からは窓を生成しない。
 */
export function OverlayApp() {
  const [comments, setComments] = useState<CommentViewDto[]>([]);

  // 034e: オーバーレイの表示設定（フォント / サイト名表示）。設定窓（CommentViewerApp/SettingsView）が localStorage に
  // 保存し、この窓は起動時に load*＋下の storage 購読で即反映する（両窓は別 webview・同一 localStorage）。表示専用の
  // ままで、新規外部通信・宛先・依存は増やさない（localStorage の非機密 UI 設定を読むだけ）。
  const [font, setFont] = useState(() => loadOverlayFont());
  const [showSource, setShowSource] = useState(() => loadOverlayShowSource());
  // 060d: 選択中のカスタム CSS テーマ id（null = 既定意匠）。フォント／サイト名表示と**同じ二段構え**で、
  // ここが保証ベースラインの read-on-mount、下の storage 購読が即時反映（ベストエフォート）。
  const [themeId, setThemeId] = useState(() => loadOverlayTheme());

  // この窓の document にだけ背景透明化の目印を立てる（main/comment-viewer 窓には波及しない）。
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay", "1");
    return () => {
      root.removeAttribute("data-overlay");
    };
  }, []);

  // 034e: 設定窓での変更を、開いたままのオーバーレイへ即反映する。storage イベントは「他窓（設定窓）での localStorage
  // 書換」で発火する（自窓の書換では発火しない）。対象キーのみ再読込する（clear() 時は e.key===null なので両方読む）。
  //
  // 034e(review M1・修正不要): 「即時反映」は Tauri の別 webview（comment-viewer→comment-overlay）間で storage イベントが
  // 跨って届くことに依存し、これはプラットフォーム依存で未検証（本環境は tauri dev 未実行）。設計は二段構えで、
  //   ・保証ベースライン＝起動時の read-on-mount（上の lazy useState 初期化）。イベントが届かなくてもオーバーレイを
  //     開き直せば必ず最新設定で描画される。
  //   ・即時反映＝この storage 購読（ベストエフォート）。届けば開いたまま反映される。
  // 届かなくても通信・権限昇格は一切伴わず（同一 localStorage の非機密 UI 値を再読込するだけ）破綻しないため受容可能。
  // 再修正トリガー＝実機で別 webview 間伝播が「届かない」と確認され、かつ開き直し運用では不十分（配信中に即反映が必須）と
  // 判断された場合。そのときは新規通信基盤ではなく既存の Tauri window イベントで明示 broadcast する案を検討する。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === OVERLAY_FONT_KEY || e.key === null) {
        setFont(loadOverlayFont());
      }
      if (e.key === OVERLAY_SHOW_SOURCE_KEY || e.key === null) {
        setShowSource(loadOverlayShowSource());
      }
      if (e.key === OVERLAY_THEME_KEY || e.key === null) {
        setThemeId(loadOverlayTheme());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 060d: 選択中テーマの CSS をこの窓へ注入する。**ここが 060 の最後の 1 本**（060a が契約を作り、
  // 060b が外部参照を除去して保存し、ここで初めて実際に効く）。
  //
  // ⚠⚠ **注入は `<style>` の `textContent` のみ。`innerHTML` / `dangerouslySetInnerHTML` を使わない。**
  //   `get_overlay_theme_css` が返す CSS には `</style>` が**そのまま含まれうる**（正当な CSS なので 060b は
  //   除去しない）。`innerHTML` に入れると要素が閉じて**その後ろが HTML として解釈される**。
  //   `textContent` は HTML として解釈されないので、何が入っていても DOM を壊せない。
  //   docs/security.md「レビュー必須条件」がこの経路を名指ししており、静的ガード (10-i) と
  //   `OverlayApp.test.tsx` の両方で固定してある。
  // ⚠ **変換（rewriteSelectors）は注入のたびに毎回行う**（060b の決定）。保存されているのは変換前の CSS で、
  //   変換表を更新すると取り込み済みテーマにも自動で効く。だから決定性と冪等性が機能要件になっている。
  // ⚠ **`scopeSelectors` は使わない**——あれはプレビュー（コメビュ窓の中に同居する）専用で、
  //   この窓はオーバーレイ専用なので前置する相手がいない（前置すると逆に何も当たらなくなる）。
  // ⚠⚠ **代わりに `rewriteRootLike` は通す**（060c）。外部 CSS には `body{margin:…; line-height:…}` が
  //   ほぼ必ず入るが、プレビューでは `scopeSelectors` が `body` → `.sd-preview` へ読み替えるのに対し、
  //   ここでスコープ化しないと**本物の `<body>` に効いて全要素へ継承する**＝
  //   **プレビューが本番を再現していない**状態になっていた（060f の実機確認で判明）。
  //   `body` / `html` / `:root` / `.sd-overlay` を**窓ルート `.sd-overlay` へ読み替える**ことで、
  //   「その文脈でのルート要素へ寄せる」という 1 つの規則でプレビューと配信窓が揃う。
  //   ⚠ 変換表（`cssCompat.ts`）は 1 行も触っていない＝ 060f が却下した案・静的ガード (10-k) には当たらない。
  //   ⚠⚠ **受容している副作用**: `body{background:#fff}` は `.sd-overlay{background:#fff}` になり
  //   **窓が全面不透明になる**。能力は 060f が受容済みのもの（`yt-live-chat-app` → `.sd-overlay`）と同一で
  //   脱出路も同じ（「既定のデザインに戻す」）だが、⚠ **発生頻度は上がる**——060f は YouTube 専用に
  //   書かれたテーマを要したのに対し `body{background:…}` は外部 CSS にほぼ必ず入る（security-review 060c Q-3）。
  //   ＝ 実機で不透明になっても実装ミスではない。
  // ⚠ 取得に失敗したら（テーマが消えた・読めない）**既定意匠へ倒す**。オーバーレイ窓は表示専用・非フォーカスで
  //   ここからは何も操作できないため、**localStorage は書き換えない**（気付かせるのはコメビュ窓の設定側の責務）。
  //   ⚠ CSS 本文もエラー詳細もログに出さない（§9）。
  // ⚠ cleanup で必ず取り除く＝**`<style>` は常に 0 個か 1 個**（テーマを何回切り替えても積み上がらない）。
  //   切替時は「先に外してから取りに行く」ので一瞬既定へ戻るが、取得に失敗したときに前のテーマが
  //   残らない（表示と選択状態が食い違わない）ほうを採る。
  useEffect(() => {
    if (themeId === null) return;
    let cancelled = false;
    let el: HTMLStyleElement | null = null;

    getOverlayThemeCss(themeId)
      .then((css) => {
        if (cancelled) return;
        el = document.createElement("style");
        // 目印（`data-sd-overlay-theme`）。テストと DevTools が引くためだけの属性で、意匠には関与しない。
        el.dataset.sdOverlayTheme = "";
        // ⚠⚠ 060f 追修正(2026-08-08): **既定意匠のリセットを前置する**（`withDecorationReset`）。
        //   既定のしっぽは疑似要素 2 枚（`.bubble::before` / `::after`）で描いているが、テーマは
        //   `::before` 1 枚しか書かないのが普通で、`::after` が孤児として残って**しっぽが二重に見えていた**。
        //   ⚠ 追修正②以降は守備範囲が広がっており、しっぽだけでなく**吹き出しの装飾一式**
        //   （背景・枠・角丸・影・`--sd-icon-gap`）と疑似要素の `all:unset` まで前置する。
        //   ⚠ 効く仕組みは「非レイヤー > レイヤー」——既定側は **`@layer sd-default`** に入れてある
        //   （レビュー指摘 S-2: ここは追修正②で `sd-tail` から改名済み。旧名で書いてあった）。
        //   ⚠ **必ず `withDecorationReset` を通すこと**（手書きの文字列連結にしない）。プレビュー側
        //   （`OverlayThemeCard`）と 2 か所あり、片方だけ抜けると本番とプレビューで見え方が食い違う。
        //   静的ガード **(10-m)** が「2 か所とも通っていること」を固定している。
        el.textContent = withDecorationReset(
          rewriteRootLike(rewriteSelectors(css).css, OVERLAY_ROOT_SELECTOR),
        );
        // `<head>` の末尾へ足す＝CSS Modules（Vite が起動時に入れる）より後になるので、
        // 同じ詳細度ならユーザー CSS が勝つ。これが「テーマで上書きできる」の実体。
        document.head.appendChild(el);
      })
      .catch(() => {
        // 既定意匠のまま（<style> を作らない）。詳細は出さない（§9）。
      });

    return () => {
      cancelled = true;
      el?.remove();
    };
  }, [themeId]);

  // コメビュ本体と同じ loopback WS へ読み取り専用接続する（onComments のみ・制御フレームは送らない）。
  // sidecar 未起動時は connectCommentStream が接続待ち（ポート未確定で再試行）になり、0 件表示になるだけ。
  useEffect(() => {
    const handle = connectCommentStream({
      onComments: (incoming) =>
        setComments((prev) => mergeComments(prev, incoming).next),
    });
    return () => {
      handle.disconnect();
    };
  }, []);

  return (
    // 034e: フォント選択はモジュール CSS ではなく .root への inline font-family で当て、子孫（名前/本文）が継承する
    // （font スタック文字列は overlaySettings.ts に置く＝色ではないので生 hex 規約の対象外）。
    //
    // 060a: ユーザーのカスタム CSS 向けに、ハッシュ化されない安定クラス `sd-overlay` を併記する
    // （CSS 変数 `--sd-*` を上書きする器＝`.sd-overlay { --sd-comment-bg: … }` と書ける）。
    //   ⚠ **この窓（`comment-overlay`）にだけ付ける。** 同じ `.root` と `CommentList variant="overlay"` を
    //   使う `PinnedOverlayApp`（固定コメント窓）には**付けない**。理由は 2 つ:
    //   ①060d の注入先は `comment-overlay` のみと決まっており、窓の区別をこのクラスの有無で表す
    //   ②`PinnedOverlayApp` は 046c の `applyFitScale` が `.root` の transform / width / height を
    //     **排他所有**しているので、そこをユーザー CSS に触らせる的を作らない（縮小フィットが壊れる）。
    <div
      className={`${styles.root} sd-overlay`}
      style={{ fontFamily: resolveOverlayFontStack(font) }}
    >
      {/* 033f 追修正: OBS 用オーバーレイはコメントだけ映す（コメント合計「N 件」は出さない）。 */}
      {/* 修正不要（据え置き）: 0 件時は CommentList の .empty（「コメントはまだありません」）がそのまま OBS 合成にも映る。
          意図＝接続前に OBS 側でこの窓の存在・キャプチャ範囲を確認できるようにするため（セットアップ体験の利点）。配信中に
          本当に 0 件のときも文言が出るが実害は軽微なので、overlay 専用の空表示分岐は設けない。
          再修正トリガー＝配信者から「配信中の空文言が邪魔」との要望が出たら、overlay（showCount=false）時のみ .empty を
          非表示にする分岐を CommentList に足す。 */}
      {/* 034b: オーバーレイは操作 UI を持たない表示専用のため、034a の追従フックを常時追従モード
          （followMode="always"）で再利用する（解除・「最新コメント N件 ↓」ボタンは付けない）。新着が来るたび
          useFollowScroll が最下部へスクロールし、配信画面に最新コメントが映り続ける。DOM は素の <ol> のまま
          （release のときだけ出る listWrap ラッパ/ボタンは付かない）＝033f の透過体裁を非退行で維持する。 */}
      {/* 034e: OBS 用オーバーレイはチャット意匠（variant="overlay"）で描く。サイト名表示は設定トグル値を渡す。 */}
      <CommentList
        comments={comments}
        showCount={false}
        followMode="always"
        variant="overlay"
        showSource={showSource}
      />
    </div>
  );
}
