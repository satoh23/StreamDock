import "reflect-metadata";

export { registerCommentDeliveryDependencies } from "./register-di-dependencies.js";
export { DeliverCommentsUseCase } from "./usecases/deliver-comments.usecase.js";
export { DecorationPipeline } from "./adapters/decorators/decoration-pipeline.js";
export { IdentityDecorator } from "./adapters/decorators/identity.decorator.js";
export { ConsoleCommentOutputPort } from "./adapters/output-ports/console-comment.output-port.js";
export { MultiCommentOutputPort } from "./adapters/output-ports/multi-comment.output-port.js";
export { convertCommentToViewDto } from "./adapters/presenters/converters/comment-to-view.converter.js";
export { DELIVERY_DI_TOKENS } from "./infrastructure/shared/di-tokens.js";
export type { CommentDecorator } from "./usecases/interfaces/comment-decorator.interface.js";
export type { CommentOutputPort } from "./usecases/interfaces/comment-output-port.interface.js";
