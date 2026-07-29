ALTER TABLE `bet_revisions`
ADD `maker_position` text DEFAULT 'back' NOT NULL
CHECK (`maker_position` IN ('back', 'fade'));--> statement-breakpoint
ALTER TABLE `offers`
ADD `maker_position` text DEFAULT 'back' NOT NULL
CHECK (`maker_position` IN ('back', 'fade'));
