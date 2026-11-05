# AI Seat Filler — Product Brief

## Overview

An AI-powered layer that sits on top of Slick to automatically detect and fill empty appointment slots and no-shows. The system leverages the existing client database and organic social channels to drive last-minute bookings, with human review and approval at the centre of the workflow.

---

## Problem

Empty chairs and no-shows are lost revenue. Salon owners lack the time and tools to react quickly and intelligently when gaps appear in the diary.

---

## Solution

A monitoring and campaign system that detects diary gaps, selects the right clients to contact, generates ready-to-approve campaign copy, and routes it to a human for sign-off — all within a 3-hour window.

---

## Triggers

- **Event-triggered** — a no-show is marked or a cancellation comes in via Slick
- **Continuous monitoring** — the system scans the diary proactively and flags gaps before they happen

Deduplication logic ensures the same slot is never campaigned twice simultaneously.

---

## What the AI Generates

For each detected gap, the AI produces two pieces of campaign copy:

**1. SMS Campaign**
- Sent simultaneously to a selected segment of existing clients
- Personalised using client history (last visit, usual service, preferred stylist)
- Tone: limited availability, first-come-first-served
- Includes a direct booking link to the specific slot
- Includes a graceful "slot just filled" fallback response

**2. Social Post**
- Organic broadcast to clients and prospects
- Specific and urgent — stylist, service type, time, and price
- Tone: genuine scarcity, not generic availability

---

## AI Inputs (from Slick)

- Stylist
- Service type
- Appointment time
- Price
- Client history (last visit, usual service) — used for SMS personalisation

---

## Human Approval Flow

1. AI detects a gap and generates both pieces of copy
2. A notification appears in the **Slick Activity feed** alerting the owner/manager
3. Owner taps through via a deep link directly into the **marketing suite**
4. Owner reviews, edits if needed, and approves each piece independently
5. On approval, SMS sends and/or social post is published

The human is never bypassed. All outbound communication requires explicit approval.

---

## Guardrails

- **Client throttling** — no client contacted more than once per defined period
- **Slot deduplication** — no duplicate campaigns for the same gap
- **Social frequency limits** — avoid over-posting to channels

---

## Slot State Management

Every tracked slot moves through a clear lifecycle:

`Gap Detected → Campaign in Draft → Awaiting Approval → Approved & Live → Slot Filled / Expired`

The approval interface reflects current state so the manager always knows what's in flight.

---

## Agent Architecture

The system is composed of five lightweight agents. Each has a single clear responsibility. They communicate by passing a shared **Slot Event** object that carries all relevant context as it moves through the pipeline.

---

### 1. Monitor Agent

**Responsibility:** Detect gaps in the diary and emit Slot Events.

**How it works:**
- Polls the Slick diary on a regular interval (continuous monitoring mode)
- Listens for cancellation and no-show webhooks from Slick (event-triggered mode)
- Evaluates whether a gap meets the threshold to act on (e.g. minimum gap duration, within the 3-hour window)
- Checks deduplication — if a Slot Event already exists for this gap, it does not emit a new one
- On a valid gap, creates a Slot Event with status `Gap Detected` and passes it to the Selection Agent

**Inputs:** Slick diary data, webhook events
**Outputs:** Slot Event → Selection Agent

---

### 2. Selection Agent

**Responsibility:** Decide which clients to target for the SMS campaign.

**How it works:**
- Receives the Slot Event from the Monitor Agent
- Queries the client database for candidates based on relevance signals: usual service match, preferred stylist match, time since last visit, and throttle eligibility (not contacted within the defined period)
- Ranks and selects a shortlist of clients
- Attaches the selected client list and their relevant history to the Slot Event
- Updates Slot Event status to `Clients Selected` and passes it to the Copy Agent

**Inputs:** Slot Event, client database
**Outputs:** Enriched Slot Event → Copy Agent

---

### 3. Copy Agent

**Responsibility:** Generate the SMS campaign copy and social post copy.

**How it works:**
- Receives the enriched Slot Event containing slot details and selected clients
- Generates a personalised SMS variant for each selected client using stylist, service, time, price, and client history
- Generates a single organic social post using the urgency + specificity formula (stylist, service, time, price)
- Attaches all generated copy to the Slot Event
- Updates Slot Event status to `Campaign in Draft` and passes it to the Approval Agent

**Inputs:** Enriched Slot Event
**Outputs:** Slot Event with copy attached → Approval Agent

---

### 4. Approval Agent

**Responsibility:** Route the campaign to the human for review and manage the approval state.

**How it works:**
- Receives the Slot Event with copy attached
- Creates an approval task in the marketing suite
- Sends a notification to the Slick Activity feed with a deep link to the approval task
- Monitors the approval state — waiting for the human to review, edit if needed, and approve or reject each piece independently
- If approved, updates Slot Event status to `Approved & Live` and passes it to the Dispatch Agent
- If rejected or no action is taken within the window, updates status to `Expired` and closes the event
- If the slot is filled before approval, cancels the pending task and notifies the human

**Inputs:** Slot Event with copy, human approval action
**Outputs:** Approved Slot Event → Dispatch Agent, or status update to `Expired` / `Cancelled`

---

### 5. Dispatch Agent

**Responsibility:** Send the approved campaign and monitor the outcome.

**How it works:**
- Receives the approved Slot Event
- Sends the SMS simultaneously to all selected clients
- Publishes the social post to the configured organic channel(s)
- Monitors for a booking against the slot — when the slot is filled, updates Slot Event status to `Slot Filled` and triggers a "slot just filled" fallback SMS to any clients who hadn't yet responded
- Reports outcome back to the system (filled / expired / no response)

**Inputs:** Approved Slot Event
**Outputs:** Sent campaigns, Slot Event status update, fallback SMS if needed

---

### How the Agents Work Together

```
Slick Diary / Webhook
        ↓
  Monitor Agent        — detects gap, emits Slot Event
        ↓
  Selection Agent      — identifies and attaches target clients
        ↓
  Copy Agent           — generates SMS and social post copy
        ↓
  Approval Agent       — routes to human via Activity feed + marketing suite
        ↓
  Dispatch Agent       — sends approved campaign, monitors outcome
```

The Slot Event is the single shared object that flows through the pipeline. Each agent reads from it, enriches it, and updates its status before passing it on. No agent acts without a valid Slot Event in the right state.

---

## Strategic Notes

- The 3-hour window allows for proactive as well as reactive use
- The Activity feed nudge is the key adoption driver — it creates a high-urgency reason to open the marketing suite regularly
- This is a trojan horse for broader marketing suite adoption
- SMS to existing clients is the higher-converting channel; social is brand-building and reach

---

## Out of Scope (for now)

- Paid social promotion
- Fully automated sending without human approval
- Waitlist management
- Multi-location support

---

## Open Questions

- What booking link format does Slick support for direct slot linking?
- What SMS sending infrastructure is available or preferred?
- What social platforms are in scope for organic posting?
- What defines a "segment" for SMS targeting — manual selection, AI suggestion, or rule-based?
