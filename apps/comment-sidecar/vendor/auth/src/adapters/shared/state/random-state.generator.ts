import { randomBytes } from "node:crypto";
import "reflect-metadata";
import { injectable } from "tsyringe";
import type { StateGenerator } from "../../../usecases/interfaces/state-generator.interface.js";

@injectable()
export class RandomStateGenerator implements StateGenerator {
  generate(): string {
    return randomBytes(16).toString("hex");
  }
}
