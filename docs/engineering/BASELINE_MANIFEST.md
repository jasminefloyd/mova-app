# Baseline manifest

SHA-256 of the documents this build starts from (P00-T02). If a file changes, record the new hash and the reason in `CHANGE_REQUESTS.md` / `DECISION_LOG.md`.

Recorded: 2026-11-05 · branch `docs/p00-scaffold-and-design-package`

| File | Description | SHA-256 |
|---|---|---|
| `docs/product/ENGINEERING_SPEC.md` | Engineering Handoff & Implementation Spec v2.0 (normative) | `939b6e240f6d974ba89e9f07291428fd55e75ea561d680b5f2838d013d6329ee` |
| `docs/product/MASTER_BLUEPRINT.md` | Master Product & Business Blueprint v1 (business intent; partly out of date) | `f6235c3d5e508cd8096c6f286b700914ea55d5ce5eb087c5317b3f575b3bd874` |
| `docs/engineering/IMPLEMENTATION_PLAN.md` | Extract of spec §13 + §16 | `bf63d894e73d4cd1fee0aaaf421f9bd73ceebeb4185286a60a0b7cf9a102f03d` |
| `docs/qa/TEST_STRATEGY.md` | QA & Automated Test Strategy v2 | `60998ea3ce3f29f0ffbabb1af5b8e58fb44ac61a0a3d76bc87cf5c122e2bf91f` |
| `docs/qa/TEST_CASES.csv` | QA test cases v2 (539) | `d1b45fab240228bdba2ab6b3ae956fea4b7348ae91ddc9e052e9b2c1169c5b07` |
| `docs/design/design-manifest.json` | Design handoff manifest (hashes of every design file) | `8f39b6c8d5e3add922c15d0a53bc24498a174bbb1863520eaf49f1379865d47e` |
| `docs/design/tokens/tokens.json` | Design tokens | `d71d5ab2088c1f100d3f25cecb3d27728900578b4e0def59a08cf48a2a6f6cad` |

## Current normative specification revision

The original P00 v2.0 hash above is preserved as the starting baseline. The previously approved v2.1 and v2.2 revision hashes are retained below as history. The current v2.3 normative revision records the owner-specified host and path formats.

| File | Description | SHA-256 |
|---|---|---|
| `docs/product/ENGINEERING_SPEC.md` | Superseded normative Engineering Handoff & Implementation Spec v2.1 | `83b4c36df7ac50f2d647b0a09b30f2bd6612dd7c3268a3035c3890f76c55f8ad` |
| `docs/product/ENGINEERING_SPEC.md` | Superseded normative Engineering Handoff & Implementation Spec v2.2 | `939b6e240f6d974ba89e9f07291428fd55e75ea561d680b5f2838d013d6329ee` |
| `docs/product/ENGINEERING_SPEC.md` | Current normative Engineering Handoff & Implementation Spec v2.3; owner-specified parent, public, operator, and reserved admin URL formats | `300a7f12f37ad6b91de1d214bb30f4a2c4574295a2b3927a65adc156c7de77cc` |

## Current CR-001 / CR-007 alignment revisions

The initial P00 hashes above remain unchanged as historical baselines. These active documents were aligned with the owner-approved amendments:

| File | Current revision | SHA-256 |
|---|---|---|
| `docs/engineering/IMPLEMENTATION_PLAN.md` | Local phase evidence; production GO retained; P04 SSR and owner-approved design references recorded | `bf63d894e73d4cd1fee0aaaf421f9bd73ceebeb4185286a60a0b7cf9a102f03d` |
| `docs/product/MASTER_BLUEPRINT.md` | No-staging/provider sandbox guidance aligned with CR-007 | `8d66eff78591f29f02cbbe458d52804a5072996628c9b85549a4cc43aadb6589` |
| `docs/qa/TEST_STRATEGY.md` | v2.1; no hosted staging environment | `e1331dd09033c44556e3efb5b59da752509c140a8bf4c5663a8c454a4f33659e` |
| `docs/qa/TEST_CASES.csv` | Local integration and provider sandbox procedures | `d1b45fab240228bdba2ab6b3ae956fea4b7348ae91ddc9e052e9b2c1169c5b07` |

The following active records reflect the v2.2 decisions and design approvals:

| File | Description | SHA-256 |
|---|---|---|
| `docs/decisions/ADR-0003-public-rendering.md` | Owner-approved SSR, canonical and hreflang decision | `c32d1ed875b52bb7a85f81ec88f9b635a4ea0c3b909a4d2a0a09307b68eddc8b` |
| `docs/engineering/DECISION_LOG.md` | A-13 approval and DB prefix/extension decisions | `af684c1b67f2ea2102042affd45cdf5aa9e9233ddf331d820cd7582769b9ea86` |
| `docs/engineering/CHANGE_REQUESTS.md` | CR-002 partial resolution and CR-001 constraints | `966375455e5377af6453684101234cf85aa32c82a631d8bd18bdd9472d9e8cc4` |
| `docs/engineering/PHASE_STATUS.md` | Current gates and P03/P04 dependency state | `5f5b05327a4c980a66818eb4e185bdcf8926ca1e043c4dfac9bec17f2bc9843e` |
| `docs/engineering/SCREEN_INVENTORY.md` | Two approved derived Settings references added | `4f1130d64942a54c532267d09bde26630b19ba8ad42205cef1136132f790108b` |
| `docs/engineering/REQUIREMENTS_MATRIX.csv` | A-13 approval status | `918c74a414a2119dc1b2c507e5c1fc64180f9c68a986c408ae727a83bbb8f163` |
| `docs/qa/TEST_CASES.csv` | A-13 verification criteria reflect approved decision | `d1b45fab240228bdba2ab6b3ae956fea4b7348ae91ddc9e052e9b2c1169c5b07` |
| `docs/design/design-manifest.json` | Design file hashes; 60 renders including two owner-approved derived references | `8f39b6c8d5e3add922c15d0a53bc24498a174bbb1863520eaf49f1379865d47e` |
