import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { SlackAPI, TriggerTypes } from "deno-slack-api/mod.ts";
import { createSlackLogger } from "./libs/logger.ts";
import { postTweet } from "./libs/x_api_client.ts";
import {
  downloadSlackFile,
  getSlackFileInfos,
  parseFileIds,
} from "./libs/slack_file_downloader.ts";
import { uploadMultipleMedia } from "./libs/x_media_upload.ts";
import { ActiveListMessagesDatastore } from "../datastores/active_list_messages.ts";
import { PendingApprovalsDatastore } from "../datastores/pending_approvals.ts";
import PostScheduledTweetWorkflow from "../workflows/post_scheduled_tweet_workflow.ts";

const CANCEL_ACTION_ID = "cancel_scheduled_tweet";
const POST_NOW_ACTION_ID = "post_now_scheduled_tweet";
const APPROVE_FROM_LIST_ACTION_ID = "approve_from_list";
const TTL_HOURS = 24;

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


function buildEmptyBlocks(message: string) {
  return [
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
        text: message,
      },
    },
  ];
}

// deno-lint-ignore no-explicit-any
function buildPendingApprovalBlocks(pendingApprovals: any[]): any[] {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [];

  for (const approval of pendingApprovals) {
    const draftText = approval.draft_text ?? "(内容不明)";
    const authorUserId = approval.author_user_id;
    const channelId = approval.channel_id;
    const messageTs = approval.message_ts;
    const scheduledDate = approval.scheduled_date;
    const scheduledTime = approval.scheduled_time;

    const hasSchedule = scheduledDate && scheduledTime;
    const scheduleText = hasSchedule
      ? `予約予定: ${scheduledDate} ${scheduledTime} (JST)`
      : "即投稿（承認後）";

    let approvalLink = "";
    if (channelId && messageTs) {
      const tsForUrl = messageTs.replace(".", "");
      approvalLink =
        ` | <https://slack.com/archives/${channelId}/p${tsForUrl}|承認メッセージ>`;
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
            text: `投稿者: ${authorUserId ? `<@${authorUserId}>` : "不明"} | ${scheduleText}${approvalLink}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: APPROVE_FROM_LIST_ACTION_ID,
            text: { type: "plain_text", text: "承認" },
            style: "primary",
            value: approval.id,
            confirm: {
              title: { type: "plain_text", text: "確認" },
              text: {
                type: "plain_text",
                text: "この投稿を承認しますか？",
              },
              confirm: { type: "plain_text", text: "承認する" },
              deny: { type: "plain_text", text: "やめる" },
            },
          },
        ],
      },
      { type: "divider" },
    );
  }

  return blocks;
}

// deno-lint-ignore no-explicit-any
function buildFullListBlocks(triggers: any[], pendingApprovals: any[]): any[] {
  // deno-lint-ignore no-explicit-any
  const blocks: any[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "投稿一覧",
      },
    },
  ];

  if (pendingApprovals.length > 0) {
    blocks.push(
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*:hourglass: 承認待ち:* ${pendingApprovals.length} 件`,
          },
        ],
      },
      { type: "divider" },
      ...buildPendingApprovalBlocks(pendingApprovals),
    );
  }

  if (triggers.length > 0) {
    blocks.push(
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*:clock1: 予約投稿:* ${triggers.length} 件`,
          },
        ],
      },
      { type: "divider" },
    );

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
  }

  return blocks;
}

// deno-lint-ignore no-explicit-any
async function queryPendingApprovals(client: any): Promise<any[]> {
  const queryResult = await client.apps.datastore.query({
    datastore: PendingApprovalsDatastore.name,
  });
  return queryResult.ok ? (queryResult.items ?? []) : [];
}

// deno-lint-ignore no-explicit-any
async function updateAllListMessages(client: any, logger: any) {
  // 現在のトリガー一覧を取得
  const listResult = await client.workflows.triggers.list({
    is_owner: true,
  });
  const remainingTriggers = filterScheduledTweetTriggers(
    listResult.triggers ?? [],
  );

  // 承認待ち一覧を取得
  const pendingApprovals = await queryPendingApprovals(client);

  // Datastoreから全アクティブリストメッセージを取得
  const queryResult = await client.apps.datastore.query({
    datastore: ActiveListMessagesDatastore.name,
  });

  if (!queryResult.ok) {
    await logger.error("Failed to query active list messages", {
      error: queryResult.error,
    });
    return { remainingTriggers, pendingApprovals };
  }

  const entries = queryResult.items ?? [];

  // 期限切れエントリを除外（24h TTL）
  const now = Date.now();
  const activeEntries = entries.filter(
    // deno-lint-ignore no-explicit-any
    (e: any) => !e.expire_ts || e.expire_ts > now,
  );
  const expiredEntries = entries.filter(
    // deno-lint-ignore no-explicit-any
    (e: any) => e.expire_ts && e.expire_ts <= now,
  );

  // 期限切れエントリを削除
  for (const entry of expiredEntries) {
    await client.apps.datastore.delete({
      datastore: ActiveListMessagesDatastore.name,
      id: entry.id,
    });
  }

  const totalItems = remainingTriggers.length + pendingApprovals.length;

  if (totalItems === 0) {
    // 全件処理済み: 全リストを「処理済み」に更新し、エントリを削除
    for (const entry of activeEntries) {
      try {
        await client.chat.update({
          channel: entry.channel_id,
          ts: entry.message_ts,
          text: "予約投稿はすべて処理されました。",
          blocks: buildEmptyBlocks("予約投稿はすべて処理されました。"),
        });
      } catch {
        // メッセージ削除済みなど - スキップ
      }
      await client.apps.datastore.delete({
        datastore: ActiveListMessagesDatastore.name,
        id: entry.id,
      });
    }
  } else {
    // 残りのアイテムでリストを更新
    const blocks = buildFullListBlocks(remainingTriggers, pendingApprovals);
    const text = `投稿一覧（予約: ${remainingTriggers.length}件, 承認待ち: ${pendingApprovals.length}件）`;

    for (const entry of activeEntries) {
      const updateResult = await client.chat.update({
        channel: entry.channel_id,
        ts: entry.message_ts,
        text,
        blocks,
        unfurl_links: false,
      });
      if (!updateResult.ok) {
        // メッセージ更新失敗（削除済みなど）→ エントリを削除してスキップ
        await client.apps.datastore.delete({
          datastore: ActiveListMessagesDatastore.name,
          id: entry.id,
        });
      }
    }
  }

  return { remainingTriggers, pendingApprovals };
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
          text: `投稿一覧の取得に失敗しました: ${listResult.error}`,
        });
        return { error: `Failed to list triggers: ${listResult.error}` };
      }

      const scheduledTriggers = filterScheduledTweetTriggers(
        listResult.triggers ?? [],
      );

      // 承認待ち一覧を取得
      const pendingApprovals = await queryPendingApprovals(client);

      const totalItems = scheduledTriggers.length + pendingApprovals.length;

      if (totalItems === 0) {
        await client.chat.postMessage({
          channel: channelId,
          text: "予約・承認待ちの投稿はありません。",
          blocks: buildEmptyBlocks("予約・承認待ちの投稿はありません。"),
        });
        return { outputs: {} };
      }

      const blocks = buildFullListBlocks(scheduledTriggers, pendingApprovals);
      const text =
        `投稿一覧（予約: ${scheduledTriggers.length}件, 承認待ち: ${pendingApprovals.length}件）`;

      const postResult = await client.chat.postMessage({
        channel: channelId,
        text,
        blocks,
        unfurl_links: false,
      });

      // Datastoreにリストメッセージ情報を保存
      if (postResult.ok && postResult.ts) {
        const id = `${channelId}_${postResult.ts}`;
        const expireTs = Date.now() + TTL_HOURS * 60 * 60 * 1000;
        await client.apps.datastore.put({
          datastore: ActiveListMessagesDatastore.name,
          item: {
            id,
            channel_id: channelId,
            message_ts: postResult.ts,
            expire_ts: expireTs,
          },
        });
      }

      // 予約投稿または承認待ちがある場合はアクションハンドラのために未完了にする
      if (scheduledTriggers.length > 0 || pendingApprovals.length > 0) {
        return { completed: false };
      }

      return { outputs: {} };
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
        // 既に処理済みの可能性 → 全リスト更新
        await updateAllListMessages(client, logger);
        if (messageTs) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: messageTs,
            text: `この予約投稿は既に処理済みです。`,
          });
        }
        return;
      }

      await logger.log("Scheduled tweet cancelled", { triggerId });

      // 全リストメッセージを更新
      const { remainingTriggers, pendingApprovals } =
        await updateAllListMessages(client, logger);

      // 残りが0件なら自身のfunction executionを完了
      if (
        remainingTriggers.length === 0 && pendingApprovals.length === 0
      ) {
        await client.functions.completeSuccess({
          function_execution_id: executionId,
          outputs: {},
        });
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
      // 1. トリガー削除（楽観ロック）
      const deleteResult = await client.workflows.triggers.delete({
        trigger_id: triggerData.trigger_id,
      });

      if (!deleteResult.ok) {
        // 削除失敗 → 既に処理済み
        await logger.log("Trigger already deleted (duplicate post prevented)", {
          triggerId: triggerData.trigger_id,
        });
        await updateAllListMessages(client, logger);
        if (listMessageTs) {
          await client.chat.postMessage({
            channel: listChannelId,
            thread_ts: listMessageTs,
            text: "この予約投稿は既に処理済みです。",
          });
        }
        return;
      }

      // 2. トリガー削除成功 → ツイート投稿
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

      let tweetResult: { id: string };
      try {
        tweetResult = await postTweet(
          triggerData.draft_text,
          credentials,
          mediaIds,
        );
      } catch (postError) {
        // 投稿失敗（トリガーは既に削除済み）
        const postErrorMsg = postError instanceof Error
          ? postError.message
          : String(postError);
        await logger.error("Post now tweet failed after trigger deletion", {
          triggerId: triggerData.trigger_id,
          error: postErrorMsg,
        });
        await updateAllListMessages(client, logger);
        if (listMessageTs) {
          await client.chat.postMessage({
            channel: listChannelId,
            thread_ts: listMessageTs,
            text:
              `ツイート投稿に失敗しました: ${postErrorMsg}\n予約トリガーは削除済みのため、再度ドラフトを作成してください。`,
          });
        }
        return;
      }

      await logger.log("Post now tweet posted", {
        tweetId: tweetResult.id,
        author: triggerData.author_user_id,
      });

      // 元の承認メッセージスレッドに投稿完了通知
      if (triggerData.channel_id && triggerData.message_ts) {
        await client.chat.postMessage({
          channel: triggerData.channel_id,
          thread_ts: triggerData.message_ts,
          text:
            `今すぐ投稿されました。\nTweet ID: ${tweetResult.id}\nhttps://x.com/i/status/${tweetResult.id}`,
        });
      }

      // 全リストメッセージを更新
      const { remainingTriggers, pendingApprovals } =
        await updateAllListMessages(client, logger);

      // 残りが0件なら自身のfunction executionを完了
      if (
        remainingTriggers.length === 0 && pendingApprovals.length === 0
      ) {
        await client.functions.completeSuccess({
          function_execution_id: executionId,
          outputs: {},
        });
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
).addBlockActionsHandler(
  [APPROVE_FROM_LIST_ACTION_ID],
  async ({ action, body, env, token }) => {
    const logger = createSlackLogger(token);
    const client = SlackAPI(token);

    const executionId = body.function_data.execution_id;
    const reviewerUserId = body.user.id;
    const listMessageTs = body.message?.ts;
    // deno-lint-ignore no-explicit-any
    const listChannelId = (body.message as any)?.channel_id ??
      getEnv(env, "X_APPROVAL_CHANNEL_ID");

    const pendingId = action.value;

    try {
      // Datastoreから承認待ちエントリを取得
      const getResult = await client.apps.datastore.get({
        datastore: PendingApprovalsDatastore.name,
        id: pendingId,
      });

      if (!getResult.ok || !getResult.item) {
        // 既に処理済み
        await updateAllListMessages(client, logger);
        if (listMessageTs) {
          await client.chat.postMessage({
            channel: listChannelId,
            thread_ts: listMessageTs,
            text: "この投稿は既に処理済みです。",
          });
        }
        return;
      }

      const approval = getResult.item;
      const draftText = approval.draft_text ?? "";
      const authorUserId = approval.author_user_id ?? "";
      const scheduledDate = approval.scheduled_date ?? "";
      const scheduledTime = approval.scheduled_time ?? "";
      const imageFileIds = approval.image_file_ids ?? "";
      const approvalChannelId = approval.channel_id ?? "";
      const approvalMessageTs = approval.message_ts ?? "";
      const originalExecutionId = approval.function_execution_id ?? "";

      // 自己承認防止チェック
      if (
        getEnv(env, "X_PREVENT_SELF_APPROVE") === "true" &&
        reviewerUserId === authorUserId
      ) {
        await client.chat.postEphemeral({
          channel: listChannelId,
          user: reviewerUserId,
          text: "自分が作成したドラフトを自分で承認することはできません。他のメンバーに承認を依頼してください。",
        });
        return;
      }

      // Datastoreから承認待ちエントリを削除
      await client.apps.datastore.delete({
        datastore: PendingApprovalsDatastore.name,
        id: pendingId,
      });

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

      let postedTweetId = "";

      if (shouldSchedule) {
        // 予約投稿: Scheduled Trigger を作成
        const triggerResult = await client.workflows.triggers.create({
          type: TriggerTypes.Scheduled,
          name: "Scheduled X Post",
          workflow:
            `#/workflows/${PostScheduledTweetWorkflow.definition.callback_id}`,
          inputs: {
            draft_text: { value: draftText },
            channel_id: { value: approvalChannelId },
            author_user_id: { value: authorUserId },
            message_ts: { value: approvalMessageTs },
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

        await logger.log("Approved from list - Scheduled trigger created", {
          triggerId: triggerResult.trigger?.id,
          scheduledAt: scheduledISOString,
          reviewer: reviewerUserId,
        });

        // 元の承認メッセージを更新
        if (approvalChannelId && approvalMessageTs) {
          await client.chat.update({
            channel: approvalChannelId,
            ts: approvalMessageTs,
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
                      `Approved by <@${reviewerUserId}> (一覧から承認) | 予約投稿: ${scheduledDate} ${scheduledTime} (JST)`,
                  },
                ],
              },
            ],
          });
        }
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
        if (imageFileIds) {
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
        }

        const tweetResult = await postTweet(draftText, credentials, mediaIds);
        postedTweetId = tweetResult.id;

        await logger.log("Approved from list - Tweet posted", {
          tweetId: tweetResult.id,
          reviewer: reviewerUserId,
        });

        // postedチャンネルに投稿通知
        const postedChannelId = getEnv(env, "X_POSTED_CHANNEL_ID");
        if (postedChannelId) {
          await client.chat.postMessage({
            channel: postedChannelId,
            text:
              `X投稿が完了しました。\n*投稿者:* <@${authorUserId}>\n*投稿内容:*\n>>> ${draftText}\nhttps://x.com/i/status/${tweetResult.id}`,
          });
        }

        // 元の承認メッセージを更新
        if (approvalChannelId && approvalMessageTs) {
          await client.chat.update({
            channel: approvalChannelId,
            ts: approvalMessageTs,
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
                      `Approved by <@${reviewerUserId}> (一覧から承認) | Tweet ID: ${tweetResult.id}`,
                  },
                ],
              },
            ],
          });
        }
      }

      // 元のドラフト承認関数のexecutionを完了（可能であれば）
      if (originalExecutionId) {
        try {
          await client.functions.completeSuccess({
            function_execution_id: originalExecutionId,
            outputs: {
              status: shouldSchedule ? "scheduled" : "approved",
              tweet_id: postedTweetId,
            },
          });
        } catch {
          // タイムアウト済みなど - 無視
        }
      }

      // 全リストメッセージを更新
      const { remainingTriggers, pendingApprovals } =
        await updateAllListMessages(client, logger);

      // 残りが0件なら自身のfunction executionを完了
      if (
        remainingTriggers.length === 0 && pendingApprovals.length === 0
      ) {
        await client.functions.completeSuccess({
          function_execution_id: executionId,
          outputs: {},
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await logger.error("Approve from list failed", error);
      if (listMessageTs) {
        await client.chat.postMessage({
          channel: listChannelId,
          thread_ts: listMessageTs,
          text: `承認処理に失敗しました: ${errorMsg}`,
        });
      }
    }
  },
);
