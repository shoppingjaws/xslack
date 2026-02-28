#!/bin/bash
set -euo pipefail

usage() {
  echo "Usage: $0 [-a app_id] <env_file>"
  exit 1
}

APP_FLAG=()
while getopts "a:" opt; do
  case $opt in
    a) APP_FLAG=(-a "$OPTARG") ;;
    *) usage ;;
  esac
done
shift $((OPTIND - 1))

ENV_FILE="${1:-.env}"

if [ ! -r "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

while IFS= read -r line || [ -n "$line" ]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

  key="${line%%=*}"
  value="${line#*=}"

  echo "Adding: $key"
  slack env add "${APP_FLAG[@]}" "$key" "$value"
done < "$ENV_FILE"
