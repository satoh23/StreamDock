import type { Screen } from "../../types";
import type { ThemePreference } from "../../features/theme/theme";
import { Button } from "../../components/primitives";
import layout from "../formLayout.module.css";
import styles from "./SettingsScreen.module.css";

/** テーマ選択肢の表示情報（システム / ライト / ダーク）。 */
const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    value: "system",
    label: "システム",
    description: "PC（OS）の設定に合わせて自動で切り替えます。",
    icon: "🖥",
  },
  {
    value: "light",
    label: "ライト",
    description: "常に明るい配色で表示します。",
    icon: "☀",
  },
  {
    value: "dark",
    label: "ダーク",
    description: "常に暗い配色で表示します。",
    icon: "🌙",
  },
];

export function SettingsScreen({
  onNavigate,
  preference,
  onChangePreference,
}: {
  onNavigate: (screen: Screen) => void;
  preference: ThemePreference;
  onChangePreference: (preference: ThemePreference) => void;
}) {
  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>設定</h2>
          <p>アプリの外観などを設定できます。</p>
        </div>
        <div className={layout.actions}>
          <Button onClick={() => onNavigate("main")}>メインに戻る</Button>
        </div>
      </div>

      <div className={styles.stack}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>外観（テーマ）</h3>
            <p>ライト / ダークの配色を選べます。「システム」はPCの設定に追従します。</p>
          </div>
          <div className={layout.panelBody}>
            <div className={styles.options} role="radiogroup" aria-label="テーマ">
              {THEME_OPTIONS.map((option) => {
                const selected = preference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`${styles.option} ${selected ? styles.selected : ""}`}
                    onClick={() => onChangePreference(option.value)}
                  >
                    <span className={styles.optionIcon} aria-hidden="true">
                      {option.icon}
                    </span>
                    <span className={styles.optionBody}>
                      <span className={styles.optionLabel}>{option.label}</span>
                      <span className={styles.optionDesc}>{option.description}</span>
                    </span>
                    <span className={styles.check} aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
