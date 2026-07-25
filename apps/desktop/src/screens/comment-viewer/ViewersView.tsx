import { useCallback, useEffect, useState } from "react";
import {
  listViewers,
  deleteViewer,
} from "../../features/viewer-memory/viewerMemoryApi";
import type { ViewerRecord, ViewerSort } from "../../features/viewer-memory/types";
import { Select } from "./Select";
import { ConfirmDialog } from "./ConfirmDialog";
import { ViewerDetailPanel } from "./ViewerDetailPanel";
import {
  providerLabel,
  fmtDateTime,
  fmtNumber,
  fmtSuperchat,
} from "./viewerFormat";
import styles from "./CommentViewerApp.module.css";

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
 * 破壊的操作（まとめて削除）は必ず ConfirmDialog を経由する（全消去 clear_viewers は UI に出さない）。
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
          className={styles.btnGhost}
          onClick={() => void loadList()}
          disabled={loading}
        >
          {loading ? "更新中…" : "更新"}
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.status}>
            {fmtNumber(selectedIds.size)} 件を選択中
          </span>
          <button
            type="button"
            className={styles.dangerBtn}
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
              <span className={styles.vName}>{v.name}</span>
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
    </div>
  );
}
