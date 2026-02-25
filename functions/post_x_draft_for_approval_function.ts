import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { SlackAPI } from "deno-slack-api/mod.ts";
import { createSlackLogger } from "./libs/logger.ts";
import { postTweet } from "./libs/x_api_client.ts";

const APPROVE_ACTION_ID = "x_draft_approve";
const REJECT_ACTION_ID = "x_draft_reject";

/**
 * Read env var: prefer OS env (set by `op run`) over SDK `env` param (raw .env text).
 */
// deno-lint-ignore no-explicit-any
function getEnv(env: Record<string, any>, key: string): string {
  return Deno.env.get(key) ?? env[key] ?? "";
}

export const PostXDraftForApprovalFunctionDefinition = DefineFunction({
  callback_id: "post_x_draft_for_approval",
  title: "Post X Draft for Approval",
  description:
    "Post a draft tweet to an approval channel with Approve/Reject buttons",
  source_file: "functions/post_x_draft_for_approval_function.ts",
  input_parameters: {
    properties: {
      draft_text: {
        type: Schema.types.string,
        description: "Draft tweet text (max 280 characters)",
      },
      author_user_id: {
        type: Schema.slack.types.user_id,
        description: "User who authored the draft",
      },
    },
    required: ["draft_text", "author_user_id"],
  },
  output_parameters: {
    properties: {
      status: {
        type: Schema.types.string,
        description: "Result status: approved or rejected",
      },
      tweet_id: {
        type: Schema.types.string,
        description: "Tweet ID if approved and posted",
      },
    },
    required: ["status"],
  },
});

export default SlackFunction(
  PostXDraftForApprovalFunctionDefinition,
  async ({ inputs, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);
    const approvalChannelId = getEnv(env, "X_APPROVAL_CHANNEL_ID");

    if (!approvalChannelId) {
      const msg = "X_APPROVAL_CHANNEL_ID is not set";
      await logger.error(msg);
      return { error: msg };
    }

    await logger.log("X Draft Approval - Posting approval request", {
      author: inputs.author_user_id,
      charCount: inputs.draft_text.length,
      approvalChannelId,
    });

    const charCount = inputs.draft_text.length;
    const charStatus = charCount <= 280
      ? `${charCount}/280`
      : `${charCount}/280 (over limit!)`;

    const postResult = await client.chat.postMessage({
      channel: approvalChannelId,
      text: `X投稿ドラフト by <@${inputs.author_user_id}>`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "X投稿ドラフト - 承認リクエスト",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*投稿者:* <@${inputs.author_user_id}>`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*投稿内容:*\n>>> ${inputs.draft_text}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `文字数: *${charStatus}*`,
            },
          ],
        },
        {
          type: "actions",
          block_id: "x_draft_actions",
          elements: [
            {
              type: "button",
              action_id: APPROVE_ACTION_ID,
              text: { type: "plain_text", text: "Approve" },
              style: "primary",
            },
            {
              type: "button",
              action_id: REJECT_ACTION_ID,
              text: { type: "plain_text", text: "Reject" },
              style: "danger",
            },
          ],
        },
      ],
    });

    if (!postResult.ok) {
      const msg = `Failed to post to approval channel: ${postResult.error}`;
      await logger.error(msg, { channel: approvalChannelId });
      return { error: msg };
    }

    await logger.log("Approval message posted", { ts: postResult.ts });

    return { completed: false };
  },
).addBlockActionsHandler(
  [APPROVE_ACTION_ID, REJECT_ACTION_ID],
  async ({ action, body, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);

    const executionId = body.function_data.execution_id;
    const reviewerUserId = body.user.id;
    const messageTs = body.message?.ts;
    const channelId = body.message?.channel_id ??
      getEnv(env, "X_APPROVAL_CHANNEL_ID");
    const draftText = body.function_data.inputs.draft_text;
    const authorUserId = body.function_data.inputs.author_user_id;

    if (action.action_id === APPROVE_ACTION_ID) {
      try {
        const result = await postTweet(draftText, {
          consumerKey: getEnv(env, "X_CONSUMER_KEY"),
          consumerSecret: getEnv(env, "X_CONSUMER_SECRET"),
          accessToken: getEnv(env, "X_ACCESS_TOKEN"),
          accessTokenSecret: getEnv(env, "X_ACCESS_TOKEN_SECRET"),
        });

        await logger.log("X Draft Approval - Tweet posted", {
          tweetId: result.id,
          reviewer: reviewerUserId,
        });

        if (messageTs) {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `X投稿完了: ${draftText}`,
            blocks: [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: "X投稿ドラフト - 承認済み",
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*投稿者:* <@${authorUserId}>`,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*投稿内容:*\n>>> ${draftText}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text:
                      `Approved by <@${reviewerUserId}> | Tweet ID: ${result.id}`,
                  },
                ],
              },
            ],
          });
        }

        await client.functions.completeSuccess({
          function_execution_id: executionId,
          outputs: {
            status: "approved",
            tweet_id: result.id,
          },
        });
      } catch (error) {
        await logger.error("X Draft Approval - Tweet post failed", error);

        if (messageTs) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: messageTs,
            text: `X投稿に失敗しました: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }

        await client.functions.completeError({
          function_execution_id: executionId,
          error: `Tweet post failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    } else {
      await logger.log("X Draft Approval - Rejected", {
        reviewer: reviewerUserId,
      });

      if (messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `X投稿却下: ${draftText}`,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "X投稿ドラフト - 却下",
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*投稿者:* <@${authorUserId}>`,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*投稿内容:*\n>>> ${draftText}`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Rejected by <@${reviewerUserId}>`,
                },
              ],
            },
          ],
        });
      }

      await client.functions.completeSuccess({
        function_execution_id: executionId,
        outputs: {
          status: "rejected",
          tweet_id: "",
        },
      });
    }
  },
);
