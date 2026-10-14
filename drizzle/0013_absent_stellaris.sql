CREATE TABLE "result_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"notice_version" text NOT NULL,
	"stars" smallint NOT NULL,
	"comment" text,
	"locale" text NOT NULL,
	"engine_version" text NOT NULL,
	"hand_size" text,
	"hand_width" text,
	"grip" "grip_style" NOT NULL,
	"calibration_method" text NOT NULL,
	"palm_thickness_stated" text,
	"top_mice" jsonb NOT NULL,
	"created_on" timestamp with time zone NOT NULL,
	CONSTRAINT "result_feedback_notice_version_set" CHECK (char_length("result_feedback"."notice_version") BETWEEN 1 AND 100),
	CONSTRAINT "result_feedback_stars_range" CHECK ("result_feedback"."stars" BETWEEN 1 AND 5),
	CONSTRAINT "result_feedback_comment_length" CHECK ("result_feedback"."comment" IS NULL OR char_length("result_feedback"."comment") BETWEEN 1 AND 500),
	CONSTRAINT "result_feedback_created_on_a_day" CHECK (("result_feedback"."created_on" AT TIME ZONE 'UTC') = date_trunc('day', "result_feedback"."created_on" AT TIME ZONE 'UTC')),
	CONSTRAINT "result_feedback_top_mice_array" CHECK (jsonb_typeof("result_feedback"."top_mice") = 'array')
);
--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "result_feedback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "result_feedback" ADD CONSTRAINT "result_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "result_feedback_user_id_idx" ON "result_feedback" USING btree ("user_id");