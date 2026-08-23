import { Controller, Post } from "@nestjs/common";
import { EvaluationRunnerService } from "./evaluation-runner.service";

@Controller("evaluation")
export class EvaluationController {
  constructor(private readonly runner: EvaluationRunnerService) {}

  @Post("run")
  run() {
    return this.runner.runAll();
  }
}