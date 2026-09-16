#!/usr/bin/env bash
#
# A render pass over every screen in the three web applications.
#
# Signs in as a real seeded person through the development sign-in, then asks
# for each route and checks two things: that it answered 200, and that what
# came back is not Next's error boundary. The second check is the point — a
# server component that throws still answers 200 in some configurations, and a
# status-code sweep would call that a pass.
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

check() { # origin route...
  local origin="$1"; shift
  local route body status marker
  for route in "$@"; do
    [ -n "$route" ] || continue
    body=$(curl -s -b "$jar" -c "$jar" -w $'\n%{http_code}' -m 30 "$origin$route")
    status="${body##*$'\n'}"
    marker=""
    # Next renders these into the page body on a server-component throw, with
    # a 200 in front of them often enough to matter.
    if grep -qiE "Application error|a server-side exception|Unhandled Runtime" <<<"$body"; then
      marker=" ERROR-BOUNDARY"
    fi
    if [ "$status" != "200" ] || [ -n "$marker" ]; then
      echo "  FAIL $status $route$marker"
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
  check "$WORKBENCH" /queue /offline
  check "$WORKBENCH" "$(first_link "$WORKBENCH" /queue '/tickets/')"
fi

if sign_in admin "$ADMIN" "alex.admin@$TENANT.test"; then
  check "$ADMIN" / /queues /tickets /cmdb /automation /sla /insights /integrations \
    /settings /security /audit /people /fields /catalogue /rules /workflows
  # The status filter is a link rather than a control, so it is a route too.
  check "$ADMIN" '/tickets?status=open' '/tickets?status=closed' '/tickets?status=open&assignee=none' \
    '/audit?action=ticket.created'
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "every route rendered"
else
  echo "failures: $failures"
fi
exit $((failures > 0 ? 1 : 0))
