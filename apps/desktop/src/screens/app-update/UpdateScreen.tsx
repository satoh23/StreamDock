import type { AppUpdateStatus } from "../../features/app-update/bindings/AppUpdateStatus";
import type {
  AppUpdatePhase,
  AppUpdateProgressState,
} from "../../features/app-update/useAppUpdate";
import type { HostOs } from "../../features/platform/useHostOs";
import { Button, Spinner } from "../../components/primitives";
import { ReleaseNotes } from "./ReleaseNotes";
import layout from "../formLayout.module.css";
import styles from "./UpdateScreen.module.css";

/**
 * 055c: アプリのアップデート画面（**表示まで**）。器は `SettingsScreen` と同じく
 * `formLayout.module.css` を `layout` として import して揃える。
 * 055d: ダウンロード / インストール / 再起動を配線した。
 *
 * 出し分け:
 * | 状態 | 表示 |
 * | --- | --- |
 * | 更新あり（`available: true`） | 現在バージョン → 新バージョン ／ 更新内容 ／ 右下に「アップデート」ボタン |
 * | 最新（`available: false`） | 現在バージョンと「最新版です」。アップデートボタンは出さない |
 * | 取得失敗 / インストール失敗（`phase: "error"`） | 定型文言＋再確認の導線 |
 * | `downloading` / `installing` | 進捗バー（総バイト数不明なら不定形）＋ボタンは Spinner で無効 |
 * | `installed` | **OS で分岐**（macOS＝再起動ボタン／Windows＝案内文言） |
 *
 * ⚠ **Windows は `installed` に到達しない**（plugin の `install()` がインストーラを起動して
 * `std::process::exit(0)` する＝プロセスごと消える）。そのため Windows の案内文言は
 * **`installing` の時点で**出す。`installed` 側にも同じ分岐を置いてあるのは、
 * 099b の実測で挙動が違った場合に表示が破綻しないようにするため（両対応）。
 *
 * ⚠ **§9**: 取得失敗時に**生エラー文字列・URL・ローカルパスを出さない**。
 * 出すのは `useAppUpdate` が持つ定型文言だけで、この画面は例外オブジェクトを一切受け取らない。
 * 赤いエラー帯（`layout.error`）も使わない——ネットワーク断は想定内の状態で、
 * 055b が「静かな表示に落とす」と決めているため。
 *
 * ⚠ **`null` は truthy 判定で読む**（055b レビュー Q-4）。省略可フィールドは serde に
 * `skip_serializing_if` が無いので **`undefined` ではなく `null` で届く**＝`!== undefined` と書くと
 * `null` に対して true になり「新バージョン: null」と表示される。
 *
 * 054 の階層規則に従う（項目名＝`var(--text)`×太字／補足＝`var(--muted)`／`--text-faint` は無効状態専用）。
 * 実値は `formLayout.module.css` から採り、新しい値は発明しない。
 *
 * ⚠ **055c の「表示専用＝invoke も通信も一切起こさない」は 055d でも維持している**
 * （OS 分岐に使う `hostOs` は `useHostOs()` を自前で呼ばず props で受ける・review Q-9）。
 */
export function UpdateScreen({
  status,
  phase,
  error,
  progress,
  hostOs,
  onRecheck,
  onInstall,
  onRestart,
}: {
  status: AppUpdateStatus | null;
  phase: AppUpdatePhase;
  error: string | null;
  progress: AppUpdateProgressState | null;
  /**
   * 055d review Q-9: **`useHostOs()` を自前で呼ばず props で受ける。**
   * `App` は既に `hostOs` を持っており `Header` / `RakurakuToolsScreen` へ props で配っているので、
   * ここだけ自前で呼ぶと ①同じ `invoke("host_os")` が画面を開くたびに増える
   * ②このコンポーネントが「表示専用＝invoke も通信も起こさない」という 055c の契約から外れる
   * ③初回レンダリングが必ず `null`（＝macOS 扱い）になり、Windows で 1 フレーム分だけ表示が揺れる。
   */
  hostOs: HostOs;
  onRecheck: () => void;
  onInstall: () => void;
  onRestart: () => void;
}) {
  // ⚠ `SettingsView.tsx` と同じ作法: `=== "windows"` の等値比較だけで、それ以外（判定前の `null` を
  //    含む）は macOS 側に落とす。判定できないことを Windows 扱いにしない。
  const isWindows = hostOs === "windows";

  const checking = phase === "idle" || phase === "checking";
  const failed = phase === "error";
  const working = phase === "downloading" || phase === "installing";
  const installed = phase === "installed";
  // ⚠ `status.available` だけで決まる（055b）。取得失敗は status が null なので自動的に false。
  // ⚠ `!failed &&` は現在のフック契約では**冗長**（`phase: "error"` なら status は必ず null）。
  //    それでも残すのは、このコンポーネントが表示専用の純関数で**フックの契約を知らない**ため
  //    ——呼び出し側が `phase="error"` と古い `status` を同時に渡すことは型の上では可能で、
  //    そのとき「取得失敗」と「更新あり」が同時に描かれる。多重防御として意図的に置いている。
  //    再修正トリガー＝ status と phase を 1 つの判別可能 union に統合したとき（そのとき初めて不要になる）。
  const available = !failed && status?.available === true;

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>アップデート</h2>
          <p>StreamDock の新しいバージョンを確認できます。</p>
        </div>
      </div>

      <section className={layout.panel}>
        <div className={layout.panelHead}>
          <h3>{HEADLINES[headlineKey(phase, available)].title}</h3>
          <p>{HEADLINES[headlineKey(phase, available)].description}</p>
        </div>
        <div className={layout.panelBody}>
          {checking && <p className={styles.stateNote}>最新のリリース情報を取得しています。</p>}

          {/* 進捗。⚠ 総バイト数が不明なとき（`Content-Length` 無し）と `installing` 中は
              **不定形（インデターミネート）表示**にする——インストール中はバイト数が動かないので、
              満杯のまま止まったバーは「固まった」に見える。 */}
          {working && (
            <div className={styles.progressBlock}>
              <UpdateProgressBar phase={phase} progress={progress} />
              <p className={styles.stateNote}>
                {isWindows && phase === "installing"
                  ? WINDOWS_INSTALL_NOTE
                  : progressLabel(phase, progress)}
              </p>
            </div>
          )}

          {/* 完了後は OS で分岐する。⚠ Windows は原理的にここへ到達しない見込み
              （plugin がインストーラ起動後に `std::process::exit(0)` する）が、
              099b で実測するまで断定しないので両方の表示を用意しておく。 */}
          {installed && (
            <p className={styles.stateNote}>
              {isWindows ? WINDOWS_INSTALL_NOTE : MACOS_RESTART_NOTE}
            </p>
          )}

          {/* ⚠ 再確認の導線は**取得失敗のときだけ**（055c review Q-10）。「最新です」からは手動で
              確認し直せない＝アプリを開き直すまで結果が変わらない。仕様の表示表どおりだが、
              起動時に自動チェックが走るので実害は小さいと判断して据え置く。
              再修正トリガー＝「更新が出たのにバッジが付かない」問い合わせが実際に来たとき。
              ⚠ 連打は `useAppUpdate` の `inFlightRef` が止める。phase が checking に変わると
              このブロックごと un-render されてボタンが消えるが、それは `failed` 判定の**副産物**で
              あってガードではない（un-render に依存しないこと）。 */}
          {failed && (
            <>
              <p className={styles.stateNote}>{error}</p>
              <div className={styles.stateActions}>
                <Button onClick={onRecheck}>再確認</Button>
              </div>
            </>
          )}

          {!checking && !failed && status && (
            <div className={styles.fields}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>現在のバージョン</span>
                <span className={styles.fieldValue}>{status.currentVersion}</span>
              </div>

              {/* ⚠ truthy 判定。`latestVersion` は更新が無いとき `null` で届く。 */}
              {available && status.latestVersion && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>新しいバージョン</span>
                  <span className={styles.fieldValue}>{status.latestVersion}</span>
                </div>
              )}

              {/* ⚠ 同上。`notes` も `null` で届きうるので truthy 判定で守る。
                  ⚠ 空文字列 `""` でも falsy なので**「更新内容」の行ごと消える**（055c review S-4）。
                     空のラベルだけが残るより良いので意図どおり。ただし `notes` が空なのは
                     055a のリリースノート生成が失敗している合図でもあるため、実機で
                     「更新内容が出ない」を見たら 055a 側（make-latest-json.mjs）を疑うこと。 */}
              {available && status.notes && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>更新内容</span>
                  {/* 055e はこの ReleaseNotes の中身だけを差し替える（描画点は 1 箇所に閉じている）。 */}
                  <ReleaseNotes notes={status.notes} />
                </div>
              )}

              {!available && (
                <p className={styles.stateNote}>
                  お使いの StreamDock は最新版です。アップデートの必要はありません。
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ⚠ 多重押下は `disabled` と `useAppUpdate` の `inFlightRef` の**二重**で止める
          （`disabled` だけだと、レンダリングが追いつく前の連続クリックを取りこぼしうる）。
          さらに Rust 側にも `InstallGuard` があり、他の窓から呼ばれた場合も含めて止まる。 */}
      {available && !installed && (
        <div className={layout.bottomActions}>
          {/* ⚠ `aria-label` を明示するのは、実行中にラベルが `<Spinner />` に差し替わると
              **ボタンのアクセシブルネームが空になる**ため（`MainScreen` の一括起動も同じ形だが、
              あちらは名前が消えても押せる状態が続くのに対し、こちらは「無効化されている」ことを
              読み上げで伝えたい）。名前が状態で変わらないので、テストからも常に同じ名前で掴める。 */}
          <Button
            variant="primary"
            aria-label="アップデート"
            disabled={working}
            onClick={onInstall}
          >
            {working ? <Spinner /> : "アップデート"}
          </Button>
        </div>
      )}

      {/* macOS のみ。Windows は NSIS が自動で立ち上げ直すのでボタンを出さない（案内文言だけ）。 */}
      {installed && !isWindows && (
        <div className={layout.bottomActions}>
          <Button variant="primary" onClick={onRestart}>
            再起動
          </Button>
        </div>
      )}
    </>
  );
}

/** 完了後の案内（OS 分岐）。可変情報を含まない定型文言に限る（§9）。 */
const WINDOWS_INSTALL_NOTE = "インストーラが起動します。完了後に自動で立ち上がります。";
const MACOS_RESTART_NOTE = "「再起動」を押すと、新しいバージョンで起動し直します。";

/**
 * 見出しの文言テーブル（055c review 品質観点 3 の再修正トリガー
 * 「055d が DL 進捗の文言を足すとき」に従って導入した）。
 *
 * 以前は `headline()` / `headlineDescription()` が**同じ分岐を 2 回**書いており、055d で状態が
 * 4 → 7 に増えると分岐が 3 箇所に散る予定だった。テーブル 1 本＋キー導出 1 本に畳んで、
 * 「状態を足したのに片方の文言だけ直し忘れる」事故を型で防ぐ（`Record` なのでキー漏れはコンパイルエラー）。
 *
 * ⚠ `failed` の文言が「確認できませんでした」ではなく「更新できませんでした」なのは、
 * **`phase: "error"` が取得失敗とインストール失敗の両方を表すようになった**ため。
 * どちらだったかは本文（`error` の定型文言）が示す。
 * 再修正トリガー＝取得失敗とインストール失敗で見出しまで変えたくなったら、
 * phase を 2 つに割るか、判別可能 union に統合すること（`status !== null` から推測しないこと）。
 */
const HEADLINES = {
  checking: {
    title: "更新を確認しています",
    description: "しばらくお待ちください。",
  },
  failed: {
    title: "更新できませんでした",
    description: "ネットワークに接続できないときもこの表示になります。",
  },
  available: {
    title: "新しいバージョンがあります",
    description: "更新内容を確認してからアップデートしてください。",
  },
  upToDate: {
    title: "お使いのバージョンは最新です",
    description: "新しいリリースが公開されると、ヘッダーのベルでお知らせします。",
  },
  downloading: {
    title: "更新をダウンロードしています",
    description: "完了するまでアプリを終了しないでください。",
  },
  installing: {
    title: "更新をインストールしています",
    description: "完了するまでアプリを終了しないでください。",
  },
  installed: {
    title: "更新の準備ができました",
    description: "新しいバージョンは次回の起動から反映されます。",
  },
} as const satisfies Record<string, { title: string; description: string }>;

/** `phase`（＋更新の有無）から文言テーブルのキーを 1 箇所で導く。 */
function headlineKey(phase: AppUpdatePhase, available: boolean): keyof typeof HEADLINES {
  switch (phase) {
    case "idle":
    case "checking":
      return "checking";
    case "error":
      return "failed";
    case "downloading":
      return "downloading";
    case "installing":
      return "installing";
    case "installed":
      return "installed";
    case "ready":
      return available ? "available" : "upToDate";
  }
}

/**
 * 進捗の 1 文。**バイト数とパーセントだけ**（URL・ローカルパス・ファイル名を出さない・§9）。
 *
 * ⚠ **export しない**（`react-refresh/only-export-components` ＝ .tsx からコンポーネント以外を
 * export すると Fast Refresh が効かなくなる・`ReleaseNotes.tsx` の `MAX_NOTES_CHARS` と同じ扱い）。
 * 境界（総バイト数が `null` / `0` / 受信超過）は **DOM 越し**にテストする
 * （`aria-valuenow` と表示文言で十分に固定できる）。
 */
function progressLabel(
  phase: AppUpdatePhase,
  progress: AppUpdateProgressState | null,
): string {
  if (phase === "installing") return "ダウンロードが完了しました。インストールしています。";
  const percent = progressPercent(progress);
  if (percent === null) return "ダウンロードしています。";
  return `ダウンロードしています（${percent}%）。`;
}

/**
 * 進捗率（0〜100）。総バイト数が不明・0 以下なら `null`＝**不定形表示に落とす**。
 *
 * ⚠ 総バイト数はサーバの `Content-Length` 由来で、受信済みが総数を超えることが理論上ありうるので
 * 100 で頭打ちにする（バーが枠から出ないように）。
 */
function progressPercent(progress: AppUpdateProgressState | null): number | null {
  if (!progress) return null;
  const { downloadedBytes, totalBytes } = progress;
  if (totalBytes === null || totalBytes <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor((downloadedBytes / totalBytes) * 100)));
}

/** 進捗バー。`<progress>` は appearance:none で不定形アニメーションが消えるので自前の 2 段 div にする。 */
function UpdateProgressBar({
  phase,
  progress,
}: {
  phase: AppUpdatePhase;
  progress: AppUpdateProgressState | null;
}) {
  // installing 中はバイト数が動かないので、満杯で止まったバーに見せず不定形にする。
  const percent = phase === "installing" ? null : progressPercent(progress);

  if (percent === null) {
    return (
      <div className={styles.progressTrack} role="progressbar" aria-label="更新の進捗">
        <div className={styles.progressIndeterminate} />
      </div>
    );
  }

  return (
    <div
      className={styles.progressTrack}
      role="progressbar"
      aria-label="更新の進捗"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className={styles.progressValue} style={{ width: `${percent}%` }} />
    </div>
  );
}
