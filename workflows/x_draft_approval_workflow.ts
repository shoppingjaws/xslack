import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { PostXDraftForApprovalFunctionDefinition } from "../functions/post_x_draft_for_approval_function.ts";

const XDraftApprovalWorkflow = DefineWorkflow({
  callback_id: "x_draft_approval_workflow",
  title: "X Draft Approval Workflow",
  description: "Draft a tweet, get approval, then post to X",
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
    required: ["interactivity", "user_id"],
  },
});

const openFormStep = XDraftApprovalWorkflow.addStep(
  Schema.slack.functions.OpenForm,
  {
    title: "X投稿ドラフト作成",
    interactivity: XDraftApprovalWorkflow.inputs.interactivity,
    submit_label: "送信",
    fields: {
      elements: [
        {
          name: "draft_text",
          title: "投稿内容",
          type: Schema.types.string,
          long: true,
          description: "Xに投稿するテキスト（280文字以内）",
        },
        {
          name: "scheduled_date",
          title: "予約投稿日",
          type: Schema.slack.types.date,
          description: "投稿を予約する日付（任意）",
        },
        {
          name: "scheduled_time",
          title: "予約投稿時刻",
          type: Schema.types.string,
          description: "投稿を予約する時刻（HH:MM形式、任意）",
        },
      ],
      required: ["draft_text"],
    },
  },
);

XDraftApprovalWorkflow.addStep(PostXDraftForApprovalFunctionDefinition, {
  draft_text: openFormStep.outputs.fields.draft_text,
  author_user_id: XDraftApprovalWorkflow.inputs.user_id,
  scheduled_date: openFormStep.outputs.fields.scheduled_date,
  scheduled_time: openFormStep.outputs.fields.scheduled_time,
});

export default XDraftApprovalWorkflow;
