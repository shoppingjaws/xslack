import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { SlackAPI } from "deno-slack-api/mod.ts";
import { TriggerTypes } from "deno-slack-api/mod.ts";
import { createSlackLogger } from "./libs/logger.ts";
import { postTweet } from "./libs/x_api_client.ts";
import {
  downloadSlackFile,
  getSlackFileInfos,
  parseFileIds,
} from "./libs/slack_file_downloader.ts";
import { uploadMultipleMedia } from "./libs/x_media_upload.ts";
import { countXCharacters } from "./libs/x_char_count.ts";
import PostScheduledTweetWorkflow from "../workflows/post_scheduled_tweet_workflow.ts";

const APPROVE_ACTION_ID = "x_draft_approve";
const REJECT_ACTION_ID = "x_draft_reject";
const VIEW_CALLBACK_ID = "x_draft_form";

interface ApprovalData {
  draft_text: string;
  scheduled_date: string;
  scheduled_time: string;
  image_file_ids: string;
}

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
    "Open a draft form with image upload, then post to an approval channel",
  source_file: "functions/post_x_draft_for_approval_function.ts",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      author_user_id: {
        type: Schema.slack.types.user_id,
        description: "User who authored the draft",
      },
    },
    required: ["interactivity", "author_user_id"],
  },
  output_parameters: {
    properties: {
      status: {
        type: Schema.types.string,
        description: "Result status: approved, scheduled, or rejected",
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
  async ({ inputs, token }) => {
    const client = SlackAPI(token);

    const viewResult = await client.views.open({
      interactivity_pointer: inputs.interactivity.interactivity_pointer,
      view: {
        type: "modal",
        callback_id: VIEW_CALLBACK_ID,
        title: { type: "plain_text", text: "X投稿ドラフト作成" },
        submit: { type: "plain_text", text: "送信" },
        blocks: [
          {
            type: "input",
            block_id: "draft_block",
            element: {
              type: "plain_text_input",
              action_id: "draft_text",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "Xに投稿するテキスト（280文字以内）",
              },
            },
            label: { type: "plain_text", text: "投稿内容" },
          },
          {
            type: "input",
            block_id: "date_block",
            element: {
              type: "datepicker",
              action_id: "scheduled_date",
              placeholder: { type: "plain_text", text: "日付を選択" },
            },
            label: { type: "plain_text", text: "予約投稿日" },
            optional: true,
          },
          {
            type: "input",
            block_id: "time_block",
            element: {
              type: "timepicker",
              action_id: "scheduled_time",
              placeholder: { type: "plain_text", text: "時刻を選択" },
            },
            label: { type: "plain_text", text: "予約投稿時刻" },
            optional: true,
          },
          {
            type: "input",
            block_id: "image_block",
            element: {
              type: "file_input",
              action_id: "image_files",
              filetypes: ["jpg", "jpeg", "png", "gif", "webp"],
              max_files: 4,
            },
            label: { type: "plain_text", text: "画像（最大4枚）" },
            optional: true,
          },
        ],
      },
    });

    if (!viewResult.ok) {
      return { error: `Failed to open form: ${viewResult.error}` };
    }

    return { completed: false };
  },
)
  .addViewSubmissionHandler(
    VIEW_CALLBACK_ID,
    // deno-lint-ignore no-explicit-any
    async ({ body, view, env, token }: any) => {
      const logger = createSlackLogger(token);
      const client = SlackAPI(token);
      const approvalChannelId = getEnv(env, "X_APPROVAL_CHANNEL_ID");
      const authorUserId = body.function_data.inputs.author_user_id;

      if (!approvalChannelId) {
        return {
          response_action: "errors",
          errors: {
            draft_block:
              "X_APPROVAL_CHANNEL_IDが設定されていません。管理者に連絡してください。",
          },
        };
      }

      // Extract form values
      const values = view.state.values;
      const draftText = values.draft_block.draft_text.value as string;
      const scheduledDate =
        (values.date_block?.scheduled_date?.selected_date as string) ?? "";
      const scheduledTime =
        (values.time_block?.scheduled_time?.selected_time as string) ?? "";
      // deno-lint-ignore no-explicit-any
      const files: any[] = values.image_block?.image_files?.files ?? [];
      const imageFileIds = files.map((f: { id: string }) => f.id).join(",");
      const imageCount = files.length;

      await logger.log("X Draft Approval - Form submitted", {
        author: authorUserId,
        charCount: countXCharacters(draftText),
        imageCount,
      });

      const charCount = countXCharacters(draftText);
      const charStatus = charCount <= 280
        ? `${charCount}/280`
        : `${charCount}/280 (over limit!)`;

      const hasSchedule = scheduledDate && scheduledTime;
      const scheduleText = hasSchedule
        ? `*予約投稿:* ${scheduledDate} ${scheduledTime} (JST)`
        : "*予約投稿:* なし（承認後に即投稿）";

      // deno-lint-ignore no-explicit-any
      const contextElements: any[] = [
        { type: "mrkdwn", text: `文字数: *${charStatus}*` },
      ];
      if (imageCount > 0) {
        contextElements.push({
          type: "mrkdwn",
          text: `添付画像: *${imageCount}枚*`,
        });
      }

      // Build approval data for button values
      const approvalData: ApprovalData = {
        draft_text: draftText,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        image_file_ids: imageFileIds,
      };
      const buttonValue = JSON.stringify(approvalData);

      const blocks = [
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
          type: "section",
          text: {
            type: "mrkdwn",
            text: scheduleText,
          },
        },
        {
          type: "context",
          elements: contextElements,
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
              value: buttonValue,
            },
            {
              type: "button",
              action_id: REJECT_ACTION_ID,
              text: { type: "plain_text", text: "Reject" },
              style: "danger",
              value: buttonValue,
            },
          ],
        },
      ];

      const postResult = await client.chat.postMessage({
        channel: approvalChannelId,
        text: `X投稿ドラフト by <@${authorUserId}>`,
        blocks,
      });

      if (!postResult.ok) {
        await logger.error("Failed to post approval message", {
          error: postResult.error,
        });
      }

      // Post image previews in thread using slack_file image blocks
      if (imageCount > 0 && postResult.ok) {
        // deno-lint-ignore no-explicit-any
        const imageBlocks = files.map((f: any) => ({
          type: "image",
          slack_file: { id: f.id },
          alt_text: f.name,
        }));
        await client.chat.postMessage({
          channel: approvalChannelId,
          thread_ts: postResult.ts,
          text: `添付画像: ${imageCount}枚`,
          blocks: imageBlocks,
        });
      }

      await logger.log("Approval message posted", { ts: postResult.ts });
    },
  )
  .addBlockActionsHandler(
    [APPROVE_ACTION_ID, REJECT_ACTION_ID],
    async ({ action, body, env, token }) => {
      const logger = createSlackLogger(token);
      const client = SlackAPI(token);

      const executionId = body.function_data.execution_id;
      const reviewerUserId = body.user.id;
      const messageTs = body.message?.ts;
      const channelId = body.message?.channel_id ??
        getEnv(env, "X_APPROVAL_CHANNEL_ID");
      const authorUserId = body.function_data.inputs.author_user_id;

      // Parse approval data from button value
      const approvalData: ApprovalData = JSON.parse(action.value);
      const {
        draft_text: draftText,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        image_file_ids: imageFileIds,
      } = approvalData;

      // 投稿者自身による承認を禁止（環境変数で制御）
      if (
        action.action_id === APPROVE_ACTION_ID &&
        getEnv(env, "X_PREVENT_SELF_APPROVE") === "true" &&
        reviewerUserId === authorUserId
      ) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: reviewerUserId,
          text: "自分が作成したドラフトを自分で承認することはできません。他のメンバーに承認を依頼してください。",
        });
        return;
      }

      if (action.action_id === APPROVE_ACTION_ID) {
        try {
          // 予約日時の判定
          let shouldSchedule = false;
          let scheduledISOString = "";

          if (scheduledDate && scheduledTime) {
            const scheduledDateTime = new Date(
              `${scheduledDate}T${scheduledTime}:00+09:00`,
            );
            const now = new Date();

            if (scheduledDateTime.getTime() > now.getTime()) {
              shouldSchedule = true;
              scheduledISOString = scheduledDateTime.toISOString();
            }
          }

          if (shouldSchedule) {
            // 予約投稿: Scheduled Trigger を作成
            await logger.log(
              "X Draft Approval - Creating scheduled trigger",
              {
                scheduledAt: scheduledISOString,
                reviewer: reviewerUserId,
              },
            );

            const triggerResult = await client.workflows.triggers.create({
              type: TriggerTypes.Scheduled,
              name: "Scheduled X Post",
              workflow:
                `#/workflows/${PostScheduledTweetWorkflow.definition.callback_id}`,
              inputs: {
                draft_text: { value: draftText },
                channel_id: { value: channelId },
                author_user_id: { value: authorUserId },
                message_ts: { value: messageTs },
                image_file_ids: { value: imageFileIds },
              },
              schedule: {
                start_time: scheduledISOString,
                frequency: { type: "once" },
              },
            });

            if (!triggerResult.ok) {
              throw new Error(
                `Failed to create scheduled trigger: ${triggerResult.error}`,
              );
            }

            await logger.log(
              "X Draft Approval - Scheduled trigger created",
              {
                triggerId: triggerResult.trigger?.id,
                scheduledAt: scheduledISOString,
              },
            );

            if (messageTs) {
              await client.chat.update({
                channel: channelId,
                ts: messageTs,
                text: `X投稿予約済み: ${draftText}`,
                blocks: [
                  {
                    type: "header",
                    text: {
                      type: "plain_text",
                      text: "X投稿ドラフト - 予約済み",
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
                          `Approved by <@${reviewerUserId}> | 予約投稿: ${scheduledDate} ${scheduledTime} (JST)`,
                      },
                    ],
                  },
                ],
              });
            }

            await client.functions.completeSuccess({
              function_execution_id: executionId,
              outputs: {
                status: "scheduled",
                tweet_id: "",
              },
            });
          } else {
            // 即投稿
            const credentials = {
              consumerKey: getEnv(env, "X_CONSUMER_KEY"),
              consumerSecret: getEnv(env, "X_CONSUMER_SECRET"),
              accessToken: getEnv(env, "X_ACCESS_TOKEN"),
              accessTokenSecret: getEnv(env, "X_ACCESS_TOKEN_SECRET"),
            };

            // 画像処理
            let mediaIds: string[] | undefined;
            const fileIds = parseFileIds(imageFileIds);
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

            const result = await postTweet(draftText, credentials, mediaIds);

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
          }
        } catch (error) {
          await logger.error("X Draft Approval - Failed", error);

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
            error: `Failed: ${
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
