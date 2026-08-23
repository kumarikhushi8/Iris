import { Module } from "@nestjs/common";
import { EvaluationController } from "./evaluation.controller";
import { EvaluationRunnerService } from "./evaluation-runner.service";

@Module({
  controllers: [EvaluationController],
  providers: [EvaluationRunnerService],
})
export class EvaluationModule {}