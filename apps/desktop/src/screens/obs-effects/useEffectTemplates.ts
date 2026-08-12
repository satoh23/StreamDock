import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  deleteEffectTemplate,
  importEffectTemplate,
  listEffectTemplates,
  type EffectTemplateRecord,
} from "../../features/obs-effects/effectTemplateApi";
import { toErrorMessage } from "../../features/tools/useTools";
import {
  clearAllEffectAssignments,
  clearEffectAssignmentsForTemplate,
  loadEffectAssignments,
  saveEffectAssignments,
  type EffectAssignment,
  type EffectAssignments,
} from "./effectAssignments";

/**
 * 061d-2: main 窓の「OBSエフェクト」画面が持つ、**テンプレート一覧と割り当ての state**。
 *
 * ⚠⚠ **061d-1 が予告した分割（Q-9）そのもの。** あちらは
 * 「061d-2 で『削除時に割り当てを解除』『割り当て中なら確認文を変える』が入ると削除フローと
 * 割り当て state が絡み、いま引いた境界がそのまま無効になる」ので **061d-1 では切らない**と決め、
 * **再修正トリガー＝061d-2 の割り当て結線を入れるとき**と書いていた。
 *
 * ⚠⚠ **一覧と割り当てを 1 つの hook が持つ理由**: 削除は「テンプレート一覧」と「割り当て」の
 * **両方**を書き換える。2 つのカード（`EffectTemplateCard` / `EffectAssignmentCard`）が
 * それぞれ state を持つと、削除後に片方だけ古くなる（＝割り当て表に消えたテンプレートが
 * 選ばれたまま残る）。**`ObsEffectsScreen` が 1 回だけ呼び、2 つのカードへ配る。**
 *
 * ⚠ **この hook は描画も IPC の生値も持たない**——`invoke` はすべて `effectTemplateApi.ts` 経由で、
 * メディア（data URI）はここでは 1 バイトも扱わない（プレビューは `EffectTemplatePreview` の役目）。
 * ⚠ **テンプレート名・パス・エラーの詳細を `console.*` へ出さない**（§9・`no-console`）。
 */
export interface UseEffectTemplates {
  templates: EffectTemplateRecord[];
  listState: "loading" | "ready" | "failed";
  busy: boolean;
  error: string | null;
  /** 取り込み直後にプレビューを開くための record（⚠ **一覧の成否に依存しない**・061d-1 レビュー S-2(a)）。 */
  imported: EffectTemplateRecord | null;
  /**
   * 直近に削除できたテンプレートの id（プレビューを閉じる合図・Q-4）。
   * ⚠ **「一覧に無くなった」ではなく「削除された」を伝える**——取り込み直後は新しい record が
   * まだ一覧に載っていないので、前者だと **061c S-3 の緩和策（取り込み直後のプレビュー）を
   * 開いた瞬間に閉じてしまう**。
   */
  lastDeletedId: string | null;
  assignments: EffectAssignments;
  startImport: () => Promise<void>;
  pendingDelete: EffectTemplateRecord | null;
  requestDelete: (template: EffectTemplateRecord) => void;
  cancelDelete: () => void;
  runDelete: (template: EffectTemplateRecord) => Promise<void>;
  setAssignment: (eventType: string, assignment: EffectAssignment) => void;
  clearAllAssignments: () => void;
  /** 指定テンプレートを割り当てているイベント種別（削除確認文に出す）。 */
  eventTypesUsing: (templateId: string) => string[];
}

export function useEffectTemplates(): UseEffectTemplates {
  const [templates, setTemplates] = useState<EffectTemplateRecord[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<EffectTemplateRecord | null>(null);
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<EffectTemplateRecord | null>(null);
  /**
   * ⚠ **割り当ては localStorage が正**。ここは表示用のミラーで、書き込みのたびに保存関数の
   * 戻り値（＝保存後の正規化済みの表）で置き換える（「保存したつもりの値」と state がずれない）。
   */
  const [assignments, setAssignments] = useState<EffectAssignments>(() =>
    loadEffectAssignments(),
  );

  const reload = useCallback(async () => {
    try {
      setTemplates(await listEffectTemplates());
      setListState("ready");
    } catch {
      // ⚠ 一覧が読めないこと自体は伝えるが、詳細は出さない（§9）。
      setListState("failed");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startImport = useCallback(async () => {
    setError(null);
    // ⚠ 061d-1 レビュー Q-8: `busy` は **`open()` の前**に立てる。後に立てると
    //   ネイティブダイアログが開いている間だけボタンが押せる状態が残る（モーダル性に依存しない）。
    setBusy(true);
    try {
      let picked: string | string[] | null;
      try {
        picked = await open({
          multiple: false,
          directory: true,
          title: "エフェクトのテンプレートのフォルダを選択",
        });
      } catch {
        // ⚠ 061d-1 レビュー P-1: ここだけは **`tauri-plugin-dialog` のエラー文言**で、こちらの管理下に無い
        //   （`import_effect_template` 以降は Rust の `AppError`＝すべて固定安全文言）。§9 のため固定文言にする。
        setError("フォルダ選択ダイアログを開けませんでした。");
        return;
      }
      if (typeof picked !== "string") return;
      // ⚠ 生パスをそのまま渡す。**検証は Rust 側**（§8）で、ここでの整形は 1 文字も行わない。
      const record = await importEffectTemplate(picked);
      // ⚠⚠ **取り込み直後は必ずプレビューを開く**（061c security-review S-3 の緩和策）。
      //   「選んだフォルダに元から在った画像」が取り込まれてしまった場合、ここでしか気付けない。
      //   ⚠⚠ **一覧の成否に巻き込まれないことを担保しているのは、`record` を直接持つこと**
      //   （＝`templates.find` を使わないこと）である（061d-1 レビュー S-2(a)）。
      setImported(record);
      await reload();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const requestDelete = useCallback((template: EffectTemplateRecord) => {
    setPendingDelete(template);
  }, []);

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  const runDelete = useCallback(
    async (template: EffectTemplateRecord) => {
      setBusy(true);
      setError(null);
      try {
        await deleteEffectTemplate(template.id);
        // ⚠⚠ **061d-2: 削除したテンプレートを指す割り当てを「組み込み」へ戻す**（⑪）。
        //   ⚠ **「なし」へ倒さない**——削除の副作用で配信画面のエフェクトが黙って止まるのを避ける。
        //   ⚠ **削除が成功した後にだけ書き換える**（失敗したら割り当ては触らない）。
        setAssignments(clearEffectAssignmentsForTemplate(template.id));
        // 消したものをプレビューしたままにしない（取り直しに失敗して "failed" が出るだけになる）。
        setImported((prev) => (prev?.id === template.id ? null : prev));
        setLastDeletedId(template.id);
        setPendingDelete(null);
        await reload();
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const setAssignment = useCallback(
    (eventType: string, assignment: EffectAssignment) => {
      // ⚠⚠ **061d-2 レビュー Q-9: 保存を `setAssignments` の更新関数の中でやらない。**
      //   更新関数は StrictMode で二重に呼ばれる（＝純粋であることが前提の場所）ので、
      //   副作用を置くと「冪等だからたまたま無害」に依存した形になる。
      // ⚠ 基点は state ではなく **localStorage（＝正）**——state はその写しなので結果は同じで、
      //   かつ「保存 → 読み直し」が 1 本道になる（`clearEffectAssignmentsForTemplate` と同じ形）。
      saveEffectAssignments({ ...loadEffectAssignments(), [eventType]: assignment });
      // ⚠ 保存関数が正規化（未知キーを落とす・既定だけならキー削除）するので、
      //   読み直した値を state に置く（画面と localStorage を必ず一致させる）。
      setAssignments(loadEffectAssignments());
    },
    [],
  );

  /**
   * ⚠⚠ **復帰導線**。壊れたテンプレートで配信画面が読めなくなったときの唯一の脱出路
   * （060d の「既定のデザインに戻す」と同じ位置づけ）。**テストで固定する。**
   */
  const clearAllAssignments = useCallback(() => {
    setAssignments(clearAllEffectAssignments());
  }, []);

  const eventTypesUsing = useCallback(
    (templateId: string): string[] =>
      Object.keys(assignments).filter((eventType) => {
        const value = assignments[eventType];
        return value !== undefined && value.kind === "template" && value.templateId === templateId;
      }),
    [assignments],
  );

  return {
    templates,
    listState,
    busy,
    error,
    imported,
    lastDeletedId,
    assignments,
    startImport,
    pendingDelete,
    requestDelete,
    cancelDelete,
    runDelete,
    setAssignment,
    clearAllAssignments,
    eventTypesUsing,
  };
}
