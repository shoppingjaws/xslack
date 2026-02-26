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

XDraftApprovalWorkflow.addStep(PostXDraftForApprovalFunctionDefinition, {
  interactivity: XDraftApprovalWorkflow.inputs.interactivity,
  author_user_id: XDraftApprovalWorkflow.inputs.user_id,
});

export default XDraftApprovalWorkflow;
