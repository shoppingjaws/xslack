import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

export const ActiveListMessagesDatastore = DefineDatastore({
  name: "active_list_messages",
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
    expire_ts: {
      type: Schema.types.number,
    },
  },
});
