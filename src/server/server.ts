import { buildApp } from "./app.js";
import { env } from "../config/env.js";
import { getWhatsAppService, restoreWhatsAppOnBoot } from "../whatsapp/service.js";

const app = buildApp();

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

// Resume a linked WhatsApp session in the background; the HTTP server is already serving.
restoreWhatsAppOnBoot(app.log).catch((error) => app.log.error({ err: (error as Error).message }, "WhatsApp restore failed"));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    // Close the socket without unlinking, so the session restores on the next start.
    await getWhatsAppService(app.log).transport.stop().catch(() => {});
    await app.close();
    process.exit(0);
  });
}
