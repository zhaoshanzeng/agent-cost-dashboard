# Today's Real-Time Token Usage Chart

为 Agent Cost Dashboard 新增今日实时 Token 用量平滑曲线图。

## 1. 概述

在仪表盘页面顶部新增一个**今日实时统计**区域，展示当天各模型的 Token 用量随时间变化趋势。支持时间范围切换（3h / 1h / 5min），按模型拆分多条曲线，以 SVG 平滑曲线图呈现。

### 为何不展示花费

用户明确要求只展示 Token 不展示花费，因为花费数据已由现有 Daily Spending 图表覆盖。

## 2. 数据结构

### 2.1 SessionStats 新增字段

```python
# 每个 LLM 调用记录一条样本
"time_series": [
    {
        "ts": datetime,      # 调用时间戳（毫秒精度）
        "model": str,         # 模型名称，如 "claude-sonnet-4-20250514"
        "tokens": int,        # 本次调用的总 Token 数（input + output + cache）
    }
]
```

### 2.2 ProjectStats 新增字段

```python
"time_series": []  # 与 SessionStats 相同结构，合并所有子 session 的样本
```

### 2.3 GlobalStats 新增字段

```python
"time_series": []  # 与 ProjectStats 相同结构，合并所有项目的样本
```

### 2.4 前端数据注入

`window.dashboardData` 新增字段：

```json
{
    "todayTimeSeries": [
        {
            "ts": "2026-07-20T10:23:45.123",  // ISO 8601 字符串
            "model": "claude-sonnet-4-20250514",
            "tokens": 1500
        }
    ]
}
```

## 3. 数据流

### 3.1 采集阶段

```
record_llm_usage()  →  stats["time_series"].append({ts, model, tokens})
```

在 `record_llm_usage()` 函数末尾追加一条时间序列样本。`tokens` 取 `total`（已计算好的总 Token 数）。

### 3.2 聚合阶段

```
accumulate_session_into_project()  →  project_stats["time_series"].extend(session_stats["time_series"])
```

将 session 级别的时间序列合并到 project 级别。

### 3.3 全局合并

```
generate_html()  →  global_stats["time_series"].extend(project["time_series"])
```

合并所有项目的时间序列。然后过滤出今日数据（`ts.date() == today`）并序列化为 JSON 注入到前端。

### 3.4 前端渲染

```
window.dashboardData.todayTimeSeries
    →  filterByTimeRange(samples, range)       # 按 3h/1h/5m 过滤
    →  bucketSamples(samples, bucketSize)       # 按桶聚合
    →  drawSvgChart(buckets, models)            # 渲染 SVG 曲线
```

**关键决策**：桶聚合在前端完成，而不是后端。这样切换时间范围时不需要重新请求后端，响应更快。

## 4. 时间范围与颗粒度

| 时间范围 | 桶大小 | 数据点数 | 适用场景 |
|---------|-------|---------|---------|
| 最近 5 分钟 | 5 秒 | 最多 60 点 | 实时监控，看即刻变化 |
| 最近 1 小时 | 1 分钟 | 最多 60 点 | 短时趋势分析 |
| 最近 3 小时 | 3 分钟 | 最多 60 点 | 中长期趋势 |

每个桶内的 Token 数为该时间窗口内所有样本的 Token 总和，按模型拆分。

## 5. 后端改动

### 5.1 修改 record_llm_usage()

```python
def record_llm_usage(...):
    # ... 现有代码不变 ...
    stats["time_series"].append({
        "ts": ts,
        "model": model_name,
        "tokens": total,
    })
```

### 5.2 修改 accumulate_session_into_project()

```python
project_stats["time_series"].extend(stats["time_series"])
```

### 5.3 修改 generate_html()

在构建 `dashboard_data_json` 之前，将所有时间序列合并，过滤今日数据，并序列化：

```python
# 收集今日所有时间序列样本
all_series = []
for p in projects_json_raw:
    all_series.extend(p["time_series"])

today = datetime.now().date()
today_samples = [s for s in all_series if s["ts"].date() == today]

# 序列化为 JSON（ISO 格式时间戳）
today_series_json = [
    {
        "ts": s["ts"].isoformat(),
        "model": s["model"],
        "tokens": s["tokens"],
    }
    for s in today_samples
]
```

性能考虑：今日数据量通常只有几十到几百个样本，序列化开销可忽略。

## 6. 前端改动

### 6.1 HTML 结构

在 `generate_html()` 中，在 `<h1>Agent Cost Dashboard</h1>` 之后、Daily Spending 区域之前插入：

```html
<div class="section">
    <h2>今日实时统计</h2>
    <div class="time-range-selector">
        <button data-range="3h" onclick="switchTimeRange('3h')">最近 3 小时</button>
        <button data-range="1h" onclick="switchTimeRange('1h')">最近 1 小时</button>
        <button data-range="5m" class="active" onclick="switchTimeRange('5m')">最近 5 分钟</button>
    </div>
    <div class="today-chart-container" id="today-chart-content">
        <!-- SVG 曲线图由 JS 渲染 -->
    </div>
    <div class="chart-legend" id="today-chart-legend">
        <!-- 模型颜色图例由 JS 渲染 -->
    </div>
</div>
```

### 6.2 JS 逻辑（dashboard.js 新增）

在 `window.dashboardData` 解析后，新增渲染函数：

```javascript
function renderTodayChart() {
    const samples = dashboardData.todayTimeSeries || [];
    if (!samples.length) return;

    const range = currentTimeRange || '5m';  // '5m' | '1h' | '3h'
    const bucketSize = getBucketSize(range); // 5_000 | 60_000 | 180_000 (ms)

    // 1. 按时间范围过滤
    const now = Date.now();
    const rangeMs = {'5m': 300_000, '1h': 3_600_000, '3h': 10_800_000}[range];
    const filtered = samples.filter(s => (now - new Date(s.ts).getTime()) <= rangeMs);

    // 2. 收集所有模型名称
    const models = [...new Set(filtered.map(s => s.model))];

    // 3. 桶聚合
    const buckets = {};
    filtered.forEach(s => {
        const ts = new Date(s.ts).getTime();
        const bucketKey = Math.floor(ts / bucketSize) * bucketSize;
        if (!buckets[bucketKey]) buckets[bucketKey] = {};
        buckets[bucketKey][s.model] = (buckets[bucketKey][s.model] || 0) + s.tokens;
    });

    // 4. 排序桶
    const sortedBuckets = Object.entries(buckets)
        .sort(([a], [b]) => a - b)
        .map(([ts, modelTokens]) => ({ ts: Number(ts), modelTokens }));

    // 5. 渲染 SVG 曲线
    drawSvgChart(sortedBuckets, models);
}
```

#### 桶聚合算法

每个桶的计算方式：桶的开始时间戳 `bucketKey = floor(sample_timestamp / bucketSize) * bucketSize`，桶内所有样本的 Token 按模型累加。

#### SVG 曲线渲染

```javascript
function drawSvgChart(buckets, models) {
    const width = 800, height = 250;
    const padding = { top: 20, right: 20, bottom: 30, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // 计算 X/Y 范围
    const minTs = buckets[0].ts;
    const maxTs = buckets[buckets.length - 1].ts;
    const maxTokens = Math.max(...buckets.map(b =>
        models.reduce((sum, m) => sum + (b.modelTokens[m] || 0), 0)
    ), 1);

    // 坐标映射函数
    const xScale = (ts) => padding.left + (ts - minTs) / (maxTs - minTs) * chartW;
    const yScale = (tokens) => padding.top + chartH - (tokens / maxTokens) * chartH;

    // 为每个模型生成平滑曲线
    const paths = models.map(model => {
        const points = buckets.map(b => ({
            x: xScale(b.ts),
            y: yScale(b.modelTokens[model] || 0),
        }));
        return { model, path: smoothPath(points) };
    });

    // 构建 SVG...
}
```

#### 平滑曲线插值（Catmull-Rom to Cubic Bezier）

```javascript
function smoothPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`;

    let d = `M${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
}
```

### 6.3 CSS 样式（dashboard.css 新增）

```css
.today-chart-container {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    overflow-x: auto;
}

.time-range-selector {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
}

.time-range-selector button {
    background: var(--bg-card);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.2s, color 0.2s;
}

.time-range-selector button:hover {
    background: var(--border);
    color: var(--text-primary);
}

.time-range-selector button.active {
    background: var(--accent-green);
    color: #0d1117;
    border-color: var(--accent-green);
    font-weight: 600;
}

.chart-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
    margin-bottom: 16px;
    font-size: 13px;
    color: var(--text-secondary);
}

.chart-legend .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
}

.chart-legend .legend-dot {
    width: 12px;
    height: 3px;
    border-radius: 2px;
}

.today-chart-svg {
    width: 100%;
    height: auto;
}
```

## 7. 错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| 今日无数据 | 显示 "今日暂无 Token 数据" 提示，不渲染图表 |
| 某时桶无数据 | 该桶 Token 值为 0，曲线正常下降 |
| 单一样本（单点） | 只显示一个点，不连线 |
| 只有一种模型 | 只画一条曲线，图例只显示一个模型 |
| 模型名称过长 | 图例截断，与现有 daily-legend 一致使用 `slice(0, 32) + '...'` |
| 时间戳精度丢失 | 前端使用 ISO 字符串解析，微秒精度保留 |
| 3小时内无活动 | 图表显示一条水平线（所有桶为 0） |
| 5分钟内有大量样本 | 5秒桶聚合自然压缩，不会出现重叠 |

## 8. 不变的部分

- 现有 Daily Spending 柱状图不受影响
- 现有的模型颜色 PALETTE 不变
- 现有的 CSS 变量不变
- 现有的 session 读取逻辑不变
- 现有的静态文件 (`assets/`) 结构不变

## 9. 测试计划

- [ ] 后端 Python 语法检测
- [ ] 启动测试端口 8754，验证页面渲染
- [ ] 今日有数据时，曲线图正常显示
- [ ] 今日无数据时，显示空状态提示
- [ ] 切换 3h/1h/5m，图表重新计算并刷新
- [ ] 按模型拆分，图例显示正确
- [ ] SVG 曲线平滑（无锯齿）
- [ ] 响应式布局（不同宽度下正常显示）