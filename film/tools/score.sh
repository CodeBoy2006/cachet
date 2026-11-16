#!/bin/sh
# Re-renders the synthesised score and stores the lossless copy the player loads.
# Needs the film dev server running (npm run dev).
set -e
cd "$(dirname "$0")/.."
node tools/audio.mjs assets/score.wav
ffmpeg -loglevel error -y -i assets/score.wav -c:a flac -compression_level 8 assets/score.flac
rm assets/score.wav
ls -la assets/score.flac
