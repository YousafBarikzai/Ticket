#!/usr/bin/env bash
#
# A render pass over every screen in the three web applications.
#
# Signs in as a real seeded person through the development sign-in, then asks
# for each route and checks two things: that it answered 200, and that what
# came back is not an error boundary — Next's, or one of ours. The second check
# is the point — a server component that throws still answers 200 in some
# configurations, and a status-code sweep would call that a pass. Our own
# boundaries (`ProblemState` in each `error.tsx`) say something friendly rather
# than "Application error", so they carry a `data-itsm-error-boundary`
# attribute for this script to find.
#
# Two more kinds of route are checked for what they must *not* be: a redirect
# is asked where it goes (`redirects`), and a gated route is asked for its
# exact status (`answers`) — `/tenants` is a 404 for anybody who is not a
# platform operator, not a 403 that would confirm it exists.
#
# It exists because a whole class of fault is invisible to everything else we
# run. `Table` carried a `'use client'` directive while its columns took a
# `cell` *function*, so every read-only table built by a server component threw
# at render. It type-checked, it built, 1362 unit tests passed, and each of
# those screens answered 500 in a browser — but only once it had a row to draw,
# which is why an empty development database hid it too.
#
# Not a substitute for a browser suite. It renders; it does not click, focus,
# or measure contrast. Those need a real browser and are still missing.
#
# Usage, with the API on :3000 and the three apps on :3100/:3200/:3300:
#
#   pnpm seed
#   pnpm --filter @itsm/api dev &
#   pnpm --filter @itsm/portal dev & pnpm --filter @itsm/workbench dev & pnpm --filter @itsm/admin dev &
#   infra/scripts/render-pass.sh
#
# The apps must be in development mode: the development sign-in refuses to
# exist in a production build, which is exactly what it is for.
set -u

PORTAL="${PORTAL_ORIGIN:-http://localhost:3200}"
WORKBENCH="${WORKBENCH_ORIGIN:-http://localhost:3100}"
ADMIN="${ADMIN_ORIGIN:-http://localhost:3300}"
TENANT="${TENANT_SLUG:-acme}"

JAR=$(mktemp -d)
trap 'rm -rf "$JAR"' EXIT
failures=0
jar=""

# Signs in and leaves the session cookie in $jar for the checks that follow.
sign_in() { # label origin email
  local label="$1" origin="$2" email="$3" code
  jar="$JAR/$label.txt"
  code=$(curl -s -o /dev/null -w '%{http_code}' -c "$jar" -b "$jar" \
    -X POST "$origin/api/session/dev" \
    -H "Origin: $origin" \
    --data-urlencode "tenantSlug=$TENANT" --data-urlencode "email=$email" -m 20)
  if [ "$code" != "303" ] && [ "$code" != "302" ]; then
    echo "  SIGN-IN FAILED ($code) as $email at $origin"
    failures=$((failures + 1))
    return 1
  fi
  echo "== $label as $email =="
}

# What an error boundary leaves in a page body. Next renders the first set on a
# server-component throw, with a 200 in front of them often enough to matter;
# the marker is on the root element of every error page of ours.
NEXT_ERROR_TEXT='Application error|a server-side exception|Unhandled Runtime'
ITSM_ERROR_MARKER='data-itsm-error-boundary'

# Which error boundary a body shows, or nothing.
boundary_in() { # body
  if grep -qiE "$NEXT_ERROR_TEXT" <<<"$1"; then
    echo " ERROR-BOUNDARY"
  elif grep -qF "$ITSM_ERROR_MARKER" <<<"$1"; then
    echo " ERROR-BOUNDARY (ours)"
  fi
}

check() { # origin route...
  local origin="$1"; shift
  local route body status marker
  for route in "$@"; do
    [ -n "$route" ] || continue
    body=$(curl -s -b "$jar" -c "$jar" -w $'\n%{http_code}' -m 30 "$origin$route")
    status="${body##*$'\n'}"
    marker=$(boundary_in "$body")
    if [ "$status" != "200" ] || [ -n "$marker" ]; then
      echo "  FAIL $status $route$marker"
      failures=$((failures + 1))
    else
      echo "  ok   $status $route"
    fi
  done
}

# A route that must redirect, and where to. curl is not told to follow (no
# -L), so the 3xx itself is what is checked, and `%{redirect_url}` is the
# absolute URL it would have gone to next. The target is a path on the same
# origin and matches as a prefix, so `/inbox` accepts `/inbox/mine?t=12`.
redirects() { # origin route target
  local origin="$1" route="$2" target="$3" out status location
  out=$(curl -s -o /dev/null -b "$jar" -c "$jar" -w '%{http_code} %{redirect_url}' -m 30 "$origin$route")
  status="${out%% *}"
  location="${out#* }"
  case "$status" in
    301 | 302 | 303 | 307 | 308) ;;
    *)
      echo "  FAIL $status $route (expected a redirect to $target)"
      failures=$((failures + 1))
      return
      ;;
  esac
  case "$location" in
    "$origin$target"*) echo "  ok   $status $route -> ${location#"$origin"}" ;;
    *)
      echo "  FAIL $status $route -> $location (expected $target)"
      failures=$((failures + 1))
      ;;
  esac
}

# Routes that must answer exactly this status, and not render a boundary on the
# way. For gates: a 404 where a 200 or a 403 would each leak something.
answers() { # origin status route...
  local origin="$1" expected="$2"; shift 2
  local route body status marker
  for route in "$@"; do
    body=$(curl -s -b "$jar" -c "$jar" -w $'\n%{http_code}' -m 30 "$origin$route")
    status="${body##*$'\n'}"
    marker=$(boundary_in "$body")
    # Next's own not-found page is not an error boundary, but ours might carry
    # the marker on a 404, so only a mismatch in status fails here.
    if [ "$status" != "$expected" ]; then
      echo "  FAIL $status $route (expected $expected)$marker"
      failures=$((failures + 1))
    else
      echo "  ok   $status $route"
    fi
  done
}

# The first link of a given shape on a page, so the dynamic routes are exercised
# against whatever the seed actually produced rather than against ids written
# down here and gone stale by the next seed.
first_link() { # origin listing-route prefix
  curl -s -b "$jar" -c "$jar" -m 30 "$1$2" \
    | grep -oE "href=\"$3[^\"?#]+\"" \
    | head -1 | sed 's/^href="//; s/"$//'
}

if sign_in portal "$PORTAL" "ada.requester@$TENANT.test"; then
  check "$PORTAL" / /tickets /catalogue /knowledge /approvals /profile /report /offline
  check "$PORTAL" \
    "$(first_link "$PORTAL" /tickets '/tickets/')" \
    "$(first_link "$PORTAL" /catalogue '/catalogue/')" \
    "$(first_link "$PORTAL" /knowledge '/knowledge/')"
fi

if sign_in workbench "$WORKBENCH" "sam.agent@$TENANT.test"; then
  # `/` lands on the inbox, which lands on the last view (My work the first
  # time); old /queue links and bookmarks follow to the matching view.
  redirects "$WORKBENCH" / /inbox
  redirects "$WORKBENCH" /inbox /inbox/
  redirects "$WORKBENCH" '/queue?assignee=none' /inbox/unassigned
  check "$WORKBENCH" /inbox/mine /inbox/unassigned /inbox/due /inbox/waiting /inbox/all /inbox/resolved /offline
  check "$WORKBENCH" \
    "$(first_link "$WORKBENCH" /inbox/mine '/inbox/team/')" \
    "$(first_link "$WORKBENCH" /inbox/all '/tickets/')"
  # A view, team or ticket that does not exist is a 404 before anything streams.
  answers "$WORKBENCH" 404 /inbox/nonsense /inbox/team/not-a-uuid /tickets/INC-999999
fi

if sign_in admin "$ADMIN" "alex.admin@$TENANT.test"; then
  check "$ADMIN" / /workforce /tickets /cmdb /automation /sla /insights /integrations \
    /settings /security /audit /people /fields /catalogue /rules /workflows /ai-triage
  # Queues became Workforce; old links and bookmarks follow it (308).
  redirects "$ADMIN" /queues /workforce
  # The status filter is a link rather than a control, so it is a route too.
  check "$ADMIN" '/tickets?status=open' '/tickets?status=closed' '/tickets?status=open&assignee=none' \
    '/audit?action=ticket.created'
  # The platform screens do not exist for a tenant administrator: a 404, not
  # a 403 that would confirm there is something behind the door.
  answers "$ADMIN" 404 /tenants /plans
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "every route rendered"
else
  echo "failures: $failures"
fi
exit $((failures > 0 ? 1 : 0))
