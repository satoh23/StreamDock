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
            onRecheck={() => void appUpdate.recheck()}
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
 * 032c-a/033f/046b: 同一 Vite バンドルをウィンドウラベルで分岐する薄いルート。
 * `main`（既定）= 管理画面（MainWindowApp）／`comment-viewer` = 内蔵コメントビューア／
 * `comment-overlay` = OBS 用の背景透過オーバーレイ（コメント一覧・表示専用）／
 * `pinned-overlay` = 固定コメント専用の背景透過オーバーレイ（046a のピンだけを描く・表示専用・WS なし）。
 * ウィンドウ生成は Rust の `open_comment_viewer_window` / `open_comment_overlay_window` /
 * `open_pinned_overlay_window` に閉じ、frontend からは生成しない。
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
  return <MainWindowApp />;
}

export default App;
