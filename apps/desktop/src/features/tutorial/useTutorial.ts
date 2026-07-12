import { createContext, useContext } from "react";
import type { TutorialStep } from "./tutorialSteps";

/**
 * 027 First-Run Tutorial の薄い Context。
 * Provider（TutorialProvider）が値を供給し、Overlay と各画面（キャンセル無効化）が購読する。
 */
export interface TutorialContextValue {
  /** ツアー表示中か。 */
  active: boolean;
  /** 現在のステップ（非アクティブ時は null）。 */
  currentStep: TutorialStep | null;
  /** 現在のステップ番号（0 始まり）。 */
  stepIndex: number;
  /** 次のステップへ進む（末尾を超えたら終了）。 */
  advance: () => void;
  /** ツアーを即終了する（完了フラグは開始時に記録済み）。 */
  skip: () => void;
  /** 現在ステップがキャンセル無効化対象か（唯一の挙動変更点）。 */
  isCancelLockedByTutorial: () => boolean;
}

/** 既定値。Provider の外で参照しても no-op で安全に動く。 */
const DEFAULT_VALUE: TutorialContextValue = {
  active: false,
  currentStep: null,
  stepIndex: 0,
  advance: () => {},
  skip: () => {},
  isCancelLockedByTutorial: () => false,
};

export const TutorialContext =
  createContext<TutorialContextValue>(DEFAULT_VALUE);

/** チュートリアル Context を購読する。Provider 未設置でも既定値で安全。 */
export function useTutorial(): TutorialContextValue {
  return useContext(TutorialContext);
}
