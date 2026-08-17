import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { WorkerModule } from "./worker.module";

// Runs as its own process (`npm run start:worker`), separate from the API
// server started in src/main.ts -- this is what "asynchronous processing"
// (FR-5) means concretely: the webhook receiver never does this work inline.
async function bootstrap() {
  process.on("unhandledRejection", (reason) => {
    Logger.error(`Unhandled rejection in worker process: ${reason}`, undefined, "Bootstrap");
  });

  const app = await NestFactory.createApplicationContext(WorkerModule);
  Logger.log("Iris worker started, listening for build-failure jobs", "Bootstrap");
  await app.init();
}

bootstrap();
