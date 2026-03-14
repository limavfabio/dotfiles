function tx --description "tmux switch session"
    set target $argv[1]

    # If no argument is passed, just list available sessions
    if test -z "$target"
        tmux list-sessions
        return 0
    end

    if set -q TMUX
        # We are inside tmux. Switch to the session (create it in the background if it doesn't exist).
        if not tmux has-session -t "$target" 2>/dev/null
            tmux new-session -d -s "$target"
        end
        tmux switch-client -t "$target"
    else
        # We are outside tmux. Attach to the session or create it.
        tmux new-session -A -s "$target"
    end
end
