const test = require("node:test");
const assert = require("node:assert/strict");

const metricsConfig = require("../config/metrics");
const nlu = require("../lib/nlu");

test("extractFiltersFromText: 识别大写CT", () => {
  const r = nlu.extractFiltersFromText(metricsConfig, "查询CT的工程师数量");
  assert.deepEqual(r, { filterDimension: "product", filterValues: ["CT"] });
});

test("extractFiltersFromText: 识别小写ct", () => {
  const r = nlu.extractFiltersFromText(metricsConfig, "查询ct的工程师数量");
  assert.deepEqual(r, { filterDimension: "product", filterValues: ["CT"] });
});

test("extractFiltersFromText: 识别混合大小写与空格", () => {
  const r = nlu.extractFiltersFromText(metricsConfig, "看下 10月 cT 的工程师数量");
  assert.deepEqual(r, { filterDimension: "product", filterValues: ["CT"] });
});

test("extractFiltersFromText: 识别非PSM", () => {
  const r = nlu.extractFiltersFromText(metricsConfig, "查询非psm的工程师数量");
  assert.deepEqual(r, { filterDimension: "org", filterValues: ["非PSM"] });
});

test("canonicalizeFilterValues: 去重并归一化大小写", () => {
  const r = nlu.canonicalizeFilterValues(metricsConfig, "product", ["ct", "CT", " Ct "]);
  assert.deepEqual(r, ["CT"]);
});
