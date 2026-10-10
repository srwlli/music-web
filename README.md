# music

A browser page that writes song prompts for Suno and reviews lyrics line by
line: https://srwlli.github.io/music-web/

This repository holds only the built page. `music.wasm` is the music tool's Go
code compiled to WebAssembly, and `wasm_exec.js` is Go's loader for it; both
are under Go's BSD licence (GO-LICENSE). The page runs entirely in your
browser. It sends nothing anywhere and keeps your choices in that browser's
storage only.
