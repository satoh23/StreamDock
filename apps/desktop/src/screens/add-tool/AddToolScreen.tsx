import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Screen } from "../../types";
import type { ToolKind, ToolRecord } from "../../features/tools/types";
import { createTool, extractAppIcon, updateTool } from "../../features/tools/toolApi";
import { toErrorMessage } from "../../features/tools/useTools";
import { iconDataUri, toIconLetter } from "../../features/tools/display";
import {
  addToolToPreset,
  reorderPresetItems,
} from "../../features/presets/presetItemApi";
import type {
  PresetItemRecord,
  PresetRecord,
} from "../../features/presets/types";
import { Button } from "../../components/primitives";
import { PreviewCard, type PreviewRowData } from "../../components/PreviewCard";
import { useTutorial } from "../../features/tutorial/useTutorial";
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

/** 追加位置。tail=末尾追加 / head=先頭追加 / parallel=並行（順番なし・末尾）。 */
type InsertMode = "tail" | "head" | "parallel";

export function AddToolScreen({
  onNavigate,
  editingTool,
  prefillName,
  returnTo,
  onSaved,
  presets,
  presetItems,
}: {
  onNavigate: (screen: Screen) => void;
  /** 編集対象。null なら新規登録。 */
  editingTool?: ToolRecord | null;
  /** 新規登録時の表示名プリフィル（らくらく画面「ツール管理へ追加」から。パスは選択ダイアログのまま）。 */
  prefillName?: string | null;
  /** 保存/キャンセル後の戻り先（既定 main。らくらく画面から来たときは rakuraku-tools）。 */
  returnTo?: Screen;
  /** 保存成功後に一覧を再読み込みするコールバック。 */
  onSaved?: () => Promise<void> | void;
  /** 登録先プリセットの選択肢（登録済みプリセットの実データ）。 */
  presets: PresetRecord[];
  /** 「先頭に追加」時の並べ替えに使う既存 PresetItem 一覧（App が保持）。 */
  presetItems: PresetItemRecord[];
}) {
  const isEdit = !!editingTool;
  const { isCancelLockedByTutorial } = useTutorial();

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

  // 編集画面 / 新規画面 いずれもフォーム初期値を editingTool に同期する。新規登録は prefillName を
  // 表示名の初期値にする（未指定なら空。パスは選択ダイアログのまま＝生パス注入なし）。
  useEffect(() => {
    setName(editingTool?.name ?? prefillName ?? "");
    setKind(editingTool?.kind ?? "executable");
    setExecutablePath(editingTool?.executablePath ?? "");
    setUrl(editingTool?.url ?? "");
    setDescription(editingTool?.description ?? "");
    setIconPng(editingTool?.iconPng ?? null);
    setError(null);
  }, [editingTool, prefillName]);

  const isUrlKind = kind === "url";
  // 032c-a: 内蔵ツール（コメビュ等）の編集。コア項目（表示名/種別/id）は変更不可・実行パス/URL は持たない。
  // 説明（description）だけは通常ツールと同様に編集可のままにしている（コアではなく表示補助のため）。冪等 seed
  //   （INSERT OR IGNORE）は既存行を上書きしないので、編集した説明が再起動 seed で戻ることも無い。
  //   再検討条件: 内蔵ツールを完全不変（説明も固定）にしたい場合は、ここで description も readOnly にする。
  const isInternal = editingTool?.kind === "internal";

  // 登録先プリセット。"" はセンチネル（プリセットには追加しない）で既定値。
  const [targetPreset, setTargetPreset] = useState("");
  // 追加位置。既定は末尾追加。登録先が実プリセットのときだけ意味を持つ。
  const [insertMode, setInsertMode] = useState<InsertMode>("tail");

  const hasPresets = presets.length > 0;
  // 実プリセットを選んでいるときだけ「追加位置」を表示する。
  const isRealPreset = targetPreset !== "";

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
        const created = await createTool(input);
        // 024: 実プリセットが選ばれているときのみ、作成したツールをそのプリセットへ登録する。
        // 失敗してもツールは作成済み。二重作成を避けるためツール作成のリトライはしない。
        if (isRealPreset) {
          const launchMode = insertMode === "parallel" ? "parallel" : "ordered";
          const item = await addToolToPreset({
            presetId: targetPreset,
            toolId: created.id,
            launchMode,
          });
          // 先頭に追加：末尾採番された新 item を先頭にした全 id で並べ替える
          // （reorder は対象プリセットの全 item id を要求するため既存 id も渡す）。
          //
          // existingIds は addToolToPreset 前の props presetItems から作るため、
          // 新 item.id を含まず重複しない。件数は reorder 契約
          // （ordered_ids.len() == 対象プリセットの現行 item 数）を満たす前提で組む。
          //
          // なお existingIds は App 保持の props（本画面マウント時点のスナップショット）に
          // 依存する。add-tool は単一ユーザー・排他マウントで、表示中に preset_items を
          // 変更する経路が同時に存在しない（App の全ミューテーションは reloadPresetItems を
          // await 済み）ため、通常フローで DB と乖離＝件数不一致は発生しない。
          // 仮に乖離しても reorder が validation error を返すだけでツールは作成済み・
          // 二重作成はなく、失敗は toErrorMessage 表示に留まる（graceful）。
          // より堅牢にするなら addToolToPreset 直後に list_preset_items で取り直す手もあるが、
          // 本タスクは許可 command（create_tool / add_tool_to_preset / reorder_preset_items）に
          // 限定するスコープのため採用せず、上記の低リスク前提で現状の props 参照とする。
          if (insertMode === "head") {
            const existingIds = presetItems
              .filter((i) => i.presetId === targetPreset)
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((i) => i.id);
            await reorderPresetItems(targetPreset, [item.id, ...existingIds]);
          }
        }
      }
      await onSaved?.();
      onNavigate(returnTo ?? "main");
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
          <h2>{isEdit ? "ツールを編集" : "ツールを登録"}</h2>
        </div>
      </div>

      <div className={layout.content}>
        <section className={layout.panel} data-tutorial-id="add-tool-panel">
          <div className={layout.panelHead}>
            <h3>
              {isInternal ? "内蔵ツール" : isUrlKind ? "URL を入力" : "アプリを選択"}
            </h3>
            <p>
              {isInternal
                ? "内蔵のコメントビューアです。表示名・種別は変更できません。"
                : isUrlKind
                  ? "ブラウザで開くサイトの URL（http / https）を登録します。"
                  : "起動したいアプリの実行ファイルを選びます。"}
            </p>
          </div>
          <div className={layout.panelBody}>
            {/* 023: ツール種別トグル（アプリ = 実行ファイル / URL = 既定ブラウザで開く）。
                025: 編集時は種別切替を許さないため非表示にする（種別は editingTool.kind 固定）。 */}
            {!isEdit && (
              <div
                className={styles.kindToggle}
                role="tablist"
                aria-label="ツール種別"
                data-tutorial-id="add-tool-kind-toggle"
              >
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
            )}

            {isInternal ? (
              <div className={styles.selectedApp}>
                <div className={styles.appIcon}>🗪</div>
                <div>
                  <h3>{name || "コメントビューア"}</h3>
                  <div className={styles.path}>
                    内蔵ツール（別ウィンドウでコメントビューアを開きます）
                  </div>
                </div>
              </div>
            ) : isUrlKind ? (
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
                  className={isInternal ? layout.readonlyInput : undefined}
                  value={name}
                  placeholder="表示名を入力"
                  onChange={(e) => setName(e.target.value)}
                  readOnly={isInternal}
                />
                <div className={layout.fieldHelp}>
                  {isInternal
                    ? "内蔵ツールの表示名は変更できません。"
                    : "サイドバーや一覧に表示される名前です。"}
                </div>
              </div>

              {isInternal ? (
                <div className={layout.field}>
                  <label>種別</label>
                  <input
                    className={layout.readonlyInput}
                    value="内蔵ツール"
                    readOnly
                  />
                  <div className={layout.fieldHelp}>
                    実行ファイル・URL の設定はありません（「開く」で別ウィンドウを表示します）。
                  </div>
                </div>
              ) : isUrlKind ? (
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
                      disabled={!hasPresets}
                      onChange={(e) => setTargetPreset(e.target.value)}
                    >
                      {presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                      <option value="">プリセットには追加しない</option>
                    </select>
                    <div className={layout.fieldHelp}>
                      {hasPresets
                        ? "選んだプリセットにこのツールを登録します。"
                        : "先にプリセットを作成してください。"}
                    </div>
                  </div>

                  {isRealPreset && (
                    <div className={layout.field}>
                      <label>追加位置</label>
                      <select
                        value={insertMode}
                        onChange={(e) =>
                          setInsertMode(e.target.value as InsertMode)
                        }
                      >
                        <option value="tail">末尾に追加</option>
                        <option value="head">先頭に追加</option>
                        <option value="parallel">並行（順番なし）</option>
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={layout.bottomActions}>
              <Button
                onClick={() => onNavigate(returnTo ?? "main")}
                disabled={isCancelLockedByTutorial()}
              >
                キャンセル
              </Button>
              <Button variant="primary" disabled={saving} onClick={handleSave}>
                {isEdit ? "保存する" : "保存して追加"}
              </Button>
            </div>
          </div>
        </section>

        <PreviewCard
          title={isEdit ? "編集後プレビュー" : "ツール登録後プレビュー"}
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
