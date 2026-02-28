import { Manifest } from "deno-slack-sdk/mod.ts";
import { PostXDraftForApprovalFunctionDefinition } from "./functions/post_x_draft_for_approval_function.ts";
import { PostScheduledTweetFunctionDefinition } from "./functions/post_scheduled_tweet_function.ts";
import { ListScheduledTweetsFunctionDefinition } from "./functions/list_scheduled_tweets_function.ts";
import XDraftApprovalWorkflow from "./workflows/x_draft_approval_workflow.ts";
import PostScheduledTweetWorkflow from "./workflows/post_scheduled_tweet_workflow.ts";
import ListScheduledTweetsWorkflow from "./workflows/list_scheduled_tweets_workflow.ts";
import { ActiveListMessagesDatastore } from "./datastores/active_list_messages.ts";
import { PendingApprovalsDatastore } from "./datastores/pending_approvals.ts";

export default Manifest({
  name: "xslack",
  description: "X (Twitter) post drafting and approval workflow for Slack",
  icon: "assets/x.jpg",
  workflows: [
    XDraftApprovalWorkflow,
    PostScheduledTweetWorkflow,
    ListScheduledTweetsWorkflow,
  ],
  functions: [
    PostXDraftForApprovalFunctionDefinition,
    PostScheduledTweetFunctionDefinition,
    ListScheduledTweetsFunctionDefinition,
  ],
  datastores: [ActiveListMessagesDatastore, PendingApprovalsDatastore],
  outgoingDomains: ["api.x.com", "upload.twitter.com", "files.slack.com"],
  botScopes: [
    "commands",
    "chat:write",
    "chat:write.public",
    "triggers:read",
    "triggers:write",
    "files:read",
    "datastore:read",
    "datastore:write",
  ],
});
