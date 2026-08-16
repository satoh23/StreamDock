import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  listViewers,
  deleteViewer,
  importViewerMemoryCsv,
} from "../../features/viewer-memory/viewerMemoryApi";
import type {
  ViewerImportResult,
  ViewerRecord,
  ViewerSort,
} from "../../features/viewer-memory/types";
// 065b: AppError の表示整形は既存の共有ヘルパを再利用する（下の runImport の注記が理由）。
import { toErrorMessage } from "../../features/tools/useTools";
import { Select } from "../../components/Select";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ViewerDetailPanel } from "./ViewerDetailPanel";
import {
  providerLabel,
  fmtDateTime,
  fmtNumber,
  fmtSuperchat,
} from "./viewerFormat";
import styles from "./CommentViewerApp.module.css";
// 061g: ボタンの意匠は `components/compactButtons.module.css` へ移した（`ConfirmDialog` が
// `components/` へ出たため）。⚠ 寸法・配色はこの窓の 6 ファイル計 25 箇所と `ConfirmDialog` の共有。
import btnStyles from "../../components/compactButtons.module.css";

/**
 * 038b: 視聴者メモリ（038a が端末内 SQLite に保存・集計したデータ）を配信者だけが見るコメビュ窓で閲覧する
 * 「視聴者一覧」ビュー。SettingsView と同じ表示専用の流儀で、WS/TTS/sidecar 制御は持たず、操作は 038a の Tauri
 * command 薄いラッパ（viewerMemoryApi）＝invoke のみ。受け取る props は本体へ戻る onBack のみ。
 *
 * 038b フォローアップ: 「詳細」は再利用コンポーネント ViewerDetailPanel へ切り出した（一覧と、コメビュ本体の
 * 流れるコメントをクリックして開くサイドパネルの両方から使う）。このビューは一覧＋複数選択のまとめて削除だけを持つ。
 *
 * セキュリティ（docs/security.md §9・⑪）: 視聴者本文・メモ・投げ銭履歴を端末外へ出さず、ログにも出さない。
 * command 失敗時は固定の安全文言だけを画面に出し（本文・エラー詳細は出さない）、console にも流さない。
 * ⚠ **例外は取り込み経路 1 本だけ**（065b）——Rust が返す**コンパイル時定数の**原因文言を素通しで出す。
 *   `details`（ファイル名）は出さない・console にも流さない、は変わらない。理由は下の `runImport` の注記。
 * 破壊的操作（まとめて削除）は必ず ConfirmDialog を経由する（全消去 clear_viewers は UI に出さない）。
 *
 * 065b: 視聴者データ（CSV）のインポート導線をここに 1 か所だけ置く（SettingsView には出さない）。
 * 取り込みは `plugin-dialog` の `open()` が返した生パスを Rust へ渡すだけで、**frontend はファイルを読めない**
 * （`fs:*` はゼロ付与＝取り込み前のプレビューは実装できない・060b と同じ制約）。
 * ⚠ 段を割って実装した——(0)「dialog → invoke だけ」で実 CSV を 1 回通し（実測 61 名・skipped は 0/0）、
 * その後に ConfirmDialog・結果表示・一覧への新項目を足している（task-board 申し送り 9）。
 */

/** 配信元バッジの色分けクラス（CommentList の SOURCE_CLASS と同じ役割トークン・styles 依存のため UI 側に残す）。 */
const PROVIDER_CLASS: Record<string, string> = {
  twitch: styles.srcTwitch,
  youtube: styles.srcYoutube,
};

const providerClass = (p: string): string => PROVIDER_CLASS[p] ?? "";

/** 並び替えの日本語ラベル（ViewerSort の 3 値・Select の options と型で結びつくため UI 側に残す）。 */
const SORT_LABEL: Record<ViewerSort, string> = {
  lastComment: "最終コメント順",
  totalComments: "総コメント数順",
  name: "名前順",
};

interface ViewersViewProps {
  onBack: () => void;
}

export function ViewersView({ onBack }: ViewersViewProps) {
  // 一覧
  const [viewers, setViewers] = useState<ViewerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<ViewerSort>("lastComment");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 詳細（selectedId が非 null のとき ViewerDetailPanel を表示。トップレベル view は増やさずこの窓内で一覧⇄詳細を切替）
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // まとめて削除の確認（対象 id 群）。個別削除は詳細（ViewerDetailPanel）側が持つ。
  const [pending, setPending] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 065b (0): 視聴者データ CSV の取り込み。
  // ⚠ **エラーの器を listError と分けている。** loadList は先頭で setListError(null) を呼ぶので、
  //   取り込みの失敗を listError に載せると **検索・並び替え・「更新」・取り込み後の再取得で黙って消える**
  //   （実害。逆に一覧の失敗を取り込み結果で上書きする経路もできる）。CSS は既存の .errorText を再利用する。
  // ⚠ 器が 2 つになる副作用＝**赤が 2 本並ぶ経路は実在する**（レビュー Q-10 で訂正）。
  //   例: まとめて削除が失敗して listError が立った状態で取り込みも失敗する（取り込みの失敗時は
  //   loadList を呼ばないので listError が消えない）。⇒ **受容する**——どちらも「別々に起きた別々の失敗」で、
  //   片方を消すほうが誤情報になる。再修正トリガー＝画面が赤で埋まるという苦情が出たら、器ではなく
  //   「新しい失敗が来たら古い失敗を畳む」表示側の規則で解くこと（器を 1 つに戻すと上の実害が復活する）。
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState(false);
  const [importResult, setImportResult] = useState<ViewerImportResult | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);

  // 検索入力の debounce（サーバ側 list_viewers に渡す前に間引く）。
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const rows = await listViewers({
        search: debouncedSearch || undefined,
        sort,
      });
      setViewers(rows);
      // 取得後、消えた行の選択を掃除する（削除やフィルタで存在しなくなった id を選択から外す）。
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const v of rows) if (prev.has(v.id)) next.add(v.id);
        return next;
      });
    } catch {
      setListError("視聴者一覧の取得に失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, sort]);

  // 一覧はマウント時と検索/並び変更時に取得。詳細を開いている間は再取得しない（戻ったときに loadList を呼ぶ）。
  useEffect(() => {
    if (selectedId === null) void loadList();
  }, [loadList, selectedId]);

  const openDetail = (id: string) => setSelectedId(id);
  const backToList = () => setSelectedId(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = viewers.length > 0 && selectedIds.size === viewers.length;
  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === viewers.length ? new Set() : new Set(viewers.map((v) => v.id)),
    );
  };

  // 確認ダイアログで「削除」を押したときの実処理。038a に一括削除コマンドは無いため deleteViewer を選択分ループ呼び
  // （Promise.allSettled）し、失敗があれば件数だけを画面に出す（本文・エラー詳細は出さない・§9）。
  // 【許容判断（レビュー #3）】選択件数は「表示中の視聴者数」が上限で、宛先増もなく端末内 invoke のみ＝実害小のため
  // 一括化しない。再修正トリガー: 038a が一括削除コマンド（例 delete_viewers(ids)）を提供したら、それに置き換えて
  // invoke を 1 回に集約する。
  const runDelete = async () => {
    if (pending === null) return;
    setDeleting(true);
    const results = await Promise.allSettled(pending.map((id) => deleteViewer(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setDeleting(false);
    setPending(null);
    await loadList();
    if (failed > 0) {
      setListError(`${failed} 件の削除に失敗しました。`);
    }
  };

  // 065b: 他のコメントビューアーが書き出した CSV を選んで取り込む。060b（OverlayThemeCard の startImport）と同型で、
  // open() が返した**生パス**をそのまま Rust へ渡す（検証は Rust 側で必ず再実行される）。
  // ⚠ **必ず ConfirmDialog（pendingImport）を経てから呼ぶこと**（既存の DB を書き換える操作なので、
  //   この窓の作法に合わせる）。⚠ ただし `danger` は付けない——非破壊マージで既存の名前・メモは守られるため、
  //   赤ボタンにすると「消える」と誤読させる（065a・(6) のマージ規則）。
  //
  // ⚠⚠ **AppError.message をそのまま画面へ出している。** 既存 ViewersView の作法は `catch {}`（エラー値を
  //   束縛しない）＋固定の安全文言だが、取り込みは「アプリが壊れた」と「選んだファイルが違う」が混ざる唯一の
  //   経路で、後者は Rust が**原因の分かる固定文言**を返す（「この CSV には必要な列がありません。…」
  //   「CSV ファイルが大きすぎます。8MB 以内にしてください。」等）。全部を「失敗しました」に潰すと
  //   **ユーザーが取れる行動が消える**（065b の完了条件）。
  // ⚠ **既存の共有ヘルパ `toErrorMessage` を再利用する**（新しい整形ヘルパを作らない）。理由は 3 つ:
  //   ①同じ窓・同じファイル取り込み導線（OverlayThemeCard の startImport / runRename / runDelete）が既に
  //     これを使っている＝新しい作法ではなく既存作法の 2 本目 ②**details を一切読まない**ので
  //     `util::with_filename_detail` が入れる**ファイル名**が構造的に画面へ出ない（§9）
  //     ③AppError でない例外（open() の失敗等）は「予期しないエラーが発生しました」へ落ちる。
  // ⚠ もう 1 つの既存作法（`useAppUpdate` の「モジュール定数だけを出す」）を採らなかったのは、
  //   取り込み経路の原因文言 11 本（`CSV_IMPORT_SPEC` の 8 ＋ `csv_import.rs` の 3）を frontend にも持つ
  //   ことになり、**Rust と frontend で文言が二重管理**になるため（065a 外部レビュー Q-1 は、文言が片方だけ
  //   退行してもエラーコードが同じなので**既存テストが全部緑のまま**通り抜けた実例）。
  // ⚠⚠ **再修正トリガー**: Rust 側が AppError の message に**ユーザー値や第三者データを補間し始めたら**、
  //   この素通しをやめて `useAppUpdate` 方式（このモジュールが持つ定数だけを出す）へ切り替えること。
  //   065a 時点の message は `CSV_IMPORT_SPEC` / `csv_import.rs` の**コンパイル時定数のみ**である。
  // ⚠ console には 1 行も流さない（§9・既存の作法どおり）。
  // ⚠⚠ **この関数の「順序」は runDelete と揃えてある**（レビュー Q-2 / Q-3 で修正）。
  //   ①`setImporting(true)` は **`open()` より前**に置く——後ろに置くと、ネイティブのファイル選択が
  //     開いている間だけツールバーのボタンが有効なままになり、**2 回目の確認 → 2 回目の open()** が通る。
  //   ②`setPendingImport(false)`（＝確認ダイアログを閉じる）は **`finally`** に置く。先頭で閉じると
  //     `busy={importing}` が **一度も true で描画されない死んだ prop** になる（`importing` が立つ頃には
  //     ダイアログはアンマウント済み）。閉じるのを最後に回すことで、モーダルのまま「処理中…」を出せて
  //     多重実行が**ボタンの disabled ではなくモーダルそのもの**で塞がる（runDelete と同じ作法）。
  //   ⚠ 順序を戻すときは `ViewersView.test.tsx` の「取り込み中は確認ダイアログが処理中のまま残る」を見ること。
  const runImport = async () => {
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        title: "視聴者データの CSV を選択",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      // キャンセル（null）や複数選択（配列）では command を呼ばない。
      if (typeof picked !== "string") return;
      // ⚠ **open() が返した生パスを画面に出さない**（フルパスもファイル名も・§9）。invoke へ渡すだけ。
      setImportResult(await importViewerMemoryCsv(picked));
      // ⚠ 取り込みで `viewers` が増減するので一覧を取り直す（**成功したときだけ**）。失敗時は Rust 側が
      //   1 トランザクションでロールバックしていて一覧は変わらないので、取り直す理由が無い。
      await loadList();
    } catch (e) {
      setImportError(toErrorMessage(e));
    } finally {
      setImporting(false);
      setPendingImport(false);
    }
  };

  // ---- 詳細ビュー（再利用コンポーネント）----
  if (selectedId !== null) {
    return (
      <ViewerDetailPanel
        id={selectedId}
        onDismiss={backToList}
        dismissKind="back"
        onDeleted={() => setSelectedId(null)}
      />
    );
  }

  // ---- 一覧ビュー ----
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
        <h1 className={styles.settingsTitle}>視聴者</h1>
      </div>

      <div className={styles.viewersToolbar}>
        <input
          type="search"
          className={styles.searchInput}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前で検索"
          aria-label="視聴者を名前で検索"
        />
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as ViewerSort)}
          ariaLabel="並び替え"
        >
          {(Object.keys(SORT_LABEL) as ViewerSort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className={btnStyles.btnGhost}
          onClick={() => void loadList()}
          disabled={loading}
        >
          {loading ? "更新中…" : "更新"}
        </button>
        {/* 065b: 取り込み導線。⚠ **取り込み中は無効**（多重実行を防ぐ。押している間 Rust 側は
            upsert ＋ 再計算を 1 トランザクションで回し、その間 DB ロックを保持する＝コメント記録・
            プリセット起動・ログがまとめて止まる。065a で受容した設計）。 */}
        <button
          type="button"
          className={btnStyles.btn}
          onClick={() => setPendingImport(true)}
          disabled={importing}
        >
          {importing ? "インポート中…" : "視聴者データをインポート"}
        </button>
        {/* ⚠⚠ **4 件数を常に全部出す**（0 でも出す）。条件表示にすると「出ていない＝0」と
            「出し忘れ＝バグ」が画面上で同じに見えるが、常時 4 つなら**黙って落とした疑いが構造的に消える**。
            ⚠ `.status`（無彩色）で出す——`skippedUnsupported` は**正常系でも 0 にならないことがある**
            （取り込み元には StreamDock 非対応サービスの視聴者が居ることがある）ので、エラー色にしない。
            ⚠ **なぜ落ちたかは書かない**（戻り値に含まれない＝§9・件数のみ。推測して書かないこと）。
            ⚠ `.viewersToolbar` は flex-wrap: wrap なので長ければ次行へ折り返す＝**新規 CSS 不要**。 */}
        {importResult && (
          <span className={styles.status}>
            新しく取り込んだ {fmtNumber(importResult.imported)} 件 / 更新した{" "}
            {fmtNumber(importResult.updated)} 件 / 取り込めなかった（未対応サービス）
            {fmtNumber(importResult.skippedUnsupported)} 件 /
            取り込めなかった（内容不備）
            {fmtNumber(importResult.skippedInvalid)} 件
          </span>
        )}
      </div>

      {importError && <p className={styles.errorText}>{importError}</p>}

      {selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.status}>
            {fmtNumber(selectedIds.size)} 件を選択中
          </span>
          <button
            type="button"
            className={btnStyles.dangerBtn}
            onClick={() => setPending([...selectedIds])}
          >
            選択した {fmtNumber(selectedIds.size)} 件を削除
          </button>
        </div>
      )}

      {listError && <p className={styles.errorText}>{listError}</p>}

      <div className={styles.viewerTable}>
        <div className={styles.viewerHead}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            aria-label="すべて選択"
            disabled={viewers.length === 0}
          />
          <span>名前</span>
          <span className={styles.vSite}>サイト</span>
          <span className={styles.vNum}>総数</span>
          <span className={styles.vNum}>bits</span>
          <span className={styles.vNum}>スパチャ</span>
          <span>最終コメント</span>
        </div>

        {viewers.length === 0 ? (
          <p className={styles.empty}>
            {loading ? "読み込み中…" : "視聴者はまだいません"}
          </p>
        ) : (
          viewers.map((v) => (
            <div
              key={v.id}
              className={styles.viewerRow}
              role="button"
              tabIndex={0}
              onClick={() => openDetail(v.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openDetail(v.id);
                }
              }}
            >
              {/* a11y（レビュー #2）: 行を role="button" にして行クリック/Enter/Space で詳細へ、内部に複数選択用の
                  checkbox をネストしている。button ロールに interactive 子孫を入れるのは ARIA 上は非推奨だが、
                  マウス（下の stopPropagation）・キーボード（行 tabIndex＋native checkbox）双方で操作でき lint も通るため、
                  「行全体クリックで開く」UX を優先して現状維持する。再修正トリガー: スクリーンリーダー対応が要件化したら、
                  実 <table>（<tr>/<td>）化するか、行の role="button" を外して名前セルだけを <button>/リンクにする。 */}
              {/* チェックボックスのクリックは行クリック（詳細を開く）へ伝播させない。 */}
              <input
                type="checkbox"
                checked={selectedIds.has(v.id)}
                onChange={() => toggleSelect(v.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`${v.name} を選択`}
              />
              {/* 065b: 取り込んだ nickname / label は**名前セルの中**に置く（列を足さない）。
                  ⚠⚠ `.viewerHead` と `.viewerRow` は**別グリッド**で、列を足すと 7 列すべてを引き直すことに
                  なり、ヘッダ↔行のズレが再発する（CSS 側の注記が正）。さらに 062c の `.contribRow` が
                  `.viewerRow` に相乗りして列構成だけ上書きしているので、列数を動かすとそちらの前提も動く。
                  ⇒ **列数不変＝ズレが構造的に起きない**形にしてある。
                  ⚠ nickname は `name` を置き換えない（どちらの呼び方でも探せるように）。
                  ⚠ label は 062a の無彩色バッジ（`.badgeRaid`）を使う——課金のティア配色や初見/久しぶりの
                  判定バッジと**色で競合させない**ため（「色が付いている＝お金かユーザー判定」という
                  既存の読み方を壊さない）。⚠ どちらも空文字なら出さない。
                  ⚠⚠ **3 つは `.vNameCell`（flex の器）の中に並べ、`.vName` は名前そのものに残す**
                  （レビュー Q-4 で修正）。初版は 3 つとも `.vName`（ellipsis を持つブロック）の中の
                  **インライン要素**として置いていたため、**名前が長いとニックネームもラベルも
                  省略記号に飲まれて消えていた**。器に分けたことで、縮む役は ellipsis を持つ
                  `.vName` / `.vMuted` だけが引き受け、**バッジは `flex: none` で必ず残る**。
                  ⚠ `.vName` を flex 化しなかった理由（SummaryView と共有＝あちらの省略が壊れる）は
                  CSS 側の注記が正。⇒ **SummaryView は無改変。**
                  ⚠ 描画順・クラスの割り当て・器の構造は `ViewersView.test.tsx` と
                  `check-css-guards.mjs` の (1-c) が固定している（入れ替えるとレッド）。 */}
              <span className={styles.vNameCell}>
                <span className={styles.vName}>{v.name}</span>
                {v.nickname && (
                  <span className={styles.vMuted}>（{v.nickname}）</span>
                )}
                {v.label && (
                  <span className={`${styles.badge} ${styles.badgeRaid}`}>
                    {v.label}
                  </span>
                )}
              </span>
              <span className={styles.vSite}>
                <span className={`${styles.badge} ${providerClass(v.provider)}`}>
                  {providerLabel(v.provider)}
                </span>
              </span>
              <span className={styles.vNum}>{fmtNumber(v.totalComments)}</span>
              <span className={styles.vNum}>
                {v.bitsCount > 0 ? fmtNumber(v.bitsAmount) : "-"}
              </span>
              <span className={styles.vNum}>
                {v.superchatCount > 0
                  ? fmtSuperchat(v.superchatAmount, v.superchatCurrency)
                  : "-"}
              </span>
              <span className={styles.vMuted}>{fmtDateTime(v.lastCommentAt)}</span>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="視聴者の情報を削除"
        message={
          pending
            ? `選択した ${fmtNumber(pending.length)} 件の視聴者の情報を削除します。保存済みコメントも消え、取り消せません。`
            : ""
        }
        confirmLabel="削除"
        danger
        busy={deleting}
        onConfirm={() => void runDelete()}
        onCancel={() => setPending(null)}
      />

      {/* 065b: 引き継ぎの確認。⚠ **`danger` を付けない**——既存の名前・メモは非破壊マージで守られるので、
          赤ボタンにすると「消える」と誤読させる。⚠ 文言は**何が起きるか**を書く（「消えます」ではない）。
          ⚠ 「配信前に」＝取り込み中は DB ロックでコメント記録・プリセット起動・ログが止まる。
          ⚠ 「直前に書き出した CSV」＝1 ヶ月以上前の CSV は `lcts` が古く、次のコメントで「久しぶり」バッジが
          誤爆する（申し送り 6・**受容した挙動**）。⚠ **理由までは書かない**——この窓は説明文を全廃した（062c）。 */}
      <ConfirmDialog
        open={pendingImport}
        title="視聴者データをインポート"
        message="別のコメントビューアーからダウンロードした CSV を選んで、視聴者データを取り込みます（今の名前・メモは残ります）。取り込み中はアプリが数秒止まるので、配信前に、ダウンロードした直後の CSV で行ってください。"
        confirmLabel="インポート"
        busy={importing}
        onConfirm={() => void runImport()}
        onCancel={() => setPendingImport(false)}
      />
    </div>
  );
}
