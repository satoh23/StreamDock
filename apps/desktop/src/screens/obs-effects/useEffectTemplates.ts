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
  loadStageOverlayEnabled,
  saveEffectOverlayEnabled,
  saveStageOverlayEnabled,
} from "../../features/comment-viewer/overlaySettings";
import {
  addKeywordCondition as addKeywordConditionToStore,
  clearAllEffectConditions,
  clearEffectConditionsForTemplate,
  EFFECT_OUTPUTS,
  hasEffectConditions,
  loadEffectConditions,
  removeCondition as removeConditionFromStore,
  setConditionEffect as setConditionEffectInStore,
  setConditionOutput as setConditionOutputInStore,
  updateKeywordCondition as updateKeywordConditionInStore,
  type EffectAssignment,
  type EffectConditions,
  type EffectKeywordMatch,
  type EffectOutput,
} from "./effectAssignments";
import { EFFECT_EVENT_LABEL } from "./effectEventRows";

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
 * **「表示する条件が 1 件以上あるか」の派生値**にした。＝ 条件を保存する**すべての経路**が
 * [`commitConditions`] を通り、そこだけが `saveEffectOverlayEnabled` を呼ぶ。
 * ⚠⚠ **061j で経路は 3 本 → 6 本になった**（[`setConditionEffect`] / [`addKeywordCondition`] /
 * [`updateKeywordCondition`] / [`removeCondition`] / [`clearAllAssignments`] /
 * **テンプレート削除に伴う [`runDelete`]**）。⚠ **`runDelete` を忘れやすい**——忘れると
 * 「最後のテンプレートを消したのにフラグが true のまま」＝ 条件が 0 件なのに OBS へ映り続ける。
 * ⚠ **フラグを触ってよいのはここだけ**（画面の「ウィンドウを閉じる」ボタンは窓を閉じるだけで
 * この値を触らない＝**設定と窓を混ぜない**）。
 * ⚠⚠ **保存形の組み立ては 1 つも持たない**——`effectAssignments.ts` の変更関数
 * （`setConditionEffect` / `addKeywordCondition` / …）が「読む → 変える → 保存 → 読み直す」を
 * 完結させ、この hook はそれを [`commitConditions`] で包むだけである
 * （＝ **id の採番も検証もここには無い**。2 か所に分けると片方だけ緩む）。
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
  /**
   * 061j: 「エフェクトを表示する条件」の配列（**イベント条件 6 件 ＋ キーワード条件**）。
   * ⚠ 061i までの `assignments: Record<eventType, …>` から改名した——**型が変わったのに
   * 名前が同じだと誤読を生む**ため（保存キーとファイル名だけは互換のため据え置き）。
   */
  conditions: EffectConditions;
  startImport: () => Promise<void>;
  pendingDelete: EffectTemplateRecord | null;
  requestDelete: (template: EffectTemplateRecord) => void;
  cancelDelete: () => void;
  runDelete: (template: EffectTemplateRecord) => Promise<void>;
  /** 条件 1 件の**エフェクト**を変える（イベント条件・キーワード条件の共通 API）。 */
  setConditionEffect: (id: string, effect: EffectAssignment) => void;
  /**
   * 061k: 条件 1 件の**出力先**（コーナー／全画面）を変える。
   * ⚠⚠ **061j 申し送りの「条件を書き換える経路は全部 `commitConditions` を通す」の 7 本目**。
   */
  setConditionOutput: (id: string, output: EffectOutput) => void;
  /** キーワード条件を 1 件足す。⚠ **空のキーワードでは呼ばないこと**（呼んでも保存層が落とす）。 */
  addKeywordCondition: (
    when: { text: string; match: EffectKeywordMatch },
    effect: EffectAssignment,
  ) => void;
  /** キーワード条件の**キーワードと当て方**を変える。 */
  updateKeywordCondition: (
    id: string,
    when: { text: string; match: EffectKeywordMatch },
  ) => void;
  /** 条件を 1 件消す。⚠ イベント条件の id を渡しても消えない（保存層が 6 行を作り直すため）。 */
  removeCondition: (id: string) => void;
  clearAllAssignments: () => void;
  /**
   * 061j（判断 13）: 指定テンプレートを使っている条件の**表示ラベル**（削除確認文に出す）。
   *
   * ⚠⚠ **061i までの `eventTypesUsing`（イベント種別の配列）から変えた。** キーワード条件が
   * そのテンプレートを指していると、**削除しても確認文に出ない**＝「消したら知らないうちに
   * 条件が『表示しない』へ戻っていた」が起きるため。
   * ⚠ **ラベル化の責務をここへ移した**——呼び出し側（`EffectTemplateCard`）がイベント種別を
   * ラベルへ直す形だと、キーワード条件を**ラベルにする方法が呼び出し側に無い**。
   * ⚠ キーワードは**ユーザー自身の入力**なので確認ダイアログに出してよい（§9）。
   */
  conditionLabelsUsing: (templateId: string) => string[];
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
  /**
   * ⚠ 呼ばれるのは**その出力先の条件が 0 件 → 1 件以上になった瞬間だけ**（毎回の保存では呼ばない）。
   * ⚠ 061k: **引数で窓を指定する**（コーナー／ステージ）。⚠ 呼び出し側は
   * `ObsEffectsScreen` で、**窓ごとに別のキュー**へ流す（1 本に混ぜると片方の open が
   * もう片方の close の完了を待つ・判断 11）。
   */
  openEffectOverlay: (output: EffectOutput) => void;
}

/**
 * 061k: 派生値の**読み書きを出力先で振り分ける**（判断 6）。
 *
 * ⚠⚠ **`Record` の表にしないで `if` で書いているのは、`saveEffectOverlayEnabled` /
 * `saveStageOverlayEnabled` という「名前」が `grep` で追えることに担保を置いているため**
 * （`overlaySettings.ts` の JSDoc が「実装側のヒットが本ファイルと `useEffectTemplates` に
 * 限られること」を不変条件にしている）。表に畳むと呼び出し名が消えて grep が効かなくなる。
 */
const loadOverlayEnabled = (output: EffectOutput): boolean =>
  output === "stage" ? loadStageOverlayEnabled() : loadEffectOverlayEnabled();
const saveOverlayEnabled = (output: EffectOutput, enabled: boolean): void => {
  if (output === "stage") saveStageOverlayEnabled(enabled);
  else saveEffectOverlayEnabled(enabled);
};

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
   * ⚠ **条件は localStorage が正**。ここは表示用のミラーで、書き込みのたびに保存関数の
   * 戻り値（＝保存後の正規化済みの配列）で置き換える（「保存したつもりの値」と state がずれない）。
   */
  const [conditions, setConditions] = useState<EffectConditions>(() =>
    loadEffectConditions(),
  );

  /**
   * ⚠⚠ **061i（判断 2）: 条件を書き換える経路は全部ここを通る。**
   *
   * やることは 3 つで、**この順に固定**してある:
   *   1. **保存の「前」の状態を localStorage から読む**（state からではない。state は写しで、
   *      同じレンダー中に複数回書き換わりうるため。変更関数が基点を localStorage に
   *      置いているのと同じ理由）
   *   2. 実際の書き換え（`mutate`）を走らせ、**保存関数が返す正規化済みの配列**を state に置く
   *   3. **派生値 `EFFECT_OVERLAY_ENABLED_KEY` を立て直す**（＝リポジトリ全体で
   *      `saveEffectOverlayEnabled` を呼ぶ唯一の場所）
   *
   * そのうえで **0 件 → 1 件以上のときだけ窓を開く**。
   * ⚠ **「1 件以上のまま別の条件を変えた」ときに open を投げない**——投げても Rust 側は
   * 既存窓を再利用するだけ（＝実害は無い）だが、**条件を触るたびに無駄な invoke が飛ぶ**のは
   * 「発火の瞬間に IPC を呼ばない」という 061c 申し送り 6 と同じ向きの規律に反する。
   * ⚠⚠ **逆向き（条件が 0 件になったら閉じる）は作らない**（判断 1）。窓が消えると
   * **OBS のウィンドウキャプチャが真っ黒**になり、配信者は原因に気づけない。
   * OBS 側の表示が止まるのは、派生値が false になって `CommentViewerApp` が
   * `hideObs("effects")` を送るからで、**窓自体は開いたまま**である。
   *
   * ⚠⚠ **061j: キーワードを打っただけでは 0 → 1 件にならない**（`effectConditionCount` が
   * 数えるのは `kind === "template"` の条件だけ）。＝ **窓が開くのはエフェクトを選んだ瞬間**で、
   * イベント行と同じ規則である（「いつ窓が開くのか」の説明を 2 通りにしない）。
   */
  const commitConditions = useCallback(
    (mutate: () => EffectConditions) => {
      const before = loadEffectConditions();
      const next = mutate();
      setConditions(next);
      // ⚠⚠ **061k（判断 6）: 派生値は窓ごとに 2 本立てる。**
      //   ⚠ **2 キーを必ず対で書くこと**——片方だけ書くと「stage 条件を作ったのにステージ窓が
      //   開かない」／「条件を全部消したのに OBS へ映り続ける」が黙って起きる。
      //   ⚠ 判定は `effectConditionCount(conditions, output) > 0`＝**出力先ごと**であり、
      //   合計で判定すると「コーナー条件しか無いのにステージ窓が開く」＝
      //   **開いたのに何も出ない窓**を作る（061i が避けた形）。
      for (const output of EFFECT_OUTPUTS) {
        const had = hasEffectConditions(before, output);
        const has = hasEffectConditions(next, output);
        saveOverlayEnabled(output, has);
        // ⚠ **0 件 → 1 件以上の遷移だけ**開く（「1 件以上のまま別の条件を変えた」では投げない）。
        //   ⚠ 逆向き（0 件になったら閉じる）は作らない（判断 1・窓が消えると OBS が真っ黒）。
        if (has && !had) openEffectOverlay(output);
      }
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
   * ⚠ **061j の移行（旧形式 Record → 条件の配列）もここを通る**——`loadEffectConditions()` が
   * 読み込み時に変換するので、**旧形式のままでも条件数は正しく数えられる**（保存値は書き戻さない）。
   */
  useEffect(() => {
    const conditions = loadEffectConditions();
    // ⚠ 061k: **2 キーとも**実態へ合わせ直す（片方だけだと移行が半分しか効かない）。
    //   ⚠ **061j → 061k のアップグレードでは stage 側が必ず false へ倒れる**（`output` の無い
    //   保存値は全部 corner なので）＝ **既存ユーザーの見え方が 1 ミリも変わらない**ことの担保でもある。
    for (const output of EFFECT_OUTPUTS) {
      const shouldBeEnabled = hasEffectConditions(conditions, output);
      if (loadOverlayEnabled(output) === shouldBeEnabled) continue;
      saveOverlayEnabled(output, shouldBeEnabled);
    }
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
        // ⚠⚠ **061i: この経路も `commitConditions` を通す**（判断 2）。ここを直接
        //   `setConditions(...)` に戻すと、**最後のテンプレートを消して条件が 0 件になっても
        //   `EFFECT_OVERLAY_ENABLED_KEY` が true のまま**残り、OBS へ映り続ける
        //   （＝派生値の書き手が 1 か所に閉じていない状態。**6 本の中で最も忘れやすい**）。
        // ⚠ 061j: キーワード条件が指している場合も同じく「表示しない」へ戻る。
        commitConditions(() => clearEffectConditionsForTemplate(template.id));
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
    [reload, commitConditions],
  );

  /**
   * ⚠⚠ **061d-2 レビュー Q-9: 保存を `setConditions` の更新関数の中でやらない。**
   * 更新関数は StrictMode で二重に呼ばれる（＝純粋であることが前提の場所）ので、
   * 副作用を置くと「冪等だからたまたま無害」に依存した形になる。
   * ⚠ 基点は state ではなく **localStorage（＝正）**——state はその写しなので結果は同じで、
   * かつ「保存 → 読み直し」が 1 本道になる（`effectAssignments.ts` の変更関数が全部この形）。
   */
  const setConditionEffect = useCallback(
    (id: string, effect: EffectAssignment) => {
      commitConditions(() => setConditionEffectInStore(id, effect));
    },
    [commitConditions],
  );

  /**
   * 061k: 出力先の変更。⚠⚠ **必ず `commitConditions` を通す**（7 本目の経路）——
   * 通さないと**派生値 2 キーが追従しない**＝「stage へ移したのにステージ窓が開かない」
   * （あるいは「コーナーから全部移したのにコーナー窓の OBS ソースが有効なまま」）が黙って起きる。
   */
  const setConditionOutput = useCallback(
    (id: string, output: EffectOutput) => {
      commitConditions(() => setConditionOutputInStore(id, output));
    },
    [commitConditions],
  );

  const addKeywordCondition = useCallback(
    (
      when: { text: string; match: EffectKeywordMatch },
      effect: EffectAssignment,
    ) => {
      commitConditions(() => addKeywordConditionToStore(when, effect));
    },
    [commitConditions],
  );

  const updateKeywordCondition = useCallback(
    (id: string, when: { text: string; match: EffectKeywordMatch }) => {
      commitConditions(() => updateKeywordConditionInStore(id, when));
    },
    [commitConditions],
  );

  const removeCondition = useCallback(
    (id: string) => {
      commitConditions(() => removeConditionFromStore(id));
    },
    [commitConditions],
  );

  /**
   * ⚠⚠ **復帰導線**。壊れたテンプレートで配信画面が読めなくなったときの唯一の脱出路
   * （060d の「既定のデザインに戻す」と同じ位置づけ）。**テストで固定する。**
   * ⚠ 061j: **キーワード条件そのものは消さない**（`effect` だけ「表示しない」へ戻る）。
   */
  const clearAllAssignments = useCallback(() => {
    // ⚠ 061i: 条件が 0 件になるので派生値も false へ倒れる（＝OBS 側のソースが非表示になる）。
    //   ⚠ **窓は閉じない**（判断 1）。
    commitConditions(() => clearAllEffectConditions());
  }, [commitConditions]);

  /**
   * 061j（判断 13）: 削除確認文に出す**条件のラベル**。
   *
   * ⚠ **イベント条件は `EFFECT_EVENT_LABEL`**（コメント一覧・ティッカー・読み上げと同じ表）。
   *   ここで新しい呼び名を発明しない。
   * ⚠ **キーワード条件は当て方まで書く**——「含む」と「完全一致」で意味が違うので、
   *   キーワードだけ出すと「なぜこれが当たるのか」が確認文から読めない。
   */
  const conditionLabelsUsing = useCallback(
    (templateId: string): string[] =>
      conditions
        .filter(
          (c) => c.effect.kind === "template" && c.effect.templateId === templateId,
        )
        .map((c) =>
          c.when.type === "event"
            ? (EFFECT_EVENT_LABEL[c.when.eventType] ?? c.when.eventType)
            : c.when.match === "exact"
              ? `「${c.when.text}」と完全に一致するコメント`
              : `「${c.when.text}」を含むコメント`,
        ),
    [conditions],
  );

  return {
    templates,
    listState,
    busy,
    error,
    imported,
    lastDeletedId,
    conditions,
    startImport,
    pendingDelete,
    requestDelete,
    cancelDelete,
    runDelete,
    setConditionEffect,
    setConditionOutput,
    addKeywordCondition,
    updateKeywordCondition,
    removeCondition,
    clearAllAssignments,
    conditionLabelsUsing,
  };
}
