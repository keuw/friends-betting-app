CREATE TABLE `notion_bet_exports` (
	`bet_id` text PRIMARY KEY NOT NULL,
	`notion_page_id` text,
	`payload_hash` text,
	`last_exported_at` text,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notion_bet_exports_page_unique` ON `notion_bet_exports` (`notion_page_id`) WHERE "notion_bet_exports"."notion_page_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `notion_export_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`lease_expires_at` text NOT NULL,
	`scanned_count` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`unchanged_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	CONSTRAINT "notion_export_runs_status_check" CHECK("notion_export_runs"."status" IN ('running', 'succeeded', 'partial', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notion_export_runs_one_running` ON `notion_export_runs` (`status`) WHERE "notion_export_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `notion_export_runs_started_idx` ON `notion_export_runs` (`started_at`);