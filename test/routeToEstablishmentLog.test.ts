/**
 * Test suite for the `routeToEstablishmentLog` tool (29 CFR § 1904.30).
 * Validates place-of-occurrence routing, telecommuting linked-establishment routing,
 * short-term operation combined logs, and central recordkeeping transmission timelines.
 */
import { routeToEstablishmentLog } from "../src/tools/routeToEstablishmentLog.js";

type Input = Parameters<typeof routeToEstablishmentLog>[0];

/**
 * zod `.default()` fields are optional at the call site but REQUIRED in the
 * inferred type, so every new defaulted input would otherwise churn every fixture
 * here. Build inputs through this instead.
 */
const input = (over: Partial<Input> = {}): Input => ({
  occurred_at_one_of_your_establishments: true,
  employee_was_telecommuting_from_home: false,
  destination_expected_to_operate_a_year_or_longer: true,
  records_kept_centrally: false,
  ...over,
});

// 1904.30(b)(4): the case follows the PLACE, not the person. This is the direction
// multi-site employers get backwards, and site TRIR depends on it.
describe("route_to_establishment_log — the (b)(4) split", () => {
  test("a visiting employee's injury goes on the HOST establishment's log", () => {
    const r = routeToEstablishmentLog(input({ occurred_at_one_of_your_establishments: true }));
    expect(r.value.log_destination).toBe("establishment_where_injury_occurred");
    expect(r.value.basis).toMatch(/even if the employee normally works at a different/i);
  });

  test("an injury away from every establishment goes on the employee's home log", () => {
    const r = routeToEstablishmentLog(input({ occurred_at_one_of_your_establishments: false }));
    expect(r.value.log_destination).toBe("establishment_where_employee_normally_works");
    expect(r.value.basis).toMatch(/customer site, in transit, or working remotely/i);
  });

  test("both routes cite 1904.30(b)(4)", () => {
    for (const occurred of [true, false]) {
      const r = routeToEstablishmentLog(
        input({ occurred_at_one_of_your_establishments: occurred })
      );
      expect(r.cfr_cite).toBe("1904.30(b)(4)");
    }
  });
});

describe("route_to_establishment_log — whether the site needs its own log", () => {
  test("an establishment expected to run a year or longer needs its own log", () => {
    const r = routeToEstablishmentLog(input());
    expect(r.value.destination_needs_own_log).toBe(true);
    expect(r.value.cfr_cites).toContain("1904.30(a)");
  });

  test("a short-term site may share a combined log", () => {
    const r = routeToEstablishmentLog(
      input({ destination_expected_to_operate_a_year_or_longer: false })
    );
    expect(r.value.destination_needs_own_log).toBe(false);
    expect(r.value.cfr_cites).toContain("1904.30(b)(1)");
    // Still recordable — only the log structure changes.
    expect(r.value.own_log_basis).toMatch(/must still be recorded/i);
  });
});

describe("route_to_establishment_log — central recordkeeping (1904.30(b)(2))", () => {
  test("computes the 7-calendar-day transmission deadline", () => {
    const r = routeToEstablishmentLog(
      input({ records_kept_centrally: true, date_information_received: "2026-06-01T00:00:00Z" })
    );
    expect(r.value.transmit_by_iso).toBe("2026-06-08T00:00:00.000Z");
  });

  test("returns both conditions central recordkeeping depends on", () => {
    const r = routeToEstablishmentLog(input({ records_kept_centrally: true }));
    const cites = r.value.central_recordkeeping_conditions.map((c) => c.cfr_cite);
    expect(cites).toEqual(["1904.30(b)(2)(i)", "1904.30(b)(2)(ii)"]);
  });

  test("no central recordkeeping means no conditions and no deadline", () => {
    const r = routeToEstablishmentLog(input({ date_information_received: "2026-06-01T00:00:00Z" }));
    expect(r.value.central_recordkeeping_conditions).toHaveLength(0);
    expect(r.value.transmit_by_iso).toBeNull();
  });

  test("an unparseable date yields no deadline rather than throwing", () => {
    expect(() =>
      routeToEstablishmentLog(
        input({ records_kept_centrally: true, date_information_received: "next week" })
      )
    ).not.toThrow();
    const r = routeToEstablishmentLog(
      input({ records_kept_centrally: true, date_information_received: "next week" })
    );
    expect(r.value.transmit_by_iso).toBeNull();
  });

  test("carries provenance", () => {
    const r = routeToEstablishmentLog(input());
    expect(r.source_url).toMatch(/ecfr\.gov/);
    expect(r.last_verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// 1904.46(3): a home is never a business establishment, so a telecommuter's case
// always routes to the establishment they are linked to under 1904.30(b)(3).
describe("route_to_establishment_log — telecommuting (1904.46(3))", () => {
  test("a home injury routes to the linked establishment, not the home", () => {
    const r = routeToEstablishmentLog(
      input({
        occurred_at_one_of_your_establishments: false,
        employee_was_telecommuting_from_home: true,
      })
    );
    expect(r.value.log_destination).toBe("establishment_where_employee_normally_works");
    expect(r.value.cfr_cites).toContain("1904.46(3)");
    expect(r.value.basis).toMatch(/home is NOT a business establishment/i);
  });

  test("telecommuting overrides a mistaken 'at an establishment' flag", () => {
    // A home can never be the establishment where the injury occurred, so the
    // routing must not follow the place when the place is someone's house.
    const r = routeToEstablishmentLog(
      input({
        occurred_at_one_of_your_establishments: true,
        employee_was_telecommuting_from_home: true,
      })
    );
    expect(r.value.log_destination).toBe("establishment_where_employee_normally_works");
  });

  test("no separate log is ever needed for a home", () => {
    const r = routeToEstablishmentLog(
      input({
        occurred_at_one_of_your_establishments: false,
        employee_was_telecommuting_from_home: true,
      })
    );
    expect(r.value.basis).toMatch(/no separate 300 Log/i);
  });

  test("a non-telecommuting case cites no 1904.46 rule", () => {
    const r = routeToEstablishmentLog(input());
    expect(r.value.cfr_cites).not.toContain("1904.46(3)");
  });
});
