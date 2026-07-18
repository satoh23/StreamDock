import { setTimeout as sleep } from "node:timers/promises";
import type {
  FindLiveStreamInput,
  FindLiveStreamResult,
  LiveStreamRepository,
} from "./live-stream-repository.interface.js";
import {
  getLiveStreamMaxAttempts,
  getLiveStreamPollingIntervalMs,
} from "../../infrastructure/shared/config/live-stream-detection.js";

type WaitFn = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export type FindActiveLiveStreamOptions = {
  signal?: AbortSignal;
};

export class LiveStreamNotFoundError extends Error {
  constructor() {
    super(`配信が見つかりませんでした`);
    this.name = "LiveStreamNotFoundError";
  }
}

export class DetectLiveStreamUseCase {
  constructor(
    private readonly repository: LiveStreamRepository,
    private readonly pollingIntervalMs = getLiveStreamPollingIntervalMs(),
    private readonly maxAttempts = getLiveStreamMaxAttempts(),
    // テスト時に待機処理を差し替えて高速・安定に検証できるよう注入可能にしている。
    private readonly wait: WaitFn = async (milliseconds, signal) => {
      await sleep(milliseconds, undefined, { signal });
    },
  ) {}

  async findActiveLiveStream(
    input: FindLiveStreamInput,
    options: FindActiveLiveStreamOptions = {},
  ): Promise<FindLiveStreamResult> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      options.signal?.throwIfAborted();
      const result = await this.repository.findLiveStream(input);
      if (result) return result;

      if (attempt < this.maxAttempts) {
        await this.wait(this.pollingIntervalMs, options.signal);
      }
    }

    throw new LiveStreamNotFoundError();
  }
}
