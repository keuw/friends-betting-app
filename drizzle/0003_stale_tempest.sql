PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bet_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`bet_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`maker_risk_cents` integer NOT NULL,
	`taker_risk_cents` integer NOT NULL,
	`maker_position` text DEFAULT 'back' NOT NULL,
	`proposer_user_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`change_note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text,
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bet_revisions_status_check" CHECK("status" IN ('active', 'pending', 'rejected', 'cancelled', 'superseded')),
	CONSTRAINT "bet_revisions_participants_check" CHECK("proposer_user_id" <> "recipient_user_id"),
	CONSTRAINT "bet_revisions_maker_risk_check" CHECK("maker_risk_cents" > 0),
	CONSTRAINT "bet_revisions_taker_risk_check" CHECK("taker_risk_cents" > 0),
	CONSTRAINT "bet_revisions_maker_position_check" CHECK("maker_position" IN ('back', 'fade')),
	CONSTRAINT "bet_revisions_number_check" CHECK("revision_number" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_bet_revisions`("id", "bet_id", "revision_number", "maker_risk_cents", "taker_risk_cents", "maker_position", "proposer_user_id", "recipient_user_id", "status", "change_note", "created_at", "responded_at") SELECT "id", "bet_id", "revision_number", "maker_risk_cents", "taker_risk_cents", 'back', "proposer_user_id", "recipient_user_id", "status", "change_note", "created_at", "responded_at" FROM `bet_revisions`;--> statement-breakpoint
DROP TABLE `bet_revisions`;--> statement-breakpoint
ALTER TABLE `__new_bet_revisions` RENAME TO `bet_revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revisions_bet_number_unique` ON `bet_revisions` (`bet_id`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revisions_one_pending` ON `bet_revisions` (`bet_id`) WHERE "bet_revisions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revisions_one_active` ON `bet_revisions` (`bet_id`) WHERE "bet_revisions"."status" = 'active';--> statement-breakpoint
CREATE INDEX `bet_revisions_bet_created_idx` ON `bet_revisions` (`bet_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`maker_user_id` text NOT NULL,
	`maker_risk_cents` integer NOT NULL,
	`taker_risk_cents` integer NOT NULL,
	`maker_position` text DEFAULT 'back' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`accepted_by_user_id` text,
	`accepted_counter_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`accepted_at` text,
	FOREIGN KEY (`maker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "offers_status_check" CHECK("status" IN ('open', 'accepted', 'cancelled', 'expired')),
	CONSTRAINT "offers_maker_risk_check" CHECK("maker_risk_cents" > 0),
	CONSTRAINT "offers_taker_risk_check" CHECK("taker_risk_cents" > 0),
	CONSTRAINT "offers_maker_position_check" CHECK("maker_position" IN ('back', 'fade'))
);
--> statement-breakpoint
INSERT INTO `__new_offers`("id", "maker_user_id", "maker_risk_cents", "taker_risk_cents", "maker_position", "status", "accepted_by_user_id", "accepted_counter_id", "created_at", "expires_at", "accepted_at") SELECT "id", "maker_user_id", "maker_risk_cents", "taker_risk_cents", 'back', "status", "accepted_by_user_id", "accepted_counter_id", "created_at", "expires_at", "accepted_at" FROM `offers`;--> statement-breakpoint
DROP TABLE `offers`;--> statement-breakpoint
ALTER TABLE `__new_offers` RENAME TO `offers`;--> statement-breakpoint
CREATE INDEX `offers_status_created_idx` ON `offers` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `offers_maker_idx` ON `offers` (`maker_user_id`);
