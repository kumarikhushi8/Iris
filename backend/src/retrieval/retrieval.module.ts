import { Module } from "@nestjs/common";
import { LogNormalizationService } from "./log-normalization.service";
import { StructuralRetrievalService } from "./structural-retrieval.service";

@Module({
  providers: [LogNormalizationService, StructuralRetrievalService],
  exports: [LogNormalizationService, StructuralRetrievalService],
})
export class RetrievalModule {}