# README demo

Re-records `docs/media/demo.gif` from a real Obsidian, on a throwaway vault, so nothing from your own vault ends up in the GIF.

Needs: a built plugin (`npm run build`), Chrome, Python with `python-pptx` and `Pillow`.

```bash
# 1. Build the demo vault (sample deck, PDF printed with Chrome, code file, the plugin)
python tools/demo/make_demo_vault.py <demo-vault-dir>

# 2. Start Obsidian with a separate profile, so your real vault list and settings stay untouched.
#    In <profile-dir>/obsidian.json, register only the demo vault:
#    {"vaults":{"demo":{"path":"<demo-vault-dir>","ts":0,"open":true}}}
Obsidian.exe --user-data-dir=<profile-dir> --remote-debugging-port=9229 --remote-debugging-address=127.0.0.1

# 3. Record, then build the GIF
node tools/demo/record.mjs <frames-dir>
python tools/demo/make_gif.py <frames-dir> docs/media/demo.gif 960
```

Close that Obsidian afterwards. An open debug port lets any local process control it.

`record.mjs` resizes the window to 1280x760 and sets the deck to 45% zoom, so the slide and the comment strip fit side by side. It draws its own cursor, because screencast frames don't include the OS cursor.
