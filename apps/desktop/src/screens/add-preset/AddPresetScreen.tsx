import { useEffect, useState } from "react";
import type { Screen } from "../../types";
import type { PresetRecord } from "../../features/presets/types";
import { createPreset, updatePreset } from "../../features/presets/presetApi";
import { toErrorMessage } from "../../features/tools/useTools";
import { Button } from "../../components/primitives";
import { PreviewCard } from "../../components/PreviewCard";
import layout from "../formLayout.module.css";

// NOTE: 005 ではプリセット名・説明のみを扱う単一フォーム。
// ツール選択・起動順・並行設定（旧2ステップUI）は 006 Preset Item Management で
// 実装する。旧実装は git 履歴に保持され、AddPresetScreen.module.css も 006 用に残置している。
export function AddPresetScreen({
  onNavigate,
  editingPreset,
  onSaved,
}: {
  onNavigate: (screen: Screen) => void;
  /** 編集対象。null なら新規作成。 */
  editingPreset?: PresetRecord | null;
  /** 保存成功後に一覧を再読み込みするコールバック。 */
  onSaved?: () => Promise<void> | void;
}) {
  const isEdit = !!editingPreset;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 編集 / 新規いずれもフォーム初期値を editingPreset に同期する
  useEffect(() => {
    setName(editingPreset?.name ?? "");
    setDescription(editingPreset?.description ?? "");
    setError(null);
  }, [editingPreset]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const input = { name, description };
      if (isEdit && editingPreset) {
        await updatePreset(editingPreset.id, input);
      } else {
        await createPreset(input);
      }
      await onSaved?.();
      onNavigate("main");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const previewName = name.trim() || "新しいプリセット";
  const previewDescription = description.trim() || undefined;

  return (
    <>
      <div className={layout.top}>
        <div className={`${layout.title} ${layout.pageTitle}`}>
          <h2>{isEdit ? "プリセットを編集" : "プリセットを追加"}</h2>
        </div>
      </div>

      <div className={layout.content}>
        <section className={layout.panel}>
          <div className={layout.panelHead}>
            <h3>プリセット情報</h3>
            <p>
              配信内容ごとのプリセットを作成します。使うツールの選択や起動順は、この後のバージョンで設定できます。
            </p>
          </div>
          <div className={layout.panelBody}>
            <div className={layout.form}>
              <div className={layout.field}>
                <label>プリセット名</label>
                <input
                  value={name}
                  placeholder="プリセット名を入力"
                  onChange={(e) => setName(e.target.value)}
                />
                <div className={layout.fieldHelp}>
                  例：通常配信、雑談用、ゲーム用、海外コメント対応など
                </div>
              </div>

              <div className={layout.field}>
                <label>説明</label>
                <input
                  value={description}
                  placeholder="このプリセットの説明（任意）"
                  onChange={(e) => setDescription(e.target.value)}
                />
                <div className={layout.fieldHelp}>
                  サイドバーや一覧の補足として使えます。未入力でも保存できます。
                </div>
              </div>
            </div>

            {error && <div className={layout.error}>{error}</div>}

            <div className={layout.bottomActions}>
              <Button onClick={() => onNavigate("main")}>キャンセル</Button>
              <Button variant="primary" disabled={saving} onClick={handleSave}>
                {isEdit ? "保存する" : "保存して作成"}
              </Button>
            </div>
          </div>
        </section>

        <PreviewCard
          title={isEdit ? "編集後プレビュー" : "プリセット作成後"}
          name={previewName}
          count={previewDescription}
          rows={[]}
          emptyMessage="使うツールは、このあとのバージョンで追加できます。"
          help="このプリセットに使うツールや起動順は、今後のバージョンで設定できます。"
        />
      </div>
    </>
  );
}
