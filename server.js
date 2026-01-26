console.log("SERVER STARTING...");
const express = require("express");
const cors = require("cors");
const ExcelJS = require("exceljs");
const path = require("path");
const metricsConfig = require("./config/metrics");
const nlu = require("./lib/nlu");
const db = require("./db");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.get("/vendor/echarts.min.js", (req, res) => {
  res.sendFile(path.join(__dirname, "node_modules", "echarts", "dist", "echarts.min.js"));
});
app.use(express.static("public"));

const Stage = {
  KPI_CATEGORY_SELECT: "KPI_CATEGORY_SELECT",
  KPI_METRIC_SELECT: "KPI_METRIC_SELECT",
  TIME_TYPE_SELECT: "TIME_TYPE_SELECT",
  TIME_VALUE_SELECT: "TIME_VALUE_SELECT",
  FILTER_DIMENSION_SELECT: "FILTER_DIMENSION_SELECT",
  FILTER_VALUE_SELECT: "FILTER_VALUE_SELECT",
  SUMMARY_CONFIRM: "SUMMARY_CONFIRM",
  EXECUTING_QUERY: "EXECUTING_QUERY",
  SHOW_RESULT: "SHOW_RESULT",
};

const FilterDimension = {
  NONE: "NONE",
  PRODUCT: "product",
  ORG: "org",
};

const kpiCategories = metricsConfig.categories;

const conversations = new Map();

async function getTimeOptions() {
  const rows = await db.query(
    "SELECT DISTINCT st_WrMonth FROM dws_tas_roster ORDER BY st_WrMonth",
    []
  );
  const monthsRaw = rows
    .map((r) => (r.st_WrMonth == null ? null : String(r.st_WrMonth)))
    .filter((v) => v);
  monthsRaw.sort();
  const monthOptions = monthsRaw.map((m) => ({
    value: m,
    label: m,
  }));
  const yearMap = new Map();
  for (let i = 0; i < monthsRaw.length; i += 1) {
    const m = monthsRaw[i];
    if (m.length < 6) continue;
    const year = m.slice(0, 4);
    const monthNum = parseInt(m.slice(4), 10);
    if (Number.isNaN(monthNum)) continue;
    if (!yearMap.has(year)) {
      yearMap.set(year, []);
    }
    yearMap.get(year).push(monthNum);
  }
  const fyOptions = [];
  const halfFyOptions = [];
  for (const [year, monthNums] of yearMap.entries()) {
    fyOptions.push({
      value: year,
      label: year + " 财年",
    });
    const hasH1 = monthNums.some((v) => v >= 1 && v <= 6);
    const hasH2 = monthNums.some((v) => v >= 7 && v <= 12);
    if (hasH1) {
      halfFyOptions.push({
        value: year + "H1",
        label: year + " 上半年",
      });
    }
    if (hasH2) {
      halfFyOptions.push({
        value: year + "H2",
        label: year + " 下半年",
      });
    }
  }
  fyOptions.sort((a, b) => String(a.value).localeCompare(String(b.value)));
  halfFyOptions.sort((a, b) =>
    String(a.value).localeCompare(String(b.value))
  );
  return {
    month: monthOptions,
    half_fy: halfFyOptions,
    fy: fyOptions,
  };
}

function createEmptyState() {
  return {
    stage: Stage.KPI_CATEGORY_SELECT,
    kpiCategoryId: null,
    kpiMetricId: null,
    kpiDetailId: null,
    timeRange: null,
    filterDimension: FilterDimension.NONE,
    filterValues: [],
    lastQueryResult: null,
    lastQuerySql: null,
  };
}

function findKpiCategoryByLabel(label) {
  return kpiCategories.find((c) => c.label === label || c.id === label);
}

function findMetricByLabel(category, label) {
  if (!category) return null;
  return category.metrics.find((m) => m.label === label || m.id === label);
}

function findDetailByLabel(metric, label) {
  if (!metric) return null;
  return metric.details.find((d) => d.label === label || d.id === label);
}

async function buildOptionsForStage(state) {
  const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
  const metric =
    category && category.metrics.find((m) => m.id === state.kpiMetricId);

  if (state.stage === Stage.KPI_CATEGORY_SELECT) {
    return kpiCategories.map((c) => ({
      label: c.label,
      payload: { type: "kpi_category", id: c.id },
    }));
  }
  if (state.stage === Stage.KPI_METRIC_SELECT) {
    if (!category) return [];
    return category.metrics.map((m) => ({
      label: m.label,
      payload: { type: "kpi_metric", id: m.id },
    }));
  }
  if (state.stage === Stage.TIME_TYPE_SELECT) {
    let allowedTypes = ["month", "half_fy", "fy"];
    if (metric && metric.allowedTimeTypes) {
        allowedTypes = metric.allowedTimeTypes;
    }
    
    const options = [];
    if (allowedTypes.includes("month")) {
        options.push({
            label: "Month",
            payload: { type: "time_type", value: "month" },
        });
    }
    if (allowedTypes.includes("half_fy")) {
        options.push({
            label: "HalfFY",
            payload: { type: "time_type", value: "half_fy" },
        });
    }
    if (allowedTypes.includes("fy")) {
        options.push({
            label: "FY",
            payload: { type: "time_type", value: "fy" },
        });
    }
    return options;
  }
  if (state.stage === Stage.TIME_VALUE_SELECT) {
    const timeOptions = await getTimeOptions();
    const type = state.timeType || "month";
    const options = timeOptions[type] || [];
    return options.map((opt) => ({
      label: opt.label,
      payload: { type: "time_value", value: opt.value, label: opt.label },
    }));
  }
  if (state.stage === Stage.FILTER_DIMENSION_SELECT) {
    let allowedDimensions = null;
    if (metric && metric.allowedFilterDimensions) {
        allowedDimensions = metric.allowedFilterDimensions;
    }
    
    const options = metricsConfig.filterDimensions
        .filter(d => !allowedDimensions || allowedDimensions.includes(d.id))
        .map((d) => ({
          label: d.label,
          payload: { type: "filter_dimension", value: d.id },
        }));
        
    options.push({
      label: "不筛选",
      payload: { type: "filter_dimension", value: FilterDimension.NONE },
    });
    return options;
  }
  if (state.stage === Stage.FILTER_VALUE_SELECT) {
    if (state.filterDimension && state.filterDimension !== FilterDimension.NONE) {
      const dim = metricsConfig.filterDimensions.find(
        (d) => d.id === state.filterDimension
      );
      if (!dim) return [];
      return dim.values.map((v) => ({
        label: v.label,
        payload: { type: "filter_value", value: v.id },
      }));
    }
  }
  if (state.stage === Stage.SUMMARY_CONFIRM) {
    return [
      { label: "开始查询", payload: { type: "confirm_start" } },
      { label: "修改", payload: { type: "modify" } },
    ];
  }
  if (state.stage === Stage.SHOW_RESULT) {
    return [
      { label: "生成图表", payload: { type: "chart" } },
      { label: "下载明细", payload: { type: "download_detail" } },
      { label: "新查询", payload: { type: "new_query" } },
    ];
  }
  return [];
}

function summarizeState(state) {
  const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
  const metric =
    category && category.metrics.find((m) => m.id === state.kpiMetricId);
  const parts = [];
  if (category) parts.push(category.label);
  if (metric) parts.push(metric.label);
  const kpiText = parts.length > 0 ? parts.join(" / ") : "未选择";
  const timeText = state.timeRange ? state.timeRange.label : "未选择";
  let filterText = "不筛选";
  if (
    state.filterDimension &&
    state.filterDimension !== FilterDimension.NONE &&
    state.filterValues.length > 0
  ) {
    const dim = metricsConfig.filterDimensions.find(
      (d) => d.id === state.filterDimension
    );
    if (dim) {
      const labels = dim.values
        .filter((v) => state.filterValues.includes(v.id))
        .map((v) => v.label)
        .join("、");
      filterText = dim.label + "：" + labels;
    }
  }
  let summary = `已选择指标：${kpiText}\n时间范围：${timeText}\n筛选条件：${filterText}`;
  if (state.lastQuerySql) {
    summary += `\nSQL: ${state.lastQuerySql}`;
  }
  return summary;
}

function withSummary(text, state) {
  return text; // 不再合并 summary
}

function getSummary(state) {
  return summarizeState(state);
}

function stripWhereStubForDisplay(sql) {
  return String(sql || "")
    .replace(/\bWHERE\s+1=1\s+AND\s+/i, "WHERE ")
    .replace(/\bWHERE\s+1=1\b\s*/i, "");
}

function formatSqlForDisplay(sql, params) {
  let formatted = String(sql || "");
  for (const val of Array.isArray(params) ? params : []) {
    const v = typeof val === "string" ? `'${val}'` : val;
    formatted = formatted.replace("?", v);
  }
  return stripWhereStubForDisplay(formatted);
}

function buildWhere(state) {
  const params = [];
  let where = "WHERE 1=1";
  
  const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
  const metric = category && category.metrics.find((m) => m.id === state.kpiMetricId);

  if (state.timeRange && state.timeRange.type !== 'none' && state.timeRange.value) {
    const tr = state.timeRange;
    if (tr.type === "month" && tr.value) {
      where += " AND st_WrMonth = ?";
      params.push(tr.value);
    } else if (tr.type === "half_fy" && tr.value) {
      const v = String(tr.value);
      const year = v.slice(0, 4);
      const half = v.slice(4);
      let minMonth = 1;
      let maxMonth = 12;
      if (half === "H1") {
        minMonth = 1;
        maxMonth = 6;
      } else if (half === "H2") {
        minMonth = 7;
        maxMonth = 12;
      }
      where +=
        " AND substr(st_WrMonth, 1, 4) = ? AND CAST(substr(st_WrMonth, 5, 2) AS INTEGER) BETWEEN ? AND ?";
      params.push(year, minMonth, maxMonth);
    } else if (tr.type === "fy" && tr.value) {
      const v = String(tr.value);
      const year = v.slice(0, 4);
      where += " AND substr(st_WrMonth, 1, 4) = ?";
      params.push(year);
    } else if (tr.value && tr.value !== "any") {
      // Only filter if value is provided and not 'any'
      where += " AND st_WrMonth = ?";
      params.push(tr.value);
    }
  }
  if (
    state.filterDimension &&
    state.filterDimension !== FilterDimension.NONE &&
    state.filterValues.length > 0
  ) {
    const dim = metricsConfig.filterDimensions.find(
      (d) => d.id === state.filterDimension
    );
    if (dim) {
      let column = dim.column;
      // Check for dimension override in metric config
      if (metric && metric.dimensionMap && metric.dimensionMap[dim.id]) {
          column = metric.dimensionMap[dim.id];
      }
      
      const placeholders = state.filterValues.map(() => "?").join(",");
      where += " AND " + column + " IN (" + placeholders + ")";
      for (let i = 0; i < state.filterValues.length; i += 1) {
        params.push(state.filterValues[i]);
      }
    }
  }
  return { where, params };
}

async function executeQuery(state) {
  try {
    state.stage = Stage.EXECUTING_QUERY;
    const queryResult = await runQueryForState(state);
    state.lastQueryResult = queryResult.raw || null;
    state.lastQuerySql = queryResult.sql || null;
    state.stage = Stage.SHOW_RESULT;
    const options = await buildOptionsForStage(state);
    return {
      reply: queryResult.reply,
      summary: getSummary(state), // Summary will now contain the executed conditions and SQL
      stage: state.stage,
      options,
      done: true,
      result: queryResult.raw || null,
      state,
    };
  } catch (e) {
    state.stage = Stage.SUMMARY_CONFIRM; // Fallback if error
    return {
      reply: "执行数据库查询时出错：" + e.message,
      summary: getSummary(state),
      stage: state.stage,
      options: await buildOptionsForStage(state),
      done: false,
      result: null,
      state,
    };
  }
}

async function handleButtonInput(state, payload, textInput) {
  if (state.stage === Stage.KPI_CATEGORY_SELECT && payload.type === "kpi_category") {
    state.kpiCategoryId = payload.id;
    // state.stage = Stage.KPI_METRIC_SELECT;
    return {
      reply: updateStageAndGetReply(state)
    };
  }
  if (state.stage === Stage.KPI_METRIC_SELECT && payload.type === "kpi_metric") {
    state.kpiMetricId = payload.id;
    // state.stage = Stage.TIME_TYPE_SELECT;
    return {
      reply: updateStageAndGetReply(state)
    };
  }
  if (state.stage === Stage.TIME_TYPE_SELECT && payload.type === "time_type") {
    state.timeType = payload.value;
    state.stage = Stage.TIME_VALUE_SELECT;
    return {
      reply: withSummary("请选择具体时间：", state),
    };
  }
  if ((state.stage === Stage.TIME_VALUE_SELECT || state.stage === Stage.TIME_TYPE_SELECT) && payload.type === "time_value") {
    state.timeRange = {
      type: payload.timeType || state.timeType,
      value: payload.value,
      label: payload.label,
    };
    // state.stage = Stage.FILTER_DIMENSION_SELECT;
    return {
      reply: updateStageAndGetReply(state)
    };
  }
  if (state.stage === Stage.FILTER_DIMENSION_SELECT && payload.type === "filter_dimension") {
    state.filterDimension = payload.value;
    if (payload.value === FilterDimension.NONE) {
      state.filterValues = [];
      return executeQuery(state);
    }
    // state.stage = Stage.FILTER_VALUE_SELECT;
    return {
      reply: updateStageAndGetReply(state)
    };
  }
  if (state.stage === Stage.FILTER_VALUE_SELECT && payload.type === "confirm_filter_values") {
    state.filterValues = payload.values || [];
    return executeQuery(state);
  }
  if (state.stage === Stage.FILTER_VALUE_SELECT && payload.type === "filter_value") {
    if (!state.filterValues.includes(payload.value)) {
      state.filterValues.push(payload.value);
    }
    state.stage = Stage.SUMMARY_CONFIRM;
    return {
      reply: summarizeState(state),
    };
  }
  if (state.stage === Stage.SUMMARY_CONFIRM) {
    if (payload.type === "modify") {
      state.stage = Stage.KPI_CATEGORY_SELECT;
      state.kpiCategoryId = null;
      state.kpiMetricId = null;
      state.kpiDetailId = null;
      state.timeType = null;
      state.timeRange = null;
      state.filterDimension = FilterDimension.NONE;
      state.filterValues = [];
      state.lastQueryResult = null;
      state.lastQuerySql = null;
      return {
        reply: withSummary("请重新选择KPI大类：", state),
      };
    }
  }
  if (state.stage === Stage.SHOW_RESULT) {
    if (payload.type === "new_query") {
      const newState = createEmptyState();
      state.stage = Stage.KPI_CATEGORY_SELECT;
      state.kpiCategoryId = null;
      state.kpiMetricId = null;
      state.kpiDetailId = null;
      state.timeType = null;
      state.timeRange = null;
      state.filterDimension = FilterDimension.NONE;
      state.filterValues = [];
      state.lastQueryResult = null;
      state.lastQuerySql = null;
      
      return {
        reply: withSummary("开始新的查询，请选择KPI大类：", state),
      };
    }
    if (payload.type === "chart") {
      const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
      const metric = category && category.metrics.find((m) => m.id === state.kpiMetricId);
      
      if (metric && metric.kind === "aggregate_group" && state.lastQueryResult) {
          const rows = state.lastQueryResult;
          const groupBy = metric.groupBy || "item";
          
          const chartData = {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: rows.map(r => r[groupBy] || "未知") },
            yAxis: { type: 'value' },
            series: [{
                data: rows.map(r => r.value),
                type: 'bar',
                itemStyle: { color: '#3b82f6' }
            }],
            grid: { top: 30, bottom: 30, left: 40, right: 20 }
        };
        return {
            reply: withSummary("已为您生成图表：", state),
            chartData: chartData
        };
      }
      
      if (metric && metric.kind === "aggregate") {
          const { where, params } = buildWhere(state);
          
          // Determine the product column
          let productCol = "st_DeptName"; // Default for personnel
          // Find 'product' dimension config
          const productDim = metricsConfig.filterDimensions.find(d => d.id === 'product');
          if (productDim) {
             productCol = productDim.column;
          }
          // Check for override
          if (metric.dimensionMap && metric.dimensionMap.product) {
              productCol = metric.dimensionMap.product;
          }

          let sql = metric.sql;
          sql = sql.replace(/SELECT\s+COUNT\(\*\)\s+AS\s+value/i, `SELECT ${productCol} as product, COUNT(*) AS value`);
          sql = sql.replace("{where}", where);
          sql += ` GROUP BY ${productCol}`;

          const rows = await db.query(sql, params);
          
          let finalRows = rows;
          if (state.filterDimension === FilterDimension.PRODUCT && state.filterValues.length > 0) {
              const existingMap = new Map(rows.map(r => [r.product, r.value]));
              finalRows = state.filterValues.map(val => ({
                  product: val,
                  value: existingMap.get(val) || 0
              }));
          }
          
          if (finalRows.length > 0 || state.filterValues.length > 0) { 
              const chartData = {
                tooltip: { trigger: 'axis' },
                xAxis: { type: 'category', data: finalRows.map(r => r.product || "未知") },
                yAxis: { type: 'value' },
                series: [{
                    data: finalRows.map(r => r.value),
                    type: 'bar',
                    itemStyle: { color: '#3b82f6' }
                }],
                grid: { top: 30, bottom: 30, left: 40, right: 20 }
            };
             state.lastQuerySql = formatSqlForDisplay(sql, params);

             return {
                reply: withSummary("已按产品为您生成图表：", state),
                summary: getSummary(state), 
                summary: getSummary(state), 
                chartData: chartData
            };
          }
      }
      
      return {
        reply: withSummary("当前指标或数据不支持生成图表。", state),
      };
    }
    if (payload.type === "download_detail") {
      return {
        reply: withSummary("已准备好明细数据，请点击下载按钮。", state),
      };
    }
  }
  return {
    reply: withSummary(
      "未能理解你的选择，请使用提供的按钮继续操作。",
      state
    ),
  };
}

async function extractEntitiesFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const monthFromText = extractMonthFromText(trimmed);
  const filtersFromText = extractFiltersFromText(trimmed);
  const kpiFromText = extractKpiFromText(trimmed);
  
  let finalKpi = kpiFromText;
  let finalTime = monthFromText ? { type: "month", value: monthFromText, label: monthFromText } : null;
  let finalFilterDim = filtersFromText ? filtersFromText.filterDimension : null;
  let finalFilterVals = filtersFromText ? filtersFromText.filterValues : [];

  if (!finalKpi) {
      const llmIntent = await parseIntentWithLlm(trimmed).catch(() => null);
      if (llmIntent) {
          if (llmIntent.kpiMetricId) {
              finalKpi = {
                  kpiCategoryId: llmIntent.kpiCategoryId,
                  kpiMetricId: llmIntent.kpiMetricId,
                  kpiDetailId: llmIntent.kpiDetailId
              };
          }
          if (!finalTime && llmIntent.timeRange) {
               finalTime = llmIntent.timeRange;
          }
          if (!finalFilterDim && llmIntent.filterDimension) {
               finalFilterDim = llmIntent.filterDimension;
               finalFilterVals = llmIntent.filterValues;
          }
      }
  }

  if (!finalKpi && !finalTime && !finalFilterDim) {
      return null;
  }

  return {
    kpiCategoryId: finalKpi ? finalKpi.kpiCategoryId : null,
    kpiMetricId: finalKpi ? finalKpi.kpiMetricId : null,
    kpiDetailId: finalKpi ? finalKpi.kpiDetailId : null,
    timeRange: finalTime,
    filterDimension: finalFilterDim,
    filterValues: finalFilterVals,
  };
}

function extractKpiFromText(text) {
  for (const category of kpiCategories) {
    for (const metric of category.metrics) {
      if (metric.keywords && metric.keywords.length > 0) {
        for (const keyword of metric.keywords) {
            const parts = keyword.split("+");
            const allPartsMatch = parts.every(part => text.includes(part));
            if (allPartsMatch) {
                return {
                    kpiCategoryId: category.id,
                    kpiMetricId: metric.id,
                    kpiDetailId: null,
                };
            }
        }
      }
    }
  }
  return null;
}

function updateStageAndGetReply(state) {
  const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
  const metric = category && category.metrics.find((m) => m.id === state.kpiMetricId);

  if (!state.kpiMetricId) {
      if (state.kpiCategoryId) {
           state.stage = Stage.KPI_METRIC_SELECT;
           return withSummary("请选择二级指标：", state);
      }
      state.stage = Stage.KPI_CATEGORY_SELECT;
      return withSummary("请先选择KPI大类：", state);
  }
  
  const hasTimeConfig = metric && metric.allowedTimeTypes && metric.allowedTimeTypes.length > 0;
  
  if (!state.timeRange && hasTimeConfig) {
    state.stage = Stage.TIME_TYPE_SELECT;
    return withSummary("已识别指标，请继续选择时间类型：", state);
  } else if (!state.timeRange && !hasTimeConfig) {
      state.timeRange = { type: 'none', label: '不限', value: null };
  }

  if (!state.filterDimension || state.filterDimension === FilterDimension.NONE) {
    state.stage = Stage.FILTER_DIMENSION_SELECT;
    return withSummary("已识别指标和时间，请选择筛选维度：", state);
  }
  
  if (state.filterDimension !== FilterDimension.NONE && state.filterValues.length === 0) {
      state.stage = Stage.FILTER_VALUE_SELECT;
      return withSummary("请选择具体值：", state);
  }

  state.stage = Stage.SUMMARY_CONFIRM;
  return withSummary(summarizeState(state) + "\n如无问题，请点击“开始查询”，或选择“修改”。", state);
}

function extractMonthFromText(text) {
  const explicit = text.match(/20\d{4}/);
  if (explicit && explicit[0]) {
    return explicit[0];
  }
  const m = text.match(/(\d{1,2})月/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (Number.isNaN(num)) return null;
  if (num === 10) return "202510";
  if (num === 11) return "202511";
  if (num === 12) return "202512";
  return null;
}

function extractFiltersFromText(text) {
  const extracted = nlu.extractFiltersFromText(metricsConfig, text);
  if (!extracted) return null;
  if (extracted.filterDimension === "product") {
    return {
      filterDimension: FilterDimension.PRODUCT,
      filterValues: extracted.filterValues,
    };
  }
  if (extracted.filterDimension === "org") {
    return {
      filterDimension: FilterDimension.ORG,
      filterValues: extracted.filterValues,
    };
  }
  return null;
}

async function parseIntentWithLlm(text) {
  if (typeof fetch === "undefined") {
    return null;
  }
  
  const metricDescriptions = kpiCategories
      .flatMap(c => c.metrics)
      .map(m => `- ${m.id}: ${m.description || m.label}`)
      .join("\n");
      
  const body = {
    model: process.env.LLM_MODEL || "deepseek-r1:32b",
    messages: [
      {
        role: "system",
        content:
          "你是一个KPI查询意图解析器，只输出JSON。" +
          "JSON字段: " +
          "kpiMetric (从下方指标列表中选择一个id), " +
          "month (如 '202510' 表示 2025年10月), " +
          "filterDimension ('product' 或 'org' 或 null), " +
          "filterValues (字符串数组，如 ['CT'] 或 ['PSM'])。\n\n" +
          "可选指标列表：\n" + metricDescriptions + "\n\n" +
          "用户可能会说类似“看下10月ct的工程师数量”这样的中文自然语言，请你解析出对应的字段。" +
          "注意：请根据用户的描述匹配最合适的指标ID。",
      },
      { role: "user", content: text },
    ],
    stream: false,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  let resp;
  const llmApiUrl = process.env.LLM_API_URL || "http://localhost:11434/api/chat";
  try {
    resp = await fetch(llmApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
  clearTimeout(timeout);
  if (!resp.ok) {
    return null;
  }
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return null;
  }
  const content = data && data.message && data.message.content;
  if (!content) return null;
  let jsonText = content.trim();
  const match = jsonText.match(/\{[\s\S]*\}/);
  if (match) {
    jsonText = match[0];
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return null;
  }
  
  const kpiMetric = parsed.kpiMetric;
  let metricId = null;
  const allMetrics = kpiCategories.flatMap(c => c.metrics);
  const matchedMetric = allMetrics.find(m => m.id === kpiMetric);
  if (matchedMetric) {
      metricId = matchedMetric.id;
  } else {
      if (kpiMetric === "engineer_count" || !kpiMetric) metricId = "engineer_count";
  }

  const month = parsed.month;
  let filterDimension = FilterDimension.NONE;
  if (parsed.filterDimension === "product") {
    filterDimension = FilterDimension.PRODUCT;
  } else if (parsed.filterDimension === "org") {
    filterDimension = FilterDimension.ORG;
  }
  const rawFilterValues = Array.isArray(parsed.filterValues) ? parsed.filterValues : [];
  const filterValues =
    filterDimension === FilterDimension.PRODUCT
      ? nlu.canonicalizeFilterValues(metricsConfig, "product", rawFilterValues)
      : filterDimension === FilterDimension.ORG
        ? nlu.canonicalizeFilterValues(metricsConfig, "org", rawFilterValues)
        : [];
  return {
    kpiCategoryId: "personnel",
    kpiMetricId: metricId,
    kpiDetailId: null,
    timeRange: month
      ? { type: "month", value: month, label: month }
      : null,
    filterDimension,
    filterValues,
  };
}

function processIntentAndGetReply(state, intent) {
  state.kpiCategoryId = intent.kpiCategoryId;
  state.kpiMetricId = intent.kpiMetricId;
  state.kpiDetailId = intent.kpiDetailId;
  state.timeRange = intent.timeRange;

  if (intent.filterDimension) {
    state.filterDimension = intent.filterDimension;
    state.filterValues = intent.filterValues || [];
  } else {
    state.filterDimension = FilterDimension.NONE;
    state.filterValues = [];
  }

  if (!state.timeRange) {
    state.stage = Stage.TIME_TYPE_SELECT;
    return withSummary("已识别指标，请继续选择时间类型：", state);
  }

  if (!intent.filterDimension) {
    state.stage = Stage.FILTER_DIMENSION_SELECT;
    return withSummary("已识别指标和时间，请选择筛选维度：", state);
  }

  state.stage = Stage.SUMMARY_CONFIRM;
  return withSummary(summarizeState(state) + "\n如无问题，请点击“开始查询”，或选择“修改”。", state);
}

async function runQueryForState(state) {
  const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
  const metric =
    category && category.metrics.find((m) => m.id === state.kpiMetricId);
  if (!metric) {
    return {
      reply: "未找到对应的指标配置。",
      raw: null,
    };
  }
  const { where, params } = buildWhere(state);

  let sql = metric.sql;
  if (!sql) {
      return { reply: "该指标未配置SQL", raw: null, sql: null };
  }
  
  sql = sql.replace("{where}", where);

  if (metric.kind === "aggregate") {
    const rows = await db.query(sql, params);
    const value = rows[0] ? rows[0].value : 0;
    return {
      reply: "查询结果：" + metric.label + "为 " + value + " 。",
      raw: rows,
      sql: formatSqlForDisplay(sql, params)
    };
  }
  
  if (metric.kind === "aggregate_group") {
    const rows = await db.query(sql, params);
    const groupBy = metric.groupBy || "item";

    let finalRows = rows;
    if (state.filterDimension === groupBy && state.filterValues.length > 0) {
         const existingMap = new Map(rows.map(r => [r[groupBy], r.value]));
         finalRows = state.filterValues.map(val => {
             const row = {};
             row[groupBy] = val;
             row.value = existingMap.get(val) || 0;
             return row;
         });
    }

    if (!finalRows.length) {
      return {
        reply: "未查询到符合条件的数据。",
        raw: finalRows,
        sql: formatSqlForDisplay(sql, params)
      };
    }
    
    const lines = finalRows.map((r) => (r[groupBy] || "未知") + "：" + r.value + " 人");
    
    const chartData = {
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: finalRows.map(r => r[groupBy] || "未知") },
        yAxis: { type: 'value' },
        series: [{
            data: finalRows.map(r => r.value),
            type: 'bar',
            itemStyle: { color: '#3b82f6' }
        }],
        grid: { top: 30, bottom: 30, left: 40, right: 20 }
    };

    return {
      reply: metric.label + "如下：\n" + lines.join("\n"),
      raw: finalRows,
      sql: formatSqlForDisplay(sql, params),
      chartData: chartData
    };
  }
  
  if (metric.kind === "detail") {
    const displaySql = sql + " LIMIT 50";
    const rows = await db.query(displaySql, params);
    if (!rows.length) {
      return {
        reply: "未查询到符合条件的明细。",
        raw: rows,
        sql: formatSqlForDisplay(displaySql, params)
      };
    }
    const lines = rows.map(r => {
        return Object.values(r).join(" ");
    });
    
    return {
      reply:
        "查询到以下明细（最多显示 50 条）：\n" + lines.join("\n"),
      raw: rows,
      sql: formatSqlForDisplay(displaySql, params)
    };
  }
  
  return {
    reply: "暂不支持的指标类型。",
    raw: null,
    sql: null
  };
}

app.get("/api/time-options", async (req, res) => {
  try {
    const rows = await db.query(
      "SELECT DISTINCT st_WrMonth FROM dws_tas_roster ORDER BY st_WrMonth",
      []
    );
    const monthsRaw = rows
      .map((r) => (r.st_WrMonth == null ? null : String(r.st_WrMonth)))
      .filter((v) => v);
    monthsRaw.sort();
    const monthOptions = monthsRaw.map((m) => ({
      value: m,
      label: m,
    }));
    const yearMap = new Map();
    for (let i = 0; i < monthsRaw.length; i += 1) {
      const m = monthsRaw[i];
      if (m.length < 6) continue;
      const year = m.slice(0, 4);
      const monthNum = parseInt(m.slice(4), 10);
      if (Number.isNaN(monthNum)) continue;
      if (!yearMap.has(year)) {
        yearMap.set(year, []);
      }
      yearMap.get(year).push(monthNum);
    }
    const fyOptions = [];
    const halfFyOptions = [];
    for (const [year, monthNums] of yearMap.entries()) {
      fyOptions.push({
        value: year,
        label: year + " 财年",
      });
      const hasH1 = monthNums.some((v) => v >= 1 && v <= 6);
      const hasH2 = monthNums.some((v) => v >= 7 && v <= 12);
      if (hasH1) {
        halfFyOptions.push({
          value: year + "H1",
          label: year + " 上半年",
        });
      }
      if (hasH2) {
        halfFyOptions.push({
          value: year + "H2",
          label: year + " 下半年",
        });
      }
    }
    fyOptions.sort((a, b) => String(a.value).localeCompare(String(b.value)));
    halfFyOptions.sort((a, b) =>
      String(a.value).localeCompare(String(b.value))
    );
    res.json({
      months: monthOptions,
      halfFy: halfFyOptions,
      fy: fyOptions,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/chat", async (req, res) => {
  const { conversationId, message, payload, timeRange } = req.body || {};
  console.log(`[Request] ID=${conversationId}, Msg=${message}, Payload=${JSON.stringify(payload)}`);
  
  if (!conversationId) {
    res.status(400).json({ error: "conversationId 必填" });
    return;
  }
  let state = conversations.get(conversationId);
  console.log(`[StateCheck] ID=${conversationId}, Found=${!!state}, MapSize=${conversations.size}`);
  
  if (!state) {
    state = createEmptyState();
    conversations.set(conversationId, state);
    console.log(`[StateCreate] Created new state for ${conversationId}`);
  } else {
    console.log(`[StateBefore] Stage=${state.stage}`);
  }

  let overrideTimeRange = null;
  if (timeRange && typeof timeRange === "object") {
    const hasValue = timeRange.value != null && timeRange.value !== "";
    const hasLabel = timeRange.label != null && timeRange.label !== "";
    if (hasValue || hasLabel) {
      overrideTimeRange = {
        type: timeRange.type || null,
        value: hasValue ? String(timeRange.value) : null,
        label: hasLabel
          ? String(timeRange.label)
          : hasValue
          ? String(timeRange.value)
          : "",
      };
    }
  }

  if (typeof message === "string" && message.trim()) {
    const entities = await extractEntitiesFromText(message);
    
    if (entities) {
        if (entities.kpiMetricId) {
             state.kpiCategoryId = entities.kpiCategoryId;
             state.kpiMetricId = entities.kpiMetricId;
             state.kpiDetailId = entities.kpiDetailId;
        }
        
        if (overrideTimeRange) {
             state.timeRange = overrideTimeRange;
        } else if (entities.timeRange) {
             state.timeRange = entities.timeRange;
        }
        
        if (entities.filterDimension) {
             state.filterDimension = entities.filterDimension;
             state.filterValues = entities.filterValues;
        }
        
        const replyText = updateStageAndGetReply(state);
        
        res.json({
            reply: replyText,
            summary: getSummary(state),
            stage: state.stage,
            options: await buildOptionsForStage(state),
            state
        });
        return;
    }
    
    if (state.stage === Stage.KPI_CATEGORY_SELECT) {
      const categoryMatch = findKpiCategoryByLabel(message);
      if (!categoryMatch) {
        res.json({
          reply: "很抱歉，您咨询的问题已经超纲了。\n目前仅支持查询人员信息、工程师数量等指标。",
          summary: getSummary(state),
          stage: state.stage,
          options: await buildOptionsForStage(state),
          state,
        });
        return;
      }
      // If it matches a category, we fall through to the !payload block which handles it.
    }
  }

  if (overrideTimeRange && !payload) {
    state.timeRange = overrideTimeRange;
  }

  if (!payload) {
    let replyText = "";
    console.log(`[NoPayload] Stage=${state.stage}, Msg=${message}`);
    if (state.stage === Stage.KPI_CATEGORY_SELECT) {
      const category = findKpiCategoryByLabel(message);
      console.log(`[CategoryMatch] Found=${category ? category.id : 'null'}`);
      if (category) {
        state.kpiCategoryId = category.id;
        state.stage = Stage.KPI_METRIC_SELECT;
        console.log(`[StateUpdate] NewStage=${state.stage}`);
        replyText = withSummary(
          `已选择：${category.label}。\n请选择二级指标：`,
          state
        );
      } else {
        replyText = withSummary(
          "请从按钮中选择KPI大类，或输入类似“202510工程师数量”。",
          state
        );
      }
    } else if (state.stage === Stage.TIME_TYPE_SELECT) {
      // Validate Time Type
      if (typeof message === "string") {
          const validTypes = ["Month", "HalfFY", "FY", "month", "half_fy", "fy"];
          const lowerMsg = message.trim().toLowerCase();
          // Simple check if message contains keywords
          if (validTypes.some(t => lowerMsg.includes(t.toLowerCase()))) {
             // Fallback to auto-select if text matches? 
             // Actually, if user types "Month", we can treat it as payload?
             // But for now, let's just complain if it is completely off.
             // Wait, if user types "202510", maybe they skipped the type selection?
             // Let's stick to the requirement: "Ask again if not enum value"
             const isEnum = ["month", "half_fy", "fy"].includes(lowerMsg) || ["Month", "HalfFY", "FY"].includes(message.trim());
             if (!isEnum) {
                 replyText = withSummary("输入无效。请点击按钮选择时间类型（Month, HalfFY, FY）。", state);
                 res.json({
                    reply: replyText,
                    summary: getSummary(state),
                    stage: state.stage,
                    options: await buildOptionsForStage(state),
                    state,
                 });
                 return;
             }
          } else {
             replyText = withSummary("输入无效。请点击按钮选择时间类型（Month, HalfFY, FY）。", state);
             res.json({
                reply: replyText,
                summary: getSummary(state),
                stage: state.stage,
                options: await buildOptionsForStage(state),
                state,
             });
             return;
          }
      }
    } else if (state.stage === Stage.TIME_VALUE_SELECT) {
      if (typeof message === "string") {
        let label = message.trim();
        // Validation for time value format
        // Month: 6 digits (YYYYMM)
        // HalfFY: 6 chars (YYYYH1/2)
        // FY: 4 digits (YYYY)
        const isMonth = /^\d{6}$/.test(label);
        const isHalfFy = /^\d{4}H[12]$/.test(label);
        const isFy = /^\d{4}$/.test(label);
        
        let isValid = false;
        if (state.timeType === 'month' && isMonth) isValid = true;
        if (state.timeType === 'half_fy' && isHalfFy) isValid = true;
        if (state.timeType === 'fy' && isFy) isValid = true;
        
        // If state.timeType is not set (should not happen in this stage usually), we might be lenient
        if (!state.timeType && (isMonth || isHalfFy || isFy)) isValid = true;

        if (!isValid) {
             replyText = withSummary(`时间格式无效。请重新输入（当前类型: ${state.timeType || '未知'}）。\n示例：202506 (Month), 2025H1 (HalfFY), 2025 (FY)。`, state);
             res.json({
                reply: replyText,
                summary: getSummary(state),
                stage: state.stage,
                options: await buildOptionsForStage(state),
                state,
             });
             return;
        }

        state.timeRange = {
          type: "custom",
          label,
          value: label // Assume value matches label for custom input
        };
        state.stage = Stage.FILTER_DIMENSION_SELECT;
        replyText = withSummary("请选择筛选维度：", state);
      }
    } else {
      replyText = withSummary(
        "请使用下方按钮继续选择，或输入更完整的问题。",
        state
      );
    }
    res.json({
      reply: replyText,
      summary: getSummary(state),
      stage: state.stage,
      options: await buildOptionsForStage(state),
      state,
    });
    return;
  }

  if (
    payload &&
    payload.type === "confirm_start" &&
    state.stage === Stage.SUMMARY_CONFIRM
  ) {
    const result = await executeQuery(state);
    res.json(result);
    return;
  }

  const result = await handleButtonInput(state, payload, message);
  if (result.done) {
     res.json(result);
     return;
  }
  
  try {
    const options = await buildOptionsForStage(state);
    res.json({
      reply: result.reply,
      summary: result.summary || getSummary(state),
      chartData: result.chartData,
      stage: state.stage,
      options,
      done: result.done || false,
      result: result.result || null,
      state,
    });
  } catch (err) {
    console.error("Error building options:", err);
    res.json({
      reply: result.reply + "\n\n(系统提示：加载选项失败，数据库连接异常。请联系管理员检查配置。)",
      summary: result.summary || getSummary(state),
      chartData: result.chartData,
      stage: state.stage,
      options: [],
      done: result.done || false,
      result: result.result || null,
      state,
      error: err.message
    });
  }
});

async function getDetailData(state) {
  const { where, params } = buildWhere(state);
  
  const detailMetric = kpiCategories
      .flatMap(c => c.metrics)
      .find(m => m.id === "engineer_detail");
      
  let sql = detailMetric && detailMetric.sql 
      ? detailMetric.sql 
      : "SELECT * FROM dws_tas_roster {where} ORDER BY st_WrMonth DESC, st_EmpID";
      
  sql = sql.replace("{where}", where);
  
  return db.query(sql, params);
}

app.get("/api/detail/download", async (req, res) => {
  const conversationId = req.query.conversationId;
  if (!conversationId) {
    res.status(400).send("conversationId 必填");
    return;
  }
  const state = conversations.get(conversationId);
  if (!state) {
    res.status(400).send("会话不存在");
    return;
  }
  
  try {
      const rows = await getDetailData(state);
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Detail');
      
      if (rows.length > 0) {
          const columns = Object.keys(rows[0]).map(key => ({ header: key, key: key, width: 15 }));
          worksheet.columns = columns;
          worksheet.addRows(rows);
      } else {
          worksheet.addRow(["No data found matching the criteria."]);
      }
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="engineer_detail.xlsx"');
      
      await workbook.xlsx.write(res);
      res.end();
  } catch(e) {
      console.error(e);
      res.status(500).send("Export failed: " + e.message);
  }
});

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
