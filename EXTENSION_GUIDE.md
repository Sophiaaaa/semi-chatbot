# 系统扩展指南

本系统设计为配置驱动，支持通过修改配置文件和数据库脚本来轻松扩展新的业务指标。

## 核心配置文件

1.  **`config/metrics.js`**: 核心配置文件。定义了 KPI 大类、具体指标（SQL、关键词）、筛选维度（产品、组织等）以及时间类型的启用。
2.  **`db.js`**: 数据库管理文件。用于定义新的数据库表结构（Schema）和初始化测试数据。

---

## 扩展步骤

### 1. 增加新的数据表 (Table)

如果新的指标需要查询一张新的数据库表，请在 `db.js` 中定义它。

1.  打开 `db.js`。
2.  找到 `initSchemaAndSeed` 函数。
3.  添加 `CREATE TABLE` 语句。

**示例**：增加一张“设备维修记录”表
```javascript
// db.js
await run(
  dbInstance,
  `CREATE TABLE IF NOT EXISTS maintenance_log (
    id INTEGER PRIMARY KEY,
    sn TEXT NOT NULL,
    repair_date TEXT,
    cost INTEGER
  )`
);
```

### 2. 增加新的筛选维度 (Filter Dimension)

如果需要按新的维度（如“客户”、“地区”）筛选，请在配置中定义。

1.  打开 `config/metrics.js`。
2.  找到底部的 `filterDimensions` 数组。
3.  添加新的维度对象。

**示例**：增加“地区”筛选
```javascript
// config/metrics.js -> filterDimensions
{
  id: "region",          // 唯一标识，用于代码逻辑
  label: "地区",          // 前端显示的标签
  column: "region_name", // 对应数据库表中的字段名
  values: [              // 可选的固定值列表（如果是动态获取需修改代码，这里是静态配置）
    { id: "CN", label: "中国" },
    { id: "US", label: "美国" }
  ]
}
```

### 3. 增加新的指标 (Metric)

这是最常见的扩展操作。

1.  打开 `config/metrics.js`。
2.  在 `categories` 数组中找到合适的大类（或者新建一个大类）。
3.  在 `metrics` 数组中添加指标对象。

**关键字段说明**：
*   `id`: 唯一标识。
*   `label`: 按钮显示的名称。
*   `description`: **重要**。用于 LLM 语义识别，请用自然语言描述该指标不仅指什么。
*   `keywords`: **重要**。关键词匹配数组。支持 `+` 号表示“与”逻辑（如 `"机台+数量"`）。
*   `sql`: SQL 查询语句。使用 `{where}` 占位符代表自动生成的筛选条件。
*   `allowedTimeTypes`: 允许的时间筛选类型（`month`, `fy`, `half_fy`）。留空 `[]` 表示该指标不需要时间筛选。
*   `allowedFilterDimensions`: 允许使用的筛选维度 ID 列表（需与 `filterDimensions` 中的 ID 对应）。

**示例**：增加“维修成本统计”指标
```javascript
// config/metrics.js -> categories -> metrics
{
  id: "maintenance_cost",
  label: "维修成本统计",
  description: "查询设备维修的总花费、维修金额",
  keywords: ["维修+成本", "维修+费用", "花了多少钱"],
  kind: "aggregate", // aggregate (单值), aggregate_group (分组柱状图), detail (明细表)
  sql: "SELECT SUM(cost) AS value FROM maintenance_log {where}",
  allowedTimeTypes: ["month"], // 允许按月筛选
  allowedFilterDimensions: ["region"], // 允许按刚才定义的地区筛选
  details: [],
}
```

### 4. 验证生效

1.  保存所有文件。
2.  重启服务：在终端运行 `npm start`。
3.  测试对话：输入“查询维修费用”或“CN地区的维修成本”，系统应能自动识别并执行查询。
