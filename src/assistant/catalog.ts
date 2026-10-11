import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { categories, menuItemPrices, menuItems } from "../db/schema.js";
import type { Catalog, CatalogItem } from "./types.js";

// Read-only adapter over the existing menu tables. The menu is small (one food truck), so tools load it
// whole and filter in memory with the pure helpers in menuQueries.ts.
export const dbCatalog: Catalog = {
  async loadItems() {
    const [itemRows, categoryRows, priceRows] = await Promise.all([
      db.select().from(menuItems).orderBy(menuItems.sortOrder, menuItems.name),
      db.select().from(categories),
      db.select().from(menuItemPrices).where(eq(menuItemPrices.isActive, true))
    ]);
    return itemRows.map((item): CatalogItem => {
      const category = categoryRows.find((row) => row.id === item.categoryId);
      const price = priceRows.find((row) => row.menuItemId === item.id);
      return {
        id: item.id,
        name: item.name,
        categoryId: item.categoryId,
        categoryName: category?.name ?? "Other",
        categoryActive: category?.isActive ?? false,
        description: item.description,
        price: price ? Number(price.price) : null,
        isVeg: item.isVeg,
        isAvailable: item.isAvailable,
        stockQuantity: item.stockQuantity,
        imageUrl: item.imageUrl
      };
    });
  },
  async loadCategories() {
    const rows = await db.select().from(categories).where(eq(categories.isActive, true)).orderBy(categories.sortOrder, categories.name);
    return rows.map((row) => ({ id: row.id, name: row.name, description: row.description }));
  }
};
