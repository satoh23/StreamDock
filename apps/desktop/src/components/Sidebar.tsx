import { presets, toolCatalog } from "../data/mockData";
import type { Screen } from "../types";
import { Chip } from "./primitives";
import styles from "./Sidebar.module.css";

export function Sidebar({
  activePresetId,
  onSelectPreset,
  showToolList = false,
  activeNav,
  onNavigate,
}: {
  /** メイン画面: 選択中プリセットのハイライト */
  activePresetId?: string;
  onSelectPreset?: (id: string) => void;
  /** 追加画面: 登録済みツール一覧を表示する */
  showToolList?: boolean;
  /** ghost ナビの active 表示 (追加画面のとき) */
  activeNav?: Extract<Screen, "add-preset" | "add-tool">;
  onNavigate: (screen: Screen) => void;
}) {
  const hasPresets = presets.length > 0;
  const hasTools = showToolList && toolCatalog.length > 0;

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
        {hasTools && (
          <div className={styles.toolList}>
            {toolCatalog.map((tool) => (
              <div key={tool.id} className={styles.sidebarTool}>
                <div className={styles.sidebarToolIcon}>{tool.iconLetter}</div>
                <span>{tool.name}</span>
              </div>
            ))}
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
