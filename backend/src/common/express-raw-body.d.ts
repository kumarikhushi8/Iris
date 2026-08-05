// Nest attaches the raw request body to req.rawBody when the app is
// created with `NestFactory.create(AppModule, { rawBody: true })` (see
// src/main.ts). Express's own types don't know about this field, so it's
// declared here for the webhook signature verification code to use safely.

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export {};
