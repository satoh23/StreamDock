import { useEffect, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import { mergeComments } from "../../features/comment-viewer/mergeComments";
import {
  loadOverlayFont,
  loadOverlayShowSource,
  resolveOverlayFontStack,
  OVERLAY_FONT_KEY,
  OVERLAY_SHOW_SOURCE_KEY,
} from "../../features/comment-viewer/overlaySettings";
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
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);

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
    <div
      className={styles.root}
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
