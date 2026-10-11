-- Five-status order lifecycle (same conversion as scripts/migrate-order-statuses.sql, safe to re-run).
ALTER TABLE `orders` MODIFY COLUMN `status` enum('new','confirmed','placed','preparing','ready','completed','cancelled') NOT NULL DEFAULT 'placed';
--> statement-breakpoint
UPDATE `orders` SET `status` = 'placed' WHERE `status` IN ('new','confirmed');
--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `status` enum('placed','preparing','ready','completed','cancelled') NOT NULL DEFAULT 'placed';
--> statement-breakpoint
ALTER TABLE `orders` MODIFY COLUMN `source` enum('qr','admin','walk_in','whatsapp') NOT NULL DEFAULT 'qr';
--> statement-breakpoint
ALTER TABLE `whatsapp_integrations` ADD COLUMN `display_name` varchar(120);
--> statement-breakpoint
ALTER TABLE `whatsapp_integrations` ADD COLUMN `last_error` varchar(500);
--> statement-breakpoint
CREATE TABLE `whatsapp_auth_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key_name` varchar(190) NOT NULL,
	`value_encrypted` mediumtext NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_auth_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_auth_state_key_uq` UNIQUE(`key_name`)
);
--> statement-breakpoint
CREATE TABLE `whatsapp_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chat_jid` varchar(120) NOT NULL,
	`customer_name` varchar(120),
	`customer_phone` varchar(30),
	`status` enum('active','handoff') NOT NULL DEFAULT 'active',
	`state` json,
	`greeted_at` timestamp,
	`last_message_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `whatsapp_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_conversations_chat_uq` UNIQUE(`chat_jid`)
);
--> statement-breakpoint
CREATE INDEX `whatsapp_conversations_status_idx` ON `whatsapp_conversations` (`status`);
--> statement-breakpoint
CREATE TABLE `whatsapp_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversation_id` int NOT NULL,
	`wa_message_id` varchar(128),
	`direction` enum('inbound','outbound') NOT NULL,
	`message_type` varchar(20) NOT NULL DEFAULT 'text',
	`content` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_messages_wa_id_uq` UNIQUE(`conversation_id`,`wa_message_id`)
);
--> statement-breakpoint
CREATE INDEX `whatsapp_messages_conversation_idx` ON `whatsapp_messages` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `whatsapp_order_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`idempotency_key` varchar(190) NOT NULL,
	`conversation_id` int NOT NULL,
	`order_id` int,
	`wa_message_id` varchar(128),
	`status` enum('created','handoff') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `whatsapp_order_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `whatsapp_order_requests_key_uq` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE INDEX `whatsapp_order_requests_order_idx` ON `whatsapp_order_requests` (`order_id`);
