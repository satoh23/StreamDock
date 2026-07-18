import { UnauthorizedRequestError } from "@comment-dock/auth";

const GRPC_UNAUTHENTICATED_CODE = 16;

export const isUnauthorizedRequestError = (
  error: unknown,
): error is UnauthorizedRequestError =>
  error instanceof UnauthorizedRequestError;

export const isGrpcUnauthenticatedError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return (
    code === GRPC_UNAUTHENTICATED_CODE || /UNAUTHENTICATED/i.test(error.message)
  );
};
