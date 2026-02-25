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
      ],
      required: ["draft_text"],
    },
  },
);

XDraftApprovalWorkflow.addStep(PostXDraftForApprovalFunctionDefinition, {
  draft_text: openFormStep.outputs.fields.draft_text,
  author_user_id: XDraftApprovalWorkflow.inputs.user_id,
});

export default XDraftApprovalWorkflow;
