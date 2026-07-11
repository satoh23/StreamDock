import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Screen } from "../../types";
import type { ToolKind, ToolRecord } from "../../features/tools/types";
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

/**
 * 023: URL が http/https スキームか（frontend の事前バリデーション）。
 * Rust 側でも `validate_http_url` で必ず再検証する（多層防御）。
 */
function isValidHttpUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
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
  // 023: ツール種別（アプリ = executable / URL = url）。
  const [kind, setKind] = useState<ToolKind>("executable");
  const [executablePath, setExecutablePath] = useState("");
  // 023: url 種別で開く URL（http/https）。
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  // 018: 選択時に一度だけ抽出した実アイコン（base64 PNG, `data:` 無し）。抽出不可なら null。
  const [iconPng, setIconPng] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 編集画面 / 新規画面 いずれもフォーム初期値を editingTool に同期する
  useEffect(() => {
    setName(editingTool?.name ?? "");
    setKind(editingTool?.kind ?? "executable");
    setExecutablePath(editingTool?.executablePath ?? "");
    setUrl(editingTool?.url ?? "");
    setDescription(editingTool?.description ?? "");
    setIconPng(editingTool?.iconPng ?? null);
    setError(null);
  }, [editingTool]);

  const isUrlKind = kind === "url";

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
    // 023: url 種別は http/https のみ許可（Rust 側でも再検証されるが、無駄な往復を避け即時にエラー表示）。
    if (isUrlKind && !isValidHttpUrl(url)) {
      setError("URL は http:// または https:// で始まる必要があります");
      return;
    }
    setSaving(true);
    try {
      // 023: 種別に応じて payload を構成する。
      // - executable: 従来どおり executablePath ＋抽出アイコン。
      // - url: URL を含め、executablePath は空文字（アイコンは文字ラベルにフォールバック）。
      const input = {
        name,
        kind,
        executablePath: isUrlKind ? "" : executablePath,
        url: isUrlKind ? url.trim() : undefined,
        description,
        // 018: 抽出済みアイコンを保存する（無ければ省略し、DB では null のまま）。
        iconPng: isUrlKind ? undefined : iconPng ?? undefined,
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
  // 023: url 種別は実アイコン抽出をしないため文字ラベルにフォールバックする。
  const previewIconSrc = isUrlKind ? null : iconDataUri(iconPng);

  const previewRows: PreviewRowData[] = [
    {
      key: "__preview__",
      orderLabel: "1",
      iconLetter: previewIcon,
      iconSrc: previewIconSrc,
      name: name || "（表示名未入力）",
      description: description || (isUrlKind ? url : executablePath) || "説明未入力",
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
            <h3>{isUrlKind ? "URL を入力" : "アプリを選択"}</h3>
            <p>
              {isUrlKind
                ? "ブラウザで開くサイトの URL（http / https）を登録します。"
                : "起動したいアプリの実行ファイルを選びます。"}
            </p>
          </div>
          <div className={layout.panelBody}>
            {/* 023: ツール種別トグル（アプリ = 実行ファイル / URL = 既定ブラウザで開く）。 */}
            <div className={styles.kindToggle} role="tablist" aria-label="ツール種別">
              <button
                type="button"
                role="tab"
                aria-selected={!isUrlKind}
                className={`${styles.kindOption} ${!isUrlKind ? styles.kindActive : ""}`}
                onClick={() => {
                  setKind("executable");
                  setError(null);
                }}
              >
                アプリ
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isUrlKind}
                className={`${styles.kindOption} ${isUrlKind ? styles.kindActive : ""}`}
                onClick={() => {
                  setKind("url");
                  setError(null);
                }}
              >
                URL
              </button>
            </div>

            {isUrlKind ? (
              <div className={styles.selectedApp}>
                <div className={styles.appIcon}>{previewIcon}</div>
                <div>
                  <h3>{name || "URL ツール"}</h3>
                  <div className={styles.path}>{url || "URL 未入力"}</div>
                </div>
              </div>
            ) : hasPath ? (
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

              {isUrlKind ? (
                <div className={layout.field}>
                  <label>URL</label>
                  <input
                    className={
                      url && !isValidHttpUrl(url) ? layout.inputError : undefined
                    }
                    value={url}
                    placeholder="https://example.com"
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <div className={layout.fieldHelp}>
                    http:// または https:// で始まる URL を既定ブラウザで開きます。
                  </div>
                </div>
              ) : (
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
              )}

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
