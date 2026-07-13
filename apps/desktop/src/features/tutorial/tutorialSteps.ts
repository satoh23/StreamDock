import type { Screen } from "../../types";

/**
 * 027 First-Run Tutorial の 16 ステップ静的定義。
 *
 * mode:
 * - "dialog"          … 画面中央・全面ディム・「次へ」で進む。
 * - "spotlight-info"  … 対象を穴あきで明るくし吹き出し＋「次へ」。対象クリックは不可。
 * - "spotlight-action"… 対象を明るくしクリック可・ボタン非表示。対象操作 or 状態変化で進む。
 *
 * advanceOn:
 * - next             … 吹き出しの「次へ」ボタン（dialog / spotlight-info）。
 * - target-click     … 特定要素クリックで進む（clickId 省略時は targetId）。実操作を兼ねる。
 * - screen           … App から渡る screen が一致したら進む（画面遷移で進行）。
 * - tools-increased  … tools.length がステップ開始時より増えたら進む（ツール作成）。
 * - presets-increased… presets.length が増えたら進む（プリセット作成）。
 */
export type StepMode = "dialog" | "spotlight-info" | "spotlight-action";

export type AdvanceOn =
  | { kind: "next" }
  | { kind: "target-click"; clickId?: string }
  // 指定 data-tutorial-id 要素が DOM に現れたら進む（例: プリセット Step1→Step2 の遷移＝
  // バリデーション通過を要素出現で検知。クリックだけでは進めない）。
  | { kind: "target-appears"; appearId: string }
  | { kind: "screen"; screen: Screen }
  | { kind: "tools-increased" }
  | { kind: "presets-increased" };

export interface TutorialStep {
  id: string;
  mode: StepMode;
  /** スポットライトの穴を開ける対象の data-tutorial-id（dialog では省略）。 */
  targetId?: string;
  title?: string;
  body: string;
  advanceOn: AdvanceOn;
  /** true のときチュートリアル中はキャンセルボタンを無効化する（唯一の挙動変更点）。 */
  lockCancel?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    mode: "dialog",
    title: "StreamDock へようこそ！",
    body: "配信のツール準備をまとめて楽にするアプリです。かんたんな使い方を一緒に見ていきましょう。",
    advanceOn: { kind: "next" },
  },
  {
    id: "intro",
    mode: "dialog",
    title: "このアプリでできること",
    body: "配信者向けに、複数のツールを『プリセット』としてまとめ、ワンクリックで一括起動できます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "header-sections",
    mode: "spotlight-info",
    targetId: "header-sections",
    title: "上部メニュー",
    body: "左から『ツール管理』（今ここ）、『らくらくツール設定』『OBSエフェクト』が並びます。後ろ2つは準備中で、今後のアップデートで機能が追加されます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "enter-tools",
    mode: "spotlight-action",
    targetId: "header-section-tools",
    title: "ツール管理を始めましょう",
    body: "まずは『ツール管理』から。ここをクリックして進みます。",
    advanceOn: { kind: "target-click" },
  },
  {
    id: "open-add-tool",
    mode: "spotlight-action",
    targetId: "sidebar-add-tool",
    title: "ツールを登録する",
    body: "サイドバーの『＋ ツールを登録』を押して、最初のツールを登録しましょう。",
    advanceOn: { kind: "screen", screen: "add-tool" },
  },
  {
    id: "tool-kind",
    mode: "spotlight-info",
    targetId: "add-tool-kind-toggle",
    title: "アプリ / URL を選べます",
    body: "PC のアプリだけでなく、URL を登録してブラウザで開くツールも作れます。今回は『アプリ』で進めます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "create-tool",
    mode: "spotlight-action",
    targetId: "add-tool-panel",
    title: "ツールを作成しましょう",
    body: "『アプリを選択』でファイルを選び、表示名を確認して『保存して追加』を押してください。作成すると次へ進みます。",
    advanceOn: { kind: "tools-increased" },
    lockCancel: true,
  },
  {
    id: "open-add-preset",
    mode: "spotlight-action",
    targetId: "sidebar-add-preset",
    title: "ツールを登録できました！",
    body: "次は配信プリセットを作ります。サイドバーの『＋ プリセットを登録』を押してください。",
    advanceOn: { kind: "screen", screen: "add-preset" },
  },
  {
    id: "preset-intro",
    mode: "spotlight-info",
    targetId: "add-preset-panel",
    title: "配信プリセット",
    body: "用途ごとに複数登録でき、個別起動・一括起動・PC起動時の自動起動に対応します。作成後もサイドバーから編集できます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "preset-step1",
    mode: "spotlight-action",
    targetId: "add-preset-panel",
    title: "使うツールを選ぶ",
    body: "プリセット名を入力し、先ほど登録したツールにチェックを入れてから『次へ』を押してください。",
    // 「次へ」クリックそのものではなく、Step2（起動リスト）が実際に現れたら進む
    // ＝バリデーション失敗（名前/ツール未設定）でエラー表示のときは進めない。
    advanceOn: { kind: "target-appears", appearId: "add-preset-launch-list" },
    lockCancel: true,
  },
  {
    id: "preset-step2-info",
    mode: "spotlight-info",
    targetId: "add-preset-launch-list",
    title: "起動設定",
    body: "番号付きは順番に、『並行』はまとめて起動します。↑↓ で並び順も変えられます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "preset-save",
    mode: "spotlight-action",
    targetId: "add-preset-submit",
    title: "プリセットを作成",
    body: "『保存して作成』を押してプリセットを完成させましょう。",
    advanceOn: { kind: "presets-increased" },
  },
  {
    id: "main-intro",
    mode: "dialog",
    title: "メイン画面",
    body: "各ツールは個別に起動でき、右上の一括ボタンでまとめて起動／停止できます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "launch-all",
    mode: "spotlight-action",
    targetId: "main-launch-all",
    title: "一括起動してみましょう",
    body: "右上の『一括起動』を押すと、プリセットのツールがまとめて起動します。押してみてください。",
    advanceOn: { kind: "target-click" },
  },
  {
    id: "launched",
    mode: "dialog",
    title: "一括起動できました",
    body: "同じボタンが『一括停止』に変わり、まとめて停止もできます。",
    advanceOn: { kind: "next" },
  },
  {
    id: "done",
    mode: "dialog",
    title: "これで準備はばっちりです",
    body: "ツール登録 → プリセット作成 → 一括起動の流れを体験できました。あとは自由に使ってみてください！",
    advanceOn: { kind: "next" },
  },
];
