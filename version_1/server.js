const express = require("express");
const cors = require("cors");
const metricsConfig = require("./config/metrics");
const db = require("./db");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const Stage = {
  KPI_CATEGORY_SELECT: "KPI_CATEGORY_SELECT",
  KPI_METRIC_SELECT: "KPI_METRIC_SELECT",
  TIME_RANGE_SELECT: "TIME_RANGE_SELECT",
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

function buildOptionsForStage(state) {
  if (state.stage === Stage.KPI_CATEGORY_SELECT) {
    return kpiCategories.map((c) => ({
      label: c.label,
      payload: { type: "kpi_category", id: c.id },
    }));
  }
  if (state.stage === Stage.KPI_METRIC_SELECT) {
    const category = kpiCategories.find((c) => c.id === state.kpiCategoryId);
    if (!category) return [];
    return category.metrics.map((m) => ({
      label: m.label,
      payload: { type: "kpi_metric", id: m.id },
    }));
  }
  if (state.stage === Stage.TIME_RANGE_SELECT) {
    return metricsConfig.timeExamples.map((v) => ({
      label: v,
      payload: { type: "time_range", value: v },
    }));
  }
  if (state.stage === Stage.FILTER_DIMENSION_SELECT) {
    const options = metricsConfig.filterDimensions.map((d) => ({
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
      { label: "查看明细", payload: { type: "view_detail" } },
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
  return `已选择指标：${kpiText}\n时间范围：${timeText}\n筛选条件：${filterText}`;
}

function withSummary(text, state) {
  const summary = summarizeState(state);
  if (!summary) return text;
  return text + "\n\n" + summary;
}

function handleButtonInput(state, payload, textInput) {
  if (state.stage === Stage.KPI_CATEGORY_SELECT && payload.type === "kpi_category") {
    state.kpiCategoryId = payload.id;
    state.stage = Stage.KPI_METRIC_SELECT;
    return {
      reply: withSummary(
        `已选择：${kpiCategories.find((c) => c.id === payload.id).label}。\n请选择二级指标：`,
        state
      ),
    };
  }
  if (state.stage === Stage.KPI_METRIC_SELECT && payload.type === "kpi_metric") {
    state.kpiMetricId = payload.id;
    state.stage = Stage.TIME_RANGE_SELECT;
    return {
      reply: withSummary("请选择时间范围：", state),
    };
  }
  if (state.stage === Stage.TIME_RANGE_SELECT) {
    if (payload.type === "time_range") {
      state.timeRange = {
        type: "month",
        value: payload.value,
        label: payload.value,
      };
      state.stage = Stage.FILTER_DIMENSION_SELECT;
      return {
        reply: withSummary("请选择筛选维度，例如产品或组织：", state),
      };
    }
  }
  if (state.stage === Stage.FILTER_DIMENSION_SELECT && payload.type === "filter_dimension") {
    state.filterDimension = payload.value;
    if (payload.value === FilterDimension.NONE) {
      state.filterValues = [];
      state.stage = Stage.SUMMARY_CONFIRM;
      return {
        reply: summarizeState(state),
      };
    }
    state.stage = Stage.FILTER_VALUE_SELECT;
    return {
      reply: withSummary("请选择具体值：", state),
    };
  }
  if (state.stage === Stage.FILTER_VALUE_SELECT && payload.type === "confirm_filter_values") {
    state.filterValues = payload.values || [];
    state.stage = Stage.SUMMARY_CONFIRM;
    return {
      reply: withSummary("已确认筛选条件。", state),
    };
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
      state.timeRange = null;
      state.filterDimension = FilterDimension.NONE;
      state.filterValues = [];
      state.lastQueryResult = null;
      return {
        reply: withSummary("请重新选择KPI大类：", state),
      };
    }
  }
  if (state.stage === Stage.SHOW_RESULT) {
    if (payload.type === "new_query") {
      const newState = createEmptyState();
      Object.assign(state, newState);
      return {
        reply: withSummary("开始新的查询，请选择KPI大类：", state),
      };
    }
    if (payload.type === "view_detail") {
      return {
        reply: withSummary("明细数据导出功能暂为示例，可在此接入CSV导出。", state),
      };
    }
    if (payload.type === "chart") {
      return {
        reply: withSummary("图表生成功能暂为示例，可在此生成折线图/柱状图。", state),
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

async function parseIntentFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const monthFromText = extractMonthFromText(trimmed);
  const filtersFromText = extractFiltersFromText(trimmed);
  if (trimmed.includes("工程师") && trimmed.includes("数量")) {
    let metricId = "engineer_count";
    if (trimmed.includes("按产品")) {
      metricId = "engineer_count_by_product";
    } else if (trimmed.includes("按组织") || trimmed.includes("按org")) {
      metricId = "engineer_count_by_org";
    }
    return {
      kpiCategoryId: "personnel",
      kpiMetricId: metricId,
      kpiDetailId: null,
      timeRange: monthFromText
        ? { type: "month", value: monthFromText, label: monthFromText }
        : null,
      filterDimension: filtersFromText.filterDimension,
      filterValues: filtersFromText.filterValues,
    };
  }
  if (trimmed.includes("工程师") && trimmed.includes("明细")) {
    return {
      kpiCategoryId: "personnel",
      kpiMetricId: "engineer_detail",
      kpiDetailId: null,
      timeRange: monthFromText
        ? { type: "month", value: monthFromText, label: monthFromText }
        : null,
      filterDimension: filtersFromText.filterDimension,
      filterValues: filtersFromText.filterValues,
    };
  }
  const llmIntent = await parseIntentWithLlm(trimmed).catch(() => null);
  if (llmIntent) return llmIntent;
  return null;
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
  const products = [];
  if (text.includes("ct")) products.push("ct");
  if (text.includes("sps")) products.push("sps");
  if (text.includes("es")) products.push("es");
  const orgs = [];
  if (text.includes("psm")) orgs.push("psm");
  if (text.includes("非psm")) orgs.push("非psm");
  if (products.length > 0) {
    return {
      filterDimension: FilterDimension.PRODUCT,
      filterValues: products,
    };
  }
  if (orgs.length > 0) {
    return {
      filterDimension: FilterDimension.ORG,
      filterValues: orgs,
    };
  }
  return null;
}

async function parseIntentWithLlm(text) {
  if (typeof fetch === "undefined") {
    return null;
  }
  const body = {
    model: process.env.LLM_MODEL || "deepseek-r1:32b",
    messages: [
      {
        role: "system",
        content:
          "你是一个KPI查询意图解析器，只输出JSON。" +
          "JSON字段: " +
          "kpiMetric (可选: 'engineer_count', 'engineer_detail', 'engineer_count_by_product', 'engineer_count_by_org'), " +
          "month (如 '202510' 表示 2025年10月), " +
          "filterDimension ('product' 或 'org' 或 null), " +
          "filterValues (字符串数组，如 ['ct'] 或 ['psm'])。" +
          "用户可能会说类似“看下10月ct的工程师数量”这样的中文自然语言，请你解析出对应的字段。",
      },
      { role: "user", content: text },
    ],
    stream: false,
  };
  const resp = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    return null;
  }
  const data = await resp.json();
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
  let metricId = "engineer_count";
  if (kpiMetric === "engineer_detail") {
    metricId = "engineer_detail";
  } else if (kpiMetric === "engineer_count_by_product") {
    metricId = "engineer_count_by_product";
  } else if (kpiMetric === "engineer_count_by_org") {
    metricId = "engineer_count_by_org";
  }
  const month = parsed.month;
  let filterDimension = FilterDimension.NONE;
  if (parsed.filterDimension === "product") {
    filterDimension = FilterDimension.PRODUCT;
  } else if (parsed.filterDimension === "org") {
    filterDimension = FilterDimension.ORG;
  }
  const filterValues = Array.isArray(parsed.filterValues)
    ? parsed.filterValues
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
    state.stage = Stage.TIME_RANGE_SELECT;
    return withSummary("已识别指标，请继续选择时间范围：", state);
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
  const params = [];
  let where = "WHERE 1=1";
  if (state.timeRange && state.timeRange.value) {
    where += " AND update_month = ?";
    params.push(state.timeRange.value);
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
      const placeholders = state.filterValues.map(() => "?").join(",");
      where += " AND " + dim.column + " IN (" + placeholders + ")";
      for (let i = 0; i < state.filterValues.length; i += 1) {
        params.push(state.filterValues[i]);
      }
    }
  }
  if (metric.kind === "aggregate") {
    const rows = await db.query(
      "SELECT COUNT(*) AS value FROM personnel_detail " + where,
      params
    );
    const value = rows[0] ? rows[0].value : 0;
    return {
      reply: "查询结果：工程师数量为 " + value + " 人。",
      raw: rows,
    };
  }
  if (metric.kind === "aggregate_group" && metric.id === "engineer_count_by_product") {
    const rows = await db.query(
      "SELECT product, COUNT(*) AS value FROM personnel_detail " +
        where +
        " GROUP BY product",
      params
    );
    if (!rows.length) {
      return {
        reply: "未查询到符合条件的工程师数量。",
        raw: rows,
      };
    }
    const lines = rows.map((r) => r.product + "：" + r.value + " 人");
    return {
      reply: "按产品统计的工程师数量如下：\n" + lines.join("\n"),
      raw: rows,
    };
  }
  if (metric.kind === "aggregate_group" && metric.id === "engineer_count_by_org") {
    const rows = await db.query(
      "SELECT org, COUNT(*) AS value FROM personnel_detail " +
        where +
        " GROUP BY org",
      params
    );
    if (!rows.length) {
      return {
        reply: "未查询到符合条件的工程师数量。",
        raw: rows,
      };
    }
    const lines = rows.map((r) => r.org + "：" + r.value + " 人");
    return {
      reply: "按组织统计的工程师数量如下：\n" + lines.join("\n"),
      raw: rows,
    };
  }
  if (metric.kind === "detail") {
    const rows = await db.query(
      "SELECT employee_id, update_month, product, org FROM personnel_detail " +
        where +
        " ORDER BY employee_id LIMIT 50",
      params
    );
    if (!rows.length) {
      return {
        reply: "未查询到符合条件的工程师明细。",
        raw: rows,
      };
    }
    const lines = rows.map(
      (r) =>
        r.employee_id +
        " " +
        r.update_month +
        " " +
        r.product +
        " " +
        r.org
    );
    return {
      reply:
        "查询到以下工程师明细（最多显示 50 条）：\n" + lines.join("\n"),
      raw: rows,
    };
  }
  return {
    reply: "暂不支持的指标类型。",
    raw: null,
  };
}

app.post("/api/chat", async (req, res) => {
  const { conversationId, message, payload } = req.body || {};
  if (!conversationId) {
    res.status(400).json({ error: "conversationId 必填" });
    return;
  }
  let state = conversations.get(conversationId);
  if (!state) {
    state = createEmptyState();
    conversations.set(conversationId, state);
  }

  if (typeof message === "string" && message.trim()) {
    const intent = await parseIntentFromText(message);
    if (intent) {
      const reply = processIntentAndGetReply(state, intent);
      res.json({
        reply,
        stage: state.stage,
        options: buildOptionsForStage(state),
        state,
      });
      return;
    }
    // 如果意图识别失败，且当前不是在等待特定输入（如时间/筛选值），则认为是超纲问题
    if (state.stage === Stage.KPI_CATEGORY_SELECT) {
      res.json({
        reply: "很抱歉，您咨询的问题已经超纲了。\n目前仅支持查询人员信息、工程师数量等指标。",
        stage: state.stage,
        options: buildOptionsForStage(state),
        state,
      });
      return;
    }
  }

  if (!payload) {
    let replyText = "";
    if (state.stage === Stage.KPI_CATEGORY_SELECT) {
      const category = findKpiCategoryByLabel(message);
      if (category) {
        state.kpiCategoryId = category.id;
        state.stage = Stage.KPI_METRIC_SELECT;
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
    } else if (state.stage === Stage.TIME_RANGE_SELECT) {
      if (typeof message === "string") {
        let label = message.trim();
        state.timeRange = {
          type: "custom",
          label,
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
      stage: state.stage,
      options: buildOptionsForStage(state),
      state,
    });
    return;
  }

  if (
    payload &&
    payload.type === "confirm_start" &&
    state.stage === Stage.SUMMARY_CONFIRM
  ) {
    try {
      state.stage = Stage.EXECUTING_QUERY;
      const queryResult = await runQueryForState(state);
      state.lastQueryResult = queryResult.raw || null;
      state.stage = Stage.SHOW_RESULT;
      const options = buildOptionsForStage(state);
      res.json({
        reply: queryResult.reply,
        stage: state.stage,
        options,
        done: true,
        result: queryResult.raw || null,
        state,
      });
    } catch (e) {
      state.stage = Stage.SUMMARY_CONFIRM;
      res.json({
        reply: "执行数据库查询时出错：" + e.message,
        stage: state.stage,
        options: buildOptionsForStage(state),
        done: false,
        result: null,
        state,
      });
    }
    return;
  }

  const result = handleButtonInput(state, payload, message);
  const options = buildOptionsForStage(state);
  res.json({
    reply: result.reply,
    stage: state.stage,
    options,
    done: result.done || false,
    result: result.result || null,
    state,
  });
});

app.get("/api/detail/download", async (req, res) => {
  const conversationId = req.query.conversationId;
  if (!conversationId) {
    res.status(400).send("conversationId 必填");
    return;
  }
  const state = conversations.get(conversationId);
  if (!state || state.kpiMetricId !== "engineer_detail") {
    res.status(400).send("当前会话没有可下载的明细，请先查询工程师明细。");
    return;
  }
  const rows = state.lastQueryResult;
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).send("没有可下载的明细数据。");
    return;
  }
  const headers = ["employee_id", "update_month", "product", "org"];
  const lines = [headers.join(",")];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const line = [
      r.employee_id,
      r.update_month,
      r.product,
      r.org,
    ]
      .map((v) => (v == null ? "" : String(v).replace(/"/g, '""')))
      .map((v) => `"${v}"`)
      .join(",");
    lines.push(line);
  }
  const csv = lines.join("\n");
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="engineer_detail.xlsx"'
  );
  res.send(csv);
});

app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
