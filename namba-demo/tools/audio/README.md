# Audio tools (v20)

The game plays recorded files from `assets/audio/` (`manifest.json` lists them). Three pieces:

| What | Where |
| --- | --- |
| `gen-voice.mjs` | requests speech from the AI gateway, converts it to the final MP3s, rebuilds the `voice` part of the manifest |
| `verify-voice.py` | checks every voice clip (wrong words, pace, silence, clipping, loudness) |
| crowd loops | built once from field recordings (see "Crowd loops"); files live in `assets/audio/crowd/` |

`lines.mjs` (next to these files) produces the list of lines: `[{ key, text, read, style, voices }]`.

## Voice key

`voiceKey(text)` in `js/audio/phrases.js`: FNV-1a (32 bit) over the UTF-16 code units of `voiceText(text)` (clock times like
`12時30分発、` and whitespace removed), as 8 hex digits. The generator imports that function, so file names and the
engine can never disagree. Files: `voice/<key>.mp3`, plus `_b` and `_c` for variants in other voices.

## Regenerate voices

Needs Node 22, `curl`, `ffmpeg`. The cache holds the raw responses OUTSIDE the repo; a line + variant already in the
cache is never requested again, so reruns are free. Real requests cost money: ask first.

```sh
export AI_GATEWAY_API_KEY=...          # defaults to "dummy" (the session proxy supplies the real credential)
node tools/audio/lines.mjs > /tmp/lines.json     # however lines.mjs is run to emit the JSON
node tools/audio/gen-voice.mjs /tmp/lines.json --cache ~/namba-voice-cache --dry        # list what would be requested
node tools/audio/gen-voice.mjs /tmp/lines.json --cache ~/namba-voice-cache --limit 5    # a few real requests
node tools/audio/gen-voice.mjs /tmp/lines.json --cache ~/namba-voice-cache              # everything
```

Options: `--only <style>`, `--limit N`, `--concurrency 4`, `--dry`, `--reprocess` (rebuild MP3s from the cache),
`--no-process`, `--out`, `--manifest`. `voices` in a line is the number of variants wanted (default 1), or `"all"`,
or an array of voice names. Styles: `pa-station` (Zephyr), `pa-mall` (Zephyr), `staff` (Zephyr, Leda),
`passerby` (Leda, Puck, Aoede). A voice name the gateway rejects is reported and skipped.

Post-processing: mono, 80 Hz high-pass, silence trimmed (60 ms head, 150 ms tail), ONE linear gain to -19 LUFS
(ebur128 measured on a copy tiled to 2 s or more, so short clips measure like long ones; the gain is corrected up to 3 times
after encoding), peak limiter at -3 dBFS (true peak of the MP3 stays under -2 dBTP), 44.1 kHz, MP3 56 kbps CBR with a
LAME header. `loudnorm` two-pass is not used: it needs several seconds of audio.

## Verify voices

```sh
pip install faster-whisper pykakasi          # once; the first run downloads the "small" model (~460 MB)
python3 -I tools/audio/verify-voice.py --lines /tmp/lines.json            # worst first, exit 1 if anything is flagged
python3 -I tools/audio/verify-voice.py --lines /tmp/lines.json --no-asr   # technical checks only
```

Transcribes each clip in Japanese, converts transcript and expected `read` text to kana, and prints a similarity
ratio (flag under 0.85). Always checks pace (seconds per mora against the style median), silence, clipping and
loudness (+-1.5 LU of -19). Recognition errors are possible, so read the flagged lines before regenerating.

## Crowd loops

Each loop is `pad + d + pad` seconds, `pad = 0.25`, `d = 20`, and periodic with period `d`: the file is the last `pad`
seconds of the loop, then the whole loop, then the first `pad` seconds. The engine plays `loopStart = pad`,
`loopEnd = pad + d`, so the seam is the same whatever delay a decoder adds. Stereo MP3 112 kbps, mono MP3 64 kbps
(44.1 kHz). All six are normalised to -18 LUFS integrated (the game's synthetic `bed:walla`), true peak under -2 dBTP.
The loops themselves are the 20 s crossfaded excerpts (1.5 s equal-power crossfade of tail into head) from the field
recordings listed in `assets/audio/CREDITS.md`; the exact cut points are in the notes of the source project (Hanshin B1
230.0 s, Nanba arcade 150.0 s, Osaka Station 45.5 s, each 21.5 s long before the crossfade).
