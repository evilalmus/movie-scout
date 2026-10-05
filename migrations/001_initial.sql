CREATE TABLE `jobs` (
	`movie_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`error` text,
	`updated_at` integer NOT NULL
);

CREATE INDEX `idx_jobs_status_next_attempt` ON `jobs` (`status`,`next_attempt`);
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE INDEX `idx_movies_title` ON `movies` (`title`);
CREATE TABLE `runs` (
	`day` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`ids` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
