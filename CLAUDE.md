# Ocean Freight Intelligence App — Product Thinking

## Core Philosophy

This is not a traditional freight schedule table.

The product is designed as:

- a logistics decision engine
- a geographically-aware schedule qualifier
- an operational booking prioritization tool

The system helps users:

1. Compare carriers intelligently
2. Qualify schedules geographically
3. Explore schedule alternatives per carrier
4. Create booking priority rankings
5. Reduce operational back-and-forth with forwarders


---

# Product Structure

The frontend has two primary operational views:

1. Carrier View
2. Rank View

These are not only UI variations.

They represent two different business workflows.


---

# View 1 — Carrier View

## Goal

Help the user compare the best realistic option per carrier.

This is the primary operational workflow.


## Problem Being Solved

Displaying all schedules from all carriers simultaneously creates:

- visual clutter
- operational confusion
- decision fatigue

Users do not need:
- every schedule at once

Users need:
- the best schedule candidate per carrier
- with the ability to explore alternatives


---

# Carrier View UX Logic

## Initial State

The system:

1. Filters schedules geographically
2. Groups schedules by carrier
3. Sorts schedules inside each carrier group
4. Selects the best schedule initially

Default sorting:
- earliest ETA

The grid initially shows:
- 1 selected schedule per carrier


---

# Example

| Carrier | ETA | Transit | Last CY | POD |
|---|---|---|---|---|
| COSCO | Jul 6 | 32d | Long Beach | Long Beach |
| CMA CGM | Jul 8 | 34d | Los Angeles | Los Angeles |
| OOCL | Jul 10 | 36d | Long Beach | Long Beach |


---

# Carrier Interaction

Each carrier row is interactive.

The user can:
- expand the carrier row
- see alternative schedules
- switch the currently selected schedule

Example:

COSCO
- Schedule A — Jul 6 ETA
- Schedule B — Jul 10 ETA
- Schedule C — Jul 15 ETA

If operational constraints prevent loading the best option:
- the user can switch scenarios instantly


---

# Important Product Principle

The grid represents:
- selected scenarios

NOT:
- raw schedules


---

# Carrier Filtering

Users can enable or disable carriers.

Example:
- some carriers may not have active rates
- some carriers may not be operationally viable
- some carriers may not be preferred

The UI should allow:
- checkbox toggles
- instant removal/addition from comparison


---

# Intended Operational Outcome

The user should be able to answer:

"What is the best realistic schedule option per carrier?"


---

# View 2 — Rank View

## Goal

Generate an operational booking priority list.


---

# Problem Being Solved

Current workflow with forwarders creates:

- excessive back-and-forth
- poor fallback logic
- inefficient booking escalation

Typical issue:
- first option unavailable
- forwarder proposes weak alternative
- internal team rejects it
- repeated iteration cycle


---

# Rank View UX Logic

Unlike Carrier View:

- schedules are NOT grouped by carrier
- all schedules compete globally

The system:

1. Flattens all schedules
2. Sorts globally by ETA
3. Returns top N schedules

Example:
- Top 20 schedules


---

# Example

| Rank | Carrier | ETA | Last CY |
|---|---|---|---|
| 1 | COSCO | Jul 6 | Long Beach |
| 2 | OOCL | Jul 7 | Long Beach |
| 3 | CMA CGM | Jul 8 | Los Angeles |


---

# Intended Operational Outcome

The user can provide forwarders:

"Book using this priority order."

If:
- schedule #1 unavailable

then:
- attempt schedule #2
- then #3
- etc

This creates:
- operational clarity
- reduced communication loops
- standardized booking fallback logic


---

# Geographic Qualification Logic

The application is warehouse-centric.

Schedules are not filtered only by:
- POD
- Last CY exact match

Instead:
- schedules are geographically qualified

using:
- warehouse location
- radius threshold
- PostGIS spatial queries


---

# Core Geographic Flow

User inputs:
- POL
- warehouse city/state OR ZIP code
- radius threshold

Frontend:
- calls GeoAPI geocoder service

Backend:
- returns coordinates

Supabase/PostGIS:
- performs radius qualification using ST_DWithin


---

# Radius Philosophy

The radius represents:

"acceptable drayage flexibility"

NOT:
- strict geographic precision


---

# Default Radius

Initial default:
- 100 miles

User adjustable:
- 25
- 50
- 100
- 200
- 500


---

# Technical Frontend Philosophy

Frontend responsibilities:

- UI/UX
- state management
- interaction orchestration

Frontend should NOT:
- perform geographic calculations
- contain heavy business logic


---

# Frontend Architecture

The app should be thought of as:

UI Layer
    ↓
State Layer
    ↓
Backend Orchestration
    ↓
Spatial Query Results
    ↓
Visualization


---

# Initial Frontend Components

## SearchPanel

Responsible for:
- POL selection
- warehouse input
- ZIP code input
- radius controls
- carrier filtering


## SchedulesGrid

Responsible for:
- carrier grouping
- ranking view
- schedule selection
- CSV export


## App State

Core state examples:

```js
{
  pol,
  warehouseQuery,
  warehouseCoordinates,
  radius,
  enabledCarriers,
  viewMode,
  schedules,
  selectedSchedules,
  loading
}