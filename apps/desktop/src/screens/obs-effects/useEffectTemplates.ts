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
  loadEffectOverlayEnabled,
  saveEffectOverlayEnabled,
} from "../../features/comment-viewer/overlaySettings";
import {
  clearAllEffectAssignments,
  clearEffectAssignmentsForTemplate,
  hasEffectConditions,
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
 *
 * ## ⚠⚠ 061i: **`EFFECT_OVERLAY_ENABLED_KEY` の唯一の書き手**になった（判断 2）
 *
 * 「エフェクトを配信画面に表示する」トグルを廃止し、あのフラグを
 * **「表示する条件が 1 件以上あるか」の派生値**にした。＝ 割り当てを保存する**すべての経路**が
 * [`commitAssignments`] を通り、そこだけが `saveEffectOverlayEnabled` を呼ぶ。
 * ⚠⚠ **経路は 3 本ある**（[`setAssignment`] / [`clearAllAssignments`] /
 * **テンプレート削除に伴う [`runDelete`]**）。⚠ **3 本目を忘れやすい**——忘れると
 * 「最後のテンプレートを消したのにフラグが true のまま」＝ 条件が 0 件なのに OBS へ映り続ける。
 * ⚠ **フラグを触ってよいのはここだけ**（画面の「ウィンドウを閉じる」ボタンは窓を閉じるだけで
 * この値を触らない＝**設定と窓を混ぜない**）。
 *
 * ⚠ **061i レビュー S-3 で、このファイル内の `saveEffectOverlayEnabled` は 2 か所になった**——
 * [`commitAssignments`]（割り当ての保存経路）と、**マウント時の再計算**（アップグレードで
 * 持ち越した値を実態へ合わせ直す。下の `useEffect`）。⚠ **どちらも「割り当てが正」**という
 * 同じ規則で書いており、**hook の外から書かない**という不変条件は変わっていない。
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

/**
 * 061i: この hook に注入する「窓を開く」操作（判断 1・2）。
 *
 * ⚠⚠ **hook は「いつ開くか」だけを決め、`invoke` は自分でしない。** 実際に
 * `open_effect_overlay_window` を投げるのは `ObsEffectsScreen` で、あちらは
 * **`effectOverlayOpRef` で開閉を直列化している**（046b レビューの連打レース対策）。
 * ここから直接 invoke すると、その直列化と**別のキュー**になり、
 * 「『ウィンドウを閉じる』を押した直後に条件を足す」等で
 * **close と open の順序が入れ替わりうる**（＝自動 close 経路が無いので、
 * 「閉じたはずなのに OBS へ映り続ける」がセッション中解消しない）。
 * ⚠ **省略可にしない**——既定値を持たせると、渡し忘れたときに
 * 「条件を設定したのに窓が開かない＝黙って何も起きない」へ倒れる（061a 以来の規律。
 * `EffectTemplateCard` の `effectWindowOpen` を必須にしたのと同じ理由）。
 */
export interface UseEffectTemplatesOptions {
  /** ⚠ 呼ばれるのは**条件が 0 件 → 1 件以上になった瞬間だけ**（毎回の保存では呼ばない）。 */
  openEffectOverlay: () => void;
}

export function useEffectTemplates({
  openEffectOverlay,
}: UseEffectTemplatesOptions): UseEffectTemplates {
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

  /**
   * ⚠⚠ **061i（判断 2）: 割り当てを書き換える経路は全部ここを通る。**
   *
   * やることは 3 つで、**この順に固定**してある:
   *   1. **保存の「前」の状態を localStorage から読む**（state からではない。state は写しで、
   *      同じレンダー中に複数回書き換わりうるため。`setAssignment` が基点を localStorage に
   *      置いているのと同じ理由）
   *   2. 実際の書き換え（`mutate`）を走らせ、**保存関数が返す正規化済みの表**を state に置く
   *   3. **派生値 `EFFECT_OVERLAY_ENABLED_KEY` を立て直す**（＝リポジトリ全体で
   *      `saveEffectOverlayEnabled` を呼ぶ唯一の場所）
   *
   * そのうえで **0 件 → 1 件以上のときだけ窓を開く**。
   * ⚠ **「1 件以上のまま別の条件を変えた」ときに open を投げない**——投げても Rust 側は
   * 既存窓を再利用するだけ（＝実害は無い）だが、**割り当てを触るたびに無駄な invoke が飛ぶ**のは
   * 「発火の瞬間に IPC を呼ばない」という 061c 申し送り 6 と同じ向きの規律に反する。
   * ⚠⚠ **逆向き（条件が 0 件になったら閉じる）は作らない**（判断 1）。窓が消えると
   * **OBS のウィンドウキャプチャが真っ黒**になり、配信者は原因に気づけない。
   * OBS 側の表示が止まるのは、派生値が false になって `CommentViewerApp` が
   * `hideObs("effects")` を送るからで、**窓自体は開いたまま**である。
   */
  const commitAssignments = useCallback(
    (mutate: () => EffectAssignments) => {
      const hadConditions = hasEffectConditions(loadEffectAssignments());
      const next = mutate();
      const hasConditions = hasEffectConditions(next);
      setAssignments(next);
      saveEffectOverlayEnabled(hasConditions);
      if (hasConditions && !hadConditions) openEffectOverlay();
    },
    [openEffectOverlay],
  );

  /**
   * ⚠⚠ **061i レビュー S-3（移行）: マウント時に派生値を実態へ合わせ直す。**
   *
   * `commitAssignments` は「割り当てを触ったとき」しか走らないので、**061h からの
   * アップグレードで持ち越した `EFFECT_OVERLAY_ENABLED_KEY` が実態とずれたまま**になっていた。
   * ずれは 2 方向とも壊れ方がはっきりしている:
   *   - **条件あり ＋ フラグ false**（＝061h で条件だけ設定し、表示トグルは OFF のままだった人
   *     ＝**061i が救おうとしている当のユーザー**）… 起動時復元が走らず窓が開かない。しかも
   *     条件を編集しても `hadConditions` が既に true なので open は投げられず、
   *     **フラグだけ true になって OBS ソースが有効化される**（窓が無いのでキャプチャは真っ黒）
   *   - **条件なし ＋ フラグ true**（＝061h で表示トグルを ON にしていた人）… 毎起動で空の窓が開き、
   *     「ウィンドウを閉じる」はフラグを触らないので**次回起動でまた開く**＝止める手段が実質無い
   *
   * ⚠ **書き手を 1 か所に閉じる規律を壊さないよう、ここ（hook の中）に置く**
   * （`saveEffectOverlayEnabled` の呼び出しは本ファイルの 2 か所だけで、どちらも割り当てが正）。
   * ⚠⚠ **窓は開かない。** 開くと「閉じたのに画面を開き直すたび復活する」＝判断 1 の脱出路を潰す。
   * 条件があるのに窓が無い状態からの復帰は、**起動時復元**と `ObsEffectsScreen` の
   * **「ウィンドウを開く」ボタン**（同レビュー Q-2）が担う。
   * ⚠ **値が既に一致していれば書かない**——無駄な `storage` イベント（＝コメビュ窓の
   * `enableObs` / `hideObs`）を撒かないため。未保存（キー無し）は `false` として比較される。
   */
  useEffect(() => {
    const shouldBeEnabled = hasEffectConditions(loadEffectAssignments());
    if (loadEffectOverlayEnabled() === shouldBeEnabled) return;
    saveEffectOverlayEnabled(shouldBeEnabled);
  }, []);

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
        // ⚠⚠ **061h: 削除したテンプレートを指す割り当てを「表示しない」へ戻す。**
        //   ⚠ 061d-2 は「組み込み」へ戻していた（削除の副作用でエフェクトが黙って止まるのを避けるため）が、
        //   組み込みを廃止したので戻し先が 1 つしか無い。呼ぶ関数は同じ
        //   （`clearEffectAssignmentsForTemplate` が `DEFAULT_EFFECT_ASSIGNMENT` を見ている）。
        //   ⚠ **削除が成功した後にだけ書き換える**（失敗したら割り当ては触らない）。
        // ⚠⚠ **061i: この経路も `commitAssignments` を通す**（判断 2）。ここを直接
        //   `setAssignments(...)` に戻すと、**最後のテンプレートを消して条件が 0 件になっても
        //   `EFFECT_OVERLAY_ENABLED_KEY` が true のまま**残り、OBS へ映り続ける
        //   （＝派生値の書き手が 1 か所に閉じていない状態。**最も忘れやすい 3 本目**）。
        commitAssignments(() => clearEffectAssignmentsForTemplate(template.id));
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
    [reload, commitAssignments],
  );

  const setAssignment = useCallback(
    (eventType: string, assignment: EffectAssignment) => {
      // ⚠⚠ **061d-2 レビュー Q-9: 保存を `setAssignments` の更新関数の中でやらない。**
      //   更新関数は StrictMode で二重に呼ばれる（＝純粋であることが前提の場所）ので、
      //   副作用を置くと「冪等だからたまたま無害」に依存した形になる。
      // ⚠ 基点は state ではなく **localStorage（＝正）**——state はその写しなので結果は同じで、
      //   かつ「保存 → 読み直し」が 1 本道になる（`clearEffectAssignmentsForTemplate` と同じ形）。
      commitAssignments(() => {
        saveEffectAssignments({
          ...loadEffectAssignments(),
          [eventType]: assignment,
        });
        // ⚠ 保存関数が正規化（未知キーを落とす・既定だけならキー削除）するので、
        //   読み直した値を state に置く（画面と localStorage を必ず一致させる）。
        return loadEffectAssignments();
      });
    },
    [commitAssignments],
  );

  /**
   * ⚠⚠ **復帰導線**。壊れたテンプレートで配信画面が読めなくなったときの唯一の脱出路
   * （060d の「既定のデザインに戻す」と同じ位置づけ）。**テストで固定する。**
   */
  const clearAllAssignments = useCallback(() => {
    // ⚠ 061i: 条件が 0 件になるので派生値も false へ倒れる（＝OBS 側のソースが非表示になる）。
    //   ⚠ **窓は閉じない**（判断 1）。
    commitAssignments(() => clearAllEffectAssignments());
  }, [commitAssignments]);

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
