const metricsConfig = {
  categories: [
    {
      id: "personnel",
      label: "人员信息",
      metrics: [
        {
          id: "engineer_count",
          label: "工程师数量",
          description: "查询工程师的总人数、有多少工程师、人数统计",
          keywords: ["工程师+数量", "工程师+多少", "人数"],
          kind: "aggregate",
          sql: "SELECT COUNT(*) AS value FROM dws_tas_roster {where} AND st_EmpAvailable='1' AND st_ClassName='FE'",
          allowedTimeTypes: ["month", "half_fy", "fy"],
          allowedFilterDimensions: ["product", "org"],
          details: [],
        },
        {
          id: "engineer_detail",
          label: "工程师明细",
          description: "查询工程师的详细名单、明细数据、具体人员列表",
          keywords: ["工程师+名单", "人员+明细", "详细+名单", "工程师+明细"],
          kind: "detail",
          sql: "SELECT st_EmpID, st_EmpNameCN, st_EmpNameEN, st_DeptName, st_OrgName FROM dws_tas_roster {where} AND st_EmpAvailable='1' AND st_ClassName='FE' ORDER BY st_WrMonth DESC, st_EmpID",
          allowedTimeTypes: ["month"],
          allowedFilterDimensions: ["product", "org"],
          details: [],
        },
        {
          id: "engineer_count_by_product",
          label: "按产品统计工程师数量",
          description: "按产品线分组统计工程师数量、各产品有多少人",
          keywords: ["按产品", "各产品+人数"],
          kind: "aggregate_group",
          groupBy: "st_DeptName",
          sql: "SELECT st_DeptName, COUNT(*) AS value FROM dws_tas_roster {where} AND st_EmpAvailable='1' AND st_ClassName='FE' GROUP BY st_DeptName",
          allowedTimeTypes: ["month", "fy"],
          allowedFilterDimensions: ["product"],
        },
        {
          id: "engineer_count_by_org",
          label: "按组织统计工程师数量",
          description: "按部门/组织分组统计工程师数量、各部门有多少人",
          keywords: ["按组织", "按部门", "各部门+人数"],
          kind: "aggregate_group",
          groupBy: "st_OrgName",
          sql: "SELECT st_OrgName, COUNT(*) AS value FROM dws_tas_roster {where} AND st_EmpAvailable='1' AND st_ClassName='FE' GROUP BY st_OrgName",
          allowedTimeTypes: ["month", "half_fy", "fy"],
          allowedFilterDimensions: ["org"],
        },
      ],
    },
    {
      id: "machine",
      label: "机台信息",
      metrics: [
        {
          id: "machine_count",
          label: "机台数量统计",
          description: "查询机台的总数量、有多少机台、设备数量统计",
          keywords: ["机台+数量", "设备+数量", "多少+机台", "多少+台"],
          kind: "aggregate",
          sql: "SELECT COUNT(*) AS value FROM dws_wisdom_machine {where} AND st_MachineClusterFlag='R'",
          allowedTimeTypes: [], 
          allowedFilterDimensions: ["product", "customer"],
          dimensionMap: {
            product: "st_ProductLine"
          },
          details: [],
        },
        {
            id: "machine_detail",
            label: "机台明细",
            description: "查询机台的详细列表、设备清单",
            keywords: ["机台+明细", "设备+清单", "机台+列表"],
            kind: "detail",
            sql: "SELECT st_SN, st_ProductLine, st_BP, st_MachineModelName FROM dws_wisdom_machine {where} AND st_MachineClusterFlag='R'",
            allowedTimeTypes: [],
            allowedFilterDimensions: ["product", "customer"],
            dimensionMap: {
                product: "st_ProductLine"
            },
            details: [],
        }
      ],
    },
  ],
  timeExamples: ["202510", "202511", "202512"],
  filterDimensions: [
    {
      id: "product",
      label: "产品",
      column: "st_DeptName", // Default for personnel
      values: [
        { id: "CT", label: "CT" },
        { id: "SPS", label: "SPS" },
        { id: "ES", label: "ES" },
        { id: "3DI", label: "3DI" },
        { id: "CERTAS", label: "CERTAS" },
      ],
    },
    {
      id: "org",
      label: "组织",
      column: "st_OrgName",
      values: [
        { id: "PSM", label: "PSM" },
        { id: "非PSM", label: "非PSM" },
      ],
    },
    {
      id: "customer",
      label: "客户",
      column: "st_BP",
      values: [
        { id: "BYD", label: "BYD" },
        { id: "CATL", label: "CATL" },
        { id: "Tesla", label: "Tesla" },
        { id: "NIO", label: "NIO" },
      ],
    },
  ],
};

module.exports = metricsConfig;
