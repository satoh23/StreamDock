import { useState } from "react";
import type { VoicevoxSpeaker } from "../../features/comment-viewer/voicevox";
import {
  OVERLAY_FONTS,
  resolveOverlayFontStack,
  type OverlayFontId,
} from "../../features/comment-viewer/overlaySettings";
import type { ObsWsConfig } from "../../features/comment-viewer/obsApi";
import {
  TTS_MAX_LENGTH_MAX,
  TTS_MAX_LENGTH_MIN,
  clampTtsMaxLength,
} from "../../features/comment-viewer/ttsPrefs";
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
  // 048: 1 件あたりの読み上げ最大文字数（超過分は「以下略」で打ち切る）。state/永続化は CommentViewerApp が保持し、
  // ここは表示と確定値の受け渡しのみ。**省略の ON/OFF トグルは無い**（常時有効・変えられるのは文字数だけ）。
  ttsMaxLength: number;
  onTtsMaxLengthChange: (value: number) => void;
  // 033d: 読み上げ話者の選択（話者・スタイル一覧と選択中 style id。state は CommentViewerApp が保持）。
  speakers: VoicevoxSpeaker[];
  selectedSpeakerId: number;
  onSpeakerIdChange: (id: number) => void;
  // 034c: 話者/スタイル選択時にその声のサンプルを試聴する（中断切替は CommentViewerApp が持つ preview プレイヤーが担う）。
  onPreview: (styleId: number) => void;
  // 045b: 表示（開閉）トグルは本体コメントビューのツールバーへ移設したため、この設定ビューは overlayOpen /
  // onOverlayToggle を受け取らない（034d の部分反転）。開閉 state・ハンドラは CommentViewerApp が保持したまま。
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
  // 046b: 「固定コメントをOBSに表示」トグル（固定専用オーバーレイ窓 `pinned-overlay` の表示 ON/OFF）。
  // 値は CommentViewerApp が保持し localStorage 永続。ここは表示とユーザー操作の受け渡しのみ。
  pinnedOverlayEnabled: boolean;
  onPinnedOverlayToggle: (next: boolean) => void;
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
  ttsMaxLength,
  onTtsMaxLengthChange,
  speakers,
  selectedSpeakerId,
  onSpeakerIdChange,
  onPreview,
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
  pinnedOverlayEnabled,
  onPinnedOverlayToggle,
}: SettingsViewProps) {
  // 044a: OBS パスワード入力のローカル state（**この値は保存しない・保存は Rust→keychain**）。認証が必要な OBS の
  // ときだけ入力欄を出す。保存ボタンで onSetObsPassword に渡し、入力欄は即クリアして DOM/メモリに残さない（§9）。
  const [obsPasswordInput, setObsPasswordInput] = useState("");
  // 048: 読み上げ最大文字数の**入力中の生文字列**。確定（blur / Enter）まで親 state に反映しない。
  // 理由: 打鍵ごとに確定すると「80 にしたい途中の 8」が下限 20 へクランプされて入力が壊れ、さらに
  // 1 打鍵ごとに localStorage へ書くことになる（親の永続化 effect が state 変更のたびに走るため）。
  // 設定ビューは view 切替でアンマウントされるので、開くたびに現在値で初期化される。
  const [maxLengthInput, setMaxLengthInput] = useState(() =>
    String(ttsMaxLength),
  );

  /**
   * 048: 文字数入力を確定する（blur / Enter）。
   * - 空・NaN（全角数字は `type="number"` が受け付けず空になる）は**直前の確定値へ戻す**。
   *   既定値へ飛ばさない＝ユーザーが設定した値を打ち間違いで勝手に消さない。
   * - 有限値は `clampTtsMaxLength` で丸め、**入力欄の表示もクランプ後の値へ書き戻す**
   *   （「999 と打ったら 200 に落ちた」が見えるようにする。min/max 属性はブラウザの補助であって保証ではない）。
   */
  const commitMaxLength = () => {
    const parsed = Number(maxLengthInput.trim());
    if (maxLengthInput.trim() === "" || !Number.isFinite(parsed)) {
      setMaxLengthInput(String(ttsMaxLength));
      return;
    }
    const next = clampTtsMaxLength(parsed);
    setMaxLengthInput(String(next));
    onTtsMaxLengthChange(next);
  };
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

          {/* 048: 読み上げの文字数上限。長文 1 件の読み上げ中（290 文字なら 48〜64 秒）に届いたコメントが
              バックログ上限で無言破棄されるのを防ぐため、**読み上げテキストだけ**を打ち切る（表示は全文のまま）。
              省略の ON/OFF トグルは持たない（常時有効・変えられるのは文字数だけ）ので、クランプの下限/上限が
              「上限なし」を作らせない役割も兼ねる。ttsEnabled=false でも disabled にしない（話者/スタイル選択と
              同じ「読み上げの中身」を決める設定で、読み上げ前に決めておけるため。source トグルとは性質が違う）。 */}
          <label className={styles.speakerField}>
            {/* 054: ラベル文字列を .fieldLabel で包む（設定項目名＝13px/700/--text）。<label> が子の
                コントロールを包む暗黙ラベルのままなので、関連付け・アクセシブル名は不変（htmlFor/id は導入しない）。 */}
            <span className={styles.fieldLabel}>読み上げの文字数上限</span>
            {/* step=10 は矢印キー/スピナーの刻みを 10 にするためだけの指定で、値の妥当性はここでは決めない
                （65 のような step 外の値も確定時の clampTtsMaxLength が通すので有効。step 不整合は :invalid に
                該当するが、この CSS モジュールに :invalid のスタイルは無いため見た目にも出ない）。
                再修正トリガー＝:invalid の見た目を入れるとき、または「1 刻みで微調整したい」要望が出たとき（step=1 へ）。
                onKeyDown で isComposing を見ていないのは、type="number" が IME 入力を実質受け付けない（変換中の
                文字が value に載らない）ため。仮に誤発火しても commitMaxLength は現在の入力を確定するだけで、
                空なら直前値へ戻る＝非破壊。再修正トリガー＝WKWebView/WebView2 実機で変換確定の Enter が
                値を書き換える事象を観測したとき（そのとき e.nativeEvent.isComposing で弾く）。 */}
            <input
              className={styles.searchInput}
              type="number"
              inputMode="numeric"
              min={TTS_MAX_LENGTH_MIN}
              max={TTS_MAX_LENGTH_MAX}
              step={10}
              value={maxLengthInput}
              onChange={(e) => setMaxLengthInput(e.target.value)}
              onBlur={commitMaxLength}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMaxLength();
              }}
            />
          </label>
          <span className={styles.note}>
            読み上げは指定文字数で打ち切り、続きは「以下略」と読みます（コメントの表示は全文のままです）。
            {TTS_MAX_LENGTH_MIN}〜{TTS_MAX_LENGTH_MAX} 文字。
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
                <span className={styles.fieldLabel}>話者</span>
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
                <span className={styles.fieldLabel}>スタイル</span>
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

      {/* OBSオーバーレイカード。**054 追補(E2E) 以降このカードが担うのは「自動反映（044a）のセットアップ」だけ**で、
          表示（開閉）トグルはここには無い（本体ツールバーへ移設済み）。手動ウィンドウキャプチャの手順注記と
          移設先への導線注記は削除した（下記 cardBody 内の 054 追補コメントに理由と再修正トリガーを書いてある）。
          オーバーレイは表示専用で、閉じても sidecar は落とさない（no-orphan kill 契機はコメビュ窓に集約のまま）。
          経緯: 034d/034(UI刷新) で開閉トグルをこのカードへ集約したが、045b で**部分反転**した。表示（開閉）は
          配信中に頻繁に切り替えるので本体へ、一度きりのセットアップである自動反映はここに残す、という線引き
          （親 045）。045b が併せて置いた移設先への導線注記は、054 追補で自動反映が既定の導線になったため撤去した。
          レビュー（ARIA 逸脱 / 修正不要）: 仕様は aria-pressed だが、switch ロールでは aria-checked が正しい等価
          表現のため既存 ToggleSwitch を流用した。045b 後もカードに残る自動反映トグルが同じ ToggleSwitch なので
          この判断は現役。再修正トリガー＝トグルを switch でなく通常の押しボタン（toggle button）に置き換えるなら
          aria-pressed へ戻す。
          045a: 可視文言のみ「コメントをOBSに表示」へ改名した。窓 label `comment-overlay` と OBS 実窓名
          「StreamDock コメントオーバーレイ」は据え置き（044a の自動追加が窓名一致で探すため・親 045 の線引き）。
          054 追補(E2E): この**実窓名を UI に出していた手動キャプチャ注記は削除した**ので、窓名の一致は
          lib.rs の `.title` と sidecar の `OBS_SOURCE_NAME` の 2 者間だけの契約になった（UI 側の目視担保は無い）。
          窓名を変えるときはこの 2 つを必ず同時に直すこと。
          レビュー（見出しと中身のずれ / 今回は修正不要）: 045b でトグルが出ていったので、見出し
          「コメントをOBSに表示」は**このカードに無いコントロール名**を指している（設定を探しに来た人が見出しで
          見つけたと思い、中では「上部へ行け」と言われる導線）。改名は 045a の領分（可視文言リネーム）で、
          CLAUDE.md「1 回 1 機能」に沿って移設タスクに混ぜない。再修正トリガー＝次に文言タスクを起票するとき。
          そのとき「OBSへの反映（セットアップ）」等へ改め、見出し・導線注記・移設先ラベルの同一文字列衝突
          （CommentViewerApp.toolbar.test.tsx が role="switch" で絞って回避している）も併せて解消する。 */}
      <div className={styles.card}>
        <div className={styles.cardHead}>コメントをOBSに表示</div>
        <div className={styles.cardBody}>
          {/* 054 追補(E2E): ここにあった注記 2 本を**依頼者の指示で削除**した。
              (a) 045b の移設先導線「表示の ON/OFF は、コメント画面の上部にある『コメントをOBSに表示』で切り替えます。」
              (b) 033f 由来の手動キャプチャ手順「OBSの『ウィンドウキャプチャ』で…『StreamDock コメントオーバーレイ』を選ぶと…」
              理由: 自動反映（044a/046d）が既定の導線になり、説明が過剰で設定が読みにくいという実機フィードバック。
              ⚠ 手放したもの（意図的・再修正トリガー付き）:
                - 設定画面だけを見ている人が「表示をどこで ON にするか」を辿る導線（045b が置いたもの）。
                  再修正トリガー＝「表示の ON/OFF が見つからない」という実機フィードバックが出たとき。
                - 自動反映が失敗した人向けの手動フォールバック手順と、OBS 実窓名の可視提示。
                  再修正トリガー＝自動反映の失敗報告が出て、手動手順を画面から辿れないことが原因になったとき
                  （そのとき窓名リテラルは lib.rs の `.title` / sidecar の `OBS_SOURCE_NAME` と一致させること）。
              固定コメントカード側の手動手順は指示外のため据え置き＝**2 カードで非対称**であることも承知の上。 */}
          {/* 033f Windows 追修正③: Windows は OBS 側の設定が macOS と異なる。旧「BitBlt」方式では GPU/透過の
              WebView2 窓を取り込めず真っ黒になるため、WGC＋透過許可を Windows のときだけ案内する。
              上の手動手順を消した後も**残す**: 044a が自動設定するのは `pickWgcMethodValue` によるキャプチャ方式だけで、
              「透過を許可」は自動化されていない＝自動反映を使う人にも必要。固定コメントカードの Windows 注記
              （「上のコメント用と同じく」）が参照している先でもある。 */}
          {hostOs === "windows" && (
            <span className={styles.note}>
              Windows では OBS のウィンドウキャプチャで「キャプチャ方式＝Windows
              10（1903 以降）」を選び、「透過を許可」を ON
              にしてください。旧方式（BitBlt）のままだと真っ黒になります。
            </span>
          )}

          {/* 044a: OBS へ自動追加（連携）。ON の間、オーバーレイを「ウィンドウキャプチャ」ソースとして OBS へ
              自動追加（既存なら再利用）する。手動でのウィンドウキャプチャ追加が不要になる。接続は loopback
              （127.0.0.1:4455）のみ・ユーザーが ON にした時のみ。失敗時は上の手動手順にフォールバックする。
              045c: label を「いつ反映されるのか」が読み取れる条件付きの文へ変更した。旧「OBSに自動で反映する」は
              **このトグル単体で反映が起きる**ようにも読め、実際 044a の旧実装も ON だけでオーバーレイを開いて
              いた（045c で削除）。鉤括弧内は移設先トグルの label と同一文字列（045a 確定）にして指示語を避ける。
              054 追補(E2E): 「失敗時は**上の手動手順にフォールバックする**」と書いていたが、その手動手順の注記は
              画面から削除した（挙動としてのフォールバック＝自動追加を諦めて失敗状態を出すこと自体は不変）。 */}
          <ToggleSwitch
            label="「コメントをOBSに表示」ON時、OBSに自動で反映する"
            checked={obsAutoAdd}
            onChange={onObsAutoAddToggle}
          />
          {/* 054 追補(E2E): ここにあった「ONにすると、上の手動でのウィンドウキャプチャ追加が不要になります。」も
              一緒に削除した。指していた「上の手動での…」が無くなり宙に浮くため（依頼者の判断）。
              自動反映の効果は label「『コメントをOBSに表示』ON時、OBSに自動で反映する」（045c で条件付きの文へ
              改めたもの）が単体で伝えるので、注記無しでも意味は通る。 */}

          {/* 状態表示（idle 以外）。added/reused は「表示できた」ことだけ伝える（区別しない）。failed は赤字（エラー）。
              045a レビュー（表記ゆれ）→ **045b で解消済み**: 「OBS に接続しています…」だけ半角スペースありで他と
              ゆれていた。045a は据え置き（再修正トリガー＝「045b でこの周辺を触るとき」）としていたが、045b が
              同カードの本文を編集し、4 行上の導線注記で「OBSに」表記を新たに増やしたためトリガー発火と判断し、
              「OBSに接続しています…」へ statement を統一した。以降このカードの可視文言は全て「OBSに」で揃う。 */}
          {obsState === "connecting" && (
            <span className={styles.note}>OBSに接続しています…</span>
          )}
          {(obsState === "added" || obsState === "reused") && (
            <span className={styles.note}>OBSにコメントを表示しました。</span>
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
            <span className={styles.fieldLabel}>フォント</span>
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
            ON にすると、OBSに表示する各コメントに配信サービス名（Twitch /
            YouTube）を小さく表示します。
          </span>
        </div>
      </div>

      {/* 046b: 固定コメント（右クリック→「上部に固定」）を OBS へ出す専用オーバーレイ窓のカード。
          上の OBS カードとは**別ウィンドウ**（label `pinned-overlay`）で、OBS では別ソースとして取り込む。
          置き場所を設定ビューにした理由（親 045 の線引きに照らした判断・依頼者の決定）: 表示（開閉）を
          ツールバーへ移した 045b の基準は「配信中に頻繁に切り替えるか」だが、固定オーバーレイの出し入れは
          **固定/固定解除（右クリックメニュー）側の仕事**で、窓そのものは開けっぱなしにする＝
          「OBS にウィンドウキャプチャを仕込む」一度きりのセットアップに当たる。上の OBS カード（同じ
          セットアップ系）の隣に置くのが導線として自然。
          046b 実装時は「手動キャプチャの手順注記と同じカードに置く」ことを理由にしていたが、その注記は
          054 追補(E2E) で上のカードから削除された。置き場所の判断（セットアップ系をまとめる）は不変。
          ⚠ このカードの手動手順（「OFFのときは…手動で追加してください」）は 054 追補の指示範囲外で**据え置き**＝
          コメント用カードには手動手順が無く固定用には在る、という**非対称**が残っている（承知の上）。
          再修正トリガー＝2 カードの案内粒度を揃える文言タスクを起票するとき。
          上の OBS カードの見出し・自動反映トグル・状態表示・パスワード欄は 046b 時点から不変。 */}
      <div className={styles.card}>
        {/* 046b レビュー（修正不要・既知の重複）: 見出しとトグル label が同一文字列で、テストが
            `role="switch"` 絞りを強いられる点は 045b レビューの既知問題と同じ。上の OBS カードと
            同じ作法に揃える方を優先して据え置く（片方だけ言い回しを変えると 2 カードが非対称になる）。
            再修正トリガー＝045b 指摘の一般解として「見出しとコントロール名の重複」をまとめて直すとき。 */}
        <div className={styles.cardHead}>固定コメントをOBSに表示</div>
        <div className={styles.cardBody}>
          {/* ON で専用ウィンドウが開く（固定が 0 件のときは完全に透明で何も映らない）。固定/固定解除では
              窓は開閉せず中身が入れ替わるだけ＝OBS のソースが途切れない。 */}
          <ToggleSwitch
            label="固定コメントをOBSに表示"
            checked={pinnedOverlayEnabled}
            onChange={onPinnedOverlayToggle}
          />
          <span className={styles.note}>
            ONにすると、コメントを右クリックして「上部に固定」したものが OBS
            に表示されます。固定していない間は何も映りません。
          </span>
          {/* 046b レビュー（S-1・依頼者の決定）: この設定が ON だとコメントビューアを開いた時点で窓が自動で開く
              ため、固定を永続させると「前回配信のコメントが次の配信開始時に操作なしで本番へ出る」ことになる。
              そのため**固定はコメントビューアを開くたびに空へ戻す**仕様にした（CommentViewerApp の pinned state）。
              ここでは「配信をまたいでは残らない」ことをユーザーに明示する（毎回固定し直す運用になるため）。 */}
          <span className={styles.note}>
            固定はコメントビューアを開くたびにリセットされます（前の配信で固定したコメントが、次の配信にそのまま映ることはありません）。
          </span>
          {/* 046d: この窓も 044a の自動反映の対象になった（当初は「対象外・手動キャプチャ前提」だったが、
              親 046 が将来タスクとして先送りしていただけで技術的な障害は無く、依頼者の指示で解禁）。
              自動反映が OFF のときのために手動手順も残す。 */}
          <span className={styles.note}>
            上の「OBSに自動で反映する」がONなら、OBSに「StreamDock
            固定コメント」ソースが自動で追加されます。OFFのときは、OBSの「ウィンドウキャプチャ」でウィンドウ「StreamDock
            固定コメント」を選んで手動で追加してください。位置やサイズの調整は、コメントを1件固定してから行うと分かりやすいです。
          </span>
          {hostOs === "windows" && (
            <span className={styles.note}>
              Windows
              では、上のコメント用と同じく「キャプチャ方式＝Windows10（1903
              以降）」と「透過を許可」の設定がこのソースにも必要です。
            </span>
          )}
          {/* フォント・サイト名表示は上のカードの設定を共有する（同じ OBS 画面に 2 つ並ぶため）。 */}
          <span className={styles.note}>
            フォントとサイト名表示は、上の設定がこのウィンドウにも適用されます。
          </span>
        </div>
      </div>
    </div>
  );
}
