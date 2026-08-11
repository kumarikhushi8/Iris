import { Module } from "@nestjs/common";
import { LogNormalizationService } from "./log-normalization.service";

@Module({
  providers: [LogNormalizationService],
  exports: [LogNormalizationService],
})
export class RetrievalModule {}