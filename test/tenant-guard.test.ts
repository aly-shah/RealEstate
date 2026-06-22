import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompanyScoped, runUnscoped } from "@/lib/prisma";

test("isCompanyScoped detects a direct companyId scope", () => {
  assert.equal(isCompanyScoped({ where: { companyId: "c1" } }), true);
  assert.equal(isCompanyScoped({ where: { companyId: "c1", stage: "NEW" } }), true);
});

test("isCompanyScoped detects a nested relation company scope", () => {
  assert.equal(isCompanyScoped({ where: { commission: { companyId: "c1" } } }), true);
  assert.equal(isCompanyScoped({ where: { deal: { companyId: "c1" } } }), true);
});

test("isCompanyScoped flags a where with no company anchor", () => {
  assert.equal(isCompanyScoped({ where: { userId: "u1" } }), false);
  assert.equal(isCompanyScoped({ where: { stage: "NEW" } }), false);
});

test("isCompanyScoped treats a missing/empty where as unscoped", () => {
  assert.equal(isCompanyScoped({}), false);
  assert.equal(isCompanyScoped(undefined), false);
  assert.equal(isCompanyScoped({ where: undefined }), false);
});

test("runUnscoped runs the callback and returns its value", async () => {
  const result = await runUnscoped("test", async () => 42);
  assert.equal(result, 42);
});
