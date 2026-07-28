CREATE TABLE `bet_revision_legs` (
	`id` text PRIMARY KEY NOT NULL,
	`bet_revision_id` text NOT NULL,
	`market_id` text NOT NULL,
	`market_revision_id` text NOT NULL,
	`maker_selection` text NOT NULL,
	FOREIGN KEY (`bet_revision_id`) REFERENCES `bet_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`market_revision_id`) REFERENCES `market_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bet_revision_legs_selection_check" CHECK("bet_revision_legs"."maker_selection" IN ('a', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revision_legs_revision_market_unique` ON `bet_revision_legs` (`bet_revision_id`,`market_id`);--> statement-breakpoint
CREATE INDEX `bet_revision_legs_market_revision_idx` ON `bet_revision_legs` (`market_revision_id`);--> statement-breakpoint
CREATE TABLE `bet_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`bet_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`maker_risk_cents` integer NOT NULL,
	`taker_risk_cents` integer NOT NULL,
	`proposer_user_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`change_note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text,
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bet_revisions_status_check" CHECK("bet_revisions"."status" IN ('active', 'pending', 'rejected', 'cancelled', 'superseded')),
	CONSTRAINT "bet_revisions_participants_check" CHECK("bet_revisions"."proposer_user_id" <> "bet_revisions"."recipient_user_id"),
	CONSTRAINT "bet_revisions_maker_risk_check" CHECK("bet_revisions"."maker_risk_cents" > 0),
	CONSTRAINT "bet_revisions_taker_risk_check" CHECK("bet_revisions"."taker_risk_cents" > 0),
	CONSTRAINT "bet_revisions_number_check" CHECK("bet_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revisions_bet_number_unique` ON `bet_revisions` (`bet_id`,`revision_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revisions_one_pending` ON `bet_revisions` (`bet_id`) WHERE "bet_revisions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `bet_revisions_one_active` ON `bet_revisions` (`bet_id`) WHERE "bet_revisions"."status" = 'active';--> statement-breakpoint
CREATE INDEX `bet_revisions_bet_created_idx` ON `bet_revisions` (`bet_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `market_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`question` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`selection_a` text NOT NULL,
	`selection_b` text NOT NULL,
	`closes_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`winning_selection` text,
	`editor_user_id` text NOT NULL,
	`change_note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`market_id`) REFERENCES `markets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`editor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "market_revisions_status_check" CHECK("market_revisions"."status" IN ('open', 'resolved', 'void')),
	CONSTRAINT "market_revisions_winning_selection_check" CHECK("market_revisions"."winning_selection" IS NULL OR "market_revisions"."winning_selection" IN ('a', 'b')),
	CONSTRAINT "market_revisions_number_check" CHECK("market_revisions"."revision_number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `market_revisions_market_number_unique` ON `market_revisions` (`market_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `market_revisions_market_created_idx` ON `market_revisions` (`market_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `market_revisions_status_closes_idx` ON `market_revisions` (`status`,`closes_at`);--> statement-breakpoint
ALTER TABLE `bets` ADD `current_revision_id` text;--> statement-breakpoint
ALTER TABLE `markets` ADD `current_revision_id` text;--> statement-breakpoint
ALTER TABLE `offer_legs` ADD `market_revision_id` text REFERENCES market_revisions(id);--> statement-breakpoint
INSERT INTO `market_revisions` (
	`id`, `market_id`, `revision_number`, `question`, `description`,
	`selection_a`, `selection_b`, `closes_at`, `status`, `winning_selection`,
	`editor_user_id`, `change_note`, `created_at`, `resolved_at`
)
SELECT
	'market-revision:' || `id`, `id`, 1, `question`, `description`,
	`selection_a`, `selection_b`, `closes_at`, `status`, `winning_selection`,
	`creator_user_id`, 'Original market terms', `created_at`, `resolved_at`
FROM `markets`;--> statement-breakpoint
UPDATE `markets`
SET `current_revision_id` = 'market-revision:' || `id`
WHERE `current_revision_id` IS NULL;--> statement-breakpoint
UPDATE `offer_legs`
SET `market_revision_id` = (
	SELECT `current_revision_id`
	FROM `markets`
	WHERE `markets`.`id` = `offer_legs`.`market_id`
)
WHERE `market_revision_id` IS NULL;--> statement-breakpoint
INSERT INTO `bet_revisions` (
	`id`, `bet_id`, `revision_number`, `maker_risk_cents`,
	`taker_risk_cents`, `proposer_user_id`, `recipient_user_id`, `status`,
	`change_note`, `created_at`, `responded_at`
)
SELECT
	'bet-revision:' || `id`, `id`, 1, `maker_risk_cents`,
	`taker_risk_cents`, `maker_user_id`, `taker_user_id`, 'active',
	'Original matched terms', `accepted_at`, `accepted_at`
FROM `bets`;--> statement-breakpoint
UPDATE `bets`
SET `current_revision_id` = 'bet-revision:' || `id`
WHERE `current_revision_id` IS NULL;--> statement-breakpoint
INSERT INTO `bet_revision_legs` (
	`id`, `bet_revision_id`, `market_id`, `market_revision_id`,
	`maker_selection`
)
SELECT
	'bet-revision-leg:' || `bets`.`id` || ':' || `offer_legs`.`market_id`,
	'bet-revision:' || `bets`.`id`,
	`offer_legs`.`market_id`,
	`offer_legs`.`market_revision_id`,
	`offer_legs`.`maker_selection`
FROM `bets`
JOIN `offer_legs` ON `offer_legs`.`offer_id` = `bets`.`offer_id`;
