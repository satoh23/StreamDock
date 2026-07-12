import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Screen } from "../../types";
import { TUTORIAL_STEPS } from "./tutorialSteps";
import { isTutorialCompleted, markTutorialCompleted } from "./tutorialStorage";
import { TutorialContext, type TutorialContextValue } from "./useTutorial";

/** env 強制表示（`.env.local` の VITE_SHOW_TUTORIAL=true で完了フラグを無視し毎起動表示）。 */
const FORCE_SHOW = import.meta.env.VITE_SHOW_TUTORIAL === "true";

/**
 * 027 First-Run Tutorial の状態を供給する薄い Provider。
 *
 * - 初回判定 = env 強制 or 未完了。開始時に完了フラグを立てる（中断＝完了扱い。env 強制時は書かない）。
 * - 状態条件 advance（screen 一致 / tools・presets 件数増）は、App から渡る監視 props を
 *   見る 1 本の useEffect に集約する。各画面のハンドラは書き換えない（非破壊）。
 */
export function TutorialProvider({
  screen,
  toolsCount,
  presetsCount,
  children,
}: {
  /** 現在の画面（screen 一致 advance の監視元）。 */
  screen: Screen;
  /** 登録済みツール数（tools-increased の監視元）。 */
  toolsCount: number;
  /** 登録済みプリセット数（presets-increased の監視元）。 */
  presetsCount: number;
  children: ReactNode;
}) {
  // 初回マウント時に一度だけ表示可否を決める（以降は skip / 完了で false へ）。
  const [active, setActive] = useState<boolean>(
    () => FORCE_SHOW || !isTutorialCompleted(),
  );
  const [stepIndex, setStepIndex] = useState(0);

  // 最新の件数を非同期・effect から参照するためのミラー。
  const countsRef = useRef({ tools: toolsCount, presets: presetsCount });
  countsRef.current = { tools: toolsCount, presets: presetsCount };

  // 現在ステップ開始時点の件数（state 条件 advance の基準）。
  const baselineRef = useRef({ tools: toolsCount, presets: presetsCount });

  // 最新の stepIndex を advance のガードから同期参照するミラー。
  const stepIndexRef = useRef(0);
  stepIndexRef.current = stepIndex;

  // 直近に advance 済みのステップ index。同一ステップからの多重 advance を弾く。
  const advancedFromRef = useRef<number | null>(null);

  // 開始時に完了フラグを立てる（env 強制時は毎回表示のため書かない）。
  useEffect(() => {
    if (active && !FORCE_SHOW) markTutorialCompleted();
    // 初回マウント時の active 判定に対して一度だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentStep =
    active && stepIndex < TUTORIAL_STEPS.length
      ? TUTORIAL_STEPS[stepIndex]
      : null;

  const advance = useCallback(() => {
    const from = stepIndexRef.current;
    // 同一ステップからの二重 advance を無視してステップ飛ばしを防ぐ。
    // ステップ遷移がコミットされる前に advance() が複数回呼ばれ得るため必要:
    // target-click のダブルクリック / target-appears の MutationObserver 多重発火 /
    // screen 条件 effect の再発火。state 条件（件数増）は baselineRef でも
    // ガードされるが、本ガードで全 advance 経路を一律に冪等化する。
    // なお判定・更新は setStepIndex の updater 外で行う（StrictMode の updater
    // 二重実行に巻き込まれ from を誤って二重消費しないため）。
    if (advancedFromRef.current === from) return;
    advancedFromRef.current = from;
    // 次ステップ開始時点の件数を基準として記録する。
    baselineRef.current = {
      tools: countsRef.current.tools,
      presets: countsRef.current.presets,
    };
    const next = from + 1;
    if (next >= TUTORIAL_STEPS.length) setActive(false);
    setStepIndex(next);
  }, []);

  const skip = useCallback(() => {
    setActive(false);
  }, []);

  const isCancelLockedByTutorial = useCallback(
    () => active && currentStep?.lockCancel === true,
    [active, currentStep],
  );

  // 状態条件 advance の集約監視（screen 一致 / tools・presets 件数増）。
  // next / target-click は Overlay の UI が advance() を直接呼ぶため、ここでは扱わない。
  useEffect(() => {
    if (!active || !currentStep) return;
    const a = currentStep.advanceOn;
    if (a.kind === "screen" && screen === a.screen) {
      advance();
    } else if (
      a.kind === "tools-increased" &&
      toolsCount > baselineRef.current.tools
    ) {
      advance();
    } else if (
      a.kind === "presets-increased" &&
      presetsCount > baselineRef.current.presets
    ) {
      advance();
    }
  }, [active, currentStep, screen, toolsCount, presetsCount, advance]);

  const value = useMemo<TutorialContextValue>(
    () => ({
      active,
      currentStep,
      stepIndex,
      advance,
      skip,
      isCancelLockedByTutorial,
    }),
    [active, currentStep, stepIndex, advance, skip, isCancelLockedByTutorial],
  );

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
}
