import { test } from "node:test";
import assert from "node:assert/strict";
import { can, CAPABILITIES, COMPANY_ROLES, homePathForRole } from "@/lib/rbac";

/**
 * RBAC matrix tests. Capability grants are a security boundary —
 * every change should fail loudly. The expectations below mirror the
 * requirements §3 permission matrix.
 */

test("SUPER_ADMIN can do everything in the matrix", () => {
  for (const capability of Object.keys(CAPABILITIES) as Array<keyof typeof CAPABILITIES>) {
    assert.equal(can("SUPER_ADMIN", capability), true, `SUPER_ADMIN missing ${capability}`);
  }
});

test("AGENT cannot manage users", () => {
  assert.equal(can("AGENT", "manageUsers"), false);
});

test("AGENT cannot assign leads/calendars", () => {
  assert.equal(can("AGENT", "assignLeadsCalendars"), false);
});

test("AGENT cannot record deals", () => {
  assert.equal(can("AGENT", "recordDeals"), false);
});

test("AGENT can update leads/visits", () => {
  assert.equal(can("AGENT", "updateLeadsVisits"), true);
});

test("DEALER cannot view company reports", () => {
  assert.equal(can("DEALER", "viewCompanyReports"), false);
});

test("DEALER cannot manage users", () => {
  assert.equal(can("DEALER", "manageUsers"), false);
});

test("OWNER can set commission rules; ADMIN cannot", () => {
  assert.equal(can("OWNER", "setCommissionRules"), true);
  assert.equal(can("ADMIN", "setCommissionRules"), false);
});

test("Only SUPER_ADMIN can manage companies", () => {
  assert.equal(can("SUPER_ADMIN", "manageCompanies"), true);
  assert.equal(can("OWNER", "manageCompanies"), false);
  assert.equal(can("ADMIN", "manageCompanies"), false);
  assert.equal(can("AGENT", "manageCompanies"), false);
  assert.equal(can("DEALER", "manageCompanies"), false);
});

test("COMPANY_ROLES excludes SUPER_ADMIN", () => {
  assert.equal(COMPANY_ROLES.includes("OWNER"), true);
  assert.equal(COMPANY_ROLES.includes("AGENT"), true);
  assert.equal(COMPANY_ROLES.includes("SUPER_ADMIN"), false);
});

test("homePathForRole routes SUPER_ADMIN to the platform console", () => {
  assert.equal(homePathForRole("SUPER_ADMIN"), "/admin/companies");
  assert.equal(homePathForRole("OWNER"), "/dashboard");
  assert.equal(homePathForRole("AGENT"), "/dashboard");
});
