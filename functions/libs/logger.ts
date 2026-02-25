import { SlackAPI } from "deno-slack-api/mod.ts";

type SlackClient = ReturnType<typeof SlackAPI>;

const SLACK_LOG_CHANNEL_ID = "C09AL4G6VUY";

interface Logger {
  log: (...args: unknown[]) => Promise<void>;
  error: (...args: unknown[]) => Promise<void>;
}

function formatMessage(...args: unknown[]): string {
  return args.map((arg) => {
    if (typeof arg === "string") {
      return arg;
    } else if (arg instanceof Error) {
      return `${arg.message}\n${arg.stack || ""}`;
    } else if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    } else {
      return String(arg);
    }
  }).join(" ");
}

async function postToSlack(
  client: SlackClient | undefined,
  message: string,
  level: "info" | "error",
): Promise<void> {
  if (!client) {
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const emoji = level === "error" ? "🚨" : "💬";
    const formattedMessage =
      `${emoji} [${timestamp}] [${level.toUpperCase()}]\n\`\`\`\n${message}\n\`\`\``;

    await client.chat.postMessage({
      channel: SLACK_LOG_CHANNEL_ID,
      text: formattedMessage,
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (error) {
    console.error("Failed to post log to Slack:", error);
  }
}

export function createLogger(client?: SlackClient): Logger {
  return {
    async log(...args: unknown[]): Promise<void> {
      const message = formatMessage(...args);
      console.log(...args);
      await postToSlack(client, message, "info");
    },

    async error(...args: unknown[]): Promise<void> {
      const message = formatMessage(...args);
      console.error(...args);
      await postToSlack(client, message, "error");
    },
  };
}

export const slog = createLogger();

export function createSlackLogger(token: string): Logger {
  const client = SlackAPI(token);
  return createLogger(client);
}
