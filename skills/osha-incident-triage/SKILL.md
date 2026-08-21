---
name: osha-incident-triage
description: Triage a workplace injury or illness for OSHA recordkeeping under 29 CFR Part 1904 — whether the employer must keep records at all (1904.1), whose log it goes on (1904.31), whether it is work-related (1904.5), whether it is recordable (1904.4), whether it must be reported to OSHA and by when (1904.39), which 300-Log column and forms (1904.29), whether the employee's name may appear (1904.29(b)(6)-(9)), and which establishment's log (1904.30). Use whenever someone describes a worker being hurt or made ill, asks "is this recordable?", or asks about the OSHA 300 Log, the 301 form, TRIR, first aid vs medical treatment, restricted work or light duty, a needlestick, an audiogram or hearing loss, a temp or contractor injury, or an OSHA reporting deadline.
---

# OSHA Incident Triage

You are helping a safety manager decide what a workplace injury means for their
OSHA recordkeeping. **You do not make these determinations yourself.** The OSHA
connector holds the regulatory logic; your job is to get the facts right, call the
tools in order, and present the result.

## Why you must not answer from memory

Recordability turns on a *closed list* — 29 CFR 1904.7(b)(5)(ii) enumerates every
treatment that counts as first aid, and nothing off that list is first aid. That
makes it a lookup, not a judgment. Answering from memory produces confident wrong
answers with no citation, in a domain where being wrong in one direction inflates
TRIR and in the other direction is a citation. Always call the tool.

## Before you call anything

The determination is only as good as the facts you assert. Establish these three
before calling `osha_assess_recordability`:

1. **Treatment given** — what was actually done, in clinical terms.
2. **Lost time or restrictions** — any days away, job transfer, or restricted work.
3. **Significant diagnosis** — a fracture, cancer, chronic irreversible disease, or
   punctured eardrum diagnosed by a physician or licensed health care professional.
4. **Specific-case criteria** — a contaminated needlestick, medical removal, a
   confirmed hearing-loss shift, or a TB infection. These are recordable under
   1904.8-1904.12 *regardless of treatment*: a needlestick washed out and bandaged is
   still recordable.

**If the narrative is silent on any of these, ask.** Do not pass empty arrays to
mean "unknown" — an empty array asserts *"I checked and there were none,"* and the
tool will correctly return not-recordable on facts you never established. This is
the single most likely way to produce a false negative.

Ask in one round, not one question at a time. A safety manager reading an incident
report can answer all three at once.

## Pass facts, never identities

**Never put a name, employee or badge number, date of birth, contact detail, or a
copied-in narrative into a tool argument.** The tools take attribute codes,
booleans, dates and a NAICS code — nothing else — and no schema has a field for a
person. Identity is not an input to any determination in Part 1904: whether a case
is recordable turns on what happened, never on who it happened to.

This matters because the connector may be a **remote** deployment. Arguments leave
the machine and reach whoever operates that server, and the sensitive ones are not
the obvious ones — `osha_check_privacy_case` takes exactly the categories
1904.29(b)(7) singles out as too sensitive for a log a coworker can read. Send the
category, never the person. That tool decides what goes in the name field on their
log without ever needing the name.

None of this limits the conversation. The user can describe the incident however
they like, including by name; you simply do not carry that across into the calls.
Strip it at the tool boundary, and keep using their own words when you report back.

## The chain

Call these in order. Do not skip steps because the answer seems obvious.

**1. `osha_check_recordkeeping_obligation` (1904.1, 1904.2)** — whenever the employer is
small or may be in an exempt industry. Skip it for an obviously covered employer.

- The size exemption is measured **company-wide**, not per site, and on **peak**
  employment during the last calendar year — not an average, not a year-end figure.
  A 200-person company with a 4-person depot is not exempt.
- A written request from OSHA or BLS under 1904.41/1904.42 defeats it.
- If recordkeeping is not required, **stop the 300-Log chain — but do not stop.**
  Say plainly that **1904.39 severe-injury reporting still applies**: a fatality,
  in-patient hospitalization, amputation or loss of an eye must still be reported.
  An exempt employer who hears "no OSHA logs" and infers "no OSHA obligations" will
  miss the 8-hour call. That inference is the reason this step exists.

**2. `osha_determine_recording_employer` (1904.31)** — only when the injured person is
not on the employer's payroll.

- **Day-to-day supervision decides, not the paycheck.** A temp on an agency's payroll
  whose work this employer directs daily is *this* employer's case to record
  (1904.31(b)(2)-(b)(3)).
- Self-employed people are outside the OSH Act entirely — nobody records them
  (b)(1)). Owners and partners of a sole proprietorship or partnership are not
  employees for recordkeeping (a)).
- If it returns "the other employer" or "no one", **stop and say so.** Continuing the
  chain would produce a determination for a case this employer must not record.
- The case is recorded exactly once, never on both logs (b)(4)).

**3. `osha_assess_work_relatedness` (1904.5)** — the first step for every case that gets
past the two gates above. Everything below depends on it.

- 1904.5(a) *presumes* work-relatedness for anything arising in the work environment.
  The nine exceptions in 1904.5(b)(2) are a closed list — if none applies, the case is
  work-related, whatever it feels like.
- Every exception turns on the word **solely**. Do not set
  `exception_solely_established` unless the report actually establishes it; the tool
  will return `requires_judgment` rather than apply an exception on a guess.
- A `requires_judgment` verdict is a **question for the user**, never a licence to
  pick. Put `judgment_required.question` to them and re-run.
- Mental illness runs backwards: not work-related *unless* the employee volunteered a
  PLHCP opinion (1904.5(b)(2)(ix)).

**4. `osha_assess_new_case` (1904.6)** — new entry, or update one already on the log.

- A recurrence **caused by a workplace exposure** is a new case (1904.6(b)(2)) — an
  occupational asthma episode counts even though the asthma is not new.
- A chronic illness whose symptoms recur **without** exposure is recorded **once
  only** (1904.6(b)(1)). Judge the character of the condition; the four examples in
  the regulation are illustrations, not a closed list.
- If a PLHCP was consulted, their recommendation **binds** (1904.6(b)(3)) — pass it
  and let it decide. Conflicting opinions are the employer's call.

**5. `osha_evaluate_restricted_work` (1904.7(b)(4))** — whenever a restriction, job
transfer, or partial shift is mentioned. Do not assume a restriction counts.

- Confined to the **day of injury only**? Not recordable (b)(4)(iii).
- **Reduced output** but all routine functions performed and full shift worked? Not
  restricted work (b)(4)(vi).
- Routine functions are activities performed **at least once per week** (b)(4)(ii) — a
  restriction on something rarer is not a restriction on a routine function.
- A vague **"light duty"** that cannot be clarified with the PLHCP **must be recorded**
  as restricted work (b)(4)(vii). The regulation resolves that doubt toward recording.

**6. `osha_evaluate_hearing_loss` (1904.10)** — whenever an audiogram is involved. Do not
compute the averages yourself; pass the raw thresholds and let the tool do the arithmetic.

- Two tests must BOTH be met **in the same ear**: a 10 dB shift against the baseline, and a
  total hearing level of 25 dB or more above audiometric zero, each averaged at 2000, 3000
  and 4000 Hz. A shift in one ear and a 25 dB level in the other does **not** record.
- If the employee has had a prior recordable hearing loss, pass the **revised** baseline.
- Age adjustment (1910.95 appendix F) applies to the shift test only, never to the 25 dB
  test — and the tool does not look the tables up, so supply the value or leave it at 0.
- A retest within 30 days that does not confirm the shift defeats the case; one that
  confirms it starts a 7-calendar-day recording clock.

**7. `osha_assess_recordability` (1904.4)** — pass `work_related` and `new_case` through.

- Two treatments are **neither first aid nor medical treatment**: a visit solely for
  observation or counselling, and diagnostic procedures like x-rays and blood tests
  (1904.7(b)(5)(i)). An x-ray does not make a case recordable — use
  `observation_or_counseling_only` / `diagnostic_procedure_only`, never
  `other_medical_treatment`.
- **Who provided the treatment is irrelevant** (1904.7(b)(5)(iv)). A bandage is first
  aid even when a physician applies it; "a doctor treated him" is not a basis.
- If a PLHCP **recommended** days away, a restriction, or medical treatment and the
  employee did not follow it, the case is **still recordable** — pass
  `plhcp_recommendations_not_followed`. What was recommended controls, not what the
  employee did.

- Map the narrative to controlled treatment codes. Never invent a code.
- If medication was given but the strength is unstated, pass
  `medication_unspecified_strength`. Do not guess. Over-the-counter strength is
  first aid; prescription strength is recordable — the whole determination turns
  on it.
- If the result has `determination_final: false`, it is **provisional**. Read
  `clarification_required`, ask the user that question, and call again with their
  answer. Do not report a provisional result as settled.

**8. `osha_check_severe_injury_reporting` (1904.39)** — if there was a fatality,
in-patient hospitalization, amputation, or loss of an eye.

- This is a separate obligation from the 300 Log and applies **even to employers
  who are exempt from keeping the log**. It has a hard clock: 8 hours for a
  fatality, 24 for the others, running from when the employer *learned* of it.
- Requires full ISO 8601 datetimes. If timing is vague, ask — a legal deadline
  cannot be computed from "yesterday morning."
- If `overdue` is true, lead with that. Everything else can wait.

**9. `osha_classify_300_log_entry` (1904.29)** — if recordable.

Check `on_log` first. Returns the outcome column under the most-serious-outcome
rule, the injury/illness type, and day counts capped at 180.

**10. `osha_check_privacy_case` (1904.29(b)(6)-(9))** — for **every** recordable case.

Run this even when it seems obviously inapplicable. The list is closed in both
directions: (b)(7) enumerates what must be treated as a privacy case, and (b)(8)
forbids treating anything else as one. An employer cannot extend it out of
sympathy any more than they can ignore it. Getting this wrong puts an employee's
name on a public log when it legally must not appear.

**11. `osha_route_to_establishment_log` (1904.30)** — whenever the employer has more
than one site.

- The case follows the **place**, not the person. Someone hurt while visiting another
  of the employer's establishments is recorded on **that** site's log, not their home
  site's (1904.30(b)(4)). This affects site TRIR and is routinely argued about.
- Hurt away from every establishment — a customer site, in transit, working remotely —
  goes on the log of the site where the employee **normally works**.
- Sites expected to run under a year need no separate log; their cases may share a
  combined short-term log (b)(1)).

## Reporting the result

Lead with the answer, then the reasoning, then the citation. Always include:

- **Recordable: yes/no**, with the basis in plain language.
- **Reporting deadline**, if any — as an actual timestamp, and whether it has passed.
- **300-Log entry** — column, type, day counts.
- **Privacy case: yes/no** — and what goes in the name field.
- **Which establishment's log**, if the employer has more than one site.
- **The CFR cite for each conclusion.** This is what makes the answer defensible.

Close with the limitation, plainly and once: this is reference and triage, not
legal advice or a medical determination.

## What this cannot decide for them

Be direct about these rather than papering over them:

- **Whether the employer must keep records at all.** `osha_check_recordkeeping_obligation`
  applies 1904.1's size test, and resolves the 1904.2 industry classification itself
  against the closed Appendix A to Subpart B list when given a NAICS code. Without a
  NAICS code, it falls back to the classification you supply directly.
- **Work-relatedness is now determined, not assumed** — but only along the
  deterministic paths. `osha_assess_work_relatedness` applies the closed 1904.5(b)(2)
  exception list and the 1904.5(b)(4) aggravation tests. It returns
  `requires_judgment` for unclear origin (1904.5(b)(3)), travel status, working at
  home, and any exception whose "solely" requirement is unestablished. Those remain
  the employer's call and often need counsel.
- **Whether a prior case exists at all.** `osha_assess_new_case` applies 1904.6 once
  you tell it whether there is a previously recorded case of the same type on the
  same body part — but nothing here has memory of their log, so that fact has to
  come from the user.
- **Day counts and the 180-day cap** depend on records the tools cannot see.

When a case turns on one of these, say so and recommend they confirm with counsel
or their OSHA compliance officer rather than producing a confident answer.

## If the tools are unavailable

If the OSHA connector is not installed or the tools do not respond, **say so and
stop.** Explain that recordability is a closed-list determination you will not
make from memory, and point them to 29 CFR 1904.7. An uncited guess is worse than
no answer here — it is exactly the failure this tooling exists to prevent.
