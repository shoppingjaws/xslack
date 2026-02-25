import { Trigger } from "deno-slack-api/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import XDraftApprovalWorkflow from "../workflows/x_draft_approval_workflow.ts";

const XDraftApprovalTrigger: Trigger<
  typeof XDraftApprovalWorkflow.definition
> = {
  type: TriggerTypes.Shortcut,
  name: "X投稿ドラフト作成",
  description: "Xへの投稿ドラフトを作成し、承認を得てからポストします",
  workflow: `#/workflows/${XDraftApprovalWorkflow.definition.callback_id}`,
  inputs: {
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
    channel_id: {
      value: TriggerContextData.Shortcut.channel_id,
    },
    user_id: {
      value: TriggerContextData.Shortcut.user_id,
    },
  },
};

export default XDraftApprovalTrigger;
