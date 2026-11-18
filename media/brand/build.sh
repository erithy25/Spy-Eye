#!/usr/bin/env bash
#
# Sicht — Markenfilm. Baut den Schnitt aus den erzeugten Aufnahmen, den Texttafeln und einem
# Tonbett neu auf.
#
#   ./build.sh              alles: Aufnahmen angleichen, Tafeln, Schnitt, Ton
#   ./build.sh shots        nur raw/*.kling.mp4 -> shots/*.mp4 (1920x1080, 25 B/s, Schwarzweiß)
#   ./build.sh cards        nur die Tafeln nach cards/
#   ./build.sh web          aus der fertigen Datei eine leichte 720p-Fassung für die Website
#   BED=synth ./build.sh    das Tonbett mit ffmpeg erzeugen statt audio/bed-elevenlabs.mp3 zu nehmen
#   OUT=datei.mp4 ./build.sh
#   END_NOTE='BILDSCHIRMAUFNAHME DER KONSOLE · ÜBUNGSDATEN · ERPROBUNGSSTAND' SEQ=ablauf-produktfilm.txt OUT=sicht-produktfilm.mp4 MUSIC=audio/bed-lang.mp3 CLIP_W=1728 CLIP_H=972 ./build.sh
#                           Produktfilm aus der Bildschirmaufnahme der Konsole (media/product/take.mp4)
#   SEQ=ablauf.txt OUT=sicht-markenfilm-lang.mp4 ./build.sh
#                           anderer Ablauf aus einer Datei (eine Zeile je Eintrag, # = Kommentar);
#                           Pfade gelten ab diesem Ordner
#
# Braucht nur ffmpeg (>= 6, mit libfreetype und libx264) und awk. Die gesperrten Schriften in
# fonts/SichtCard-*.ttf sind aus JetBrains Mono abgeleitet (tools/track_font.py); sie liegen
# bei, das Python-Werkzeug wird nur gebraucht, wenn sich die Sperrung ändern soll.
#
# Der Ablauf des Films steht unten in SEQUENCE. Bildschirmaufnahmen der Konsole werden dort
# als "clip|..."-Zeilen eingefügt; Dauer, Tonbett und die Ticks der Tafeln rechnen sich neu.

set -euo pipefail
export LC_ALL=C.UTF-8
cd "$(dirname "$0")"

# ------------------------------------------------------------------ Ablauf
#
#   card|<kennung>|<sekunden>|<fußzeile oder leer>|<zeile 1>|<zeile 2>...
#   shot|<datei in shots/>|<start s>|<dauer s>
#   clip|<pfad>|<start s>|<dauer s>|<beschriftung oder leer>     Bildschirmaufnahme, eingerückt
#   mark|turn                                                    ab hier hellt das Tonbett auf
#   end|<sekunden>
#
# Tafeln: rund 18 Zeichen je Sekunde Lesezeit plus eine halbe Sekunde. Text in Versalien.

QUELLE='QUELLEN: DPA, EPD · OKTOBER 2022'

SEQUENCE=(
  "card|01-datum|2.4||AHRTAL · 14. JULI 2021 · 22:14 UHR"
  "shot|01-tal-daemmerung.mp4|0.6|3.0"
  "card|02-hubschrauber|3.2|$QUELLE|EIN POLIZEIHUBSCHRAUBER FILMT|MENSCHEN AUF DÄCHERN."
  "shot|07-hubschrauber-nacht.mp4|0.8|3.2"
  "card|03-nicht-weitergegeben|2.8|$QUELLE|DIE AUFNAHMEN WERDEN NICHT WEITERGEGEBEN."
  "shot|08-leerer-leitstand.mp4|0.6|3.0"
  "card|04-keiner-sieht|2.9||BILDER, DIE KEINER SIEHT,|HELFEN NIEMANDEM."
  "mark|turn"
  "card|05-durchsuchbar|3.2||SICHT MACHT EINSATZBILDER|IN SEKUNDEN DURCHSUCHBAR."
  "shot|04-tastatur.mp4|1.0|1.8"
  # --- Hier die Bildschirmaufnahmen der Konsole einfügen, zum Beispiel:
  # "clip|../../deliverables/film/suche.mp4|0|6.0|KONSOLE · ÜBUNGSDATEN"
  # "clip|../../deliverables/film/lage.mp4|2.0|5.0|KONSOLE · ÜBUNGSDATEN"
  "shot|02-bruecke-treibgut.mp4|1.4|2.2"
  "shot|03-lagezentrum.mp4|1.0|2.6"
  "card|06-ohne-identifizierung|2.3||OHNE PERSONEN ZU IDENTIFIZIEREN."
  "shot|06-tal-morgen.mp4|0.8|2.8"
  "end|4.2"
)
# Nicht im ersten Schnitt, aber angeglichen vorhanden: shots/05-drohne-morgen.mp4,
# shots/07a-hubschrauber-nacht.mp4.

# Ein Ablauf aus einer Datei ersetzt den obigen; seine Tafeln liegen in einem eigenen Ordner.
CARDS_DIR=cards
if [[ -n ${SEQ:-} ]]; then
  CARDS_DIR="cards/$(basename "$SEQ" .txt)"
  SEQUENCE=()
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line%$'\r'}
    [[ -z ${line//[[:space:]]/} || ${line#"${line%%[![:space:]]*}"} == \#* ]] && continue
    SEQUENCE+=("$line")
  done < "$SEQ"
fi

OUT=${OUT:-sicht-markenfilm-v1.mp4}
BED=${BED:-auto}
MUSIC=${MUSIC:-audio/bed-elevenlabs.mp3}
MUSIC_TURN=${MUSIC_TURN:-21.2}   # Sekunde, in der im Musikstück der helle Klang einsetzt; wird auf "mark|turn" gelegt
SHOT_LABEL='SYMBOLBILD · KI-GENERIERT'
END_WORD='SICHT'
END_LINE='KEINE SICHT OHNE AUFSICHT.'
END_NOTE=${END_NOTE:-'SYMBOLBILDER, KI-GENERIERT · ERPROBUNGSSTAND'}

# ------------------------------------------------------------------ Maße und Farben

W=1920; H=1080; FPS=25
BG=0x050505; FG=0xededed; MID=0x8a8a8a; LOW=0x555555; RULE=0x333333

F_TEXT=fonts/SichtCard-Regular-t150.ttf    # Zeichenzelle = 0,75 x Schriftgröße
F_LABEL=fonts/SichtCard-Regular-t250.ttf   # Zeichenzelle = 0,85 x Schriftgröße
F_WORD=fonts/SichtCard-Medium-t540.ttf     # Zeichenzelle = 1,14 x Schriftgröße

IN=64          # Abstand der Eckmarken vom Bildrand
ARM=34         # Schenkellänge der Eckmarken
THK=2          # Strichstärke

FS=36          # Tafeltext; durch 4 teilbar, damit die Zeichenzelle ganze Pixel hat
STEP=27        # 0,75 x FS
CAP=26         # Versalhöhe
LH=68          # Zeilenabstand
MASK_UP=40; MASK_H=54
CUR_W=20; CUR_H=30; CUR_UP=28
LABEL_FS=20; LABEL_STEP=17

TYPE_START=0.16   # Sekunden bis zum ersten Zeichen
TYPE_DT=0.02      # Sekunden je Zeichen
TYPE_GAP=0.10     # Pause zwischen zwei Zeilen
CUR_HOLD=0.36     # so lange steht die Schreibmarke nach dem letzten Zeichen

CLIP_W=${CLIP_W:-1600}; CLIP_H=${CLIP_H:-900}   # Bildschirmaufnahmen stehen eingerückt in den Eckmarken
GRAIN=6                   # Filmkorn auf den Aufnahmen (0 = keins)

SEG_ENC=(-c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p -r "$FPS" -an)
FF=(ffmpeg -hide_banner -loglevel error -y)

mkdir -p shots "$CARDS_DIR" work/seg work/txt audio

calc() { awk "BEGIN { printf \"%.3f\", $* }"; }
round() { awk "BEGIN { printf \"%d\", ($*) + 0.5 }"; }

# Vier Eckmarken um ein Rechteck: x0 y0 x1 y1 farbe [strichstärke] [schenkellänge]
brackets() {
  local x0=$1 y0=$2 x1=$3 y1=$4 c=$5 k=${6:-$THK} a=${7:-$ARM}
  local r=$((x1 - a)) b=$((y1 - a)) rt=$((x1 - k)) bt=$((y1 - k))
  printf 'drawbox=x=%d:y=%d:w=%d:h=%d:color=%s:t=fill,' \
    "$x0" "$y0" "$a" "$k" "$c"  "$x0" "$y0" "$k" "$a" "$c" \
    "$r"  "$y0" "$a" "$k" "$c"  "$rt" "$y0" "$k" "$a" "$c" \
    "$x0" "$bt" "$a" "$k" "$c"  "$x0" "$b"  "$k" "$a" "$c" \
    "$r"  "$bt" "$a" "$k" "$c"  "$rt" "$b"  "$k" "$a" "$c" | sed 's/,$//'
}

# Eckmarken über bewegtem Bild: dunkel unterlegt, damit sie auch vor hellem Himmel stehen.
brackets_on_footage() {
  local x0=$1 y0=$2 x1=$3 y1=$4
  printf '%s,%s' \
    "$(brackets $((x0 - 1)) $((y0 - 1)) $((x1 + 1)) $((y1 + 1)) "$BG@0.55" $((THK + 2)) $((ARM + 2)))" \
    "$(brackets "$x0" "$y0" "$x1" "$y1" "$FG@0.9")"
}

# Schreibt einen Text in eine Datei und gibt deren Pfad aus (umgeht jedes Maskieren im Filter).
textfile() {
  local file="work/txt/$1.txt"
  printf '%s' "$2" > "$file"
  printf '%s' "$file"
}

# ------------------------------------------------------------------ Aufnahmen angleichen

# 24 -> 25 Bilder/s ohne Bilddopplung (4 % schneller), auf 1920x1080, reines Schwarzweiß,
# leichte Gradation. Ergebnis ohne Korn und ohne Einblendungen, damit es frei verwendbar
# bleibt; das Korn kommt erst im Schnitt dazu (GRAIN).
normalise_shots() {
  local src name
  for src in raw/*.kling.mp4; do
    name=$(basename "$src" .kling.mp4)
    "${FF[@]}" -i "$src" -an -vf "setpts=PTS*24/25,fps=$FPS,scale=$W:$H:flags=lanczos,format=gray,\
eq=contrast=1.06:gamma=0.98,curves=all='0/0 0.15/0.11 0.5/0.5 0.85/0.89 1/1',\
unsharp=5:5:0.4:5:5:0,format=yuv420p" \
      -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r "$FPS" -movflags +faststart "shots/$name.mp4"
    echo "shots/$name.mp4  $(ffprobe -v error -show_entries format=duration -of csv=p=0 "shots/$name.mp4") s"
  done
}

# ------------------------------------------------------------------ Tafeln

# render_card <ausgabe> <sekunden> <fußzeile> <zeile>...
# Die Zeilen werden Zeichen für Zeichen aufgedeckt: eine Blende in Grundfarbe wandert in
# Zellenschritten nach rechts, davor läuft eine Schreibmarke.
render_card() {
  local out=$1 dur=$2 foot=$3; shift 3
  local n=$# i=0 line len x0 y end hold prev tf
  local block=$(( (n - 1) * LH + CAP ))
  local base=$(( (H - block) / 2 + CAP ))
  local t0=$TYPE_START
  local id; id=$(basename "$out" .mp4)

  local graph="color=c=$BG:s=${W}x${H}:r=$FPS:d=$dur,format=yuv420p[bg];"
  graph+="color=c=$BG:s=${W}x${MASK_H}:r=$FPS:d=$dur,format=yuv420p,split=$n"
  for ((i = 0; i < n; i++)); do graph+="[m$i]"; done
  graph+=";color=c=$FG:s=${CUR_W}x${CUR_H}:r=$FPS:d=$dur,format=yuv420p,split=$n"
  for ((i = 0; i < n; i++)); do graph+="[c$i]"; done
  graph+=";[bg]"

  local -a xs=() ys=() lens=()
  i=0
  for line in "$@"; do
    len=${#line}
    x0=$(( (W - (len * STEP - 5)) / 2 ))
    y=$(( base + i * LH ))
    xs+=("$x0"); ys+=("$y"); lens+=("$len")
    tf=$(textfile "$id-$i" "$line")
    graph+="drawtext=fontfile=$F_TEXT:textfile=$tf:expansion=none:fontsize=$FS:fontcolor=$FG:x=$x0:y=$y-ascent,"
    i=$((i + 1))
  done
  graph="${graph%,}[t];"

  prev=t
  for ((i = 0; i < n; i++)); do
    x0=${xs[$i]}; y=${ys[$i]}; len=${lens[$i]}
    end=$(calc "$t0 + $len * $TYPE_DT")
    hold=$TYPE_GAP
    if ((i == n - 1)); then hold=$CUR_HOLD; fi
    graph+="[$prev][m$i]overlay=x='$x0+$STEP*floor(max(0,t-$t0)/$TYPE_DT+0.001)':y=$((y - MASK_UP)):eval=frame[a$i];"
    graph+="[a$i][c$i]overlay=x='$x0+$STEP*min($len,floor(max(0,t-$t0)/$TYPE_DT+0.001))':y=$((y - CUR_UP)):eval=frame"
    graph+=":enable='between(t,$t0,$(calc "$end + $hold"))'[b$i];"
    prev=b$i
    t0=$(calc "$end + $TYPE_GAP")
  done

  graph+="[$prev]$(brackets "$IN" "$IN" $((W - IN)) $((H - IN)) "$MID")"
  if [[ -n $foot ]]; then
    tf=$(textfile "$id-foot" "$foot")
    graph+=",drawtext=fontfile=$F_LABEL:textfile=$tf:expansion=none:fontsize=$LABEL_FS:fontcolor=$MID:x=$((IN + ARM + 18)):y=h-$((IN + 8))-text_h"
  fi
  graph+="[v]"
  "${FF[@]}" -filter_complex "$graph" -map "[v]" -t "$dur" "${SEG_ENC[@]}" "$out"
}

# Schlusstafel: Wortmarke, Haarlinie, Leitsatz, Hinweis.
render_end() {
  local out=$1 dur=$2
  local word_fs=150 word_step=171 line_fs=40 line_step=30
  local width=$(( ${#END_WORD} * word_step - 81 ))             # sichtbare Breite der Wortmarke
  local x0=$(( (W - width) / 2 ))
  local word_cap=110 line_cap=29
  local top=$(( (H - (word_cap + 46 + 1 + 40 + line_cap)) / 2 ))
  local word_y=$(( top + word_cap )) rule_y=$(( top + word_cap + 46 )) line_y=$(( top + word_cap + 46 + 1 + 40 + line_cap ))
  local line_w=$(( ${#END_LINE} * line_step - 6 ))
  local line_x=$(( (W - line_w) / 2 ))
  local note_w=$(( ${#END_NOTE} * LABEL_STEP - 5 ))
  local note_x=$(( (W - note_w) / 2 ))
  local t_word=0.40 dt_word=0.11
  local t_rule t_line t_line_end
  t_rule=$(calc "$t_word + ${#END_WORD} * $dt_word + 0.12")
  t_line=$(calc "$t_rule + 0.16")
  t_line_end=$(calc "$t_line + ${#END_LINE} * $TYPE_DT")
  local tw tl tn
  tw=$(textfile end-word "$END_WORD"); tl=$(textfile end-line "$END_LINE"); tn=$(textfile end-note "$END_NOTE")

  local graph="color=c=$BG:s=${W}x${H}:r=$FPS:d=$dur,format=yuv420p[bg];"
  graph+="color=c=$BG:s=${W}x170:r=$FPS:d=$dur,format=yuv420p[mw];"
  graph+="color=c=$BG:s=${W}x${MASK_H}:r=$FPS:d=$dur,format=yuv420p[ml];"
  graph+="color=c=$FG:s=22x33:r=$FPS:d=$dur,format=yuv420p[cl];"
  graph+="[bg]drawtext=fontfile=$F_WORD:textfile=$tw:expansion=none:fontsize=$word_fs:fontcolor=$FG:x=$x0:y=$word_y-ascent,"
  graph+="drawtext=fontfile=$F_TEXT:textfile=$tl:expansion=none:fontsize=$line_fs:fontcolor=$FG:x=$line_x:y=$line_y-ascent[t];"
  graph+="[t][mw]overlay=x='$x0+$word_step*floor(max(0,t-$t_word)/$dt_word+0.001)':y=$((word_y - 135)):eval=frame[a];"
  graph+="[a][ml]overlay=x='$line_x+$line_step*floor(max(0,t-$t_line)/$TYPE_DT+0.001)':y=$((line_y - MASK_UP - 2)):eval=frame[b];"
  graph+="[b][cl]overlay=x='$line_x+$line_step*min(${#END_LINE},floor(max(0,t-$t_line)/$TYPE_DT+0.001))':y=$((line_y - 31)):eval=frame"
  graph+=":enable='between(t,$t_line,$(calc "$t_line_end + $CUR_HOLD"))'[c];"
  graph+="[c]drawbox=x=$x0:y=$rule_y:w=$width:h=1:color=$RULE:t=fill:enable='gte(t,$t_rule)',"
  graph+="$(brackets "$IN" "$IN" $((W - IN)) $((H - IN)) "$MID"),"
  graph+="drawtext=fontfile=$F_LABEL:textfile=$tn:expansion=none:fontsize=$LABEL_FS:fontcolor=$MID:x=$note_x:y=h-$((IN + 8))-text_h[v]"
  "${FF[@]}" -filter_complex "$graph" -map "[v]" -t "$dur" "${SEG_ENC[@]}" "$out"
}

# ------------------------------------------------------------------ Aufnahmen und Einschübe

# render_shot <ausgabe> <datei in shots/> <start> <dauer>
render_shot() {
  local out=$1 file=$2 start=$3 dur=$4 tf
  tf=$(textfile shot-label "$SHOT_LABEL")
  "${FF[@]}" -ss "$start" -t "$dur" -i "shots/$file" -vf "noise=c0s=$GRAIN:c0f=t+u,\
$(brackets_on_footage "$IN" "$IN" $((W - IN)) $((H - IN))),\
drawtext=fontfile=$F_LABEL:textfile=$tf:expansion=none:fontsize=$LABEL_FS:fontcolor=$FG@0.92:\
box=1:boxcolor=$BG@0.55:boxborderw=9:x=$((IN + ARM + 18)):y=h-$((IN + 8))-text_h,format=yuv420p" \
    -t "$dur" "${SEG_ENC[@]}" "$out"
}

# render_clip <ausgabe> <pfad> <start> <dauer> <beschriftung>
# Bildschirmaufnahme beliebiger Größe: eingepasst, auf Grundfarbe gesetzt, von Eckmarken gefasst.
render_clip() {
  local out=$1 file=$2 start=$3 dur=$4 label=$5 tf
  local cx=$(( (W - CLIP_W) / 2 )) cy=$(( (H - CLIP_H) / 2 ))
  local vf="fps=$FPS,scale=$CLIP_W:$CLIP_H:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,"
  vf+="pad=$W:$H:(ow-iw)/2:(oh-ih)/2:color=$BG,"
  vf+="$(brackets $((cx - 16)) $((cy - 16)) $((cx + CLIP_W + 16)) $((cy + CLIP_H + 16)) "$MID")"
  if [[ -n $label ]]; then
    tf=$(textfile "clip-label-$(basename "$out" .mp4)" "$label")
    vf+=",drawtext=fontfile=$F_LABEL:textfile=$tf:expansion=none:fontsize=$LABEL_FS:fontcolor=$MID:x=$((cx - 16)):y=$((cy + CLIP_H + 30))"
  fi
  vf+=",format=yuv420p"
  "${FF[@]}" -ss "$start" -t "$dur" -i "$file" -vf "$vf" -t "$dur" "${SEG_ENC[@]}" "$out"
}

# ------------------------------------------------------------------ Ton

# build_audio <gesamtdauer> <zeit der aufhellung> <tick-zeiten...>
build_audio() {
  local total=$1 turn=$2; shift 2
  local -a ticks=("$@") inputs=()
  local graph="" i=0 ms use_music=0 music_len fade_out

  fade_out=$(calc "$total - 2.6")
  # Das Musikstück wird so verschoben, dass sein heller Klang auf die Aufhellung fällt.
  local offset lead=0 skip=0
  offset=$(calc "$MUSIC_TURN - $turn")
  if awk "BEGIN { exit !($offset >= 0) }"; then skip=$offset; else lead=$(round "(-1 * ($offset)) * 1000"); fi
  if [[ $BED != synth && -f $MUSIC ]]; then
    music_len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MUSIC")
    if awk "BEGIN { exit !($music_len - $skip + $lead / 1000 >= $total) }"; then use_music=1; fi
  fi

  if ((use_music)); then
    inputs=(-i "$MUSIC")
    graph="[0:a]atrim=start=$skip,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,"
    graph+="adelay=${lead}|${lead},atrim=0:$total,afade=t=in:d=1.0,afade=t=out:st=$fade_out:d=2.6[bed];"
    echo "Tonbett: $MUSIC (ab ${skip} s, Vorlauf ${lead} ms)"
  else
    # Liegeton auf A mit langsamer Schwebung; ab der Aufhellung kommt ein Dur-Klang dazu.
    local lift="clip((t-$turn)/5,0,1)"
    local left="0.22*sin(2*PI*55*t)*(0.78+0.22*sin(2*PI*0.07*t))+0.13*sin(2*PI*55.37*t)"
    left+="+0.10*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.11*t+1))+0.07*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*0.05*t+2))"
    left+="+0.04*sin(2*PI*164.81*t)*(0.5+0.5*sin(2*PI*0.09*t))"
    left+="+$lift*(0.045*sin(2*PI*220*t)+0.034*sin(2*PI*277.18*t)+0.03*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*0.21*t)))"
    local right="0.22*sin(2*PI*55*t+0.6)*(0.78+0.22*sin(2*PI*0.07*t+0.9))+0.13*sin(2*PI*55.29*t)"
    right+="+0.10*sin(2*PI*82.41*t+0.4)*(0.6+0.4*sin(2*PI*0.11*t+2.1))+0.07*sin(2*PI*110*t+1.1)*(0.5+0.5*sin(2*PI*0.05*t+0.3))"
    right+="+0.04*sin(2*PI*164.81*t+0.7)*(0.5+0.5*sin(2*PI*0.09*t+1.6))"
    right+="+$lift*(0.045*sin(2*PI*220*t+0.5)+0.034*sin(2*PI*277.18*t+0.2)+0.03*sin(2*PI*329.63*t+1.3)*(0.6+0.4*sin(2*PI*0.21*t+1)))"
    inputs=(-f lavfi -i "aevalsrc=exprs='$left|$right':s=48000:d=$total"
            -f lavfi -i "anoisesrc=color=brown:amplitude=0.05:r=48000:d=$total")
    graph="[1:a]lowpass=f=300,pan=stereo|c0=c0|c1=c0[air];"
    graph+="[0:a][air]amix=inputs=2:normalize=0,afade=t=in:d=3.5,afade=t=out:st=$fade_out:d=2.6[bed];"
    echo "Tonbett: mit ffmpeg erzeugt"
  fi

  # Ein leiser Tick zu Beginn jeder Tafel.
  local mix="[bed]" count=1
  for ms in "${ticks[@]}"; do
    graph+="aevalsrc=exprs='0.26*sin(2*PI*1320*t)*exp(-85*t)+0.22*sin(2*PI*98*t)*exp(-20*t)':s=48000:d=0.5,"
    graph+="pan=stereo|c0=c0|c1=c0,adelay=${ms}|${ms}[k$i];"
    mix+="[k$i]"; i=$((i + 1)); count=$((count + 1))
  done
  graph+="${mix}amix=inputs=$count:normalize=0:duration=first[a]"
  "${FF[@]}" "${inputs[@]}" -filter_complex "$graph" -map "[a]" -t "$total" -c:a pcm_s16le work/audio-raw.wav

  # Auf feste Lautheit bringen: erst messen, dann eine einzige feste Verstärkung anwenden.
  local measured peak gain
  measured=$(ffmpeg -hide_banner -nostats -i work/audio-raw.wav -af loudnorm=I=-17:TP=-1.5:LRA=20:print_format=json -f null - 2>&1)
  local in_i in_tp
  in_i=$(printf '%s\n' "$measured" | sed -n 's/.*"input_i" *: *"\([-0-9.]*\)".*/\1/p' | tail -1)
  in_tp=$(printf '%s\n' "$measured" | sed -n 's/.*"input_tp" *: *"\([-0-9.]*\)".*/\1/p' | tail -1)
  gain=$(awk "BEGIN { g = -17 - ($in_i); m = -1.5 - ($in_tp); if (g > m) g = m; printf \"%.2f\", g }")
  "${FF[@]}" -i work/audio-raw.wav -af "volume=${gain}dB" -c:a pcm_s16le work/audio.wav
  echo "Ton: gemessen ${in_i} LUFS, Spitze ${in_tp} dBTP, Verstärkung ${gain} dB"
}

# ------------------------------------------------------------------ Schnitt

assemble() {
  local -a segs=() ticks=() fields=()
  local entry kind idx=0 seg dur total=0 turn="" out

  for entry in "${SEQUENCE[@]}"; do
    IFS='|' read -r -a fields <<< "$entry"
    kind=${fields[0]}
    seg=$(printf 'work/seg/%03d.mp4' "$idx")
    case $kind in
      card)
        out="$CARDS_DIR/${fields[1]}.mp4"
        render_card "$out" "${fields[2]}" "${fields[3]}" "${fields[@]:4}"
        cp "$out" "$seg"
        ticks+=("$(round "$total * 1000 + 40")")
        ;;
      shot) render_shot "$seg" "${fields[1]}" "${fields[2]}" "${fields[3]}" ;;
      clip) render_clip "$seg" "${fields[1]}" "${fields[2]}" "${fields[3]}" "${fields[4]:-}" ;;
      end)
        render_end "$CARDS_DIR/99-schluss.mp4" "${fields[1]}"
        cp "$CARDS_DIR/99-schluss.mp4" "$seg"
        ticks+=("$(round "$total * 1000 + 40")")
        ;;
      mark)
        turn=$total
        continue
        ;;
      *) echo "Unbekannte Zeile im Ablauf: $entry" >&2; exit 1 ;;
    esac
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$seg")
    printf '%6.2f s  +%5.2f  %s\n' "$total" "$dur" "$entry"
    total=$(calc "$total + $dur")
    segs+=("$seg")
    idx=$((idx + 1))
  done
  [[ -n $turn ]] || turn=$(calc "$total * 0.55")

  build_audio "$total" "$turn" "${ticks[@]}"

  local -a inputs=()
  local graph="" i=0
  for seg in "${segs[@]}"; do
    inputs+=(-i "$seg")
    graph+="[$i:v]"
    i=$((i + 1))
  done
  graph+="concat=n=${#segs[@]}:v=1:a=0,format=yuv420p[v]"
  "${FF[@]}" "${inputs[@]}" -i work/audio.wav -filter_complex "$graph" -map "[v]" -map "$i:a" \
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -r "$FPS" -c:a aac -b:a 192k \
    -movflags +faststart -shortest "$OUT"
  echo "$OUT  $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT") s"
}

render_cards_only() {
  local entry fields
  for entry in "${SEQUENCE[@]}"; do
    IFS='|' read -r -a fields <<< "$entry"
    case ${fields[0]} in
      card) render_card "$CARDS_DIR/${fields[1]}.mp4" "${fields[2]}" "${fields[3]}" "${fields[@]:4}"; echo "$CARDS_DIR/${fields[1]}.mp4" ;;
      end) render_end "$CARDS_DIR/99-schluss.mp4" "${fields[1]}"; echo "$CARDS_DIR/99-schluss.mp4" ;;
    esac
  done
}

# Leichte Fassung zum Einbetten: 1280x720, deutlich kleinere Datei.
render_web() {
  local web="${OUT%.mp4}-web.mp4"
  [[ -f $OUT ]] || { echo "$OUT fehlt; erst ./build.sh ausführen" >&2; exit 1; }
  "${FF[@]}" -i "$OUT" -vf "scale=1280:720:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 25 \
    -pix_fmt yuv420p -r "$FPS" -c:a aac -b:a 128k -movflags +faststart "$web"
  echo "$web  $(du -h "$web" | cut -f1)"
}

case ${1:-all} in
  shots) normalise_shots ;;
  cards) render_cards_only ;;
  web) render_web ;;
  all)
    if ! compgen -G "shots/*.mp4" > /dev/null; then normalise_shots; fi
    assemble
    ;;
  *) echo "Aufruf: $0 [all|shots|cards|web]" >&2; exit 1 ;;
esac
