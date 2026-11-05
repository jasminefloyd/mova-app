# Change requests and pending inputs

This register records mismatches and missing inputs without changing the normative spec or resolving product approvals.

| ID | Request / issue | Source | Status | Owner / next action |
|---|---|---|---|---|
| CR-001 | Reconcile the unprefixed SQL object examples in the v2.0 spec with the owner's binding requirement that every project-created database/schema object use the `mova_` prefix, before database implementation. The prefix requirement itself is confirmed; the spec hash remains unchanged until a versioned revision is reviewed. | Owner instruction, 2026-11-05; spec §§3–6 | OPEN — contract text needs update | Engineering: prepare a versioned spec amendment and identifier inventory; product owner: review the resulting contract text. |
| CR-002 | Provide approved designs for cancel/reschedule, manage page, notification settings, privacy & data, Spanish guest-flow layouts, review reply, concierge Decide sheet + web chat, `/c/:token` + delete-profile confirm, Settings services/portfolio, and loading/empty/error/offline patterns. | `docs/engineering/PHASE_STATUS.md` initial blocker list; `docs/design/SCREEN_MAP.md` | OPEN — blocks affected phase acceptance | Product owner: provide or approve artboards before implementation. |
| CR-003 | Name the load-test tool; the spec does not select one. | QA strategy §3; spec §14 | OPEN | Engineering: propose a tool in an ADR-0001 addendum after requirements are confirmed. |
| CR-004 | Confirm F04-AC08 wording for running-late texts during quiet hours. | `docs/engineering/PHASE_STATUS.md` initial blocker list | OPEN | Product owner: confirm behavior before P06. |
| CR-005 | Add or formally map the 38 inherited `Fnn-V1-nn` acceptance criteria into the normative spec. | QA strategy §1 and §12 | OPEN | Product owner: approve a versioned spec update or explicit mapping. |
| CR-006 | Branch protection for GitHub `main` is not required. The product owner directs committing directly to `main` by default unless they say otherwise. | Product owner instruction, 2026-11-05 | CLOSED — owner instruction | Follow the owner's direct-to-main workflow; use another workflow only when instructed. |
