import { Module } from "@nestjs/common";
import { LogNormalizationService } from "./log-normalization.service";
import { StructuralRetrievalService } from "./structural-retrieval.service";
import { InfraClassifierService } from "./infra-classifier.service";
import { EmbeddingService } from "./embedding.service";

@Module({
  providers: [LogNormalizationService, StructuralRetrievalService, InfraClassifierService, EmbeddingService],
  exports: [LogNormalizationService, StructuralRetrievalService, InfraClassifierService, EmbeddingService],
})
export class RetrievalModule {}