import { Fragment, useEffect, useState } from "react";
import {
  listStreamSessions,
  getActiveStreamSession,
  updateStreamSessionTitle,
  type StreamSessionRecord,
} from "../../features/stream-session/streamSessionApi";
import {
  getStreamSummary,
  type StreamSummary,
  type CurrencyTotal,
} from "../../features/stream-summary/streamSummaryApi";
import {
  listGachaDraws,
  type GachaDrawRecord,
} from "../../features/gacha-history/gachaHistoryApi";
// 063i: 「何も出ない」の文言は `gachaDraw.ts` が唯一の持ち主（⚠ ここに書き写さない＝設定画面の
//   テスト抽選と同じ言葉であること）。⚠ `screens/comment-viewer/` → `screens/obs-effects/` の
//   import は `CommentViewerApp.tsx` に先例がある（あちらの JSDoc「import はここが初めて」が正で、
//   循環は無い＝あの窓と同じ横参照）。
import { GACHA_MISS_LABEL } from "../obs-effects/gachaDraw";
import { Select } from "../../components/Select";
import { ViewerDetailPanel } from "./ViewerDetailPanel";
import {
  providerLabel,
  eventLabel,
  fmtDateTime,
  fmtNumber,
  fmtSuperchat,
} from "./viewerFormat";
import styles from "./CommentViewerApp.module.css";
// 061g: ボタンの意匠は `components/compactButtons.module.css` にある（この窓の 6 ファイルが共有）。
import btnStyles from "../../components/compactButtons.module.css";

/**
 * 062c: 配信サマリー（1 回の配信の総コメント数・通貨ごとの総課金額・課金回数・サブスク件数・
 * **貢献者一覧**〔マスト〕・**レイド一覧**〔マスト〕）を配信者だけが見るコメビュ窓で表示するビュー。
 *
 * ⚠⚠ **063i: 「ガチャを引いた人」節を最後に足した**（`list_gacha_draws`＝063h が記録した抽選）。
 * ⚠ **invoke は 2 本**（`get_stream_summary` と `list_gacha_draws`）を**同じ effect で並べて投げ**、
 * **失敗の受け皿を別々に持つ**（`error` と `drawsError`）。⇒ ガチャが取れなくても課金・レイドは出る。
 * ⚠⚠⚠ **保存は 1 ミリも動いていない**（読んで表示するだけ）。新しい項目を出したくなったら
 * **`docs/security.md` §9 追補〔063h〕を読み直すこと**——**保存していないものは出せない**
 * （配信元〔サイト〕の列が無いのはそのため）。
 *
 * ## ⚠ なぜコメビュ窓の 4 つ目のビューなのか（main 窓の新 Screen にしなかった理由）
 *
 * 1. **貢献者の行から視聴者詳細へ飛べる**——`ViewerDetailPanel` はこの窓にあり、`ViewersView` が既に
 *    「一覧⇄詳細をトップレベル view を増やさずこの窓内で切替」という形で使っている（038b の導線の再利用）。
 * 2. 配信終わりに見るもので、**視聴者一覧の隣**にあるのが自然（数字が食い違ったときの突き合わせ先が隣）。
 * 3. main 窓へ置くと `session_id` / `stream_sessions` を扱う state が 2 窓に分かれる。
 * 4. ⚠ この窓（`CommentViewerApp`）は**ビューを切り替えてもアンマウントされない**ので、
 *    **サマリーを見ている間もコメント受信・記録は止まらない**（`connectCommentStream` の effect は
 *    `view` に依存していない）。`CommentViewerApp.session.test.tsx` がこれを固定している。
 *
 * ## 作法（`ViewersView` と同じ）
 *
 * 表示専用で WS/TTS/sidecar 制御は持たず、操作は Tauri command 薄いラッパ（invoke）のみ。
 * 受け取る props は本体へ戻る `onBack` だけ。**専用 CSS モジュールは作らず
 * `CommentViewerApp.module.css` を使う**——理由は下の「⚠⚠ CSS の置き場所」を参照。
 *
 * セキュリティ（docs/security.md §9・⑪）: 集計は端末内で完結し、端末外へ出さずログにも出さない。
 * command 失敗時は固定の安全文言だけを画面に出す（本文・エラー詳細は出さない・console にも流さない）。
 *
 * ## ⚠⚠ ユーザー CSS（テーマプレビュー）がこの画面に届かない根拠（security-review S-2）
 *
 * 060h の security-review S-9 が「テーマの `@font-face` によるグリフ差し替え＝**表示偽装**の対象は
 * プレビュー表示中のコメビュ設定画面全体」と警告している。本ビューは**金額の数字だけを見せる画面**
 * ＝偽装されると最も困る面なので、到達経路が無いことを明記しておく。
 * プレビューの `<style>` を所有するのは `OverlayThemeCard`（それを描くのは `SettingsView`）で、
 * `CommentViewerApp` の描画分岐は `viewers` → `summary` → `settings` の**排他的な三項連鎖**である。
 * ⇒ サマリーへ切り替えた瞬間に `SettingsView` ごとアンマウントされ、`previewThemeId` 連動の
 * cleanup（意匠用・フォント用の 2 本とも）が `<style>` を外す。**同時に描画されることが構造上ない。**
 * 【再修正トリガー】⚠ **`SummaryView` を `SettingsView` と同時に描く形へ変えたら**（タブ化・分割表示・
 * サマリーを設定画面の中のカードにする等）、この根拠が消える。そのときは 060h の受容根拠
 * （露出時間を限ること）を金額表示にも適用できるか、security-review で判定し直すこと。
 *
 * ## ⚠⚠ CSS の置き場所（`SummaryView.module.css` を作らないこと）
 *
 * `scripts/check-css-guards.mjs` の (6-b)（`--text-faint` は `:disabled` 専用）が走査するのは
 * **`CommentViewerApp.module.css` ＋ `src/components/**.module.css` だけ**（`FAINT_SCANNED`）。
 * ⇒ `screens/comment-viewer/SummaryView.module.css` を新設すると**走査外**になり、無効色の誤用が素通りする。
 * ガード自身が「リストの保守を人間に委ねた時点で同じ穴が開く」と同型の穴を 2 度踏んだ記録を残しているので、
 * **走査対象のファイルに足す**（＝`ViewersView` と同じ作法）。
 */

/** 配信元バッジの色分けクラス（`ViewersView` / `ViewerDetailPanel` と同型・styles 依存のため UI 側に持つ）。 */
const PROVIDER_CLASS: Record<string, string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};
const providerClass = (p: string): string => PROVIDER_CLASS[p] ?? "";

/**
 * ⚠ 穴 K: `list_stream_sessions` は**引数なしで全件返す**（フィルタは 062d の仕事）。
 * セッションが増えたときに選択 UI が破綻しないよう、**画面側で**直近この件数までに切る。
 * ⚠ **切ったことは画面に出す**（黙って切ると「過去の配信が消えた」と読まれる）。
 * ⚠ ただし**文章では書かない**——「直近 20 件 / 全 35 件」という**事実だけ**を添える（下記の方針）。
 */
export const SUMMARY_SESSION_LIMIT = 20;

/**
 * 063i 穴 A: ガチャ一覧を画面側で切る件数。
 *
 * ⚠⚠ **Rust には上限もページングも入れない**（`list_gacha_draws` の引数はセッション id 1 つだけ＝
 * docs/security.md §3）。切るのはここだけである。
 * ⚠ セッション一覧（[`SUMMARY_SESSION_LIMIT`]＝20）より多いのは、**1 配信の抽選は桁が上がりうる**ため
 * （キーワード条件を広く張れば毎コメント抽選が起きる）。
 * ⚠⚠ **切ったことは画面に出す**（黙って切ると「引いたのに残っていない」と読まれる）。
 * ⚠ ただし**文章では書かない**——「直近 50 件 / 全 120 件」という**事実だけ**を添える
 *   （`SUMMARY_SESSION_LIMIT` と同じ作法・2026-08-16 の決定）。
 * ⚠⚠⚠ **再修正トリガー＝この件数で足りないと言われたとき。** そのときは**この定数を上げるのではなく、
 *   Rust 側にページングを入れる**こと（画面に全件を抱えたまま数だけ増やすと、次は描画が重くなる）。
 */
export const SUMMARY_GACHA_DRAW_LIMIT = 50;

/*
 * ⚠⚠ **2026-08-16（実機確認・依頼者の決定）: 画面から説明文（注記）を全廃した。**
 *
 * 親 062 (3) は「既知の歪みは隠さず**注記する**」と決めており、062c はそれを 6 本の説明文として
 * 実装していた。実機で見た結果、**説明文が画面の大半を占めて数字が読めなくなっていた**ため、
 * 依頼者の判断で全廃した。⚠ **「歪みを隠す」方向へ倒したのではなく、「文章で説明する」のをやめた**
 * ——親 062 (3) の意図は**構造（UI そのもの）で分かるようにする**形へ置き換える:
 *
 * | 元の注記 | 文章の代わりに何が伝えているか |
 * |---|---|
 * | 通貨は換算していない | **総課金額を「500 BITS / 1,500 JPY」と通貨ごとに並べている**（1 つの数字に丸めない） |
 * | donation も総額に含む | **種別ごとの内訳（スーパーチャット / ビッツ / ドネーション）を並べている** |
 * | Jewels は金額に合算しない | **Jewels の行が「2 回」だけで金額を持たない**（総課金額の通貨欄にも現れない） |
 * | セッションを切り捨てた | 「直近 20 件 / 全 35 件」の**事実だけ**を添える |
 *
 * ⚠⚠ **構造で代替できず、情報として失われたもの（次の人が「なぜ書いていないのか」を疑うために残す）:**
 *   1. **Twitch コミュニティギフトの N+1**（043a）＝サブスク件数が多めに出ることは画面から分からない。
 *   2. **視聴者を削除すると過去のサマリーの数字が変わる**（FK CASCADE）＝画面から分からない。
 *   3. **`ended_at` は最大 30 分ぶん後ろにずれる**（申し送り 6）＝画面から分からない。
 *      ⇒ **だから配信時間（経過時間）は出していない**（引き算すると誤差がそのまま出るため）。
 *   4. **貢献者の並び順は通貨をまたいだ単純合計**（穴 L）＝複数通貨が混ざると順位が実際と一致しない。
 * ⚠ **これらを説明文として書き戻さないこと**（依頼者の明示指示）。伝える必要が出たら、
 *   文章ではなく**構造**（列の分け方・ラベル・並べ方）で解くこと。
 * ⚠ 判断の経緯は docs/progress.md の 062c 節「注記の全廃」を正とする。
 */

/** 通貨ごとの金額を「1,000 JPY / 500 BITS」の形に並べる（⚠ **足し合わせない**）。 */
const formatCurrencyTotals = (totals: CurrencyTotal[]): string =>
  totals.length === 0
    ? "-"
    : totals.map((t) => fmtSuperchat(t.amount, t.currency)).join(" / ");

/** 選択プルダウンの 1 行（開始日時＋タイトル＋配信中かどうか）。 */
const sessionOptionLabel = (s: StreamSessionRecord): string => {
  const live = s.endedAt ? "" : "（配信中）";
  const title = s.title ? ` ${s.title}` : "";
  return `${fmtDateTime(s.startedAt)}${title}${live}`;
};

interface SummaryViewProps {
  onBack: () => void;
}

export function SummaryView({ onBack }: SummaryViewProps) {
  // セッション選択（⚠ 一覧は SUMMARY_SESSION_LIMIT 件で切る＝穴 K）。
  const [sessions, setSessions] = useState<StreamSessionRecord[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 集計
  const [summary, setSummary] = useState<StreamSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 「更新」ボタン用。⚠ ポーリングはしない（穴 I）。
  const [reloadToken, setReloadToken] = useState(0);

  // 配信タイトル（手入力）。検証（trim・制御文字拒否・100 文字）は Rust 側に在る＝ここでは持たない。
  const [title, setTitle] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleSaved, setTitleSaved] = useState(false);

  // 貢献者の行から視聴者詳細へ（038b の導線を再利用。トップレベル view は増やさない＝ViewersView と同型）。
  const [selectedViewerId, setSelectedViewerId] = useState<string | null>(null);

  /*
   * 063i: ガチャ一覧（⚠⚠⚠ **専用の state を持つ**）。
   *
   * ⚠⚠ 上の `error` に相乗りさせないこと。あれは **①配信一覧 ②サマリー ③タイトル保存**の
   * 3 用途で共用されており、②で失敗すると **`setSummary(null)` も撃つ**ので
   * カード・数字・貢献者・レイドが丸ごと消える。⇒ ガチャの失敗をあそこへ流すと、
   * 「**どちらか一方が失敗しても、もう一方は出す**」（063i の完了条件 4）を満たせなくなる。
   * ⚠ `loading`（更新ボタンの無効化）もサマリー側のままにしてある——ガチャだけ遅れても
   *   「更新」が押せなくなる理由は無い。
   */
  const [draws, setDraws] = useState<GachaDrawRecord[]>([]);
  const [drawsError, setDrawsError] = useState<string | null>(null);

  // 配信の一覧を取る（マウント時のみ）。
  // ⚠ **新しいコマンドは作らない**——`list_stream_sessions`（全件・開始時刻の降順）と
  //   `get_active_stream_session`（進行中）の 2 本で足りる。既定の選択は「進行中があればそれ、無ければ直近」。
  //   ⚠ 進行中セッションが切り捨て範囲の外に居ることは理屈のうえではありうるので、
  //     そのときは先頭へ差し込む（選んでいる配信が選択肢に無い状態を作らない）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [all, active] = await Promise.all([
          listStreamSessions(),
          getActiveStreamSession(),
        ]);
        if (cancelled) return;
        const shown = all.slice(0, SUMMARY_SESSION_LIMIT);
        if (active !== null && !shown.some((s) => s.id === active.id)) {
          shown.unshift(active);
        }
        setSessionTotal(all.length);
        setSessions(shown);
        setSelectedId(active?.id ?? shown[0]?.id ?? null);
      } catch {
        // §9: エラー本文は出さず固定の安全文言のみ。
        if (!cancelled) setError("配信の一覧を取得できませんでした。");
      } finally {
        if (!cancelled) setSessionsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 集計を取る（選択が変わったとき・更新ボタン）。
  // ⚠ `cancelled` ガードは必須——選択を素早く切り替えると古い応答が後から届いて上書きしうる。
  // ⚠⚠ **このガードはテストで固定していない**（レビュー Q-4）。意図的な判断で、固定するには
  //   「1 本目の getStreamSummary を保留したまま選択を変え、2 本目の解決後に 1 本目を解決させる」
  //   という遅延制御のモックが要り、テストの側が実装の詳細（Promise の解決順）に張り付く。
  //   取りうる被害は**表示が一瞬古い集計になる**ことだけで、記録も保存も壊れない（read-only）ため受容する。
  //   【再修正トリガー】このビューが**書き込み**を伴うようになったら（例: 集計結果の保存・
  //   選択中セッションへの操作）、古い応答での上書きが実害になるのでテストを足すこと。
  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getStreamSummary(selectedId)
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        setTitle(s.session.title);
        setTitleSaved(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        // NotFound（062b 以前の session_id）を含む取得失敗。§9: 固定の安全文言のみ。
        setError("配信サマリーを取得できませんでした。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // 063i: ガチャ一覧は**同じ effect の中で並べて投げる**（「更新」ボタンで両方が並んで走るのが
    //   期待挙動）。⚠⚠ **失敗の受け皿を分けてあるのが要点**——上のサマリー側は失敗時に
    //   `setSummary(null)` を撃つので、同じ state を共有すると「ガチャが取れないと配信サマリーごと
    //   出ない」という退行になる（063i の完了条件 4 が禁じているもの）。
    // ⚠ `Promise.allSettled` で束ねていないのは、**束ねると両方が揃うまで画面が出ない**ため。
    //   「どちらか一方が失敗しても、もう一方は出す」は、2 本を別々に解決させるほうが素直に満たせる。
    //   ⚠⚠ タスクファイル本文は「先例（`ViewersView` の一括削除・`effectOverlayRestore`）に
    //   揃えて `Promise.allSettled`」と指示していたが、**意図的に外している**——あちらは
    //   「N 件のバッチで失敗件数を出す」形で、ここ（独立した 2 本が独立した 2 領域を養う）とは
    //   問題の形が違う。⇒ 063i タスクファイル冒頭の「本文との差」表の 5 番目が正。
    //
    // ⚠⚠⚠ **ここで `setDraws([])` はしない（意図的）。**
    //   そのぶん「サマリーが先に解決し、ガチャが遅れる」瞬間だけ **新しい配信のサマリー ＋
    //   前の配信のガチャ行**が並びうる。⚠ **受容する**理由: 消すと「更新」を押すたびに
    //   **「ガチャはありません」が一瞬出る**——それは下の `drawsError` 分岐が
    //   「失敗時に空の表を出さない」で避けているのと**まったく同じ誤読**（「取れなかった」が
    //   「1 回も引かれていない」に化ける）を、成功パスで作り直すことになる。
    //   ⚠ 実害は read-only の一瞬の表示ずれだけである（`cancelled` ガードを固定していない
    //   上のレビュー Q-4 の受容と同性質）。
    //   【再修正トリガー】**節ごとに内容を隠すローディング表示を入れるとき**——そのとき混ざり自体が
    //   消えるので、`setDraws([])` ではなくそちらで解くこと。
    setDrawsError(null);
    listGachaDraws(selectedId)
      .then((d) => {
        if (cancelled) return;
        setDraws(d);
      })
      .catch(() => {
        if (cancelled) return;
        // ⚠ 前の配信の行を残さない（選び直したのに古い一覧が出たままにならないように）。
        setDraws([]);
        // §9: エラー本文は出さず固定の安全文言のみ。
        setDrawsError("ガチャの結果を取得できませんでした。");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, reloadToken]);

  // タイトルは既存の `update_stream_session_title` を呼ぶだけ（検証は Rust 側＝新しい経路を作らない）。
  const saveTitle = async () => {
    if (selectedId === null) return;
    setTitleSaving(true);
    setTitleSaved(false);
    try {
      const updated = await updateStreamSessionTitle(selectedId, title);
      setSummary((prev) =>
        prev === null ? prev : { ...prev, session: updated },
      );
      setSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
      setTitle(updated.title);
      setTitleSaved(true);
    } catch {
      setError("配信タイトルを保存できませんでした。");
    } finally {
      setTitleSaving(false);
    }
  };

  // ---- 視聴者詳細（038b の再利用コンポーネント）----
  if (selectedViewerId !== null) {
    return (
      <ViewerDetailPanel
        id={selectedViewerId}
        onDismiss={() => setSelectedViewerId(null)}
        dismissKind="back"
        onDeleted={() => setSelectedViewerId(null)}
      />
    );
  }

  const session = summary?.session ?? null;
  // 063i 穴 A: 画面側で直近 N 件に切る（⚠ Rust は全件返す＝あちらに上限を入れない）。
  //   ⚠ `list_gacha_draws` は `drawnAt` の降順なので、**先頭から N 件が「直近 N 件」**である。
  const shownDraws = draws.slice(0, SUMMARY_GACHA_DRAW_LIMIT);

  return (
    <div className={styles.settingsView}>
      <div className={styles.settingsHeader}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBack}
          title="コメントへ戻る"
          aria-label="コメントへ戻る"
        >
          ←
        </button>
        <h1 className={styles.settingsTitle}>配信サマリー</h1>
      </div>

      <div className={styles.viewersToolbar}>
        <Select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value)}
          ariaLabel="配信を選択"
          disabled={sessions.length === 0}
        >
          {sessions.length === 0 ? (
            <option value="">配信がありません</option>
          ) : (
            sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionOptionLabel(s)}
              </option>
            ))
          )}
        </Select>
        {/* ⚠ 穴 I: 更新は手動だけ（ポーリングしない）。文言と流儀は ViewersView の「更新」と揃える。 */}
        <button
          type="button"
          className={btnStyles.btnGhost}
          onClick={() => setReloadToken((t) => t + 1)}
          disabled={loading || selectedId === null}
        >
          {loading ? "更新中…" : "更新"}
        </button>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      {/* ⚠ 切り捨てが起きたときだけ、**事実だけ**を添える（黙って切ると「過去の配信が消えた」と読まれる）。
          文章での説明は書かない（2026-08-16 の決定・上の注記を参照）。 */}
      {sessionTotal > SUMMARY_SESSION_LIMIT && (
        // ⚠ 件数は定数ではなく実際の選択肢数を出す（進行中を先頭へ差し込んだときは
        //   上限 +1 件になるため。定数を出すと添えた「事実」のほうが嘘になる）。
        <p className={styles.note}>
          直近 {sessions.length} 件 / 全 {fmtNumber(sessionTotal)} 件
        </p>
      )}

      {summary === null || session === null ? (
        <p className={styles.empty}>
          {loading || !sessionsLoaded
            ? "読み込み中…"
            : "表示できる配信がありません"}
        </p>
      ) : (
        <>
          {/* ---- この配信（期間・サイト・タイトル）---- */}
          <section className={styles.card}>
            <h2 className={styles.cardHead}>この配信</h2>
            <div className={styles.cardBody}>
              <div className={styles.statGrid}>
                <span className={styles.statLabel}>開始</span>
                <span className={styles.statValue}>
                  {fmtDateTime(session.startedAt)}
                </span>
                <span className={styles.statLabel}>終了</span>
                <span className={styles.statValue}>
                  {/* ⚠⚠ 申し送り 7: 「配信中」の判定は `endedAt` の有無だけ。**接続状態から導かない**
                      （sidecar は WS が繋がるたびに嘘の `idle` を送るので、窓を開き直した直後に
                      「配信が終わった」と表示される）。 */}
                  {session.endedAt ? (
                    fmtDateTime(session.endedAt)
                  ) : (
                    <span className={`${styles.badge} ${styles.badgeLive}`}>
                      配信中
                    </span>
                  )}
                </span>
                <span className={styles.statLabel}>サイト</span>
                <span className={styles.statValue}>
                  {session.platforms.length === 0
                    ? "-"
                    : session.platforms.map((p) => (
                        <span
                          key={p}
                          className={`${styles.badge} ${providerClass(p)}`}
                        >
                          {providerLabel(p)}
                        </span>
                      ))}
                </span>
              </div>

              <label className={styles.fieldLabel} htmlFor="summary-title">
                配信タイトル
              </label>
              <input
                id="summary-title"
                type="text"
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="あとから付けられます"
              />
              <div>
                <button
                  type="button"
                  className={btnStyles.btn}
                  onClick={() => void saveTitle()}
                  disabled={titleSaving}
                >
                  {titleSaving ? "保存中…" : "タイトルを保存"}
                </button>
              </div>
              {titleSaved && <p className={styles.note}>保存しました。</p>}
            </div>
          </section>

          {/* ---- 数字 ---- */}
          <section className={styles.card}>
            <h2 className={styles.cardHead}>数字</h2>
            <div className={styles.cardBody}>
              <div className={styles.statGrid}>
                <span className={styles.statLabel}>総コメント数</span>
                <span className={styles.statValue}>
                  {fmtNumber(summary.totalComments)}
                </span>
                <span className={styles.statLabel}>総課金額</span>
                <span className={styles.statValue}>
                  {formatCurrencyTotals(summary.monetaryByCurrency)}
                </span>
                <span className={styles.statLabel}>総課金回数</span>
                <span className={styles.statValue}>
                  {fmtNumber(summary.monetaryTotalCount)} 回
                </span>
                <span className={styles.statLabel}>サブスク件数</span>
                <span className={styles.statValue}>
                  {fmtNumber(summary.subscriptionCount)} 件
                </span>
                <span className={styles.statLabel}>Jewels</span>
                <span className={styles.statValue}>
                  {fmtNumber(summary.jewelsCount)} 回
                </span>
              </div>

              {/* ⚠ 訂正 2 (A) の副作用の手当て: 総額に donation を混ぜる以上、種別ごとの内訳を出して
                  「視聴者一覧のスパチャ額はスパチャだけ」という違いを説明できるようにする。 */}
              {summary.monetaryByKind.length > 0 && (
                <div className={styles.statGrid}>
                  {summary.monetaryByKind.map((k) => (
                    // ⚠ `.statGrid` は「ラベル｜値」の 2 列なので、Fragment で 2 セルずつ流し込む
                    //   （1 要素で包むと 1 セルに収まって列が揃わない）。
                    <Fragment key={`${k.kind}-${k.currency}`}>
                      <span className={styles.statLabel}>
                        {eventLabel(k.kind) || k.kind}
                      </span>
                      <span className={styles.statValue}>
                        {fmtSuperchat(k.amount, k.currency)}（
                        {fmtNumber(k.count)} 回）
                      </span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ---- 貢献者一覧（マスト）---- */}
          {/* ⚠ (1)(2)(3) 対策: `.settingsView` は「flex 縦積み＋overflow:auto」そのもの。`.card` が
              `flex-shrink: 0` を持つのと同じ理由で、表のセクションも縮まないようにラップする
              （`.viewerTable` は `overflow: hidden` を持つので、縮むと中身がクリップされる）。
              ⚠⚠ **065b 追記**: `.viewerTable` 自体にも `flex-shrink: 0` を持たせた（ガード (1-b)）。
              ここで器に頼る形にしたせいで、**器を持たない ViewersView 側だけが無防備のまま残り**、
              「視聴者が増えると見切れてスクロールできない」という実機不具合になった（4 回目の再発）。
              ⇒ このラップは**二重になったが残してある**（無害で、見出し＋表＋注記をまとめる器でもあるため）。 */}
          <section className={styles.summarySection}>
            <h2 className={styles.summaryHeading}>
              課金・サブスクをしてくれた人
            </h2>
            <div className={styles.viewerTable}>
              <div className={`${styles.viewerHead} ${styles.contribHead}`}>
                <span>名前</span>
                <span className={styles.vSite}>サイト</span>
                <span className={styles.vNum}>金額</span>
                <span className={styles.vNum}>サブスク</span>
              </div>
              {summary.contributors.length === 0 ? (
                <p className={styles.empty}>課金・サブスクはありません</p>
              ) : (
                summary.contributors.map((c) => (
                  <div
                    key={c.viewerId}
                    className={`${styles.viewerRow} ${styles.contribRow}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedViewerId(c.viewerId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedViewerId(c.viewerId);
                      }
                    }}
                  >
                    <span className={styles.vName}>{c.name}</span>
                    <span className={styles.vSite}>
                      <span
                        className={`${styles.badge} ${providerClass(c.source)}`}
                      >
                        {providerLabel(c.source)}
                      </span>
                    </span>
                    <span className={styles.vNum}>
                      {formatCurrencyTotals(c.monetaryByCurrency)}
                    </span>
                    <span className={styles.vNum}>
                      {c.subscriptionCount > 0
                        ? `${fmtNumber(c.subscriptionCount)} 件`
                        : "-"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ---- レイド一覧（マスト・Twitch のみ）---- */}
          {/* ⚠ **欄ごと消さない**（YouTube 単独でも出す）。消すと「機能が無い」と誤解される
              ——040 が「Twitch 限定・YouTube は対象外」を明示している先例と同型。 */}
          <section className={styles.summarySection}>
            <h2 className={styles.summaryHeading}>
              レイドしてくれた人（Twitch のみ）
            </h2>
            <div className={styles.viewerTable}>
              <div className={`${styles.viewerHead} ${styles.raidHead}`}>
                <span>レイド元</span>
                <span className={styles.vNum}>人数</span>
                <span>時刻</span>
              </div>
              {summary.raids.length === 0 ? (
                /* ⚠ 「Twitch のみ」は見出し側が持っているので、ここでは繰り返さない。 */
                <p className={styles.empty}>レイドはありません</p>
              ) : (
                summary.raids.map((r) => (
                  <div
                    key={`${r.at}-${r.name}`}
                    className={`${styles.viewerRow} ${styles.raidRow}`}
                  >
                    <span className={styles.vName}>{r.name}</span>
                    <span className={styles.vNum}>
                      {/* ⚠ 人数は NULL 許容。0 を捏造せず「不明」と出す。 */}
                      {r.viewerCount == null
                        ? "不明"
                        : `${fmtNumber(r.viewerCount)} 人`}
                    </span>
                    <span className={styles.vMuted}>{fmtDateTime(r.at)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ---- ガチャを引いた人（063i）---- */}
          {/* ⚠ 見出しは既存 2 つ（「課金・サブスクをしてくれた人」「レイドしてくれた人（Twitch のみ）」）と
              同じ**人主語**に揃える。依頼者の要望も「**誰が**ガチャを引いて誰が何を引いたのか」である。
              ⚠⚠ **何も当たらなかった抽選も 1 行として並ぶ**（063h が等しく記録している）ので、
              「当選一覧」ではない。⚠ 外れを意味する語は画面に出さず、結果は `GACHA_MISS_LABEL` で出す。
              ⚠⚠⚠ **行に「メールで送る」等の導線を置かないこと**（063g＝景品の自動配布は「やらない」で完了）。 */}
          <section className={styles.summarySection}>
            <h2 className={styles.summaryHeading}>ガチャを引いた人</h2>
            {drawsError !== null ? (
              /* ⚠⚠ 失敗したときは**表を出さない**——空の表（「ガチャはありません」）を出すと、
                 「取れなかった」が「1 回も引かれていない」に化ける。
                 ⚠ §9: エラー本文は出さず固定の安全文言のみ（30 文字未満＝説明文ガード）。 */
              <p className={styles.errorText}>{drawsError}</p>
            ) : (
              /* ⚠⚠ 件数の注記も**この分岐の中**に置く（`drawsError` の外に出さない）。
                 外に置くと「エラー文言の下に件数だけが出ない」ことが、`catch` の
                 `setDraws([])` という**離れた副作用への暗黙の依存**になる。⇒ 構造で表現する。 */
              <>
                <div className={styles.viewerTable}>
                  <div className={`${styles.viewerHead} ${styles.gachaHead}`}>
                    <span>時刻</span>
                    <span>引いた人</span>
                    <span>ガチャ</span>
                    <span>結果</span>
                  </div>
                  {shownDraws.length === 0 ? (
                    /* ⚠ 「記録を始める前の配信だから空です」等の説明文を書かない（注記全廃の決定）。
                       古い配信が必ず空になることは、文章ではなくこの 1 行だけで見える。 */
                    <p className={styles.empty}>ガチャはありません</p>
                  ) : (
                    shownDraws.map((d) => (
                      /* ⚠ 行から視聴者詳細へ（貢献者一覧と**同じ 4 点セット**＝新しい導線を作らない）。
                         ⚠⚠ `viewers` に対応行が無い視聴者が居る（FK を張っていない＝§9 追補〔063h〕
                         レビュー S-1）が、`ViewerDetailPanel` が `getViewer` の失敗を catch して
                         固定安全文言を出すので**開くが「見つかりません」と出る**＝それでよい。 */
                      <div
                        key={d.id}
                        className={`${styles.viewerRow} ${styles.gachaRow}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedViewerId(d.viewerId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedViewerId(d.viewerId);
                          }
                        }}
                      >
                        <span className={styles.vMuted}>{fmtDateTime(d.drawnAt)}</span>
                        {/* ⚠⚠ **抽選した時点の名前**（穴 D）。上の貢献者一覧は `viewers.name`＝**今の名前**を
                            出しており、**同じ画面に 2 つの規則が並ぶ**のが仕様である
                            （「その配信で誰が引いたか」は当時の名前が正しい）。⚠ 説明文は書かないので、
                            意図は `SummaryView.test.tsx` の 063i ブロックが固定している。 */}
                        <span className={styles.vName}>{d.viewerName}</span>
                        <span className={styles.vMuted}>{d.gachaName}</span>
                        {/* ⚠ レアは**列にせず結果の隣のバッジ**（列を増やすと横に伸びて読めなくなる。
                            この窓は配信中に開く）。器は 065b の `.vNameCell`（名前＋バッジ）を再利用する。 */}
                        <span className={styles.vNameCell}>
                          <span className={styles.vName}>
                            {/* ⚠⚠⚠ 文言をここに書かない（`GACHA_MISS_LABEL` が唯一の持ち主＝
                                設定画面のテスト抽選と同じ言葉であること）。⚠ `prizeLabel` は
                                serde が `null` を出す・型は optional なので `??` の両対応で受ける。 */}
                            {d.prizeLabel ?? GACHA_MISS_LABEL}
                          </span>
                          {d.rare && (
                            <span className={`${styles.badge} ${styles.badgeRare}`}>
                              レア
                            </span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                {/* ⚠ 切り捨てが起きたときだけ、**事実だけ**を添える（セッション一覧と同じ形・同じ言い回し）。 */}
                {draws.length > SUMMARY_GACHA_DRAW_LIMIT && (
                  <p className={styles.note}>
                    直近 {shownDraws.length} 件 / 全 {fmtNumber(draws.length)} 件
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
