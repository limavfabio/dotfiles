if status is-interactive
    # ABBREVIATIONS: The cleaner alternative to your OMZ aliases
    abbr -a fishconf "$EDITOR ~/.config/fish/config.fish"
    abbr -a venv    'source .venv/bin/activate.fish'
    abbr -a p       'pnpm'
    abbr -a pi      'pnpm install'
    abbr -a pu      'pnpm update'
    abbr -a be      'bundle exec'
    abbr -a copilot_ni "copilot --enable-all-github-mcp-tools --allow-all-tools --allow-all-paths"

    abbr -a ta "tmux attach -t"
    abbr -a tad "tmux attach -d -t"
    abbr -a ts "tmux new-session -s"
    abbr -a tl "tmux list-sessions"
    abbr -a tksv "tmux kill-server"
    abbr -a tkss "tmux kill-session -t"

    abbr -a rdd "bin/rails db:drop"
    abbr -a rdc "bin/rails db:create"
    abbr -a rdm "bin/rails db:migrate"
    abbr -a rds "bin/rails db:seed"
    abbr -a rdsr "bin/rails db:seed:replant"
    abbr -a rt "bin/rails test"
    abbr -a rc "bin/rails console"
end
