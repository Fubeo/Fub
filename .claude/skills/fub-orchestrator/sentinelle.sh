#!/usr/bin/env bash
# Le sentinelle dell'orchestrazione: controlli algoritmici che girano sempre,
# senza token (skill fub-orchestrator). Ogni riga: LIVELLO  AREA  messaggio.
#   ROSSO  = va sistemato adesso (rompe i check dei coder o perde lavoro)
#   GIALLO = da sistemare al prossimo giro
#   OK     = nei limiti (nascosto con --allarmi)
# Uso:
#   sentinelle.sh              tutto
#   sentinelle.sh --allarmi    solo GIALLO e ROSSO (per il Monitor)
#   sentinelle.sh --pulisci    toglie le copie dei coder finite (pulite, unite,
#                              ferme da 90 minuti, nessun processo dentro);
#                              i rami restano
# Esce con 2 se c'è almeno un ROSSO, 1 se un GIALLO, 0 altrimenti.
# Variabili facoltative: FUB_REPO (la copia principale del repository; di
# serie quella che contiene questo script, oppure quella della cartella
# corrente), FUB_INTEGRA (il worktree di
# integrazione; di serie l'ultimo su un ramo integra/*), FUB_CODA_DIR e
# FUB_CODA_POSTI (la coda dei controlli pesanti, se la macchina ne ha una).
# Nato il 2026-11-20: 83 copie dei coder finite avevano esaurito inotify.
set -u
qui=$(cd "$(dirname "$0")" && pwd)
comune=$(git -C "$qui" rev-parse --path-format=absolute --git-common-dir 2>/dev/null \
  || git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
REPO="${FUB_REPO:-$(dirname "$comune")}"
[ -d "$REPO/.git" ] || { echo "sentinelle: repository non trovato (lancialo dal repo o con FUB_REPO)" >&2; exit 3; }
INTEGRA="${FUB_INTEGRA:-$(git -C "$REPO" worktree list --porcelain | awk '/^worktree/{w=$2} /^branch refs\/heads\/integra\//{i=w} END{print i}')}"
solo_allarmi=0; pulisci=0
for a in "$@"; do
  case "$a" in --allarmi) solo_allarmi=1 ;; --pulisci) pulisci=1 ;; esac
done
peggio=0
riga() { # livello area messaggio
  case "$1" in ROSSO) peggio=2 ;; GIALLO) [ $peggio -lt 1 ] && peggio=1 ;; esac
  [ $solo_allarmi -eq 1 ] && [ "$1" = OK ] && return
  printf '%-6s %-10s %s\n' "$1" "$2" "$3"
}

# 1. Disco.
libero=$(command df -BG --output=avail / | tail -1 | tr -dc 0-9)
if [ "$libero" -lt 60 ]; then riga ROSSO disco "${libero} GB liberi: cargo clean e copie finite, subito"
elif [ "$libero" -lt 150 ]; then riga GIALLO disco "${libero} GB liberi"
else riga OK disco "${libero} GB liberi"; fi

# 2. inotify: cartelle osservate e istanze, di tutti i processi dell'utente.
max_w=$(cat /proc/sys/fs/inotify/max_user_watches)
max_i=$(cat /proc/sys/fs/inotify/max_user_instances)
watch=0; ist=0; chi=""; chi_n=0
for fd in $(find /proc/[0-9]*/fd -lname 'anon_inode:inotify' 2>/dev/null); do
  pid=${fd#/proc/}; pid=${pid%%/*}; n=${fd##*/}
  c=$(grep -c '^inotify' "/proc/$pid/fdinfo/$n" 2>/dev/null); c=${c:-0}
  watch=$((watch + c)); ist=$((ist + 1))
  if [ "$c" -gt "$chi_n" ]; then chi_n=$c; chi=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-40); fi
done
pw=$((watch * 100 / max_w)); pi=$((ist * 100 / max_i))
msg="cartelle osservate $watch/$max_w ($pw%), istanze $ist/$max_i; il più grosso: $chi ($chi_n)"
if [ $pw -ge 85 ] || [ $pi -ge 85 ]; then riga ROSSO inotify "$msg"
elif [ $pw -ge 60 ] || [ $pi -ge 60 ]; then riga GIALLO inotify "$msg"
else riga OK inotify "$msg"; fi

# 3. Memoria e carico.
disp=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)
if [ "$disp" -lt 4 ]; then riga ROSSO memoria "${disp} GB disponibili"
elif [ "$disp" -lt 8 ]; then riga GIALLO memoria "${disp} GB disponibili"
else riga OK memoria "${disp} GB disponibili"; fi
carico=$(cut -d' ' -f1 /proc/loadavg); c=${carico%.*}; nt=$(nproc)
if [ "$c" -ge $((nt * 6)) ]; then riga ROSSO carico "$carico su $nt thread: i test di tempo scadono (118 il 17/11)"
elif [ "$c" -ge $((nt * 4)) ]; then riga GIALLO carico "$carico su $nt thread"
else riga OK carico "$carico su $nt thread"; fi

# 4. Coda dei controlli pesanti: posti occupati (solo se la macchina ne ha una).
coda="${FUB_CODA_DIR:-$HOME/.cache/fub-coda}"
if [ -d "$coda" ]; then
  posti=${FUB_CODA_POSTI:-2}; occ=0
  for i in $(seq 1 "$posti"); do
    flock -n "$coda/posto-$i.lock" true 2>/dev/null || occ=$((occ + 1))
  done
  riga OK coda "posti occupati $occ/$posti"
fi

# 5. Copie di lavoro dei coder.
cd "$REPO" || exit 3
punta=$(git -C "${INTEGRA:-$REPO}" rev-parse HEAD 2>/dev/null)
[ -n "$INTEGRA" ] || punta=$(git rev-parse origin/main)
finite=(); attive=0; altre=0; grosse=""
while read -r w h; do
  case "$w" in "$REPO"/.claude/worktrees/agent-*) ;; *) continue ;; esac
  [ -d "$w" ] || continue
  id=${w##*agent-}
  t=""; [ $solo_allarmi -eq 0 ] || [ "$libero" -lt 150 ] && t=$(timeout 30 du -s --block-size=1G "$w/target" 2>/dev/null | cut -f1)
  [ -n "$t" ] && [ "$t" -ge 60 ] && grosse="$grosse ${id:0:8}=${t}G"
  sporca=$(git -C "$w" status --porcelain --untracked-files=no 2>/dev/null | head -1)
  unita=0
  { git merge-base --is-ancestor "$h" "$punta" 2>/dev/null || git merge-base --is-ancestor "$h" origin/main 2>/dev/null; } && unita=1
  recente=$(find "$w" \( -name target -o -name node_modules -o -name .git \) -prune -o -type f -mmin -90 -print -quit 2>/dev/null)
  dentro=$(for p in /proc/[0-9]*/cwd; do readlink "$p" 2>/dev/null; done | grep -c "^$w")
  if [ -z "$sporca" ] && [ $unita -eq 1 ] && [ -z "$recente" ] && [ "$dentro" -eq 0 ]; then finite+=("$w")
  elif [ -n "$recente" ] || [ "$dentro" -gt 0 ]; then attive=$((attive + 1))
  else altre=$((altre + 1)); fi
done < <(git worktree list --porcelain | awk '/^worktree/{w=$2}/^HEAD/{print w, $2}')
if [ ${#finite[@]} -gt 0 ] && [ $pulisci -eq 1 ]; then
  tolte=0
  for w in "${finite[@]}"; do
    git worktree unlock "$w" 2>/dev/null
    nice -n 19 git worktree remove "$w" 2>/dev/null && tolte=$((tolte + 1))
  done
  riga OK copie "tolte $tolte copie finite (rami tenuti)"
  finite=()
fi
msg="attive $attive, finite ${#finite[@]}, ferme non unite $altre"
if [ ${#finite[@]} -ge 10 ]; then riga ROSSO copie "$msg: sentinelle.sh --pulisci"
elif [ ${#finite[@]} -ge 1 ]; then riga GIALLO copie "$msg: sentinelle.sh --pulisci"
elif [ $altre -ge 1 ]; then riga GIALLO copie "$msg: guardale (lavoro non unito, fermo da 90 minuti)"
else riga OK copie "$msg"; fi
[ -n "$grosse" ] && riga GIALLO target "oltre 60 GB:$grosse"
t=""; [ -n "$INTEGRA" ] && { [ $solo_allarmi -eq 0 ] || [ "$libero" -lt 150 ]; } && t=$(timeout 60 du -s --block-size=1G "$INTEGRA/target" 2>/dev/null | cut -f1)
[ -n "$t" ] && [ "$t" -ge 80 ] && riga GIALLO target "integra ${t}G: cargo clean dopo il push"

# 6. Rami dei coder già uniti e senza copia.
rami=0
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/worktree-agent-*); do
  git worktree list --porcelain | grep -q "branch refs/heads/$b$" && continue
  git merge-base --is-ancestor "$b" "$punta" 2>/dev/null && rami=$((rami + 1))
done
[ $rami -ge 20 ] && riga GIALLO rami "$rami rami worktree-agent-* uniti senza copia: git branch -D dopo il controllo"
[ $rami -lt 20 ] && riga OK rami "$rami rami worktree-agent-* uniti senza copia"

# 7. Il worktree di integrazione: niente modifiche lasciate, niente sonde.
if [ -n "$INTEGRA" ]; then
sporco=$(git -C "$INTEGRA" status --porcelain --untracked-files=no | wc -l)
sonde=$(git -C "$INTEGRA" status --porcelain --ignored 2>/dev/null | grep -c '\.probe')
[ "$sporco" -gt 0 ] && riga GIALLO integra "$sporco file modificati e non registrati"
[ "$sonde" -gt 0 ] && riga GIALLO integra "$sonde sonde .probe rimaste"
[ "$sporco" -eq 0 ] && [ "$sonde" -eq 0 ] && riga OK integra "pulito"
fi

# 8. Processi rimasti appesi in cartelle tolte (Vite, Chromium, banco).
orfani=$(for p in /proc/[0-9]*; do
  c=$(readlink "$p/cwd" 2>/dev/null) || continue
  case "$c" in *"(deleted)"*) case "$c" in *Fub*|*fub*)
    # Gli aiutanti di Flatpak (p11-kit) li avvia il sistema: non sono nostri.
    tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q 'flatpak' || echo "${p#/proc/}" ;; esac ;; esac
done | wc -l)
if [ "$orfani" -gt 0 ]; then riga GIALLO processi "$orfani processi in cartelle già tolte (guardali con ps, mai pkill generico)"
else riga OK processi "nessun processo in cartelle tolte"; fi

# 9. Porte del banco occupate da copie che non esistono più.
porte=""
while read -r porta pid; do
  c=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue
  [ -d "$c" ] || porte="$porte $porta"
done < <(ss -ltnpH 2>/dev/null | awk '$4 ~ /127\.0\.0\.1:14[3-9][0-9]$/ { split($4,a,":"); if (match($0,/pid=[0-9]+/)) print a[2], substr($0,RSTART+4,RLENGTH-4) }')
[ -n "$porte" ] && riga GIALLO porte "porte del banco tenute da copie tolte:$porte"

# 10. Attese eterne: cicli `until` lanciati dalle sessioni di Claude e vivi da
# più di 3 ore. Il caso tipico: `until ! pgrep -f "X"` trova sé stesso (la
# stringa X è nella sua riga di comando) e non finisce mai; 47 così il 20/11,
# alcuni vivi da tre giorni, ognuno svegliato ogni 5–15 s.
claude_pid=$(pgrep -u "$USER" -x claude | paste -sd,)
eterne=""
if [ -n "$claude_pid" ]; then
  eterne=$(ps -o pid=,etimes=,args= --ppid "$claude_pid" 2>/dev/null \
    | awk '$2 > 10800 && /until/ { print $1 }' | paste -sd' ')
fi
if [ -n "$eterne" ]; then riga GIALLO attese "cicli until vivi da oltre 3 ore: $eterne (guardali con ps -o args= -p, poi kill per numero)"
else riga OK attese "nessun ciclo until vecchio"; fi

exit $peggio
