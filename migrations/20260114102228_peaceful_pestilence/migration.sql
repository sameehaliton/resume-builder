CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`image` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT 0 NOT NULL,
	`username` text NOT NULL,
	`display_username` text NOT NULL,
	`two_factor_enabled` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	UNIQUE(`email`),
	UNIQUE(`username`),
	UNIQUE(`display_username`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	UNIQUE(`token`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text DEFAULT 'credential' NOT NULL,
	`user_id` text NOT NULL,
	`scope` text,
	`id_token` text,
	`password` text,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	UNIQUE(`identifier`)
);
--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`secret` text,
	`backup_codes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`aaguid` text,
	`public_key` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT 0 NOT NULL,
	`transports` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resume` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`tags` text NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`is_locked` integer DEFAULT 0 NOT NULL,
	`password` text,
	`data` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `resume_slug_user_id_unique` UNIQUE(`slug`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `resume_statistics` (
	`id` text PRIMARY KEY NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`downloads` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`last_downloaded_at` integer,
	`resume_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	UNIQUE(`resume_id`),
	FOREIGN KEY (`resume_id`) REFERENCES `resume`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`config_id` text NOT NULL DEFAULT 'default',
	`reference_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`rate_limit_enabled` integer DEFAULT 0 NOT NULL,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0 NOT NULL,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`permissions` text,
	`metadata` text,
	FOREIGN KEY (`reference_id`) REFERENCES `user`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_created_at_index` ON `user` (`created_at`);
--> statement-breakpoint
CREATE INDEX `session_token_user_id_index` ON `session` (`token`, `user_id`);
--> statement-breakpoint
CREATE INDEX `session_expires_at_index` ON `session` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `account_user_id_index` ON `account` (`user_id`);
--> statement-breakpoint
CREATE INDEX `two_factor_user_id_index` ON `two_factor` (`user_id`);
--> statement-breakpoint
CREATE INDEX `two_factor_secret_index` ON `two_factor` (`secret`);
--> statement-breakpoint
CREATE INDEX `passkey_user_id_index` ON `passkey` (`user_id`);
--> statement-breakpoint
CREATE INDEX `resume_user_id_index` ON `resume` (`user_id`);
--> statement-breakpoint
CREATE INDEX `resume_created_at_index` ON `resume` (`created_at`);
--> statement-breakpoint
CREATE INDEX `resume_user_id_updated_at_index` ON `resume` (`user_id`, `updated_at`);
--> statement-breakpoint
CREATE INDEX `resume_is_public_slug_user_id_index` ON `resume` (`is_public`, `slug`, `user_id`);
--> statement-breakpoint
CREATE INDEX `apikey_user_id_index` ON `apikey` (`reference_id`);
--> statement-breakpoint
CREATE INDEX `apikey_key_index` ON `apikey` (`key`);
--> statement-breakpoint
CREATE INDEX `apikey_enabled_user_id_index` ON `apikey` (`enabled`, `reference_id`);
