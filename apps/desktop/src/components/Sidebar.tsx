import type { Screen } from "../types";
import type { ToolRecord } from "../features/tools/types";
import type { PresetRecord } from "../features/presets/types";
import { toIconLetter } from "../features/tools/display";
import styles from "./Sidebar.module.css";

export function Sidebar({
  presets = [],
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
  /** メイン画面: 選択中プリセットのハイライト */
  activePresetId?: string | null;
  onSelectPreset?: (id: string) => void;
  onEditPreset?: (id: string) => void;
  onDeletePreset?: (id: string) => void;
  /** 登録済みツール一覧を表示する */
  showToolList?: boolean;
  /** ghost ナビの active 表示 (追加画面のとき) */
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
                  <h3 title={preset.name}>{preset.name}</h3>
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
        >
          ＋ プリセットを追加
        </button>
      </div>

      <div className={styles.toolSection}>
        <div className={styles.label}>ツール</div>
        {showToolList && (
          <div className={styles.toolList}>
            {hasTools ? (
              tools.map((tool) => (
                <div key={tool.id} className={styles.sidebarTool}>
                  <div className={styles.sidebarToolIcon}>{toIconLetter(tool)}</div>
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
        >
          ＋ ツールを登録
        </button>
      </div>
    </aside>
  );
}
