import { presets } from "../data/mockData";
import type { Screen } from "../types";
import type { ToolRecord } from "../features/tools/types";
import { toIconLetter } from "../features/tools/display";
import { Chip } from "./primitives";
import styles from "./Sidebar.module.css";

export function Sidebar({
  activePresetId,
  onSelectPreset,
  showToolList = false,
  activeNav,
  onNavigate,
  tools = [],
  onEditTool,
  onDeleteTool,
}: {
  /** メイン画面: 選択中プリセットのハイライト */
  activePresetId?: string;
  onSelectPreset?: (id: string) => void;
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
        {hasPresets && (
          <div className={styles.presetList}>
            {presets.map((preset) => (
              <div
                key={preset.id}
                className={`${styles.preset} ${
                  activePresetId === preset.id ? styles.active : ""
                }`}
                onClick={() => onSelectPreset?.(preset.id)}
              >
                <h3>{preset.name}</h3>
                <div className={styles.presetMeta}>
                  {preset.chips.map((chip) => (
                    <Chip key={chip}>{chip}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
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
