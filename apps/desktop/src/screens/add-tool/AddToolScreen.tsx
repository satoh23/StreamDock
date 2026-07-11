import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Screen } from "../../types";
import type { ToolRecord } from "../../features/tools/types";
import { createTool, extractAppIcon, updateTool } from "../../features/tools/toolApi";
import { toErrorMessage } from "../../features/tools/useTools";
import { iconDataUri, toIconLetter } from "../../features/tools/display";
import {
  insertModeOptions,
  targetPresetOptions,
} from "../../data/mockData";
import { Button } from "../../components/primitives";
import { PreviewCard, type PreviewRowData } from "../../components/PreviewCard";
import layout from "../formLayout.module.css";
import styles from "./AddToolScreen.module.css";

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** パス文字列からファイル名（拡張子除く）を推定して表示名の初期値にする。 */
function guessNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

export function AddToolScreen({
  onNavigate,
  editingTool,
  onSaved,
}: {
  onNavigate: (screen: Screen) => void;
  /** 編集対象。null なら新規登録。 */
  editingTool?: ToolRecord | null;
  /** 保存成功後に一覧を再読み込みするコールバック。 */
  onSaved?: () => Promise<void> | void;
}) {
  const isEdit = !!editingTool;

  const [name, setName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [description, setDescription] = useState("");
  // 018: 選択時に一度だけ抽出した実アイコン（base64 PNG, `data:` 無し）。抽出不可なら null。
  const [iconPng, setIconPng] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 編集画面 / 新規画面 いずれもフォーム初期値を editingTool に同期する
  useEffect(() => {
    setName(editingTool?.name ?? "");
    setExecutablePath(editingTool?.executablePath ?? "");
    setDescription(editingTool?.description ?? "");
    setIconPng(editingTool?.iconPng ?? null);
    setError(null);
  }, [editingTool]);

  // 表示のみに使う（保存には関与しない）プリセット系 select
  const [targetPreset, setTargetPreset] = useState(targetPresetOptions[0]);
  const [insertMode, setInsertMode] = useState(insertModeOptions[0]);

  const selectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "実行ファイルを選択",
      });
      if (typeof selected === "string") {
        setExecutablePath(selected);
        if (!name.trim()) setName(guessNameFromPath(selected));
        // 018: 選択時に一度だけ実アイコンを抽出する。抽出失敗はフローを止めず文字にフォールバック。
        const png = await extractAppIcon(selected).catch(() => null);
        setIconPng(png);
      }
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const input = {
        name,
        executablePath,
        description,
        // 018: 抽出済みアイコンを保存する（無ければ省略し、DB では null のまま）。
        iconPng: iconPng ?? undefined,
      };
      if (isEdit && editingTool) {
        await updateTool(editingTool.id, input);
      } else {
        await createTool(input);
      }
      await onSaved?.();
      onNavigate("main");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const hasPath = executablePath.trim().length > 0;
  const previewIcon = toIconLetter({ name });
  const previewIconSrc = iconDataUri(iconPng);

  const previewRows: PreviewRowData[] = [
    {
      key: "__preview__",
      orderLabel: "1",
      iconLetter: previewIcon,
      iconSrc: previewIconSrc,
      name: name || "（表示名未入力）",
      description: description || executablePath || "説明未入力",
      highlight: true,
    },
  ];

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>{isEdit ? "ツールを編集" : "ツールを追加"}</h2>
        </div>
      </div>

      <div className={layout.content}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>アプリを選択</h3>
            <p>起動したいアプリの実行ファイルを選びます。</p>
          </div>
          <div className={layout.panelBody}>
            {hasPath ? (
              <div className={styles.selectedApp}>
                <div className={styles.appIcon}>
                  {previewIconSrc ? (
                    <img
                      className={styles.appIconImg}
                      src={previewIconSrc}
                      alt=""
                    />
                  ) : (
                    previewIcon
                  )}
                </div>
                <div>
                  <h3>{name || guessNameFromPath(executablePath)}</h3>
                  <div className={styles.path}>{executablePath}</div>
                </div>
              </div>
            ) : (
              <div className={styles.dropzone}>
                <div>
                  <div className={styles.dropIcon}>
                    <DropIcon />
                  </div>
                  <h3>アプリを選択</h3>
                  <p>ファイル選択から、起動したいアプリの実行ファイルを選びます。</p>
                  <Button onClick={selectFile}>アプリを選択</Button>
                  <div className={styles.fileTypes}>
                    <span className={styles.typeChip}>.exe</span>
                    <span className={styles.typeChip}>.app</span>
                    <span className={styles.typeChip}>その他</span>
                  </div>
                </div>
              </div>
            )}

            <div className={layout.form}>
              <div className={layout.field}>
                <label>表示名</label>
                <input
                  value={name}
                  placeholder="表示名を入力"
                  onChange={(e) => setName(e.target.value)}
                />
                <div className={layout.fieldHelp}>サイドバーや一覧に表示される名前です。</div>
              </div>

              <div className={layout.field}>
                <label>実行ファイルパス</label>
                <input
                  className={layout.readonlyInput}
                  value={executablePath}
                  placeholder="実行ファイルのパス"
                  readOnly
                />
                <div className={layout.fieldHelp}>
                  直接入力・編集はできません。
                </div>
              </div>

              <div className={layout.field}>
                <label>説明</label>
                <input
                  value={description}
                  placeholder="このツールの説明（任意）"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {!isEdit && (
                <>
                  <div className={layout.field}>
                    <label>登録先プリセット</label>
                    <select
                      value={targetPreset}
                      onChange={(e) => setTargetPreset(e.target.value)}
                    >
                      {targetPresetOptions.map((opt) => (
                        <option key={opt}>{opt}</option>
                      ))}
                    </select>
                    <div className={layout.fieldHelp}>
                      プリセットへの登録は今後のバージョンで対応予定です。
                    </div>
                  </div>

                  <div className={layout.field}>
                    <label>追加位置</label>
                    <select value={insertMode} onChange={(e) => setInsertMode(e.target.value)}>
                      {insertModeOptions.map((opt) => (
                        <option key={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={layout.bottomActions}>
              <Button onClick={() => onNavigate("main")}>キャンセル</Button>
              <Button variant="primary" disabled={saving} onClick={handleSave}>
                {isEdit ? "保存する" : "保存して追加"}
              </Button>
            </div>
          </div>
        </section>

        <PreviewCard
          title={isEdit ? "編集後プレビュー" : "ツール追加後プレビュー"}
          rows={previewRows}
          help={
            isEdit
              ? undefined
              : "起動順や並行起動はあとからプリセット編集画面で変更できます。"
          }
        />
      </div>
    </>
  );
}
