# apps/mobile: RESERVED for V1.1 (do not build in V1)

V1 ships as the web app in `apps/web` (spec D-02). This folder is reserved for the **thin native shell** allowed in **V1.1 only**, so Tap to Pay can use
Stripe Terminal's native SDK and Apple's Tap to Pay entitlement (approval **A-17**, ADR to be written).

Expected approach when A-17 is approved: Expo (React Native) app that wraps the existing web app and adds the native Tap to Pay flow. It should reuse
`packages/contracts`, `packages/domain` and `packages/design-tokens`. Nothing here should duplicate screens that already exist in `apps/web`.

Until then: no code, no dependencies, no CI job for this folder.
