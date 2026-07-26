import { useState } from "react";
import type { VoicevoxSpeaker } from "../../features/comment-viewer/voicevox";
import {
  OVERLAY_FONTS,
  resolveOverlayFontStack,
  type OverlayFontId,
} from "../../features/comment-viewer/overlaySettings";
import type { ObsWsConfig } from "../../features/comment-viewer/obsApi";
import { ToggleSwitch } from "./ToggleSwitch";
import { Select } from "./Select";
import { useHostOs } from "../../features/platform/useHostOs";
import styles from "./CommentViewerApp.module.css";

/**
 * 033b: コメビュ窓内の「設定ビュー」。本体（comment ビュー）から歯車ボタンで切り替えて表示し、Twitch/YouTube の
 * 接続・チャンネル入力・取得開始/停止・Device Code 提示をここに集約する（本体には接続ボタンを置かない）。
 *
 * このコンポーネントは**表示専用**で、sidecar への通信面（WS）や制御フレームは一切持たない。接続状態 state は
 * `CommentViewerApp` が保持し、既存ハンドラ（`handleTwitchConnect` / `handleStartSession` / `handleStopSession` /
 * `handleYouTubeConnect` / `handleYouTubeStartSession` / `handleYouTubeStopSession`）を props でそのまま受け取って
 * 呼ぶだけ。よって WS 接続は窓内 1 本のまま・宛先も不変で、メイン窓 no-internet 境界に影響しない。
 *
 * 034(UI刷新): 帯の縦積みを複数カード（読み上げ(VOICEVOX) / OBSオーバーレイ）へ再編し、選択 UI は自作 Select に
 * 統一する。表示・レイアウトのみの変更で、上記ハンドラ・disabled 条件・localStorage 連携などの挙動は不変。
 *
 * 042b: 接続（Twitch/YouTube の連携・取得開始/停止・Device Code 提示）カードは本体のプラットフォーム別カードへ移設
 * したため、この設定ビューからは撤去した（033b の部分反転）。設定ビューは読み上げ／OBS オーバーレイの設定のみを担い、
 * 接続系の state・ハンドラは受け取らない（表示専用で WS を持たない性質は不変・窓内 1 本のまま）。
 */

interface SettingsViewProps {
  onBack: () => void;
  // 033c: VOICEVOX 自動連携 ON/OFF（読み上げトグルは本体コメントビューへ・state は CommentViewerApp が保持）。
  voicevoxAutolink: boolean;
  onVoicevoxAutolinkChange: (value: boolean) => void;
  // 035c: source 別読み上げ ON/OFF（既定 両 ON・state/永続化は CommentViewerApp が保持）。VOICEVOX 読み上げが OFF
  // （ttsEnabled=false）のときは両トグルを無効表示にするため、判定用に ttsEnabled も受け取る（読み上げトグル本体は
  // 本体コメントビューのツールバーにあり、この設定ビューは状態を受け取って disabled 表示するだけ）。
  ttsEnabled: boolean;
  speakTwitch: boolean;
  onSpeakTwitchChange: (value: boolean) => void;
  speakYoutube: boolean;
  onSpeakYoutubeChange: (value: boolean) => void;
  // 033d: 読み上げ話者の選択（話者・スタイル一覧と選択中 style id。state は CommentViewerApp が保持）。
  speakers: VoicevoxSpeaker[];
  selectedSpeakerId: number;
  onSpeakerIdChange: (id: number) => void;
  // 034c: 話者/スタイル選択時にその声のサンプルを試聴する（中断切替は CommentViewerApp が持つ preview プレイヤーが担う）。
  onPreview: (styleId: number) => void;
  // 034d: OBS オーバーレイ窓の開閉（開＝ON / 閉＝OFF）。state は CommentViewerApp が保持し、外部 close も購読で同期。
  overlayOpen: boolean;
  onOverlayToggle: (next: boolean) => void;
  // 034e: オーバーレイの意匠設定（フォント選択・サイト名表示）。値は CommentViewerApp が保持し localStorage 永続。
  // 実際の描画反映はオーバーレイ窓（OverlayApp）が同一 localStorage を storage 購読で受けて行う（この設定ビューは表示専用）。
  overlayFont: OverlayFontId;
  onOverlayFontChange: (id: OverlayFontId) => void;
  overlayShowSource: boolean;
  onOverlayShowSourceChange: (value: boolean) => void;
  // 044a: OBS 連携（方式A＝ウィンドウキャプチャ自動追加）。state/ハンドラは CommentViewerApp が保持し、
  // ここは表示とユーザー操作の受け渡しのみ（WS/秘密は持たない・パスワードは onSetObsPassword 経由で Rust へ）。
  obsConfig: ObsWsConfig | null; // OBS WebSocket の read-only 検出結果（null=未検出）
  obsAutoAdd: boolean; // 「OBS へ自動追加」トグルの状態
  onObsAutoAddToggle: (next: boolean) => void;
  obsState: string; // sidecar からの状態通知（idle/connecting/added/reused/failed）
  onSetObsPassword: (password: string) => void;
  onClearObsPassword: () => void;
}

export function SettingsView({
  onBack,
  voicevoxAutolink,
  onVoicevoxAutolinkChange,
  ttsEnabled,
  speakTwitch,
  onSpeakTwitchChange,
  speakYoutube,
  onSpeakYoutubeChange,
  speakers,
  selectedSpeakerId,
  onSpeakerIdChange,
  onPreview,
  overlayOpen,
  onOverlayToggle,
  overlayFont,
  onOverlayFontChange,
  overlayShowSource,
  onOverlayShowSourceChange,
  obsConfig,
  obsAutoAdd,
  onObsAutoAddToggle,
  obsState,
  onSetObsPassword,
  onClearObsPassword,
}: SettingsViewProps) {
  // 044a: OBS パスワード入力のローカル state（**この値は保存しない・保存は Rust→keychain**）。認証が必要な OBS の
  // ときだけ入力欄を出す。保存ボタンで onSetObsPassword に渡し、入力欄は即クリアして DOM/メモリに残さない（§9）。
  const [obsPasswordInput, setObsPasswordInput] = useState("");
  // 033f Windows 追修正③: OBS のウィンドウキャプチャ方式は OS で事情が異なる。Windows は
  // 「Windows 10(WGC)＋透過を許可」でないと GPU/透過の WebView2 窓を取り込めず黒くなるため、
  // Windows のときだけ設定手順の一文を出す。OS 判定は既存の host_os（タイトルバー出し分けと
  // 同経路）を読み取り専用で使う（この設定ビューの「表示専用」＝WS/制御フレームを持たない性質は不変）。
  const hostOs = useHostOs();

  // 033d: 選択中 style id を含む話者を導出（話者 select の現在値）。一覧が空/未一致なら先頭話者にフォールバック。
  const selectedSpeaker =
    speakers.find((sp) =>
      sp.styles.some((st) => st.id === selectedSpeakerId),
    ) ?? speakers[0];

  return (
    <div className={styles.settingsView}>
      <div className={styles.settingsHeader}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onBack}
          title="コメントに戻る"
          aria-label="コメントに戻る"
        >
          ←
        </button>
        <h1 className={styles.settingsTitle}>設定</h1>
      </div>

      {/* 033c/034(UI刷新): 読み上げ（VOICEVOX）カード。自動連携は設定向けの一度きり設定（読み上げ ON/OFF は配信中に
          頻繁に切り替えるため本体コメントビューへ置く）。起動は既存 launch_voicevox_engine の再利用。 */}
      <div className={styles.card}>
        <div className={styles.cardHead}>読み上げ（VOICEVOX）</div>
        <div className={styles.cardBody}>
          <ToggleSwitch
            label="VOICEVOX自動連携"
            checked={voicevoxAutolink}
            onChange={onVoicevoxAutolinkChange}
          />
          <span className={styles.note}>
            自動連携が ON だと、コメントビューアを開いたときに VOICEVOX
            を自動起動します（要: ツール管理に VOICEVOX を登録）。
          </span>

          {/* 035c: 配信元（Twitch/YouTube）別の読み上げ ON/OFF。両プラットフォーム同時取得時の読み上げ暴発を抑えるための
              フィルタで、既定は両 ON（現行踏襲）。OFF の配信元はコメントを読み上げないが、表示・一覧には残る。読み上げ
              フィルタのみで、VOICEVOX 読み上げ本体が OFF（ttsEnabled=false）のときは両トグルを無効表示にする。 */}
          <ToggleSwitch
            label="Twitch を読み上げる"
            checked={speakTwitch}
            onChange={onSpeakTwitchChange}
            disabled={!ttsEnabled}
          />
          <ToggleSwitch
            label="YouTube を読み上げる"
            checked={speakYoutube}
            onChange={onSpeakYoutubeChange}
            disabled={!ttsEnabled}
          />
          <span className={styles.note}>
            配信元ごとに読み上げの ON/OFF を切り替えられます（OFF
            の配信元は読み上げませんが、コメント表示は残ります）。VOICEVOX
            読み上げが ON のときだけ設定できます。
          </span>

          {/* 033d: 読み上げ話者・スタイルの選択（話者→スタイルの 2 段）。ENGINE 稼働後に一覧（GET /speakers）が
              埋まると選べるようになる。未取得（空）のときは現在の選択（style id）を保持したまま案内文を出す。 */}
          {speakers.length === 0 ? (
            <span className={styles.note}>
              読み上げ話者は VOICEVOX ENGINE を起動すると選べます（現在の選択:
              id=
              {selectedSpeakerId}）。
            </span>
          ) : (
            <div className={styles.voicevoxRow}>
              {/* 034c: 話者/スタイルを選ぶたびに onPreview を呼ぶ（キーボード矢印での選択走査でも都度発火する）。
                  デバウンスは入れない: 「選択で即再生」の要件を損なうため。連続選択は preview プレイヤー側の中断切替
                  （前の合成 abort ＋ 再生 stop）で吸収され、宛先は loopback で軽量。
                  再修正トリガー: 実機で矢印走査時に 50021 への合成連打が負荷になった場合のみ、ここにデバウンスを検討する。 */}
              <label className={styles.speakerField}>
                話者
                <Select
                  ariaLabel="話者"
                  value={speakers.indexOf(selectedSpeaker)}
                  onChange={(e) => {
                    const sp = speakers[Number(e.target.value)];
                    const firstId = sp?.styles[0]?.id;
                    if (firstId !== undefined) {
                      onSpeakerIdChange(firstId);
                      onPreview(firstId); // 034c: 話者切替＝先頭スタイルの声を即試聴（前の再生は中断切替）。
                    }
                  }}
                >
                  {speakers.map((sp, i) => (
                    <option key={i} value={i}>
                      {sp.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={styles.speakerField}>
                スタイル
                <Select
                  ariaLabel="スタイル"
                  value={selectedSpeakerId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    onSpeakerIdChange(id);
                    onPreview(id); // 034c: スタイル切替＝その声を即試聴（前の再生は中断切替）。
                  }}
                >
                  {selectedSpeaker?.styles.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </Select>
              </label>
              {/* 034c: 同じ声をもう一度鳴らす小さな試聴ボタン（選択を変えずに聴き直せる）。選択トリガーと同じ
                  onPreview を呼ぶだけ（別導線を増やさない）。前の再生中なら中断して鳴らし直す。 */}
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => onPreview(selectedSpeakerId)}
                title="選択中の声のサンプルをもう一度再生します"
              >
                試聴 ▶
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 034d/034(UI刷新): OBSオーバーレイカード。1 つのトグルで開閉し、現在の状態を配色＋aria-checked
          （ToggleSwitch は role="switch"）で明示する。ON=開く / OFF=閉じる。オーバーレイは表示専用で、閉じても
          sidecar は落とさない（no-orphan kill 契機はコメビュ窓に集約のまま）。
          レビュー（ARIA 逸脱 / 修正不要）: 仕様は aria-pressed だが、switch ロールでは aria-checked が正しい等価
          表現のため既存 ToggleSwitch を流用した。再修正トリガー＝トグルを switch でなく通常の押しボタン
          （toggle button）に置き換えるなら aria-pressed へ戻す。 */}
      <div className={styles.card}>
        <div className={styles.cardHead}>OBSオーバーレイ</div>
        <div className={styles.cardBody}>
          <ToggleSwitch
            label="OBS オーバーレイを表示"
            checked={overlayOpen}
            onChange={onOverlayToggle}
          />
          <span className={styles.note}>
            OBSの「ウィンドウキャプチャ」で「StreamDock
            コメントオーバーレイ」を選ぶとコメントを重ねられます。
          </span>
          {/* 033f Windows 追修正③: Windows は OBS 側の設定が macOS と異なる。旧「BitBlt」方式では GPU/透過の
              WebView2 窓を取り込めず真っ黒になるため、WGC＋透過許可を Windows のときだけ案内する。 */}
          {hostOs === "windows" && (
            <span className={styles.note}>
              Windows では OBS のウィンドウキャプチャで「キャプチャ方式＝Windows
              10（1903 以降）」を選び、「透過を許可」を ON
              にしてください。旧方式（BitBlt）のままだと真っ黒になります。
            </span>
          )}

          {/* 044a: OBS へ自動追加（連携）。ON で OBS に接続し、オーバーレイを「ウィンドウキャプチャ」ソースとして
              自動追加（既存なら再利用）する。手動でのウィンドウキャプチャ追加が不要になる。接続は loopback
              （127.0.0.1:4455）のみ・ユーザーが ON にした時のみ。失敗時は上の手動手順にフォールバックする。 */}
          <ToggleSwitch
            label="OBS へ自動追加（連携）"
            checked={obsAutoAdd}
            onChange={onObsAutoAddToggle}
          />
          <span className={styles.note}>
            ONにすると、コメントオーバーレイを表示する際、OBSに自動的にオーバーレイが反映されます。
          </span>

          {/* 状態表示（idle 以外）。added/reused は「表示できた」ことだけ伝える（区別しない）。failed は赤字（エラー）。 */}
          {obsState === "connecting" && (
            <span className={styles.note}>OBS に接続しています…</span>
          )}
          {(obsState === "added" || obsState === "reused") && (
            <span className={styles.note}>
              OBSにオーバーレイを表示しました。
            </span>
          )}
          {obsState === "failed" && (
            <span className={styles.errorText}>
              OBSに接続できませんでした。OBSが起動しているか確認してください。
            </span>
          )}

          {/* WS 未検出/未有効なら有効化ガイド（read-only 検出結果に基づく・書き込みはしない）。エラーとして赤字で案内する。 */}
          {(obsConfig === null || !obsConfig.enabled) && (
            <div className={styles.errorText}>
              OBSの設定が不足しています。OBSのメニュー → ツール →
              WebSocketサーバー設定 を開き、以下を確認してください。
              <ul className={styles.obsGuideSteps}>
                <li>WebSocketサーバーを有効にするにチェックを入れる</li>
                <li>サーバーポートが4455になっていることを確認</li>
                <li>適用ボタンをクリック。</li>
              </ul>
            </div>
          )}

          {/* OBS 側で認証が必要なときだけパスワード入力を出す（不要な人には出さない）。
              入力値は保存せず、保存ボタンで Rust（keychain）へ渡した直後にクリアする（§9）。 */}
          {obsConfig?.authRequired && (
            <div className={styles.speakerField}>
              {/* 入力を短幅（searchInput）にし、保存/削除ボタンを横に並べる。保存＝主要色(btn)・削除＝ghost。 */}
              <div className={styles.fontRow}>
                <input
                  className={styles.searchInput}
                  type="password"
                  autoComplete="off"
                  value={obsPasswordInput}
                  onChange={(e) => setObsPasswordInput(e.target.value)}
                  placeholder="OBS のサーバーパスワード"
                />
                <button
                  type="button"
                  className={styles.btn}
                  disabled={obsPasswordInput.trim().length === 0}
                  onClick={() => {
                    onSetObsPassword(obsPasswordInput);
                    setObsPasswordInput(""); // DOM/メモリに残さない（§9）
                  }}
                >
                  保存
                </button>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => {
                    onClearObsPassword();
                    setObsPasswordInput("");
                  }}
                >
                  削除
                </button>
              </div>
              {/* 取得方法はフォーム下に折りたたみで置く（既定は閉じ・クリックで展開・native details）。 */}
              <details className={styles.obsPasswordHelp}>
                <summary>OBSのサーバーパスワード取得方法</summary>
                OBSのメニュー → ツール → WebSocketサーバー設定 → 接続情報を表示
                → サーバーパスワードの横にあるコピーをクリック
              </details>
            </div>
          )}

          {/* 034e: オーバーレイの意匠設定（フォント選択・サイト名表示）。値は同一 localStorage を介してオーバーレイ窓へ
              即反映する（OverlayApp が storage 購読）。フォントはすべて OS 標準で外部フォントは使わない（CSP 方針）。
              サイト名は受信済み source（Twitch/YouTube）の表示のみで新規取得はしない。 */}
          <label className={styles.speakerField}>
            フォント
            {/* 034(UI刷新): 選択したフォントで実際にどう表示されるかを右側でプレビューする。resolveOverlayFontStack で
                id → font-family スタックへ解決し inline 適用（オーバーレイ本体と同じ解決経路・OS 標準フォントのみで
                外部フォントは参照しない）。 */}
            <div className={styles.fontRow}>
              <Select
                ariaLabel="フォント"
                value={overlayFont}
                onChange={(e) =>
                  onOverlayFontChange(e.target.value as OverlayFontId)
                }
              >
                {OVERLAY_FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <span className={styles.fontPreview} aria-hidden="true">
                <span className={styles.fontPreviewLabel}>プレビュー</span>
                <span
                  className={styles.fontPreviewSample}
                  style={{ fontFamily: resolveOverlayFontStack(overlayFont) }}
                >
                  あア亜Ag 123
                </span>
              </span>
            </div>
          </label>
          <ToggleSwitch
            label="サイト名を表示する"
            checked={overlayShowSource}
            onChange={onOverlayShowSourceChange}
          />
          <span className={styles.note}>
            ON にすると、オーバーレイの各コメントに配信サービス名（Twitch /
            YouTube）を小さく表示します。
          </span>
        </div>
      </div>
    </div>
  );
}
