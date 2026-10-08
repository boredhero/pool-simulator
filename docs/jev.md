# Jev opponent design

Research checked against TypeSafe's live documentation on 2026-10-08:

- [HTTP API](https://docs.typesafe.ai/api): `POST /v1/systemone`, bearer credential,
  structured state and typed questions; returns keyed answers and input-token usage.
- [Models](https://docs.typesafe.ai/models): Jev 1.13 (`jev-1.13.0`) accepts text/JSON,
  not images. Listed input price is $0.042 per million tokens; outputs are free.
  Pricing and provider limits may change. Pinning avoids silently changing behavior.
- [Choice](https://docs.typesafe.ai/primitives/choice): select one supplied option,
  with a distribution and confidence. Confidence measures distribution concentration,
  not whether a pool shot will succeed.
- [Function calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling):
  typed closed-set decisions compose with ordinary code-owned actions.

## Initial 0.7 implementation (superseded by the 0.9 planner below)

Jev is a System One decision model, not a chat generator or physics simulator.
Noul answers yes/no probabilities; Score evaluates ordered rubrics; Choice chooses
one of a known set. Choice matches this initial opponent: server-owned deterministic geometry
provides target, pocket, cut angle, cue/object distances and power, and Jev selects
a candidate. We deliberately do not ask it to perform trigonometry, choose illegal
targets, generate prose, or directly control shots.

The existing CPU chooses its highest heuristic score with difficulty-dependent
noise. Jev sees candidate features without that score and selects an exact proposed
aim. Both remain limited by the same direct-pot candidate coverage. Neither this
integration nor the live probe establishes that Jev outplays CPU. Future strength
work should compare win rate, scratch rate and pot success on seeded table states;
physics rollouts could supply scratch and next-position evidence before model
selection. Do not describe geometric estimates as simulated outcomes.

A live two-candidate smoke request picked the simple short pot over the long thin
cut in approximately 0.29 seconds. This validates credentials/contract and one
simple preference only. Tests mock external inference to cover auth rejection,
input bounds, fixed request shape, response validation, failure sanitization,
durable usage limits across accounts, UI sign-in, and cancellation after reracking.

Only numeric candidate features and remaining-target count are sent to TypeSafe;
account identity, usernames, session tokens and credentials are not model state.
Usage counting is backend-owned. The account's lifetime attempt count advances
before a provider call; completion advances only after a valid offered selection.
Daily game admission uses database uniqueness constraints; the emergency provider-call budget is a separate durable counter. Neither is supplied by the browser.

## Daily-game and legal changes

The initial per-selection account allowance was replaced before release by one
persistent authoritative game per account and source network per UTC day. The
server selects candidates and simulates both human and Jev turns; versioned turn
requests reject replay or stale state. Provider token counts, not browser claims,
feed private per-game cost estimates. A global paid-call cap remains an abuse
safeguard and visibly falls back to CPU while preserving game progression.

Privacy implementation follows the conservative opt-in route for all optional
analytics. References researched October 8, 2026:

- [ICO: cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/): explain purposes and distinguish necessary storage from optional analytics.
- [FTC: COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions): child-directed services and actual knowledge of collecting children's data require special analysis. Adult affirmations do not establish that the overall service is legally outside COPPA.
- [California AG: CalOPPA](https://oag.ca.gov/news/press-releases/attorney-general-kamala-d-harris-launches-new-tool-help-consumers-report): conspicuous privacy policies and explanation of tracking practices/signals.

The initial accounts/analytics policy is 18+ with no date-of-birth collection.
Legal documents are operator-specific drafts implemented for review, not a legal
opinion. Future advertising, children-directed features, payment, new providers or
expanded telemetry require renewed privacy/legal review rather than silently
expanding the existing consent.

An additional live automated match check exercised 30 server-owned turns: 15 geometry-driven human-seat shots, 7 live Jev selections and 8 opponent geometry fallbacks. It recorded 5,793 input tokens and 294 output tokens with no unmetered requests (estimated $0.000243306). The rack remained active at the 30-turn test limit. This checks real inference plus physics and accounting; it does not establish completed-game reliability or playing strength.


## 0.9 decision planner

The new adapter accepts private server-generated plans, not browser candidates.
Planning runs in a worker thread under the four-active-turn admission cap. The
planner returns executable shots with stable IDs, shot families, optional legal
cue placements, and physics-preview consequences. The provider sees semantic
consequences (legal result, continuation, scratch, next-shot options and opponent
replies), not controls to synthesize. Placement is chosen jointly with the shot
and committed through `place_cue` immediately before execution; planning must not
consume ball-in-hand or mutate the stored position.

When multiple families exist, one request asks for a tactical family and,
speculatively, the best plan in each family. Code routes the family answer to its
corresponding plan answer. These are independent questions; none can read another
answer. A selected ID must belong to the selected family and the original server
shortlist. Missing, malformed or out-of-set answers use the highest-ranked local
plan. A single offered plan requires no model call. The response adds `family`
and a short deterministic `intent` label; provider prompts and account cost data
remain private. Candidate ordering is shuffled reproducibly from the decision
context to avoid always presenting the locally top-ranked option first.

A preview is one deterministic simulation, not a calibrated pot probability.
Likewise, finding no direct reply does not establish that an opponent is snookered.
Jev confidence measures decision distribution concentration, not shot accuracy.
The planner owns legality, coordinates, aim, power and spin. Model selection can
choose among strategic consequences but cannot repair missing candidate coverage.
No claim of superiority over the CPU is made without comparative evaluation.

Provider usage is now parsed independently from selection validity: valid usage
on an invalid answer is still included in input/output totals and estimated cost.
Missing or invalid usage leaves the attempt marked unmetered, including timeouts
whose billing is unknown. No provider retries are added in this release; failure
continues the rack with a local plan. Each provider attempt remains subject to the
existing global emergency budget, independent of Premium game admission.

Research checked against official live docs on October 8, 2026:

- [Models](https://docs.typesafe.ai/models): pinned `jev-1.13.0`, $0.042 per million
  input tokens and free outputs; 64k request context, 32k state plus longest
  question. Rate limits currently list 80 requests/sec and 100k tokens/sec and may
  change. Keep ordinary turn requests far smaller than those context limits.
- [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13): numerical
  precision, indirection, irrelevant detail and choice order can reduce accuracy.
  Compute physical consequences in code and test reordered candidate lists.
- [State](https://docs.typesafe.ai/concepts/state): named structured state and
  independent typed questions; no image input required.
- [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out): batch conditional
  branch questions and let code select the relevant answer after the response.
- [Confidence](https://docs.typesafe.ai/confidence): distribution confidence is not
  an independent estimate of real-world success.
- [HTTP API](https://docs.typesafe.ai/api): bearer-authenticated
  `POST /v1/systemone`, exact offered Choice IDs, and request token usage. Provider
  failures remain private; future retries require accounting for every attempt.

Evaluation must compare old CPU, new planner without Jev, and the same planner
with Jev on matched seeded states and alternating seats. Include direct pots,
scratch traps, wrong-pocket eight, blocked contact, bank/kick opportunities,
safeties, and ball-in-hand/kitchen restrictions. Track legality, rack completion,
win rate with uncertainty, run length, fallback rate, p50/p95 planning and provider
latency, and measured cost per rack. Geometry improvement and Jev improvement must
be measured separately. CI uses deterministic fixtures and mocked provider
contracts; live paid comparisons require a separately budgeted evaluation run.
