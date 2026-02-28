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

const CANCEL_ACTION_ID = "cancel_scheduled_tweet";
const POST_NOW_ACTION_ID = "post_now_scheduled_tweet";

function getEnv(env: Record<string, string>, key: string): string {
  return env[key] ?? "";
}

export const ListScheduledTweetsFunctionDefinition = DefineFunction({
  callback_id: "list_scheduled_tweets",
  title: "List Scheduled Tweets",
  description: "List scheduled tweet triggers with cancel buttons",
  source_file: "functions/list_scheduled_tweets_function.ts",
  input_parameters: {
    properties: {
      channel_id: {
        type: Schema.slack.types.channel_id,
        description: "Channel to post the list in",
      },
      user_id: {
        type: Schema.slack.types.user_id,
        description: "User who invoked the command",
      },
    },
    required: ["channel_id", "user_id"],
  },
  output_parameters: {
    properties: {},
    required: [],
  },
});

// deno-lint-ignore no-explicit-any
function filterScheduledTweetTriggers(triggers: any[]): any[] {
  return triggers.filter(
    // deno-lint-ignore no-explicit-any
    (t: any) =>
      t.type === "scheduled" &&
      t.workflow?.callback_id === "post_scheduled_tweet_workflow",
  );
}

// deno-lint-ignore no-explicit-any
function buildListBlocks(triggers: any[]): any[] {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "予約投稿一覧",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `全 ${triggers.length} 件の予約投稿`,
        },
      ],
    },
    { type: "divider" },
  ];

  for (const trigger of triggers) {
    const draftText = trigger.inputs?.draft_text?.value ?? "(内容不明)";
    const authorUserId = trigger.inputs?.author_user_id?.value;
    const approvalChannelId = trigger.inputs?.channel_id?.value;
    const approvalMessageTs = trigger.inputs?.message_ts?.value;
    const scheduledAt = trigger.schedule?.start_time;

    let scheduleDisplay = "不明";
    if (scheduledAt) {
      const date = new Date(scheduledAt);
      scheduleDisplay = date.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    let approvalLink = "";
    if (approvalChannelId && approvalMessageTs) {
      const tsForUrl = approvalMessageTs.replace(".", "");
      approvalLink =
        ` | <https://slack.com/archives/${approvalChannelId}/p${tsForUrl}|承認メッセージ>`;
    }

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `>>> ${draftText}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `投稿者: ${authorUserId ? `<@${authorUserId}>` : "不明"} | 予約日時: ${scheduleDisplay} (JST)${approvalLink}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: POST_NOW_ACTION_ID,
            text: { type: "plain_text", text: "今すぐ投稿" },
            style: "primary",
            value: JSON.stringify({
              trigger_id: trigger.id,
              draft_text: trigger.inputs?.draft_text?.value,
              channel_id: trigger.inputs?.channel_id?.value,
              author_user_id: trigger.inputs?.author_user_id?.value,
              message_ts: trigger.inputs?.message_ts?.value,
              image_file_ids: trigger.inputs?.image_file_ids?.value ?? "",
            }),
            confirm: {
              title: { type: "plain_text", text: "確認" },
              text: {
                type: "plain_text",
                text: "この投稿を今すぐXに投稿しますか？",
              },
              confirm: { type: "plain_text", text: "投稿する" },
              deny: { type: "plain_text", text: "やめる" },
            },
          },
          {
            type: "button",
            action_id: CANCEL_ACTION_ID,
            text: { type: "plain_text", text: "キャンセル" },
            style: "danger",
            value: trigger.id,
          },
        ],
      },
      { type: "divider" },
    );
  }

  return blocks;
}

export default SlackFunction(
  ListScheduledTweetsFunctionDefinition,
  async ({ inputs, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);
    const channelId = inputs.channel_id ??
      getEnv(env, "X_APPROVAL_CHANNEL_ID");

    try {
      const listResult = await client.workflows.triggers.list({
        is_owner: true,
      });

      if (!listResult.ok) {
        await logger.error("Failed to list triggers", {
          error: listResult.error,
        });
        await client.chat.postMessage({
          channel: channelId,
          text: `予約投稿一覧の取得に失敗しました: ${listResult.error}`,
        });
        return { error: `Failed to list triggers: ${listResult.error}` };
      }

      const scheduledTriggers = filterScheduledTweetTriggers(
        listResult.triggers ?? [],
      );

      if (scheduledTriggers.length === 0) {
        await client.chat.postMessage({
          channel: channelId,
          text: "予約されている投稿はありません。",
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "予約投稿一覧",
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "予約されている投稿はありません。",
              },
            },
          ],
        });
        return { outputs: {} };
      }

      const blocks = buildListBlocks(scheduledTriggers);

      await client.chat.postMessage({
        channel: channelId,
        text: `予約投稿一覧（${scheduledTriggers.length}件）`,
        blocks,
        unfurl_links: false,
      });

      return { completed: false };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logger.error("List scheduled tweets failed", error);
      return { error: `List scheduled tweets failed: ${errorMsg}` };
    }
  },
).addBlockActionsHandler(
  [CANCEL_ACTION_ID],
  async ({ action, body, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);

    const executionId = body.function_data.execution_id;
    const triggerId = action.value;
    const messageTs = body.message?.ts;
    // deno-lint-ignore no-explicit-any
    const channelId = (body.message as any)?.channel_id ??
      getEnv(env, "X_APPROVAL_CHANNEL_ID");

    try {
      const deleteResult = await client.workflows.triggers.delete({
        trigger_id: triggerId,
      });

      if (!deleteResult.ok) {
        await logger.error("Failed to delete trigger", {
          triggerId,
          error: deleteResult.error,
        });
        if (messageTs) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: messageTs,
            text: `予約投稿のキャンセルに失敗しました: ${deleteResult.error}`,
          });
        }
        return;
      }

      await logger.log("Scheduled tweet cancelled", { triggerId });

      // Re-fetch remaining triggers
      const listResult = await client.workflows.triggers.list({
        is_owner: true,
      });
      const remainingTriggers = filterScheduledTweetTriggers(
        listResult.triggers ?? [],
      );

      if (remainingTriggers.length === 0) {
        // All cancelled - update message and complete
        if (messageTs) {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: "予約投稿はすべてキャンセルされました。",
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "予約投稿一覧",
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "予約投稿はすべてキャンセルされました。",
                },
              },
            ],
          });
        }

        await client.functions.completeSuccess({
          function_execution_id: executionId,
          outputs: {},
        });
      } else {
        // Still remaining - update the list
        const blocks = buildListBlocks(remainingTriggers);

        if (messageTs) {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `予約投稿一覧（${remainingTriggers.length}件）- 1件キャンセルしました`,
            blocks,
            unfurl_links: false,
          });
        }
      }
    } catch (error) {
      await logger.error("Cancel scheduled tweet failed", error);
      if (messageTs) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: `キャンセル処理中にエラーが発生しました: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
  },
).addBlockActionsHandler(
  [POST_NOW_ACTION_ID],
  async ({ action, body, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);

    const executionId = body.function_data.execution_id;
    const listMessageTs = body.message?.ts;
    // deno-lint-ignore no-explicit-any
    const listChannelId = (body.message as any)?.channel_id ??
      getEnv(env, "X_APPROVAL_CHANNEL_ID");

    let triggerData: {
      trigger_id: string;
      draft_text: string;
      channel_id: string;
      author_user_id: string;
      message_ts: string;
      image_file_ids: string;
    };

    try {
      triggerData = JSON.parse(action.value);
    } catch {
      await logger.error("Failed to parse post_now action value", {
        value: action.value,
      });
      return;
    }

    try {
      const credentials = {
        consumerKey: getEnv(env, "X_CONSUMER_KEY"),
        consumerSecret: getEnv(env, "X_CONSUMER_SECRET"),
        accessToken: getEnv(env, "X_ACCESS_TOKEN"),
        accessTokenSecret: getEnv(env, "X_ACCESS_TOKEN_SECRET"),
      };

      // 画像処理
      let mediaIds: string[] | undefined;
      if (triggerData.image_file_ids) {
        const fileIds = parseFileIds(triggerData.image_file_ids);
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

      const result = await postTweet(
        triggerData.draft_text,
        credentials,
        mediaIds,
      );

      await logger.log("Post now tweet posted", {
        tweetId: result.id,
        author: triggerData.author_user_id,
      });

      // スケジュールトリガーを削除
      await client.workflows.triggers.delete({
        trigger_id: triggerData.trigger_id,
      });

      // 元の承認メッセージスレッドに投稿完了通知
      if (triggerData.channel_id && triggerData.message_ts) {
        await client.chat.postMessage({
          channel: triggerData.channel_id,
          thread_ts: triggerData.message_ts,
          text:
            `今すぐ投稿されました。\nTweet ID: ${result.id}\nhttps://x.com/i/status/${result.id}`,
        });
      }

      // 一覧メッセージを更新
      const listResult = await client.workflows.triggers.list({
        is_owner: true,
      });
      const remainingTriggers = filterScheduledTweetTriggers(
        listResult.triggers ?? [],
      );

      if (remainingTriggers.length === 0) {
        if (listMessageTs) {
          await client.chat.update({
            channel: listChannelId,
            ts: listMessageTs,
            text: "予約投稿はすべて処理されました。",
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "予約投稿一覧",
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "予約投稿はすべて処理されました。",
                },
              },
            ],
          });
        }

        await client.functions.completeSuccess({
          function_execution_id: executionId,
          outputs: {},
        });
      } else {
        const blocks = buildListBlocks(remainingTriggers);

        if (listMessageTs) {
          await client.chat.update({
            channel: listChannelId,
            ts: listMessageTs,
            text: `予約投稿一覧（${remainingTriggers.length}件）- 1件投稿しました`,
            blocks,
            unfurl_links: false,
          });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logger.error("Post now failed", error);
      if (listMessageTs) {
        await client.chat.postMessage({
          channel: listChannelId,
          thread_ts: listMessageTs,
          text: `今すぐ投稿に失敗しました: ${errorMsg}`,
        });
      }
    }
  },
);
