import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { PostScheduledTweetFunctionDefinition } from "../functions/post_scheduled_tweet_function.ts";

const PostScheduledTweetWorkflow = DefineWorkflow({
  callback_id: "post_scheduled_tweet_workflow",
  title: "Post Scheduled Tweet Workflow",
  description: "Posts a tweet at a scheduled time after approval",
  input_parameters: {
    properties: {
      draft_text: {
        type: Schema.types.string,
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
      author_user_id: {
        type: Schema.slack.types.user_id,
      },
      message_ts: {
        type: Schema.types.string,
      },
      image_file_ids: {
        type: Schema.types.string,
      },
    },
    required: ["draft_text", "channel_id", "author_user_id", "message_ts"],
  },
});

PostScheduledTweetWorkflow.addStep(PostScheduledTweetFunctionDefinition, {
  draft_text: PostScheduledTweetWorkflow.inputs.draft_text,
  channel_id: PostScheduledTweetWorkflow.inputs.channel_id,
  author_user_id: PostScheduledTweetWorkflow.inputs.author_user_id,
  message_ts: PostScheduledTweetWorkflow.inputs.message_ts,
  image_file_ids: PostScheduledTweetWorkflow.inputs.image_file_ids,
});

export default PostScheduledTweetWorkflow;
