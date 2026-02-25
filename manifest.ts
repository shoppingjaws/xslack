import { Manifest } from "deno-slack-sdk/mod.ts";
import { PostXDraftForApprovalFunctionDefinition } from "./functions/post_x_draft_for_approval_function.ts";
import XDraftApprovalWorkflow from "./workflows/x_draft_approval_workflow.ts";

export default Manifest({
  name: "xslack",
  description: "X (Twitter) post drafting and approval workflow for Slack",
  icon: "assets/icon.png",
  workflows: [XDraftApprovalWorkflow],
  functions: [PostXDraftForApprovalFunctionDefinition],
  outgoingDomains: ["api.x.com"],
  botScopes: [
    "commands",
    "chat:write",
    "chat:write.public",
  ],
});
