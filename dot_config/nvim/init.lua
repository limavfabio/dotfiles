vim.keymap.set( "i", "jk", "<esc>")
vim.keymap.set( "i", "kj", "<esc>")

vim.keymap.set("n", "<Esc>", "<cmd>noh<CR>")

vim.opt.clipboard = "unnamedplus"   -- Sync with system clipboard (no more "+y)
vim.opt.undofile = true            -- Persistent undo (survives closing Nvim)
vim.opt.smartcase = true           -- Smart case-sensitive search
vim.opt.inccommand = "split"       -- Live preview of :s/replace/commands
vim.opt.cursorline = true          -- Highlight current line for orientation
vim.opt.scrolloff = 8              -- Keep 8 lines visible above/below cursor

vim.api.nvim_create_autocmd("TextYankPost", { callback = function() vim.highlight.on_yank() end })
