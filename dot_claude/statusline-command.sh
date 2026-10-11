#!/usr/bin/env bash

input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir')

# Replace home directory with ~
display_dir="${cwd/#$HOME/~}"

# Truncate to last 3 path components (mirrors Starship truncation_length=3)
IFS='/' read -ra parts <<< "$display_dir"
total=${#parts[@]}
if [ "$total" -gt 3 ]; then
    display_dir="${parts[$((total-3))]}/${parts[$((total-2))]}/${parts[$((total-1))]}"
fi

# Git info (skip optional locks to avoid interfering with running git operations)
branch=$(git -C "$cwd" --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null)

git_status_str=""
if [ -n "$branch" ]; then
    status_output=$(git -C "$cwd" --no-optional-locks status --porcelain 2>/dev/null)

    dirty=""
    [ -n "$status_output" ] && dirty="!"

    ahead_behind=$(git -C "$cwd" --no-optional-locks rev-list --left-right --count HEAD...@{upstream} 2>/dev/null)
    ahead=""
    behind=""
    if [ -n "$ahead_behind" ]; then
        ahead_count=$(echo "$ahead_behind" | awk '{print $1}')
        behind_count=$(echo "$ahead_behind" | awk '{print $2}')
        [ "$ahead_count" -gt 0 ] 2>/dev/null && ahead="⇡${ahead_count}"
        [ "$behind_count" -gt 0 ] 2>/dev/null && behind="⇣${behind_count}"
    fi

    status_str="${dirty}${ahead}${behind}"
    [ -n "$status_str" ] && git_status_str=" [${status_str}]"
fi

# Directory: bold, fg #ffcc00 (24-bit ANSI)
printf "\033[1;38;2;255;204;0m%s\033[0m" "$display_dir"

# Git branch: bold magenta with nerd-font branch symbol
if [ -n "$branch" ]; then
    printf " \033[1;35m %s\033[0m" "$branch"

    # Git status: bold red
    if [ -n "$git_status_str" ]; then
        printf "\033[1;31m%s\033[0m" "$git_status_str"
    fi
fi

# Rate limit remaining % from Claude Code API headers (Max/Pro plans only, available after first API call)
five_h_used=$(echo "$input" | jq -r '(.rate_limits.five_hour.used_percentage // .five_hour.used_percentage) // empty' 2>/dev/null)
seven_d_used=$(echo "$input" | jq -r '(.rate_limits.seven_day.used_percentage // .seven_day.used_percentage) // empty' 2>/dev/null)

if [ -n "$five_h_used" ] && [ -n "$seven_d_used" ]; then
    five_h_left=$(awk "BEGIN{printf \"%.0f\", 100 - $five_h_used}")
    seven_d_left=$(awk "BEGIN{printf \"%.0f\", 100 - $seven_d_used}")
    printf " \033[2;36m5h:%s%% wk:%s%%\033[0m" "$five_h_left" "$seven_d_left"
fi

# Context window usage (% of context used)
ctx_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)
if [ -n "$ctx_used" ]; then
    ctx_used_rounded=$(awk "BEGIN{printf \"%.0f\", $ctx_used}")
    printf " \033[2;33mctx:%s%%\033[0m" "$ctx_used_rounded"
fi

# Model and effort level (effort falls back to the configured effortLevel setting)
model=$(echo "$input" | jq -r '.model.display_name // empty' 2>/dev/null)
effort=$(echo "$input" | jq -r '(.effort.level? // .effort? // .effort_level?) // empty | if type == "string" then . else empty end' 2>/dev/null)
[ -z "$effort" ] && effort=$(jq -r '.effortLevel // empty' "$HOME/.claude/settings.json" 2>/dev/null)
if [ -n "$model" ]; then
    printf " \033[2;32m%s" "$model"
    [ -n "$effort" ] && printf " · %s" "$effort"
    printf "\033[0m"
fi

printf "\n"
