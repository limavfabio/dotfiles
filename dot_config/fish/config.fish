set -g fish_greeting ""

### 1. ENVIRONMENT VARIABLES
# Fish handles these natively; 'set -gx' is the equivalent of 'export'
set -gx TERMINAL alacritty
set -gx EDITOR nvim
set -gx GOOGLE_CLOUD_PROJECT "gen-lang-client-0239016192"
set -gx RIPGREP_CONFIG_PATH "$HOME/.config/ripgrep/config"
set -gx CODEX_HOME "$HOME/.config/codex"

# Bun & pnpm
set -gx BUN_INSTALL "$HOME/.bun"
set -gx PNPM_HOME "$HOME/.local/share/pnpm"

### 2. PATH CONSTRUCTION
# 'fish_add_path' is smart: it prepends/appends and handles duplicates automatically
fish_add_path $HOME/go/bin
fish_add_path $HOME/.local/bin
fish_add_path $BUN_INSTALL/bin
fish_add_path $PNPM_HOME
fish_add_path "$HOME/Android/Sdk/platform-tools/" # Recommended for Android dev
fish_add_path "$HOME/.local/android-studio/bin"

### 3. INTERACTIVE SESSIONS
if status is-interactive
    # MISE: The core of your runtime management
    mise activate fish | source

    # SHELL COMPLETIONS (Handled natively or via 'source')
    # Fish handles most of these automatically, but for UV:
    uv generate-shell-completion fish | source

    # VSCODE Integration
    if test "$TERM_PROGRAM" = "vscode"
        source (code --locate-shell-integration-path fish)
    end

    ### Source scripts
    starship init fish | source
    zoxide init fish | source
end

### 4. LOCAL OVERRIDES
if test -f ~/.config/fish/config.local.fish
    source ~/.config/fish/config.local.fish
end
