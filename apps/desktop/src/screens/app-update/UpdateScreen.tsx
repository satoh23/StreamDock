import type { AppUpdateStatus } from "../../features/app-update/bindings/AppUpdateStatus";
import type { AppUpdatePhase } from "../../features/app-update/useAppUpdate";
import { Button } from "../../components/primitives";
import { ReleaseNotes } from "./ReleaseNotes";
import layout from "../formLayout.module.css";
import styles from "./UpdateScreen.module.css";

/**
 * 055c: アプリのアップデート画面（**表示まで**）。器は `SettingsScreen` と同じく
 * `formLayout.module.css` を `layout` として import して揃える。
 *
 * 出し分けは 3 状態（+ 確認中）:
 * | 状態 | 表示 |
 * | --- | --- |
 * | 更新あり（`available: true`） | 現在バージョン → 新バージョン ／ 更新内容 ／ 右下に「アップデート」ボタン |
 * | 最新（`available: false`） | 現在バージョンと「最新版です」。アップデートボタンは出さない |
 * | 取得失敗（`phase: "error"`） | 「更新を確認できませんでした」＋再確認の導線 |
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
 */
export function UpdateScreen({
  status,
  phase,
  error,
  onRecheck,
}: {
  status: AppUpdateStatus | null;
  phase: AppUpdatePhase;
  error: string | null;
  onRecheck: () => void;
}) {
  const checking = phase === "idle" || phase === "checking";
  const failed = phase === "error";
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
          <h3>{headline(phase, available)}</h3>
          <p>{headlineDescription(phase, available)}</p>
        </div>
        <div className={layout.panelBody}>
          {checking && <p className={styles.stateNote}>最新のリリース情報を取得しています。</p>}

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

      {available && (
        <div className={layout.bottomActions}>
          {/*
            ⚠ 055c ではこのボタンは **必ず disabled**。ダウンロード / インストール / 再起動の配線は
            055d（`install_app_update` / `restart_app` / 進捗表示）が担う。
            055d では、この `disabled` を外して `onClick` を配線し、`useAppUpdate` 側に
            DL 進捗の state を足すこと。中途半端に押せて何も起きないより、押せない方が事故が少ない。
          */}
          <Button variant="primary" disabled>
            アップデート
          </Button>
        </div>
      )}
    </>
  );
}

// ⚠ 055c review（品質観点 3）: この 2 つは**同じ分岐構造を 2 回**書いており、
//    `Record<状態, { title; desc }>` の文言テーブル 1 本にすれば分岐は 1 回で済む。
//    指摘は妥当だが、CLAUDE.md の「仕様にないリファクタリングをしない」に従い本タスクでは変えない。
//    再修正トリガー＝状態が 5 つ目に増えるとき、または 055d が DL 進捗の文言を足すとき
//    （そのタイミングでテーブル化すること。分岐を 3 箇所に増やさない）。
function headline(phase: AppUpdatePhase, available: boolean): string {
  if (phase === "error") return "更新を確認できませんでした";
  if (phase === "idle" || phase === "checking") return "更新を確認しています";
  return available ? "新しいバージョンがあります" : "お使いのバージョンは最新です";
}

function headlineDescription(phase: AppUpdatePhase, available: boolean): string {
  if (phase === "error") return "ネットワークに接続できないときもこの表示になります。";
  if (phase === "idle" || phase === "checking") return "しばらくお待ちください。";
  return available
    ? "更新内容を確認してからアップデートしてください。"
    : "新しいリリースが公開されると、ヘッダーのベルでお知らせします。";
}
