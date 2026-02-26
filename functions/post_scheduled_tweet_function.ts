import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { SlackAPI } from "deno-slack-api/mod.ts";
import { createSlackLogger } from "./libs/logger.ts";
import { postTweet } from "./libs/x_api_client.ts";
import {
  downloadSlackFile,
  getSlackFileInfos,
  parseFileIds,
} from "./libs/slack_file_downloader.ts";
import { uploadMultipleMedia } from "./libs/x_media_upload.ts";

// deno-lint-ignore no-explicit-any
function getEnv(env: Record<string, any>, key: string): string {
  return Deno.env.get(key) ?? env[key] ?? "";
}

export const PostScheduledTweetFunctionDefinition = DefineFunction({
  callback_id: "post_scheduled_tweet",
  title: "Post Scheduled Tweet",
  description: "Post a tweet that was scheduled after approval",
  source_file: "functions/post_scheduled_tweet_function.ts",
  input_parameters: {
    properties: {
      draft_text: {
        type: Schema.types.string,
        description: "Tweet text to post",
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
        description: "Approval channel ID for status updates",
      },
      author_user_id: {
        type: Schema.slack.types.user_id,
        description: "User who authored the draft",
      },
      message_ts: {
        type: Schema.types.string,
        description: "Timestamp of the approval message for thread replies",
      },
      image_file_ids: {
        type: Schema.types.string,
        description: "Comma-separated Slack file IDs for images (max 4)",
      },
    },
    required: ["draft_text", "channel_id", "author_user_id", "message_ts"],
  },
  output_parameters: {
    properties: {
      tweet_id: {
        type: Schema.types.string,
        description: "Tweet ID if posted successfully",
      },
    },
    required: [],
  },
});

export default SlackFunction(
  PostScheduledTweetFunctionDefinition,
  async ({ inputs, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);

    await logger.log("Scheduled tweet execution started", {
      author: inputs.author_user_id,
      channel: inputs.channel_id,
    });

    try {
      const credentials = {
        consumerKey: getEnv(env, "X_CONSUMER_KEY"),
        consumerSecret: getEnv(env, "X_CONSUMER_SECRET"),
        accessToken: getEnv(env, "X_ACCESS_TOKEN"),
        accessTokenSecret: getEnv(env, "X_ACCESS_TOKEN_SECRET"),
      };

      // 画像処理
      let mediaIds: string[] | undefined;
      if (inputs.image_file_ids) {
        const fileIds = parseFileIds(inputs.image_file_ids);
        if (fileIds.length > 0) {
          const fileInfos = await getSlackFileInfos(fileIds, client);
          const images: { data: Uint8Array; mimetype: string }[] = [];
          for (const fileInfo of fileInfos) {
            const data = await downloadSlackFile(
              fileInfo.urlPrivateDownload,
              token,
            );
            images.push({ data, mimetype: fileInfo.mimetype });
          }
          mediaIds = await uploadMultipleMedia(images, credentials);
        }
      }

      const result = await postTweet(inputs.draft_text, credentials, mediaIds);

      await logger.log("Scheduled tweet posted", {
        tweetId: result.id,
        author: inputs.author_user_id,
      });

      await client.chat.postMessage({
        channel: inputs.channel_id,
        thread_ts: inputs.message_ts,
        text:
          `予約投稿が完了しました。\nTweet ID: ${result.id}\nhttps://x.com/i/status/${result.id}`,
      });

      return {
        outputs: {
          tweet_id: result.id,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logger.error("Scheduled tweet post failed", error);

      await client.chat.postMessage({
        channel: inputs.channel_id,
        thread_ts: inputs.message_ts,
        text: `予約投稿に失敗しました: ${errorMsg}`,
      });

      return { error: `Scheduled tweet failed: ${errorMsg}` };
    }
  },
);
