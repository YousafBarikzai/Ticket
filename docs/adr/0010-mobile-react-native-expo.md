# ADR-0010 · Mobile strategy: one React Native (Expo) codebase, iOS first, Android later; PWAs from the Next.js apps

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** ADR-10

## Context

Requesters and agents need native capabilities (push, camera, offline, biometrics, QR) on iOS in PH-2 and Android in PH-5, from a team that is TypeScript-first.

## Decision

`apps/mobile` is an Expo app (Expo Router, EAS Build/Update, expo-notifications, expo-secure-store, expo-auth-session) sharing `packages/sdk`, `packages/contracts` and `packages/ui` native components. PWAs are served by the Next.js apps with service workers and background sync for a closed set of offline actions. OTA updates ship JS-only changes; native changes go through store review with the mobile release checklist.

## Alternatives considered

- **Native Swift/Kotlin apps.** Rejected: two more codebases and skill sets.
- **Flutter.** Rejected: breaks the single-language, shared-types principle.
- **PWA only.** Rejected: push and background capabilities on iOS are insufficient for agent use.

## Consequences

- One mobile engineer can deliver both platforms; Android parity is mostly testing and store work.
- Expo module constraints accepted; custom native modules only if unavoidable.
