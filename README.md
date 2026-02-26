# xslack

X (Twitter) post drafting and approval workflow for Slack.

Draft tweets in Slack, get team approval, and post to X — immediately or on a schedule.

## Features

- **Draft & Approve** — Create tweet drafts in a Slack modal, then send them for team approval
- **Scheduled Posting** — Schedule tweets for a specific date and time (JST)
- **Image Attachments** — Attach up to 4 images (JPEG, PNG, GIF, WebP; max 5 MB each)
- **Self-Approval Prevention** — Optionally prevent the author from approving their own draft
- **Scheduled Tweets Management** — List, cancel, or immediately post scheduled tweets
- **Post Notifications** — Send completion notifications to a designated channel

## Prerequisites

- [Deno](https://deno.com/) runtime
- [Slack CLI](https://api.slack.com/automation/cli) (`slack` command)
- A Slack workspace where you can install apps
- X (Twitter) Developer account with API v2 credentials (OAuth 1.0a)

## Setup

### 1. Clone the repository

```sh
git clone https://github.com/shoppingjaws/xslack.git
cd xslack
```

### 2. Configure environment variables

Copy the sample and fill in your values:

```sh
cp .env.sample .env
```

| Variable | Description |
|---|---|
| `X_APPROVAL_CHANNEL_ID` | Slack channel ID for the approval workflow |
| `X_CONSUMER_KEY` | X API OAuth 1.0a consumer key |
| `X_CONSUMER_SECRET` | X API OAuth 1.0a consumer secret |
| `X_ACCESS_TOKEN` | X API OAuth 1.0a access token |
| `X_ACCESS_TOKEN_SECRET` | X API OAuth 1.0a access token secret |
| `X_PREVENT_SELF_APPROVE` | Set to `true` to prevent authors from approving their own drafts |
| `X_POSTED_CHANNEL_ID` | *(Optional)* Channel ID to receive post-completion notifications |

### 3. Deploy to Slack

```sh
slack deploy
```

### 4. Create triggers

After deployment, create shortcut triggers in your approval channel:

```sh
slack trigger create --trigger-def triggers/x_draft_approval_trigger.ts
slack trigger create --trigger-def triggers/list_scheduled_tweets_trigger.ts
```

## Usage

1. Open the approval channel in Slack
2. Use the **X Draft Approval** shortcut to open the draft form
3. Write your tweet (280 character limit), optionally attach images and set a schedule
4. Submit — the draft is posted to the approval channel for review
5. A team member approves or rejects the draft
6. On approval, the tweet is posted to X immediately or at the scheduled time

Use the **List Scheduled Tweets** shortcut to view, cancel, or immediately post pending scheduled tweets.

## Development

```sh
# Run locally
slack run

# Lint & format check
deno task test
```

## Tech Stack

- [Deno Slack SDK](https://api.slack.com/automation/deno) (v2.15.1)
- X API v2 with OAuth 1.0a (HMAC-SHA1, implemented without external dependencies)

## License

See [LICENSE](LICENSE) for details.
