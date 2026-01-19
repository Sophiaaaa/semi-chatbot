const metricsConfig = {
  categories: [
    {
      id: "personnel",
      label: "人员信息",
      metrics: [
        {
          id: "engineer_count",
          label: "工程师数量",
          kind: "aggregate",
          details: [],
        },
        {
          id: "engineer_detail",
          label: "工程师明细",
          kind: "detail",
          details: [],
        },
        {
          id: "engineer_count_by_product",
          label: "按产品统计工程师数量",
          kind: "aggregate_group",
          groupBy: "product",
        },
        {
          id: "engineer_count_by_org",
          label: "按组织统计工程师数量",
          kind: "aggregate_group",
          groupBy: "org",
        },
      ],
    },
  ],
  timeExamples: ["202510", "202511", "202512"],
  filterDimensions: [
    {
      id: "product",
      label: "产品",
      column: "product",
      values: [
        { id: "ct", label: "ct" },
        { id: "sps", label: "sps" },
        { id: "es", label: "es" },
      ],
    },
    {
      id: "org",
      label: "组织",
      column: "org",
      values: [
        { id: "psm", label: "psm" },
        { id: "非psm", label: "非psm" },
      ],
    },
  ],
};

module.exports = metricsConfig;
