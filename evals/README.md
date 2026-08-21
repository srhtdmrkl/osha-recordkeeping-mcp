# Evaluations

Forty-seven questions in [`recordkeeping-evals.xml`](recordkeeping-evals.xml), testing whether an LLM can get the right answer *through* this server — which is a different question from whether the functions are correct. `npm test` covers the second. Only an eval covers the first, and the first is where this project's one production bug lived: a model called `osha_assess_recordability` with unstated fields defaulted to empty and got back a cited **not recordable** on a two-finger amputation. Every unit test passed at the time.

## How the answers were produced

Each question was solved by driving the built server over stdio with a real MCP client and recording the output — not written from memory and not inferred from the regulation. The verification trace is below.

## What each question exercises

| # | Answer | Chain | What it catches |
|---|---|---|---|
| 1 | `no` | App. A | **Appendix A** — NAICS 5411 Legal Services is on the closed exempt list; a 400-person firm is still exempt |
| 2 | `no` | App. A | **Appendix A** is closed — 2361 Residential Building Construction is absent, so no industry exemption applies |
| 3 | `no` | 1904.1 | **1904.1(b)(2)** — the test is PEAK employment in the last calendar year, not average or year-end; six weeks at 11 defeats it |
| 4 | `yes` | 1904.1 | **1904.1(a)(1)** — the exemption is PARTIAL: 1904.39 reporting binds every employer covered by the OSH Act |
| 5 | `no` | 1904.46 | **1904.46(3)** — a home is never a business establishment; a telecommuter's case goes on the log of the establishment they are linked to |
| 6 | `no` | 1904.39 | **1904.39(b)(11)** — the definition of amputation expressly EXCLUDES severed ears, avulsions, deglovings, scalpings and chipped teeth |
| 7 | `no` | 1904.39 | **1904.39(b)(10)** — an admission for observation or diagnostics alone is not the 'care or treatment' the definition requires |
| 8 | `no` | 1904.39 | **1904.39(b)(3)** — a public-road motor vehicle accident outside a construction work zone is not reportable, though still recordable |
| 9 | `warehouse` | 1904.31 | **1904.31(b)(2)** — day-to-day supervision decides, not who issues the paycheck |
| 10 | `nobody's` | 1904.31 | **1904.31(b)(1)** — the self-employed are outside the OSH Act entirely; supervision cannot pull them onto a log |
| 11 | `Kentucky` | 1904.30 | **1904.30(b)(4)** — the case follows the PLACE: a visiting employee is recorded on the HOST site's log |
| 12 | `Dallas` | 1904.30 | **1904.30(b)(4)** — away from every establishment, it goes on the log of the site where the employee normally works |
| 13 | `2026-06-08` | 1904.29 | **1904.29(b)(3)** — 7 calendar days runs from RECEIVING the information, not from the incident date |
| 14 | `301` | 1904.29 | **1904.29(b)(2)** — every recordable case needs a 301 Incident Report as well as the 300 Log line |
| 15 | `yes` | 1904.29 | **1904.29(b)(10)(ii)** — workers' compensation processing is one of only three permitted unredacted disclosures |
| 16 | `no` | 1904.11 | **1904.11(b)(1)** — a pre-employment positive test is not an occupational exposure in your workplace |
| 17 | `permitted` | 1904.11 | **1904.11(b)(2)** is permissive — the employer MAY line the case out on the enumerated evidence, but is never required to |
| 18 | `no` | 1904.10 | **1904.10(a)** — a large shift is not enough; the total hearing level must also reach 25 dB |
| 19 | `no` | 1904.10 | **1904.10(a)** — both tests must be met in the SAME ear; split across ears does not record |
| 20 | `7` | 1904.10 | **1904.10(b)(4)** — a confirming retest starts a 7-calendar-day recording clock |
| 21 | `no` | 1904.9 | **1904.9(b)(3)** — a voluntary removal below the standard's threshold is not recordable; acting early is not penalised |
| 22 | `poisoning` | 1904.9 | **1904.9(b)(1)** — a medical removal following a chemical exposure goes in the poisoning column |
| 23 | `no` | 1904.8 | **1904.8(b)(4)** — a splash with no cut is recordable only on a diagnosis or an independent 1904.7 criterion |
| 24 | `amend` | 1904.8 | **1904.8(b)(3)** — a later bloodborne diagnosis amends the existing entry and flips it injury→illness; it is not a second case |
| 25 | `no` | 1904.8 | **1904.8(b)(2)** — a CLEAN object falls back to 1904.7; not every cut is a 1904.8 case |
| 26 | `no` | recordability | **1904.7(b)(5)(i)(B)** — an x-ray is a diagnostic procedure, expressly not medical treatment |
| 27 | `yes` | recordability | **1904.7(b)(3)(ii)** — the PLHCP recommended days away; what was recommended controls, not what the employee did |
| 28 | `yes` | restricted work | **1904.7(b)(4)(vii)** — an unclarifiable 'light duty' must be recorded; the regulation resolves its own doubt toward recording |
| 29 | `no` | restricted work | **1904.7(b)(4)(iii)** — a restriction confined to the day of injury never counts |
| 30 | `new` | new case | **1904.6(b)(2)** — a recurrence *caused by* a workplace exposure is a new case, even when the condition is not new |
| 31 | `no` | new case | **1904.6(b)(1)** — a chronic illness recurring *without* exposure is recorded once only |
| 32 | `recurrence` | new case | **1904.6(b)(3)** — a PLHCP recommendation, once sought, binds and overrides the rule logic |
| 33 | `the walker` | work-relatedness | **1904.5(b)(2)(vii)** is narrow — it covers a *motor vehicle* accident while commuting. A fall in the same lot is covered by no exception |
| 34 | `no` | work-relatedness | **1904.5(b)(2)(ix)** inverts the usual direction: a mental illness is not work-related *unless* the employee volunteers a PLHCP opinion |
| 35 | `judgment` | work-relatedness | 1904.5(b)(6) "home away from home" is assigned to the employer's evaluation — the tool must refuse to return a verdict |
| 36 | `H` | recordability → classification | Most-serious-outcome rule: days-away outranks restriction when both are present |
| 37 | `J` | recordability → classification | The `1904.7(b)(7)` trap — a fracture is recordable even though a bandage is first aid |
| 38 | `180` | recordability → classification | The 180-day cap |
| 39 | `G` | recordability → classification | Death outranks days away |
| 40 | `2026-03-11T14:00:00.000Z` | recordability → reporting | 24-hour clock runs from when the employer *learned*, not from the incident |
| 41 | `no` | reporting | The 30-day eligibility window — a late death is not reportable |
| 42 | `privacy case` | recordability → privacy | Enumerated privacy category, and the literal log entry |
| 43 | `1904.29(b)(8)` | recordability → privacy | The list is closed *against* the employer — sympathy is not a basis |
| 44 | `1904.29(b)(7)(iii)` | recordability → classification → privacy | Automatic category; no employee request needed |
| 45 | `yes` | recordability | **1904.8** — a contaminated needlestick is recordable even when treated with first aid only |
| 46 | `update` | recordability | The 1904.4(b)(2) tree does not stop at "not a new case" — the existing entry still needs updating |
| 47 | `provisional` | recordability | Unstated medication strength must not resolve silently |

Most of these have an intuitive wrong answer. Each has an intuitive wrong answer that a model reasoning from memory will reach for: *we're too small for OSHA paperwork, so none of it applies*; *we averaged 8 people so we're exempt*; *working from home means a home 300 Log*; *a severed body part is an amputation*; *hospitalised overnight means report it*; *a work fatality always gets the 8-hour call*; *the agency pays them so the agency records it*; *we supervise him daily so he's ours*; *the case follows the injured worker*; *the recording clock starts at the injury*; *the 300 Log is the whole job*; *a positive TB test at a hospital must be occupational*; *evidence it wasn't work-related means you must remove it*; *a big hearing shift must be recordable*; *hearing damage is hearing damage, whichever ear*; *pulling someone out early must surely be recordable*; *a blood splash to the eye is obviously recordable*; *a diagnosis months later is a new case*; *he saw a doctor and got an x-ray, so it's medical treatment*; *he worked all week, so there are no days away*; *"light duty" is too vague to record*; *a flare-up of a recorded condition is never a new case*; *a doctor's opinion is just input*; *a parking-lot injury is a parking-lot injury*; *obvious work stress is obviously work-related*; *bandage means first aid means not recordable*; *a death from a work injury is always reportable*; *the employee asked, so honour it*; *a washed-out needlestick with a bandage is first aid*; *not a new case means nothing to do*; *medication is medication*. Getting those right requires actually calling the tools.

## Verification trace

| Question | Scenario / API Call | Expected Outcome |
|---|---|---|
| **Q1** | `obligation(peak=400, establishment_naics_code=541110)` | `exempt, "Legal Services"` |
| **Q2** | `obligation(peak=400, establishment_naics_code=236118)` | `recordkeeping_required=true` |
| **Q3** | `obligation(company_peak_employees_last_calendar_year=11)` | `recordkeeping_required=true` |
| **Q4** | `obligation(company_peak_employees_last_calendar_year=6)` | `recordkeeping_required=false, severe_injury_reporting_still_required=true` |
| **Q5** | `route(telecommuting=true)` | `establishment_where_employee_normally_works, "home is NOT a business establishment"` |
| **Q6** | `reporting(amputation, amputation_kind=severed_ear)` | `reportable=false, still_recordable=true` |
| **Q7** | `reporting(in_patient_hospitalization, observation_only=true)` | `reportable=false` |
| **Q8** | `reporting(fatality, reporting_exclusion=public_road_motor_vehicle_not_in_work_zone)` | `reportable=false` |
| **Q9** | `recording_employer(temporary_leased_or_supplied, supervise=true)` | `you` |
| **Q10** | `recording_employer(self_employed, supervise=true)` | `no_one` |
| **Q11** | `route(occurred_at_one_of_your_establishments=true)` | `establishment_where_injury_occurred` |
| **Q12** | `route(occurred_at_one_of_your_establishments=false)` | `establishment_where_employee_normally_works` |
| **Q13** | `classify(date_information_received=2026-06-01)` | `record_by=2026-06-08T00:00:00.000Z` |
| **Q14** | `classify(is_recordable=true)` | `forms_required includes "OSHA 301"` |
| **Q15** | `privacy(sexual_assault)` | `disclosure_exceptions includes workers' compensation` |
| **Q16** | `assess(specific_case_criteria=[tuberculosis_infection], tuberculosis_test_was_pre_employment=true)` | `recordable=false` |
| **Q17** | `classify(tuberculosis_case=true, tb_non_occupational_evidence=public_health_department_contact)` | `amend_existing_entry: "...permissive, not required"` |
| **Q18** | `hearing_loss(baseline_left=0, current_left=20)` | `recordable=false (total 20 < 25)` |
| **Q19** | `hearing_loss(left shift 12 / total 18, right total 30 / shift 2)` | `recordable=false (not same ear)` |
| **Q20** | `hearing_loss(qualifying, retest confirmed 2026-05-01)` | `record_by=2026-05-08T00:00:00.000Z` |
| **Q21** | `assess(specific_case_criteria=[medical_removal], medical_removal_was_voluntary_and_early=true)` | `recordable=false` |
| **Q22** | `assess(specific_case_criteria=[medical_removal])` | `log_entry_notes: "...check the POISONING column"` |
| **Q23** | `assess(treatments=[eye_foreign_body_irrigation_or_swab])` | `recordable=false` |
| **Q24** | `classify(is_recordable=true, days_away=5, bloodborne_diagnosis_after_recording=true)` | `amend_existing_entry set` |
| **Q25** | `assess(treatments=[wound_cleaning, wound_covering])` | `recordable=false` |
| **Q26** | `assess(treatments=[diagnostic_procedure_only, non_rigid_support])` | `recordable=false` |
| **Q27** | `assess(plhcp_recommendations_not_followed=[days_away_recommended_but_employee_worked])` | `recordable=true` |
| **Q28** | `restricted_work(vague=true, clarified=false)` | `restricted=true, recorded_by_default=true` |
| **Q29** | `restricted_work(beyond_day_of_injury=false)` | `restricted=false` |
| **Q30** | `new_case(prior=true, workplace_event_caused_current_symptoms=true)` | `new_case, 1904.6(b)(2)` |
| **Q31** | `new_case(prior=true, chronic_recurs_without_workplace_exposure=true)` | `not_new_case, 1904.6(b)(1)` |
| **Q32** | `new_case(prior=true, workplace_event=true, plhcp_opinion=recurrence)` | `not_new_case, decided_by_plhcp=true` |
| **Q33** | `work_relatedness(commuting_motor_vehicle_on_company_lot, solely=true)` <br> `work_relatedness(claimed_exception=none)` | `not_work_related` <br> `work_related` |
| **Q34** | `work_relatedness(mental_illness_without_plhcp_opinion)` | `not_work_related, (b)(2)(ix)` |
| **Q35** | `work_relatedness(special_situation=travel_status)` | `requires_judgment, (b)(6)` |
| **Q36** | `assess(outcomes=[days_away, restricted], treatments=[sutures_or_staples])` <br> `classify(days_away=4, days_restricted=6)` | `recordable` <br> `column=H` |
| **Q37** | `assess(significant_diagnoses=[fractured_or_cracked_bone], treatments=[wound_covering])` <br> `classify(is_recordable=true)` | `column=J` |
| **Q38** | `classify(is_recordable=true, days_away=250)` | `180, capped=true` |
| **Q39** | `classify(is_recordable=true, death=true, days_away=3)` | `column=G` |
| **Q40** | `reporting(amputation, learned 2026-03-10T14:00Z)` | `2026-03-11T14:00:00.000Z` |
| **Q41** | `reporting(fatality, incident 01-01, outcome 02-15)` | `reportable=false` |
| **Q42** | `privacy(contaminated_needlestick_or_sharps)` | `privacy case` |
| **Q43** | `privacy(none_of_these, employee_requested=true)` | `false, 1904.29(b)(8)` |
| **Q44** | `privacy(mental_illness)` | `true, 1904.29(b)(7)(iii)` |
| **Q45** | `assess(specific_case_criteria=[contaminated_needlestick_or_sharps], treatments=[wound_cleaning, wound_covering])` | `recordable=true, 1904.8` |
| **Q46** | `assess(new_case=false, outcomes=[restricted_work_or_transfer])` | `basis directs "UPDATE"` |
| **Q47** | `assess(treatments=[medication_unspecified_strength])` | `determination_final=false` |

## Stability

Answers are pinned to fixed dates and to values that do not move: column letters, the 180-day cap, CFR sub-clauses, and a deadline computed from a stated `learned_datetime`.

Nothing here asserts `hours_remaining` or `overdue`, which are relative to wall-clock time and would rot within a day. If a future question needs them, pass an explicit `now` to `checkSevereInjuryReporting` rather than asserting against `Date.now()`.

The one thing that *should* eventually break these: OSHA amending Part 1904. That is what the decay check and `last_verified` exist to surface.
