#!/usr/bin/env bash
# Bring a mix to -16 LUFS with one linear gain, catch the few loud peaks (booms, stamps)
# with a fast limiter under -1.5 dBTP, and mux it onto the silent render.
# Usage: ./finish.sh <mix.wav> <silent.mp4> <out.mp4>
set -euo pipefail
mix="$1"; silent="$2"; out="$3"
measure() { ffmpeg -hide_banner -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | awk '/Summary:/{s=1} s'; }
I=$(measure "$mix" | awk '/ I:/{print $2; exit}')
gain=$(python3 -c "print(round(-16 - ($I), 2))")
norm="${mix%.wav}-norm.wav"
ffmpeg -hide_banner -loglevel error -y -i "$mix" -af "volume=${gain}dB,alimiter=limit=0.8:attack=2:release=60:level=disabled" -ar 48000 -c:a pcm_s16le "$norm"
ffmpeg -hide_banner -loglevel error -y -i "$silent" -i "$norm" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$out"
echo "mix in: I=${I} LUFS, gain ${gain} dB"
measure "$out" | grep -E " I:| LRA:| Peak:" | tr -s ' '
