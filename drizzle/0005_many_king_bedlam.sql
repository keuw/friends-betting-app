ALTER TABLE `offer_legs` ADD `original_market_revision_id` text REFERENCES market_revisions(id);--> statement-breakpoint
UPDATE `offer_legs`
SET `original_market_revision_id` = `market_revision_id`
WHERE `original_market_revision_id` IS NULL;
