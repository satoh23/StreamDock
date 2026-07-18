import type { StreamingSessionSnapshot } from "@comment-dock/shared";

export type SessionStateOutputEvent = StreamingSessionSnapshot;

export interface SessionStateOutputPort {
  publishSessionState(event: SessionStateOutputEvent): Promise<void>;
}
