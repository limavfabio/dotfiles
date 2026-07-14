set -g fish_greeting ""

### 1. ENVIRONMENT VARIABLES
# Fish handles these natively; 'set -gx' is the equivalent of 'export'
set -gx OBSIDIAN_VAULT_PATH "$HOME/ObsidianVault"
set -gx TERMINAL alacritty
set -gx EDITOR nvim
set -gx RIPGREP_CONFIG_PATH "$HOME/.config/ripgrep/config"
set -gx CODEX_HOME "$HOME/.config/codex"
set -gx ANDROID_HOME "$HOME/Android/Sdk"
if test -d "$HOME/.local/android-studio/jbr"
    set -gx JAVA_HOME "$HOME/.local/android-studio/jbr"
end


### 2. PATH CONSTRUCTION
# Keep PATH changes in this file; do not persist them in fish_user_paths.
# The Android Emulator ships an incompatible qemu-img, so never expose it globally.
set -gx PATH (string match -v -- "$HOME/Android/Sdk/emulator" $PATH)
fish_add_path --path $HOME/go/bin
fish_add_path --path $HOME/.local/bin
fish_add_path --path "$HOME/Android/Sdk/platform-tools" # Recommended for Android dev
fish_add_path --path "$HOME/.local/android-studio/bin"

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
