import { useEffect, useState } from "react";
import type { CommentViewDto } from "../../features/comment-viewer/types";
import { connectCommentStream } from "../../features/comment-viewer/commentStream";
import { mergeComments } from "../../features/comment-viewer/mergeComments";
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

  // この窓の document にだけ背景透明化の目印を立てる（main/comment-viewer 窓には波及しない）。
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-overlay", "1");
    return () => {
      root.removeAttribute("data-overlay");
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
    <div className={styles.root}>
      {/* 033f 追修正: OBS 用オーバーレイはコメントだけ映す（コメント合計「N 件」は出さない）。 */}
      {/* 修正不要（据え置き）: 0 件時は CommentList の .empty（「コメントはまだありません」）がそのまま OBS 合成にも映る。
          意図＝接続前に OBS 側でこの窓の存在・キャプチャ範囲を確認できるようにするため（セットアップ体験の利点）。配信中に
          本当に 0 件のときも文言が出るが実害は軽微なので、overlay 専用の空表示分岐は設けない。
          再修正トリガー＝配信者から「配信中の空文言が邪魔」との要望が出たら、overlay（showCount=false）時のみ .empty を
          非表示にする分岐を CommentList に足す。 */}
      <CommentList comments={comments} showCount={false} />
    </div>
  );
}
