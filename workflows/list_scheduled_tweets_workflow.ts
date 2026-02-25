import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { ListScheduledTweetsFunctionDefinition } from "../functions/list_scheduled_tweets_function.ts";

const ListScheduledTweetsWorkflow = DefineWorkflow({
  callback_id: "list_scheduled_tweets_workflow",
  title: "List Scheduled Tweets Workflow",
  description: "List and manage scheduled tweet posts",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
      user_id: {
        type: Schema.slack.types.user_id,
      },
    },
    required: ["interactivity", "channel_id", "user_id"],
  },
});

ListScheduledTweetsWorkflow.addStep(ListScheduledTweetsFunctionDefinition, {
  channel_id: ListScheduledTweetsWorkflow.inputs.channel_id,
  user_id: ListScheduledTweetsWorkflow.inputs.user_id,
});

export default ListScheduledTweetsWorkflow;
