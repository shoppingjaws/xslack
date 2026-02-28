# xslack

Slack上でX (Twitter) の投稿を下書き・承認・投稿するワークフローアプリです。

## 機能

- **下書き・承認フロー** — Slackのモーダルでツイートを下書きし、チームメンバーに承認を依頼
- **予約投稿** — 日時を指定してツイートを予約（JST対応）
- **画像添付** — 最大4枚の画像を添付可能（JPEG, PNG, GIF, WebP、各5MBまで）
- **自己承認の防止** — 投稿者自身による承認を禁止するオプション
- **予約投稿の管理** — 予約済みツイートの一覧表示、キャンセル、即時投稿
- **投稿通知** — 投稿完了時に指定チャンネルへ通知

## 前提条件

- [Deno](https://deno.com/) ランタイム
- [Slack CLI](https://api.slack.com/automation/cli)（`slack` コマンド）
- アプリをインストールできるSlackワークスペース
- X (Twitter) Developer アカウント（API v2、OAuth 1.0a）

## セットアップ

### 1. リポジトリのクローン

```sh
git clone https://github.com/shoppingjaws/xslack.git
cd xslack
```

### 2. 環境変数の設定

サンプルファイルをコピーして値を設定します：

```sh
cp .env.sample .env
```

| 変数名 | 説明 |
|---|---|
| `X_APPROVAL_CHANNEL_ID` | 承認ワークフロー用のSlackチャンネルID |
| `X_CONSUMER_KEY` | X API OAuth 1.0a コンシューマーキー |
| `X_CONSUMER_SECRET` | X API OAuth 1.0a コンシューマーシークレット |
| `X_ACCESS_TOKEN` | X API OAuth 1.0a アクセストークン |
| `X_ACCESS_TOKEN_SECRET` | X API OAuth 1.0a アクセストークンシークレット |
| `X_PREVENT_SELF_APPROVE` | `true` にすると投稿者自身の承認を禁止 |
| `X_POSTED_CHANNEL_ID` | 投稿完了通知を送信するチャンネルID |

### 3. 環境変数の一括追加

`.env` の環境変数をSlackにまとめて追加します：

```sh
deno task env:add .env
```

アプリIDを指定する場合：

```sh
deno task env:add -a <app_id> .env
```

[1Password CLI](https://developer.1password.com/docs/cli/) でシークレットを管理している場合、`op://` 参照を解決しつつ追加できます：

```sh
op inject -i .env | deno task env:add /dev/stdin
op inject -i .env --account <account_id> | deno task env:add -a <app_id> /dev/stdin
```

### 4. Slackへのデプロイ

```sh
slack deploy
```

### 5. トリガーの作成

デプロイ後、承認チャンネルにショートカットトリガーを作成します：

```sh
slack trigger create --trigger-def triggers/x_draft_approval_trigger.ts
slack trigger create --trigger-def triggers/list_scheduled_tweets_trigger.ts
```

### 6. トリガーのアクセス制限（推奨）

デフォルトではトリガーはワークスペース全員がアクセスできます。このアプリはXアカウントに代わって投稿を行うため、許可されたユーザーのみに実行権限を制限することを強く推奨します：

```sh
# 特定のユーザーにアクセスを付与
slack trigger access --trigger-id <trigger_id> --grant --users <user_id1>,<user_id2>

# 特定のチャンネルにアクセスを付与
slack trigger access --trigger-id <trigger_id> --grant --channels <channel_id>

# 全員のアクセスを取り消してから、特定のユーザーに付与
slack trigger access --trigger-id <trigger_id> --revoke --everyone
slack trigger access --trigger-id <trigger_id> --grant --users <user_id>
```

トリガーIDは `slack trigger create` の出力、または `slack trigger list` で確認できます。

## 使い方

1. Slackで承認チャンネルを開く
2. **X Draft Approval** ショートカットで下書きフォームを表示
3. ツイートを入力（280文字制限）、必要に応じて画像添付・投稿日時を設定
4. 送信すると承認チャンネルにレビュー用の投稿が作成される
5. チームメンバーが承認または却下
6. 承認されるとXに即時投稿、または予約した日時に自動投稿

**予約投稿の一覧** ショートカットで、予約済みツイートの確認・キャンセル・即時投稿が可能です。

## 開発

```sh
# ローカル実行
slack run

# リント・フォーマットチェック
deno task test
```

## 技術スタック

- [Deno Slack SDK](https://api.slack.com/automation/deno)（v2.15.1）
- X API v2 + OAuth 1.0a（HMAC-SHA1、外部依存なしで実装）

## ライセンス

詳細は [LICENSE](LICENSE) を参照してください。
