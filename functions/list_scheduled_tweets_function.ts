import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { SlackAPI } from "deno-slack-api/mod.ts";
import { createSlackLogger } from "./libs/logger.ts";

const CANCEL_ACTION_ID = "cancel_scheduled_tweet";

// deno-lint-ignore no-explicit-any
function getEnv(env: Record<string, any>, key: string): string {
  return Deno.env.get(key) ?? env[key] ?? "";
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
            text: `投稿者: ${authorUserId ? `<@${authorUserId}>` : "不明"} | 予約日時: ${scheduleDisplay} (JST)`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
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
    const channelId = body.message?.channel_id ??
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
);
