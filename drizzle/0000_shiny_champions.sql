CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`maker_user_id` text NOT NULL,
	`taker_user_id` text NOT NULL,
	`maker_risk_cents` integer NOT NULL,
	`taker_risk_cents` integer NOT NULL,
	`accepted_counter_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`accepted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`maker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bets_status_check" CHECK("bets"."status" IN ('pending', 'maker_won', 'taker_won', 'void')),
	CONSTRAINT "bets_participants_check" CHECK("bets"."maker_user_id" <> "bets"."taker_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bets_offer_unique` ON `bets` (`offer_id`);--> statement-breakpoint
CREATE INDEX `bets_maker_idx` ON `bets` (`maker_user_id`,`accepted_at`);--> statement-breakpoint
CREATE INDEX `bets_taker_idx` ON `bets` (`taker_user_id`,`accepted_at`);--> statement-breakpoint
CREATE INDEX `bets_status_idx` ON `bets` (`status`);--> statement-breakpoint
CREATE TABLE `counteroffers` (
	`id` text PRIMARY KEY NOT NULL,
	`root_offer_id` text NOT NULL,
	`parent_counter_id` text,
	`challenger_user_id` text NOT NULL,
	`proposer_user_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`maker_risk_cents` integer NOT NULL,
	`taker_risk_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`root_offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`challenger_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "counteroffers_status_check" CHECK("counteroffers"."status" IN ('pending', 'accepted', 'superseded')),
	CONSTRAINT "counteroffers_participants_check" CHECK("counteroffers"."proposer_user_id" <> "counteroffers"."recipient_user_id"),
	CONSTRAINT "counteroffers_maker_risk_check" CHECK("counteroffers"."maker_risk_cents" > 0),
	CONSTRAINT "counteroffers_taker_risk_check" CHECK("counteroffers"."taker_risk_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `counteroffers_root_created_idx` ON `counteroffers` (`root_offer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `counteroffers_recipient_idx` ON `counteroffers` (`recipient_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`bet_id` text NOT NULL,
	`debtor_user_id` text NOT NULL,
	`creditor_user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debtor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creditor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "debts_amount_check" CHECK("debts"."amount_cents" > 0),
	CONSTRAINT "debts_participants_check" CHECK("debts"."debtor_user_id" <> "debts"."creditor_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `debts_bet_unique` ON `debts` (`bet_id`);--> statement-breakpoint
CREATE INDEX `debts_debtor_creditor_idx` ON `debts` (`debtor_user_id`,`creditor_user_id`);--> statement-breakpoint
CREATE TABLE `markets` (
	`id` text PRIMARY KEY NOT NULL,
	`question` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`selection_a` text NOT NULL,
	`selection_b` text NOT NULL,
	`closes_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`winning_selection` text,
	`creator_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`creator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "markets_status_check" CHECK("markets"."status" IN ('open', 'resolved', 'void')),
	CONSTRAINT "markets_winning_selection_check" CHECK("markets"."winning_selection" IS NULL OR "markets"."winning_selection" IN ('a', 'b'))
);
--> statement-breakpoint
CREATE INDEX `markets_status_closes_idx` ON `markets` (`status`,`closes_at`);--> statement-breakpoint
CREATE INDEX `markets_creator_idx` ON `markets` (`creator_user_id`);--> statement-breakpoint
CREATE TABLE `offer_legs` (
	`id` text PRIMARY KEY NOT NULL,
	`offer_id` text NOT NULL,
	`market_id` text NOT NULL,
	`maker_selection` text NOT NULL,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "offer_legs_selection_check" CHECK("offer_legs"."maker_selection" IN ('a', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offer_legs_offer_market_unique` ON `offer_legs` (`offer_id`,`market_id`);--> statement-breakpoint
CREATE INDEX `offer_legs_market_idx` ON `offer_legs` (`market_id`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`maker_user_id` text NOT NULL,
	`maker_risk_cents` integer NOT NULL,
	`taker_risk_cents` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`accepted_by_user_id` text,
	`accepted_counter_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text,
	`accepted_at` text,
	FOREIGN KEY (`maker_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "offers_status_check" CHECK("offers"."status" IN ('open', 'accepted', 'cancelled', 'expired')),
	CONSTRAINT "offers_maker_risk_check" CHECK("offers"."maker_risk_cents" > 0),
	CONSTRAINT "offers_taker_risk_check" CHECK("offers"."taker_risk_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `offers_status_created_idx` ON `offers` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `offers_maker_idx` ON `offers` (`maker_user_id`);--> statement-breakpoint
CREATE TABLE `offline_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`debtor_user_id` text NOT NULL,
	`creditor_user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`proposed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text,
	FOREIGN KEY (`debtor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`creditor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlements_status_check" CHECK("offline_settlements"."status" IN ('pending', 'confirmed', 'rejected', 'cancelled')),
	CONSTRAINT "settlements_amount_check" CHECK("offline_settlements"."amount_cents" > 0),
	CONSTRAINT "settlements_participants_check" CHECK("offline_settlements"."debtor_user_id" <> "offline_settlements"."creditor_user_id")
);
--> statement-breakpoint
CREATE INDEX `settlements_pair_status_idx` ON `offline_settlements` (`debtor_user_id`,`creditor_user_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);