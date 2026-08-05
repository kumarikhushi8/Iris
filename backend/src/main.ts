import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true is required for GitHub webhook signature verification
  // (see webhook/webhook.controller.ts) -- Satisfies: FR-4
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  Logger.log(`Iris API listening on port ${port}`, "Bootstrap");
}

bootstrap();
