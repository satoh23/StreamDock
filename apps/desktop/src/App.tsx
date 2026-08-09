import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { Screen } from "./types";
import { Window } from "./components/Window";
import { Header } from "./components/Header";
import { HEADER_SECTIONS } from "./components/headerSections";
import { Sidebar } from "./components/Sidebar";
import { MainScreen } from "./screens/main/MainScreen";
import { AddToolScreen } from "./screens/add-tool/AddToolScreen";
import { AddPresetScreen } from "./screens/add-preset/AddPresetScreen";
import { DiagnosticsScreen } from "./screens/diagnostics/DiagnosticsScreen";
import { SettingsScreen } from "./screens/settings/SettingsScreen";
import { RakurakuToolsScreen } from "./screens/rakuraku-tools/RakurakuToolsScreen";
import { ComingSoonScreen } from "./screens/coming-soon/ComingSoonScreen";
import { UpdateScreen } from "./screens/app-update/UpdateScreen";
import { useAppUpdate } from "./features/app-update/useAppUpdate";
import { useTheme } from "./features/theme/useTheme";
import { useHostOs } from "./features/platform/useHostOs";
import { useTools } from "./features/tools/useTools";
import { deleteTool } from "./features/tools/toolApi";
import { usePresets } from "./features/presets/usePresets";
import { deletePreset } from "./features/presets/presetApi";
import { usePresetItems } from "./features/presets/usePresetItems";
import {
  addToolToPreset,
  removeToolFromPreset,
  reorderPresetItems,
  updatePresetItem,
} from "./features/presets/presetItemApi";
import { withTools } from "./features/presets/types";
import type { LaunchMode, PresetItemMeta } from "./features/presets/types";
import { TutorialProvider } from "./features/tutorial/TutorialProvider";
import { TutorialOverlay } from "./components/tutorial/TutorialOverlay";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CommentViewerApp } from "./screens/comment-viewer/CommentViewerApp";
import { OverlayApp } from "./screens/comment-viewer/OverlayApp";
import { PinnedOverlayApp } from "./screens/comment-viewer/PinnedOverlayApp";
import { EffectOverlayApp } from "./screens/obs-effects/EffectOverlayApp";
import { ObsEffectsScreen } from "./screens/obs-effects/ObsEffectsScreen";
import { restoreEffectOverlayWindow } from "./features/comment-viewer/effectOverlayRestore";

function MainWindowApp() {
  const [screen, setScreen] = useState<Screen>("main");

  const { preference: themePreference, setPreference: setThemePreference } =
    useTheme();

  const hostOs = useHostOs();

  const { tools, reload: reloadTools } = useTools();
  const { presets, reload: reloadPresets } = usePresets();
  const { items: presetItems, reload: reloadPresetItems } = usePresetItems();

  // 055c: 起動時に 1 回だけ更新チェックする。他の use* hook と同じく **App が 1 つだけ持ち**、
  // Header（バッジ）と UpdateScreen（本文）へ props で配る。
  // ⚠ ここ（MainWindowApp）でしか呼ばない＝コメビュ窓/オーバーレイ窓からは発火しない。
  // ⚠ 失敗してもこのフックの中で完結し、他機能には一切影響しない（phase: "error" に落ちるだけ）。
  const appUpdate = useAppUpdate();

  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  // 新規ツール登録の表示名プリフィルと、保存/キャンセル後の戻り先（既定は main。らくらく画面から
  // 「ツール管理へ追加」で来たときは rakuraku-tools へ戻す）。
  const [addToolPrefillName, setAddToolPrefillName] = useState<string | null>(null);
  const [addToolOrigin, setAddToolOrigin] = useState<Screen>("main");

  // 061a: 「エフェクトを配信画面に表示する」が ON なのに窓が無ければ開き直す（永続設定の復元）。
  //
  // ⚠ **ここ（main 窓のマウント＝アプリ起動時）で復元するのが要点**。046b が固定コメント窓で同じことを
  // している理由と同じで、**配信開始時に窓が無いと OBS のウィンドウキャプチャソースが真っ黒のまま始まる**。
  // `obs-effects` 画面を開いたときだけ復元する案は、その画面を毎回訪れないと窓が出ない＝目的を満たさない。
  //
  // ⚠ **ユーザー操作なしに窓が開く経路が 1 本増える**（046b の security-review で指摘された論点）。
  // 許容する根拠は 046b より明確に強い: ①起点は明示的な永続設定（既定 OFF）②開く窓は
  // **061a 時点では完全に空**（第三者の個人データを 1 バイトも描かない）③新規通信・OBS 接続・sidecar 起動を
  // いずれも伴わない。⚠ 061b でこの窓が投稿者名と金額を描くようになるが、061b の設計は
  // 「届かなかったら諦める・マウント時に過去のエフェクトを再生しない」なので、
  // **起動時に前回の第三者データが出る経路は生まれない**（046b が踏んだ S-1 とはここが違う）。
  //
  // ⚠ 自動 close は作らない（設定 OFF で窓が開いていても閉じない）。親 046 の「窓が消えると OBS ソースが
  // 壊れる」規律に揃える。⚠ state ではなく `loadEffectOverlayEnabled()` を直読みするのは 046b と同じ理由
  //（is* の解決を待つ間にユーザーが OFF にしたとき、stale な true で窓を開かないため）。
  //
  // ⚠ 061a レビュー（Q-9）: 判断の本体は **`effectOverlayRestore.ts` へ切り出して単体テストしてある**
  //（`MainWindowApp` は invoke 依存の hook を多数マウントするので、ここに直書きすると
  // 「ユーザー操作なしに窓が開く」挙動がテストの死角に落ちる）。仕様の正はあちらの JSDoc とテスト。
  //
  // ⚠ 061a レビュー（Q-3・修正不要）: 046b は復元とトグルを**同じ `pinnedOverlayOpRef` のチェーン**に
  // 乗せているが、061a は復元がここ（`MainWindowApp`）・トグルが `ObsEffectsScreen` の
  // `effectOverlayOpRef` と**別コンポーネント＝別 ref** なので、両者の順序は直列化されていない。
  // 理屈上は「復元の open（`command(async)`＝別スレッド）が、トグル OFF の close（同期コマンド）を
  // 追い越す → 設定 OFF なのに窓が残る（自動 close 経路が無いのでセッション中は解消しない）」が起こりうる。
  // ⚠ それでも直さないのは、**到達に「アプリ起動 → ヘッダーから OBS エフェクト画面へ遷移 → トグル OFF」が
  // 復元 invoke の往復（数百 ms）より速いこと**が要るから＝実質到達不能。逆順（OFF→ON）は上の直読みが塞ぐ。
  // 窓をまたぐので ref の共有もできない（共有するなら localStorage 経由のロックが要り、割に合わない）。
  // **再修正トリガー**＝`obs-effects` 画面が起動直後の初期画面になる／復元を遅延させる等で、
  // 「復元の解決前にトグルへ触れる」が現実的な操作になったら、復元を `ObsEffectsScreen` 側へ寄せて
  // 1 本の ref チェーンに統合する。
  useEffect(() => {
    // 窓生成の失敗は他機能に影響させない（ここで完結させる）。復元できなくても設定は残るので次回に再挑戦する。
    void restoreEffectOverlayWindow().catch(() => {});
  }, []);

  // プリセット一覧が変わったら、選択中IDが有効か検証し、無効なら先頭（無ければ null）へ寄せる
  useEffect(() => {
    setActivePresetId((current) => {
      if (current && presets.some((p) => p.id === current)) return current;
      return presets[0]?.id ?? null;
    });
  }, [presets]);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? null;
  const editingPreset = presets.find((p) => p.id === editingPresetId) ?? null;
  const editingTool = tools.find((t) => t.id === editingToolId) ?? null;

  // 選択中プリセットのツール構成（Tool 情報を合成した表示用一覧）
  const activeItems = useMemo(
    () =>
      withTools(
        presetItems.filter((i) => i.presetId === activePresetId),
        tools,
      ),
    [presetItems, activePresetId, tools],
  );

  // 選択中プリセットにまだ入っていない登録済みツール（＋ツール追加の候補）
  const availableTools = useMemo(() => {
    const usedToolIds = new Set(
      presetItems
        .filter((i) => i.presetId === activePresetId)
        .map((i) => i.toolId),
    );
    return tools.filter((t) => !usedToolIds.has(t.id));
  }, [presetItems, activePresetId, tools]);

  // サイドバー用：プリセットごとのツール数・並行有無
  const presetMeta = useMemo(() => {
    const map = new Map<string, PresetItemMeta>();
    for (const item of presetItems) {
      const meta = map.get(item.presetId) ?? { count: 0, hasParallel: false };
      meta.count += 1;
      if (item.launchMode === "parallel") meta.hasParallel = true;
      map.set(item.presetId, meta);
    }
    return map;
  }, [presetItems]);

  // --- ツール ---
  const openAddTool = (opts?: { prefillName?: string; origin?: Screen }) => {
    setEditingToolId(null);
    setAddToolPrefillName(opts?.prefillName ?? null);
    setAddToolOrigin(opts?.origin ?? "main");
    setScreen("add-tool");
  };

  const openEditTool = (id: string) => {
    setEditingToolId(id);
    setAddToolPrefillName(null);
    setAddToolOrigin("main");
    setScreen("add-tool");
  };

  const handleDeleteTool = async (id: string) => {
    const target = tools.find((t) => t.id === id);
    // 032c-a: 内蔵ツール（コメビュ等）は削除不可。UI で削除ボタンを出さないが多重防御でここでも弾く。
    if (target?.kind === "internal") return;
    const label = target ? target.name : "このツール";
    const ok = await ask(`「${label}」を削除しますか？`, {
      title: "ツールの削除",
      kind: "warning",
    });
    if (!ok) return;
    await deleteTool(id);
    await reloadTools();
    // ツール削除でプリセット構成（preset_items）もカスケード除去されるため再読込
    await reloadPresetItems();
  };

  // --- プリセット ---
  const openAddPreset = () => {
    setEditingPresetId(null);
    setScreen("add-preset");
  };

  const openEditPreset = (id: string) => {
    setEditingPresetId(id);
    setScreen("add-preset");
  };

  const handleDeletePreset = async (id: string) => {
    const target = presets.find((p) => p.id === id);
    const label = target ? target.name : "このプリセット";
    const ok = await ask(`「${label}」を削除しますか？`, {
      title: "プリセットの削除",
      kind: "warning",
    });
    if (!ok) return;
    await deletePreset(id);
    // 選択中を消した場合は、残りの先頭（無ければ null）へ切り替える
    if (activePresetId === id) {
      const remaining = presets.filter((p) => p.id !== id);
      setActivePresetId(remaining[0]?.id ?? null);
    }
    await reloadPresets();
    await reloadPresetItems();
  };

  // --- プリセット内ツール構成（メイン画面の編集モードから即時保存）---
  const handleAddToolToPreset = async (presetId: string, toolId: string) => {
    await addToolToPreset({ presetId, toolId });
    await reloadPresetItems();
  };

  const handleRemovePresetItem = async (id: string) => {
    const target = presetItems.find((i) => i.id === id);
    const presetId = target?.presetId ?? null;
    const remainingCount = presetId
      ? presetItems.filter((i) => i.presetId === presetId).length
      : 0;

    // 最後の1件を外す場合は、プリセット自体を削除する（確認あり）
    if (presetId && remainingCount <= 1) {
      const ok = await ask(
        "プリセットからツールがすべて削除されるとプリセットも削除されます。よろしいですか？",
        { title: "プリセットの削除", kind: "warning" },
      );
      if (!ok) return;
      await deletePreset(presetId);
      // 選択中を消した場合は残りの先頭（無ければ null）へ切替（handleDeletePreset と同型）
      if (activePresetId === presetId) {
        const remaining = presets.filter((p) => p.id !== presetId);
        setActivePresetId(remaining[0]?.id ?? null);
      }
      await reloadPresets();
      await reloadPresetItems();
      return;
    }

    await removeToolFromPreset(id);
    await reloadPresetItems();
  };

  const handleReorderPresetItems = async (
    presetId: string,
    orderedIds: string[],
  ) => {
    await reorderPresetItems(presetId, orderedIds);
    await reloadPresetItems();
  };

  const handleSetLaunchMode = async (
    id: string,
    launchMode: LaunchMode,
    enabled: boolean,
  ) => {
    await updatePresetItem(id, { launchMode, enabled });
    await reloadPresetItems();
  };

  const reloadPresetData = async () => {
    await reloadPresets();
    await reloadPresetItems();
  };

  const handleNavigate = (next: Screen) => {
    if (next === "add-tool") {
      openAddTool();
      return;
    }
    if (next === "add-preset") {
      openAddPreset();
      return;
    }
    setScreen(next);
  };

  // 編集対象プリセットの既存ツール構成（AddPresetScreen の初期値）。
  // フィルタ結果の identity を安定させ、編集画面側の初期化 effect の無限再実行を防ぐ。
  const editingItems = useMemo(
    () => presetItems.filter((i) => i.presetId === editingPresetId),
    [presetItems, editingPresetId],
  );

  const sidebar = (
    <Sidebar
      presets={presets}
      presetMeta={presetMeta}
      activePresetId={activePresetId}
      onSelectPreset={setActivePresetId}
      onEditPreset={openEditPreset}
      onDeletePreset={handleDeletePreset}
      onNavigate={handleNavigate}
      showToolList
      tools={tools}
      onEditTool={openEditTool}
      onDeleteTool={handleDeleteTool}
    />
  );

  // ヘッダーの active 表示：メイン(ツール管理)/準備中セクション/診断/設定/アップデートを開いているとき導出する
  const activeNav =
    screen === "main" ||
    screen === "rakuraku-tools" ||
    screen === "obs-effects" ||
    screen === "diagnostics" ||
    screen === "settings" ||
    screen === "app-update"
      ? screen
      : undefined;

  // 現在の画面が未実装セクションの「準備中」ダミーページに該当するか（該当時はその定義を表示に使う）
  const comingSoonSection = HEADER_SECTIONS.find(
    (s) => !s.implemented && s.screen === screen,
  );

  return (
    <TutorialProvider
      screen={screen}
      toolsCount={tools.length}
      presetsCount={presets.length}
    >
      <Window
        header={
          <Header
            hostOs={hostOs}
            activeNav={activeNav}
            updateAvailable={appUpdate.status?.available === true}
            onNavigate={handleNavigate}
          />
        }
        sidebar={screen === "main" ? sidebar : undefined}
      >
        {screen === "main" && (
          <MainScreen
            presetName={activePreset?.name ?? null}
            presetId={activePresetId}
            items={activeItems}
            availableTools={availableTools}
            hasAnyTools={tools.length > 0}
            onNavigate={handleNavigate}
            onAddTool={handleAddToolToPreset}
            onRemoveItem={handleRemovePresetItem}
            onReorder={handleReorderPresetItems}
            onSetLaunchMode={handleSetLaunchMode}
          />
        )}
        {screen === "add-tool" && (
          <AddToolScreen
            onNavigate={setScreen}
            editingTool={editingTool}
            prefillName={addToolPrefillName}
            returnTo={addToolOrigin}
            presets={presets}
            presetItems={presetItems}
            onSaved={async () => {
              await reloadTools();
              // 024: プリセット登録がメイン画面のツール構成へ反映されるよう item も再読込
              await reloadPresetItems();
            }}
          />
        )}
        {screen === "add-preset" && (
          <AddPresetScreen
            onNavigate={setScreen}
            editingPreset={editingPreset}
            editingItems={editingItems}
            tools={tools}
            onSaved={reloadPresetData}
          />
        )}
        {screen === "diagnostics" && <DiagnosticsScreen />}
        {screen === "settings" && (
          <SettingsScreen
            preference={themePreference}
            onChangePreference={setThemePreference}
          />
        )}
        {screen === "app-update" && (
          <UpdateScreen
            status={appUpdate.status}
            phase={appUpdate.phase}
            error={appUpdate.error}
            progress={appUpdate.progress}
            hostOs={hostOs}
            onRecheck={() => void appUpdate.recheck()}
            onInstall={() => void appUpdate.install()}
            onRestart={() => void appUpdate.restart()}
          />
        )}
        {screen === "rakuraku-tools" && (
          <RakurakuToolsScreen
            hostOs={hostOs}
            onRequestAddTool={({ name }) =>
              openAddTool({ prefillName: name, origin: "rakuraku-tools" })
            }
          />
        )}
        {/* 061a: `headerSections.ts` の `obs` が `implemented: true` になったので、下の
            `comingSoonSection`（`!implemented` で引く）は当たらなくなり、この実画面が出る。 */}
        {screen === "obs-effects" && <ObsEffectsScreen />}
        {comingSoonSection && (
          <ComingSoonScreen
            title={comingSoonSection.label}
            description={comingSoonSection.comingSoonDescription}
          />
        )}
      </Window>
      <TutorialOverlay />
    </TutorialProvider>
  );
}

/**
 * 032c-a/033f/046b/061a: 同一 Vite バンドルをウィンドウラベルで分岐する薄いルート。
 * `main`（既定）= 管理画面（MainWindowApp）／`comment-viewer` = 内蔵コメントビューア／
 * `comment-overlay` = OBS 用の背景透過オーバーレイ（コメント一覧・表示専用）／
 * `pinned-overlay` = 固定コメント専用の背景透過オーバーレイ（046a のピンだけを描く・表示専用・WS なし）／
 * `effect-overlay` = エフェクト専用の背景透過オーバーレイ（061a では空＋セットアップ用ガイド・表示専用・WS なし）。
 * ウィンドウ生成は Rust の `open_comment_viewer_window` / `open_comment_overlay_window` /
 * `open_pinned_overlay_window` / `open_effect_overlay_window` に閉じ、frontend からは生成しない。
 */
function App() {
  const label = getCurrentWindow().label;
  if (label === "comment-viewer") {
    return <CommentViewerApp />;
  }
  if (label === "comment-overlay") {
    return <OverlayApp />;
  }
  if (label === "pinned-overlay") {
    return <PinnedOverlayApp />;
  }
  if (label === "effect-overlay") {
    return <EffectOverlayApp />;
  }
  return <MainWindowApp />;
}

export default App;
