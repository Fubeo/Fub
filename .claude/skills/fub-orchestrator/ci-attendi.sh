#!/usr/bin/env bash
# ci-attendi.sh <pr> [giri]
# Aspetta la CI di una PR senza spendere token: un solo esito, alla fine.
# Segue anche il commit del robot delle baseline e la sua corsa di riuso.
# Sola lettura: non rilancia, non unisce, non commenta. Va lanciato in
# background (skill fub-orchestrator); FUB_GH_REPO cambia il repository.
set -u
repo=${FUB_GH_REPO:-Fubeo/Fub}
pr=$1
giri=${2:-3}
testa() { gh pr view "$pr" -R "$repo" --json headRefOid,state -q '"\(.headRefOid) \(.state)"'; }
corse() { gh api "repos/$repo/actions/runs?head_sha=$1&per_page=50" -q '.workflow_runs[] | "\(.id)\t\(.path)\t\(.event)\t\(.status)\t\(.conclusion // "-")"'; }

for ((g = 0; g < giri; g++)); do
  read -r sha stato < <(testa)
  while :; do
    [ "$stato" = OPEN ] || { echo "PR #$pr: $stato"; exit 0; }
    elenco=$(corse "$sha" 2> /dev/null) || elenco=""
    ci=$(printf '%s\n' "$elenco" | awk -F'\t' '$2 ~ /ci\.yml$/ && $5 != "action_required"' | head -1)
    aperte=$(printf '%s\n' "$elenco" | awk -F'\t' 'NF && $4 != "completed"' | wc -l)
    if [ -n "$ci" ] && [ "$aperte" -eq 0 ]; then break; fi
    sleep 150
    read -r nuova stato < <(testa)
    [ "$nuova" = "$sha" ] || sha=$nuova
  done

  id=$(printf '%s' "$ci" | cut -f1)
  lavori=$(gh api "repos/$repo/actions/runs/$id/jobs?per_page=100" -q '.jobs[] | "\(.conclusion // "-")\t\(.id)\t\(.name)"')
  conta() { printf '%s\n' "$lavori" | awk -F'\t' -v c="$1" '$1 == c' | wc -l; }
  echo "PR #$pr @ ${sha:0:9} · corsa $id ($(printf '%s' "$ci" | cut -f3)): $(conta success) verdi, $(conta failure) rossi, $(conta skipped) saltati, $(conta cancelled) annullati"
  printf '%s\n' "$elenco" | awk -F'\t' '$2 !~ /ci\.yml$/ && $5 != "success" && $5 != "skipped" && NF {print "  altra corsa " $1 " " $2 ": " $5}'
  rossi=$(printf '%s\n' "$lavori" | awk -F'\t' '$1 == "failure" || $1 == "cancelled" || $1 == "timed_out"')
  if [ -z "$rossi" ]; then echo "VERDE"; exit 0; fi
  while IFS=$'\t' read -r esito jid nome; do
    echo "  ✗ $nome ($esito, job $jid)"
    gh api "repos/$repo/actions/jobs/$jid/logs" 2> /dev/null \
      | grep -aE '✗|da guardare|AssertionError|FAIL |color-contrast|tab-order|heading-order|error(\[|:)|panicked|##\[error\]' \
      | sed -E 's/^[0-9T:.-]+Z //' | cut -c1-220 | head -25 | sed 's/^/      /'
  done <<< "$rossi"
  # Solo il banco visivo rosso: il robot committa le foto e parte il riuso.
  altri=$(printf '%s\n' "$rossi" | grep -vc 'banco visivo')
  if [ "$altri" -ne 0 ]; then echo "ROSSO"; exit 1; fi
  echo "  solo il banco visivo: aspetto il commit del robot"
  for ((i = 0; i < 12; i++)); do
    sleep 60
    read -r nuova stato < <(testa)
    [ "$nuova" = "$sha" ] || break
  done
  if [ "$nuova" = "$sha" ]; then echo "ROSSO (nessun commit del robot in 12 minuti)"; exit 1; fi
  echo "  commit del robot ${nuova:0:9}: $(gh api "repos/$repo/commits/$nuova" -q '.commit.author.name + " · " + ([.files[].filename | split("/") | last] | join(" "))' | cut -c1-600)"
done
echo "ROSSO (ancora rosso dopo $giri giri)"
exit 1
