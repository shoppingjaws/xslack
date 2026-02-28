import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const PendingApprovalsDatastore = DefineDatastore({
  name: "pending_approvals",
  primary_key: "id",
  attributes: {
    id: {
      type: Schema.types.string,
    },
    channel_id: {
      type: Schema.types.string,
    },
    message_ts: {
      type: Schema.types.string,
    },
    draft_text: {
      type: Schema.types.string,
    },
    author_user_id: {
      type: Schema.types.string,
    },
    scheduled_date: {
      type: Schema.types.string,
    },
    scheduled_time: {
      type: Schema.types.string,
    },
    image_file_ids: {
      type: Schema.types.string,
    },
    created_at: {
      type: Schema.types.number,
    },
  },
});
