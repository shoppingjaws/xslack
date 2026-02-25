import { Trigger } from "deno-slack-api/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import ListScheduledTweetsWorkflow from "../workflows/list_scheduled_tweets_workflow.ts";

const approvalChannelId = Deno.env.get("X_APPROVAL_CHANNEL_ID");
if (!approvalChannelId) {
  throw new Error(
    "X_APPROVAL_CHANNEL_ID is not set. Required to restrict trigger to a specific channel.",
  );
}

const ListScheduledTweetsTrigger: Trigger<
  typeof ListScheduledTweetsWorkflow.definition
> = {
  type: TriggerTypes.Shortcut,
  name: "予約投稿一覧",
  description: "予約済みのX投稿を一覧表示し、キャンセルできます",
  workflow:
    `#/workflows/${ListScheduledTweetsWorkflow.definition.callback_id}`,
  channel_ids: [approvalChannelId],
  inputs: {
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
    channel_id: {
      value: TriggerContextData.Shortcut.channel_id,
    },
    user_id: {
      value: TriggerContextData.Shortcut.user_id,
    },
  },
};

export default ListScheduledTweetsTrigger;
