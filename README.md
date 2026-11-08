# music

A browser page that writes a song in a conversation, one question at a time:
a song type, a profile and a style, the emotion, scene, arc, hook and title,
a structure and a tempo. It ends with the brief, the Suno style text and the
lyrics template. It also reviews lyrics line by line:
https://srwlli.github.io/music-web/

This repository holds only the built page. `music.wasm` is the music tool's Go
code compiled to WebAssembly, and `wasm_exec.js` is Go's loader for it; both
are under Go's BSD licence (GO-LICENSE). The page runs entirely in your
browser. It sends nothing anywhere and keeps your choices in that browser's
storage only.
