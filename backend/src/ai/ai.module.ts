import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { GroqProvider } from "./groq.provider";

export const AI_PROVIDER = "AI_PROVIDER";

@Module({
  imports: [ConfigModule],
  providers: [
    GroqProvider,
    {
      provide: AI_PROVIDER,
      // Provider selection is a single switch here. Adding self-hosted.provider.ts
      // (Phase 3) means implementing AiProvider once and adding one case below --
      // nothing in worker/build-failure.processor.ts changes.
      useFactory: (config: ConfigService, groq: GroqProvider) => {
        const selected = config.get<string>("AI_PROVIDER") ?? "groq";
        switch (selected) {
          case "groq":
          default:
            return groq;
        }
      },
      inject: [ConfigService, GroqProvider],
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
