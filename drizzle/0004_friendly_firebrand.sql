CREATE TABLE `bet_void_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`bet_id` text NOT NULL,
	`base_revision_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`recipient_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`responded_at` text,
	FOREIGN KEY (`bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_revision_id`) REFERENCES `bet_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bet_void_requests_status_check" CHECK("bet_void_requests"."status" IN ('pending', 'accepted', 'rejected', 'cancelled', 'superseded')),
	CONSTRAINT "bet_void_requests_participants_check" CHECK("bet_void_requests"."requester_user_id" <> "bet_void_requests"."recipient_user_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bet_void_requests_one_pending` ON `bet_void_requests` (`bet_id`) WHERE "bet_void_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `bet_void_requests_bet_created_idx` ON `bet_void_requests` (`bet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bet_void_requests_recipient_status_idx` ON `bet_void_requests` (`recipient_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `bet_revision_legs_market_idx` ON `bet_revision_legs` (`market_id`);