import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";

const defaultSettings = {
  siteName: "Kumari Bites",
  siteMotto: "Good food brings people together",
  siteLogo: "",
  siteFavicon: "",
  customerLandingUrl: ""
} as const;

const settingKeys = {
  siteName: "site_name",
  siteMotto: "site_motto",
  siteLogo: "site_logo",
  siteFavicon: "site_favicon",
  customerLandingUrl: "customer_landing_url"
} as const;

const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  siteMotto: z.string().trim().max(240),
  siteLogo: z.string().max(4_500_000),
  siteFavicon: z.string().max(4_500_000),
  customerLandingUrl: z.string().trim().max(2000).refine(
    (value) => !value || (/^https?:\/\//i.test(value) && (() => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } })()),
    "Enter a valid customer landing page URL starting with http:// or https://"
  )
});

async function readSettings() {
  const rows = await db.select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.isSecret, false));
  const stored = new Map(rows.map((row) => [row.key, row.value ?? ""]));
  return {
    siteName: stored.get(settingKeys.siteName) || defaultSettings.siteName,
    siteMotto: stored.get(settingKeys.siteMotto) ?? defaultSettings.siteMotto,
    siteLogo: stored.get(settingKeys.siteLogo) ?? defaultSettings.siteLogo,
    siteFavicon: stored.get(settingKeys.siteFavicon) ?? defaultSettings.siteFavicon,
    customerLandingUrl: stored.get(settingKeys.customerLandingUrl) ?? defaultSettings.customerLandingUrl
  };
}

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/v1/public/settings", async () => {
    const settings = await readSettings();
    return {
      siteName: settings.siteName,
      siteMotto: settings.siteMotto,
      siteLogo: settings.siteLogo,
      siteFavicon: settings.siteFavicon
    };
  });

  app.get("/api/v1/settings", async (request, reply) => {
    const user = await requirePermission(request, reply, "settings.manage");
    if (!user) return;
    return readSettings();
  });

  app.put("/api/v1/settings", async (request, reply) => {
    const user = await requirePermission(request, reply, "settings.manage");
    if (!user) return;

    const input = settingsSchema.parse(request.body);
    const values = Object.entries(settingKeys).map(([field, key]) => ({
      key,
      value: input[field as keyof typeof input]
    }));

    for (const item of values) {
      const existing = (await db.select({ id: appSettings.id })
        .from(appSettings)
        .where(eq(appSettings.key, item.key))
        .limit(1))[0];
      if (existing) {
        await db.update(appSettings)
          .set({ value: item.value, isSecret: false })
          .where(eq(appSettings.id, existing.id));
      } else {
        await db.insert(appSettings).values({ key: item.key, value: item.value, isSecret: false });
      }
    }

    return { message: "Settings saved successfully", settings: await readSettings() };
  });
}
