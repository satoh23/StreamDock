import { useState } from "react";
import {
  findStreamEvent,
  STREAM_EVENT_REGISTRY,
  type StreamEvent,
} from "../../features/obs-effects/streamEventRegistry";
import {
  loadStreamEventSelected,
  saveStreamEventSelected,
  streamEventRemainingLabel,
  type StreamEventRound,
} from "../../features/obs-effects/streamEventRound";
import { Button } from "../../components/primitives";
import { EFFECT_OUTPUT_LABEL, EFFECT_OUTPUT_WINDOW_TITLE } from "./effectAssignments";
import layout from "../formLayout.module.css";
import styles from "./StreamEventTab.module.css";

/**
 * 061l: 「OBSエフェクト」画面の **「配信イベント」タブ**（061i から枠だけだった場所の中身）。
 *
 * ## 形は `RakurakuToolsScreen` をそのまま借りている（判断 2）
 *
 * **一覧（カード）→ 詳細** を `Screen` union を増やさず**この中のローカル state**（判別可能ユニオン）で
 * 切り替える。⚠ **らくらく側は 1 行も変更していない**（形を借りるだけ）。
 * ⚠⚠ **カード部品を `components/` へ出さない**——061g の規律は「画面を跨ぐと分かっているものは
 * 最初から `components/`」だが、らくらく側の `INTEGRATION_REGISTRY` は**現在空配列**（032c-a で撤去）で
 * `.card` の CSS は 1 度も描画されていない＝**いま跨いでいない**。
 * ⚠ **再修正トリガー＝らくらく側にエントリが復活し、2 画面が同じカードを描くとき。**
 *
 * ## ⚠⚠ 「適用」と「開始」は別（判断 6）
 *
 * | 操作 | 意味 | 書くもの | 窓 |
 * |---|---|---|---|
 * | **適用**（詳細画面） | このイベントを使う | 選択キー | ⚠ **開かない** |
 * | **開始**（適用済みカード） | 開催を始める | 開催キー | **ステージ窓を開く** |
 * | **終了**（開催中カード） | 開催を止める | 開催キーを消す | ⚠ **閉じない**（親 046 の規律） |
 *
 * ⚠⚠ **開催状態（`round`）はこのコンポーネントが持たない。** 持ち主は `ObsEffectsScreen` で、
 * 理由は 2 つ:
 *   1. **前提ステータスの「開催中のイベント」行**（判断 10）も同じ値を出すので、
 *      2 か所が別々に持つと**片方が古くなる**（061d-2 レビュー Q-9 と同型）。
 *   2. ⚠⚠ **窓を開く要求は `ObsEffectsScreen` の `stage` 用キューを通す**必要がある（061k 判断 11）。
 *      ⇒ ⚠ **このファイルは OS 操作の口を 1 つも import しない**（窓の開閉 API も Tauri のコマンド呼び出しも
 *      持たず、`onStartRound` / `onEndRound` を呼ぶだけ）。⚠ **不変条件として grep で確認できること**が要点で、
 *      教訓 E-6 のとおり**その語をここへ書かない**（書くと grep が自分のコメントにヒットする）。
 *
 * ⚠ **`ComingSoonScreen` は流用しない**（061i の判断のまま。あれは画面まるごと用のダミーページで、
 * ヘッダーのセクション導線の意味論を持っている）。
 */

/** 一覧 / 詳細のローカル state（`RakurakuToolsScreen` と同型・`Screen` union は増やさない）。 */
type View = { stage: "list" } | { stage: "detail"; id: string };

export interface StreamEventTabProps {
  /** 開催中の 1 回（`null`＝開催していない）。⚠ 持ち主は `ObsEffectsScreen`（上の JSDoc）。 */
  round: StreamEventRound | null;
  /**
   * 残り時間の計算に使う「いま」。⚠⚠ **時計は 1 つ**（判断 5）——
   * ここで `Date.now()` を呼ぶと、画面の他の場所と 1 テック分ずれた値を同時に出すことになる。
   */
  nowMs: number;
  /** 「開始」。⚠ 実際に開催キーを書き、ステージ窓を開くのは `ObsEffectsScreen`。 */
  onStartRound: (eventId: string) => void;
  /** 「終了」。⚠⚠ **窓は閉じない**（判断 5・061i 判断 1・親 046）。 */
  onEndRound: () => void;
}

export function StreamEventTab({
  round,
  nowMs,
  onStartRound,
  onEndRound,
}: StreamEventTabProps) {
  const [view, setView] = useState<View>({ stage: "list" });
  /**
   * 適用中のイベント id。⚠ **未知 id は `load*` が `null` へ倒す**（アプリ更新でレジストリから
   * 消えた id を掴んだままにしない）。⚠ 書き手は下の `handleApply` 1 か所だけ。
   */
  const [selectedId, setSelectedId] = useState<string | null>(loadStreamEventSelected);

  const selected = selectedId === null ? null : findStreamEvent(selectedId);
  // ⚠ 開催中に出すのは**開催キーが指すイベント**（適用中のものではない）。
  //   「開催中に別のイベントを適用する」ができるので、ここを `selected` で代表させると嘘になる。
  const running = round === null ? null : findStreamEvent(round.eventId);

  const handleApply = (event: StreamEvent) => {
    saveStreamEventSelected(event.id);
    setSelectedId(event.id);
    setView({ stage: "list" });
  };

  // 詳細（未知 id は一覧へフォールバック＝`RakurakuToolsScreen` と同型）。
  if (view.stage === "detail") {
    const event = findStreamEvent(view.id);
    if (event !== null) {
      return (
        <DetailView
          event={event}
          applied={event.id === selectedId}
          onBack={() => setView({ stage: "list" })}
          onApply={() => handleApply(event)}
        />
      );
    }
  }

  return (
    <>
      {/* 開催の制御（適用済みイベントのカード・判断 6）。⚠ 何も適用していないときは案内だけ。 */}
      <section className={layout.panel}>
        <div className={layout.panelHead}>
          <h3>イベントの開催</h3>
          <p>適用したイベントを、配信中に開始・終了します。</p>
        </div>
        <div className={layout.panelBody}>
          {round !== null && running !== null ? (
            <div className={styles.roundBox}>
              <div className={styles.roundHead}>
                <span className={styles.roundTitle}>{running.title}</span>
                <span className={styles.roundRemaining}>
                  {streamEventRemainingLabel(round, nowMs)}
                </span>
              </div>
              {/* ⚠⚠ 「黙って何も起きない状態を作らない」（061a 以来の規律）——
                  ステージ窓は sidecar を**起動しない**ので、コメントの取得を始めていないと
                  件数が 1 も増えない。それをここで 1 文で明示する。 */}
              <p className={styles.note}>
                コメントの数は、コメントの取得中だけ増えます（取得はコメントビューアから開始します）。
              </p>
              {/* ⚠⚠ 判断 5・061i 判断 1・親 046: **終了しても窓は閉じない**（配信中に窓が消えると
                  OBS のウィンドウキャプチャが真っ黒になる）。閉じたいときの導線は下の 1 文。 */}
              <p className={styles.note}>
                終了しても{EFFECT_OUTPUT_LABEL.stage}
                のウィンドウは開いたままです（閉じるときは、下の「エフェクトのウィンドウ（
                {EFFECT_OUTPUT_LABEL.stage}）」にある「ウィンドウを閉じる」を押してください）。
              </p>
              <div className={styles.roundActions}>
                <Button type="button" onClick={onEndRound}>
                  終了
                </Button>
              </div>
            </div>
          ) : selected !== null ? (
            <div className={styles.roundBox}>
              <div className={styles.roundHead}>
                <span className={styles.roundTitle}>{selected.title}</span>
                <span className={styles.roundApplied}>適用中</span>
              </div>
              {/* ⚠ 窓名は表から引く（直書きすると、窓名を直したときにここだけ古くなる。
                  ユーザーは OBS のウィンドウ一覧を**この文字列で探す**）。 */}
              <p className={styles.note}>
                「開始」を押すと、{EFFECT_OUTPUT_LABEL.stage}のウィンドウ（「
                {EFFECT_OUTPUT_WINDOW_TITLE.stage}」）を開いて、そこにイベントを表示します。
              </p>
              <div className={styles.roundActions}>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => onStartRound(selected.id)}
                >
                  開始
                </Button>
              </div>
            </div>
          ) : (
            <p className={styles.note}>
              まだイベントを適用していません。下の一覧から選んで「詳細を見る」→「適用」を押してください。
            </p>
          )}
        </div>
      </section>

      {/* 一覧（左サムネ・右タイトル/短い説明のカード）。 */}
      <section className={layout.panel}>
        <div className={layout.panelHead}>
          <h3>配信イベント</h3>
          <p>視聴者が参加できるイベントを配信画面に出します。</p>
        </div>
        <div className={layout.panelBody}>
          <div className={styles.list}>
            {STREAM_EVENT_REGISTRY.map((event) => (
              <StreamEventCard
                key={event.id}
                event={event}
                applied={event.id === selectedId}
                onOpen={() => setView({ stage: "detail", id: event.id })}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * 一覧の 1 枚（左サムネ・右タイトル/短い説明・右下に「詳細を見る」）。
 *
 * ⚠ **`components/` へ出さない**（判断 2）。⚠ 再修正トリガー＝らくらく側にエントリが復活し、
 * 2 画面が同じカードを描くとき（上のクラス JSDoc）。
 */
function StreamEventCard({
  event,
  applied,
  onOpen,
}: {
  event: StreamEvent;
  applied: boolean;
  onOpen: () => void;
}) {
  return (
    <div className={styles.card}>
      <StreamEventThumb event={event} />
      <div className={styles.cardBody}>
        <span className={styles.cardTitle}>{event.title}</span>
        <span className={styles.cardSummary}>{event.summary}</span>
        {applied && <span className={styles.cardApplied}>適用中</span>}
      </div>
      <div className={styles.cardAction}>
        <Button type="button" onClick={onOpen}>
          詳細を見る →
        </Button>
      </div>
    </div>
  );
}

/**
 * サムネイル（判断 3）。**`thumbnail` があれば画像・無ければ絵文字**。
 *
 * ⚠ 画像は**同梱物（`public/` の同一オリジン）だけ**で、外部 URL は載らない（レジストリの JSDoc が正）。
 * ⚠ **`onError` の分岐は作らない**——壊れた画像は取り込みではなく同梱物なので、壊れていれば開発時に気づく。
 * ⚠ `alt=""` にしているのは、すぐ右にタイトルがあり**同じ内容を 2 回読ませない**ため（`Header.tsx` と同じ）。
 */
function StreamEventThumb({ event }: { event: StreamEvent }) {
  return (
    <span className={styles.thumb}>
      {event.thumbnail === undefined ? (
        <span aria-hidden="true">{event.icon}</span>
      ) : (
        <img className={styles.thumbImg} src={event.thumbnail} alt="" />
      )}
    </span>
  );
}

/** 詳細（アイコン＋タイトル／説明／配信での使い方／「適用」）。 */
function DetailView({
  event,
  applied,
  onBack,
  onApply,
}: {
  event: StreamEvent;
  applied: boolean;
  onBack: () => void;
  onApply: () => void;
}) {
  return (
    <>
      <div className={layout.top}>
        <div className={styles.detailTitleWrap}>
          <StreamEventThumb event={event} />
          <div className={`${layout.title} ${layout.pageTitle}`}>
            <h2>{event.title}</h2>
          </div>
        </div>
        <div className={layout.actions}>
          <Button type="button" onClick={onBack}>
            ← 一覧へ戻る
          </Button>
        </div>
      </div>

      <section className={layout.panel}>
        <div className={layout.panelBody}>
          <p className={styles.detailText}>{event.description}</p>
          <h4 className={styles.detailSubTitle}>配信での使い方</h4>
          <ul className={styles.bullets}>
            {event.howTo.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      <div className={styles.ctaArea}>
        {/* ⚠⚠ 判断 6: **「適用」は選ぶだけ**——開催キーを書かず、窓も開かない。 */}
        <Button type="button" variant="primary" onClick={onApply}>
          適用
        </Button>
        <span className={styles.ctaNote}>
          {applied
            ? "このイベントを適用中です。開始は上の「イベントの開催」から行います。"
            : "適用しても配信画面にはまだ何も出ません（開始すると出ます）。"}
        </span>
      </div>
    </>
  );
}
