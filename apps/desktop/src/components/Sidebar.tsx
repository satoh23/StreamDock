import type { Screen } from "../types";
import type { ToolRecord } from "../features/tools/types";
import type { PresetItemMeta, PresetRecord } from "../features/presets/types";
import { iconDataUri, toIconLetter } from "../features/tools/display";
import styles from "./Sidebar.module.css";

/** プリセットのツール数・並行有無を表示用ラベルにする。 */
function metaLabel(meta: PresetItemMeta | undefined): string {
  const count = meta?.count ?? 0;
  const base = `${count}ツール`;
  return meta?.hasParallel ? `${base}・一部並行` : base;
}

export function Sidebar({
  presets = [],
  presetMeta,
  activePresetId,
  onSelectPreset,
  onEditPreset,
  onDeletePreset,
  showToolList = false,
  activeNav,
  onNavigate,
  tools = [],
  onEditTool,
  onDeleteTool,
}: {
  /** 登録済みプリセット（実データ） */
  presets?: PresetRecord[];
  /** プリセットID → ツール数・並行有無のメタ情報 */
  presetMeta?: Map<string, PresetItemMeta>;
  /** メイン画面: 選択中プリセットのハイライト */
  activePresetId?: string | null;
  onSelectPreset?: (id: string) => void;
  onEditPreset?: (id: string) => void;
  onDeletePreset?: (id: string) => void;
  /** 登録済みツール一覧を表示する */
  showToolList?: boolean;
  /** ghost ナビの active 表示 (プリセット追加 / ツール登録のとき) */
  activeNav?: Extract<Screen, "add-preset" | "add-tool">;
  onNavigate: (screen: Screen) => void;
  /** 登録済みツール（実データ） */
  tools?: ToolRecord[];
  onEditTool?: (id: string) => void;
  onDeleteTool?: (id: string) => void;
}) {
  const hasPresets = presets.length > 0;
  const hasTools = tools.length > 0;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.presetSection}>
        <div className={styles.label}>配信プリセット</div>
        <div className={styles.presetList}>
          {hasPresets ? (
            presets.map((preset) => (
              <div
                key={preset.id}
                className={`${styles.preset} ${
                  activePresetId === preset.id ? styles.active : ""
                }`}
                onClick={() => onSelectPreset?.(preset.id)}
              >
                <div className={styles.presetHeader}>
                  <div className={styles.presetMain}>
                    <h3 title={preset.name}>{preset.name}</h3>
                    <div className={styles.presetMeta}>
                      {metaLabel(presetMeta?.get(preset.id))}
                    </div>
                  </div>
                  <div className={styles.toolActions}>
                    {onEditPreset && (
                      <button
                        className={styles.toolActionBtn}
                        title="編集"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditPreset(preset.id);
                        }}
                      >
                        ✎
                      </button>
                    )}
                    {onDeletePreset && (
                      <button
                        className={`${styles.toolActionBtn} ${styles.danger}`}
                        title="削除"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePreset(preset.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.emptyHint}>まだプリセットがありません。</div>
          )}
        </div>
        <button
          className={`${styles.ghost} ${activeNav === "add-preset" ? styles.active : ""}`}
          onClick={() => onNavigate("add-preset")}
          disabled={!hasTools}
          title={
            hasTools ? undefined : "先にツールを1つ以上登録してください"
          }
          data-tutorial-id="sidebar-add-preset"
        >
          ＋ プリセットを追加
        </button>
        {!hasTools && (
          <div className={styles.emptyHint}>
            ツールを登録するとプリセットを作成できます。
          </div>
        )}
      </div>

      <div className={styles.toolSection}>
        <div className={styles.label}>ツール</div>
        {showToolList && (
          <div className={styles.toolList}>
            {hasTools ? (
              tools.map((tool) => (
                <div key={tool.id} className={styles.sidebarTool}>
                  <div className={styles.sidebarToolIcon}>
                    {iconDataUri(tool.iconPng) ? (
                      <img
                        className={styles.sidebarToolIconImg}
                        src={iconDataUri(tool.iconPng)}
                        alt=""
                      />
                    ) : (
                      toIconLetter(tool)
                    )}
                  </div>
                  <span title={tool.name}>{tool.name}</span>
                  <div className={styles.toolActions}>
                    {onEditTool && (
                      <button
                        className={styles.toolActionBtn}
                        title="編集"
                        onClick={() => onEditTool(tool.id)}
                      >
                        ✎
                      </button>
                    )}
                    {onDeleteTool && (
                      <button
                        className={`${styles.toolActionBtn} ${styles.danger}`}
                        title="削除"
                        onClick={() => onDeleteTool(tool.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyHint}>
                まだツールが登録されていません。
              </div>
            )}
          </div>
        )}
        <button
          className={`${styles.ghost} ${activeNav === "add-tool" ? styles.active : ""}`}
          onClick={() => onNavigate("add-tool")}
          data-tutorial-id="sidebar-add-tool"
        >
          ＋ ツールを登録
        </button>
      </div>
    </aside>
  );
}
