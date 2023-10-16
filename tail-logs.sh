#!/bin/bash

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <filename>"
    exit 1
fi

tail -F -n0 "$1" | while read -r line; do
    if echo "$line" | jq -e . > /dev/null 2>&1; then
        ts=$(echo "$line" | jq -r '.timestamp')
        ts=$((ts/1000))
        text=$(echo "$line" | jq -r '.text')
        formatted_date=$(date -d "@$ts" '+%Y-%m-%d %H:%M:%S')
        echo "[$formatted_date] $text"
    else
        echo "$line"
    fi
done