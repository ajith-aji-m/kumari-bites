ALTER TABLE `categories` MODIFY COLUMN `image_url` text;
--> statement-breakpoint
ALTER TABLE `menu_items` MODIFY COLUMN `image_url` text;
--> statement-breakpoint
ALTER TABLE `menu_items` ADD COLUMN `stock_quantity` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `menu_items` ADD COLUMN `low_stock_threshold` int NOT NULL DEFAULT 5;
--> statement-breakpoint
ALTER TABLE `menu_items` ADD COLUMN `low_stock_alert_enabled` boolean NOT NULL DEFAULT true;
--> statement-breakpoint
UPDATE `menu_items` SET `low_stock_alert_enabled` = false WHERE `is_available` = true;
