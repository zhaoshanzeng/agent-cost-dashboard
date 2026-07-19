// Dashboard rendering and interactions.
// Data is injected by cost_dashboard.py as window.dashboardData.
const dashboardData = window.dashboardData || {};

(function() {
    const dailyStats = dashboardData.dailyStats || [];

    // Collect all model names ordered by total cost (highest first)
    const modelTotals = {};
    dailyStats.forEach(d => {
        Object.entries(d.models).forEach(([m, c]) => {
            modelTotals[m] = (modelTotals[m] || 0) + c;
        });
    });
    const allModels = Object.keys(modelTotals).sort(
        (a, b) => modelTotals[b] - modelTotals[a]
    );

    // Distinct colour palette — one colour per model.
    // We cycle through a fixed set so the same model always
    // gets the same colour across page reloads.
    const PALETTE = [
        '#3fb950', // green  (matches accent-green)
        '#58a6ff', // blue
        '#a371f7', // purple
        '#d29922', // yellow
        '#f85149', // red
        '#39d353', // bright green
        '#79c0ff', // light blue
        '#ff7b72', // salmon
        '#ffa657', // orange
        '#56d364', // lime
        '#bc8cff', // lavender
        '#e3b341', // amber
    ];
    function modelColor(model, idx) {
        return PALETTE[idx % PALETTE.length];
    }

    // Only show the last 14 days by default; full history is
    // accessible via a toggle.
    const RECENT_DAYS = 14;
    let showAll = false;

    function getVisibleDays() {
        // dailyStats is already sorted newest-first from the server,
        // so slice from the start to take the most recent RECENT_DAYS.
        return showAll ? dailyStats : dailyStats.slice(0, RECENT_DAYS);
    }

    function render() {
        const visible = getVisibleDays();
        if (!visible.length) return;

        const maxCost = Math.max(...visible.map(d => d.cost), 0.0001);

        // Group days by YYYY-MM for monthly totals
        const monthTotals = {};
        visible.forEach(d => {
            const month = d.day.slice(0, 7);
            if (!monthTotals[month]) {
                monthTotals[month] = {cost: 0, models: {}};
            }
            monthTotals[month].cost += d.cost;
            Object.entries(d.models).forEach(([m, c]) => {
                monthTotals[month].models[m] =
                    (monthTotals[month].models[m] || 0) + c;
            });
        });

        let html = '';

        // Legend
        if (allModels.length > 0) {
            html += '<div class="daily-legend">';
            allModels.forEach((m, i) => {
                const color = modelColor(m, i);
                const shortName = m.length > 35
                    ? m.slice(0, 32) + '...' : m;
                html += `<span class="legend-item">
                    <span class="legend-dot" style="background:${color}"></span>
                    ${escapeHtml(shortName)}
                </span>`;
            });
            html += '</div>';
        }

        let prevMonth = null;

        visible.forEach(d => {
            const month = d.day.slice(0, 7);

            // Insert monthly total separator when month changes
            // (after we have seen all days of the previous month)
            if (prevMonth && month !== prevMonth) {
                html += renderMonthRow(prevMonth, monthTotals[prevMonth]);
            }
            prevMonth = month;

            // Stacked bar for this day
            let stackedSegments = '';
            allModels.forEach((m, i) => {
                const mCost = d.models[m] || 0;
                const mPct = (mCost / maxCost * 100);
                if (mPct < 0.01) return;
                stackedSegments += `<div class="bar-segment" style="width:${mPct.toFixed(2)}%;background:${modelColor(m, i)}" title="${escapeHtml(m)}: $${mCost.toFixed(4)}"></div>`;
            });

            html += `
                <div class="daily-bar">
                    <span class="date">${d.day}</span>
                    <div class="bar-wrapper">
                        <div class="bar-container stacked">
                            ${stackedSegments}
                        </div>
                    </div>
                    <span class="amount">$${d.cost.toFixed(2)}</span>
                </div>`;
        });

        // Monthly total for the last visible month
        if (prevMonth) {
            html += renderMonthRow(prevMonth, monthTotals[prevMonth]);
        }

        // Toggle button
        const totalDays = dailyStats.length;
        if (totalDays > RECENT_DAYS) {
            const label = showAll
                ? 'Show last 14 days'
                : `Show all ${totalDays} days`;
            html += `<div style="margin-top:12px;text-align:center">
                <button onclick="toggleDailyChart()" class="copy-btn">${label}</button>
            </div>`;
        }

        document.getElementById('daily-chart-content').innerHTML = html;
    }

    function renderMonthRow(month, mt) {
        const [year, mon] = month.split('-');
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const label = `${monthNames[Number(mon) - 1] || mon} ${year}`;
        let segments = '';
        allModels.forEach((m, i) => {
            const mCost = mt.models[m] || 0;
            const mPct = mt.cost > 0 ? (mCost / mt.cost * 100) : 0;
            if (mPct < 0.01) return;
            segments += `<div class="bar-segment" style="width:${mPct.toFixed(2)}%;background:${modelColor(m, i)};opacity:0.55" title="${escapeHtml(m)}: $${mCost.toFixed(4)}"></div>`;
        });
        return `
            <div class="monthly-total-row">
                <span class="date monthly-label">${label}</span>
                <div class="bar-wrapper">
                    <div class="bar-container stacked">
                        ${segments}
                    </div>
                </div>
                <span class="amount monthly-amount">$${mt.cost.toFixed(2)}</span>
            </div>`;
    }

    window.toggleDailyChart = function() {
        showAll = !showAll;
        render();
    };

    render();

    // ═══════════════════════════════════════════════════════════════════
    // 今日实时 Token 曲线图
    // ═══════════════════════════════════════════════════════════════════

    const todayTimeSeries = dashboardData.todayTimeSeries || [];
    let currentTimeRange = '5m';

    function getBucketSizeMs(range) {
        return { '5m': 5000, '1h': 60000, '3h': 180000 }[range] || 5000;
    }

    function getRangeMs(range) {
        return { '5m': 300000, '1h': 3600000, '3h': 10800000 }[range] || 300000;
    }

    function switchTimeRange(range) {
        currentTimeRange = range;
        document.querySelectorAll('.time-range-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.range === range);
        });
        renderTodayChart();
    }

    function formatTimeLabel(ts, range) {
        var d = new Date(ts);
        if (range === '5m') {
            var h = String(d.getHours()).padStart(2, '0');
            var m = String(d.getMinutes()).padStart(2, '0');
            var s = String(d.getSeconds()).padStart(2, '0');
            return h + ':' + m + ':' + s;
        }
        var h = String(d.getHours()).padStart(2, '0');
        var m = String(d.getMinutes()).padStart(2, '0');
        return h + ':' + m;
    }

    function smoothPath(points) {
        if (points.length < 2) return '';
        if (points.length === 2) {
            return 'M' + points[0].x.toFixed(2) + ',' + points[0].y.toFixed(2) + ' L' + points[1].x.toFixed(2) + ',' + points[1].y.toFixed(2);
        }
        var d = 'M' + points[0].x.toFixed(2) + ',' + points[0].y.toFixed(2);
        for (var i = 0; i < points.length - 1; i++) {
            var p0 = points[Math.max(0, i - 1)];
            var p1 = points[i];
            var p2 = points[i + 1];
            var p3 = points[Math.min(points.length - 1, i + 2)];

            var cp1x = p1.x + (p2.x - p0.x) / 6;
            var cp1y = p1.y + (p2.y - p0.y) / 6;
            var cp2x = p2.x - (p3.x - p1.x) / 6;
            var cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ' C' + cp1x.toFixed(2) + ',' + cp1y.toFixed(2) + ' ' + cp2x.toFixed(2) + ',' + cp2y.toFixed(2) + ' ' + p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
        }
        return d;
    }

    function formatTokens(val) {
        var n = Math.abs(Number(val) || 0);
        var sign = val < 0 ? '-' : '';
        if (n >= 1000000000000) return sign + (n / 1000000000000).toFixed(1) + 'T';
        if (n >= 1000000000) return sign + (n / 1000000000).toFixed(1) + 'B';
        if (n >= 1000000) return sign + (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return sign + (n / 1000).toFixed(1) + 'k';
        return sign + String(Math.round(n));
    }

    function renderTodayChart() {
        var container = document.getElementById('today-chart-content');
        var legendEl = document.getElementById('today-chart-legend');
        if (!container) return;

        if (!todayTimeSeries.length) {
            container.innerHTML = '<p class="muted" style="text-align:center;padding:40px 0;">今日暂无 Token 数据</p>';
            if (legendEl) legendEl.innerHTML = '';
            return;
        }

        var range = currentTimeRange;
        var bucketSizeMs = getBucketSizeMs(range);
        var rangeMs = getRangeMs(range);
        var now = Date.now();

        // 1. 按时间范围过滤
        var filtered = [];
        for (var i = 0; i < todayTimeSeries.length; i++) {
            var s = todayTimeSeries[i];
            var t = new Date(s.ts).getTime();
            if ((now - t) <= rangeMs && t <= now) {
                filtered.push(s);
            }
        }

        if (!filtered.length) {
            container.innerHTML = '<p class="muted" style="text-align:center;padding:40px 0;">所选时间范围内暂无 Token 数据</p>';
            if (legendEl) legendEl.innerHTML = '';
            return;
        }

        // 2. 收集所有模型名称（按总 Token 量排序）
        var modelTotals = {};
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            modelTotals[s.model] = (modelTotals[s.model] || 0) + s.tokens;
        }
        var models = Object.keys(modelTotals).sort(function(a, b) {
            return modelTotals[b] - modelTotals[a];
        });

        // 3. 桶聚合
        var buckets = {};
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var t = new Date(s.ts).getTime();
            var bucketKey = Math.floor(t / bucketSizeMs) * bucketSizeMs;
            if (!buckets[bucketKey]) buckets[bucketKey] = {};
            buckets[bucketKey][s.model] = (buckets[bucketKey][s.model] || 0) + s.tokens;
        }

        // 4. 排序桶
        var bucketKeys = Object.keys(buckets).sort(function(a, b) { return Number(a) - Number(b); });
        var sortedBuckets = [];
        for (var i = 0; i < bucketKeys.length; i++) {
            sortedBuckets.push({
                ts: Number(bucketKeys[i]),
                modelTokens: buckets[bucketKeys[i]]
            });
        }

        // 5. 计算 Y 轴范围
        var maxTokens = 1;
        for (var i = 0; i < sortedBuckets.length; i++) {
            var b = sortedBuckets[i];
            var total = 0;
            for (var j = 0; j < models.length; j++) {
                total += (b.modelTokens[models[j]] || 0);
            }
            if (total > maxTokens) maxTokens = total;
        }

        // 6. SVG 尺寸
        var svgW = 800, svgH = 250;
        var pad = { top: 20, right: 20, bottom: 30, left: 60 };
        var chartW = svgW - pad.left - pad.right;
        var chartH = svgH - pad.top - pad.bottom;

        var minTs = sortedBuckets[0].ts;
        var maxTs = sortedBuckets[sortedBuckets.length - 1].ts;
        var tsRange = Math.max(maxTs - minTs, 1);

        function xScale(ts) {
            return pad.left + ((ts - minTs) / tsRange) * chartW;
        }
        function yScale(tokens) {
            return pad.top + chartH - (tokens / maxTokens) * chartH;
        }

        // 7. 生成 Y 轴刻度
        var yStep = 1;
        if (maxTokens <= 5) {
            yStep = 1;
        } else if (maxTokens <= 50) {
            yStep = Math.ceil(maxTokens / 5 / 5) * 5;
        } else if (maxTokens <= 500) {
            yStep = Math.ceil(maxTokens / 5 / 10) * 10;
        } else {
            yStep = Math.ceil(maxTokens / 5 / 100) * 100;
        }
        yStep = Math.max(yStep, 1);
        var yLabels = [];
        for (var v = 0; v <= maxTokens; v += yStep) {
            yLabels.push(v);
        }
        if (yLabels[yLabels.length - 1] < maxTokens) {
            yLabels.push(maxTokens);
        }

        // 8. 生成 X 轴标签（最多 6 个）
        var xLabelCount = Math.min(6, sortedBuckets.length);
        var xStep = Math.max(1, Math.floor(sortedBuckets.length / xLabelCount));
        var xLabels = [];
        for (var i = 0; i < sortedBuckets.length; i += xStep) {
            xLabels.push(sortedBuckets[i].ts);
        }
        // 确保最后一个标签
        if (xLabels.length === 0 || xLabels[xLabels.length - 1] !== sortedBuckets[sortedBuckets.length - 1].ts) {
            xLabels.push(sortedBuckets[sortedBuckets.length - 1].ts);
        }

        // 9. 构建 SVG
        var svg = '<svg class="today-chart-svg" viewBox="0 0 ' + svgW + ' ' + svgH + '" xmlns="http://www.w3.org/2000/svg">';

        // 网格线 + Y 轴标签
        for (var i = 0; i < yLabels.length; i++) {
            var v = yLabels[i];
            var y = yScale(v);
            svg += '<line x1="' + pad.left + '" y1="' + y.toFixed(2) + '" x2="' + (svgW - pad.right) + '" y2="' + y.toFixed(2) + '" stroke="#30363d" stroke-width="1"/>';
            var label = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
            svg += '<text x="' + (pad.left - 8) + '" y="' + (y + 4).toFixed(2) + '" text-anchor="end" fill="#8b949e" font-size="11">' + label + '</text>';
        }

        // X 轴标签
        for (var i = 0; i < xLabels.length; i++) {
            var x = xScale(xLabels[i]);
            var label = formatTimeLabel(xLabels[i], range);
            svg += '<text x="' + x.toFixed(2) + '" y="' + (svgH - 6) + '" text-anchor="middle" fill="#8b949e" font-size="11">' + label + '</text>';
        }

        // 曲线 — 每个模型一条
        for (var m = 0; m < models.length; m++) {
            var model = models[m];
            var color = modelColor(model, m);
            var points = [];
            for (var i = 0; i < sortedBuckets.length; i++) {
                points.push({
                    x: xScale(sortedBuckets[i].ts),
                    y: yScale(sortedBuckets[i].modelTokens[model] || 0)
                });
            }
            var pathD = smoothPath(points);
            if (pathD) {
                svg += '<path d="' + pathD + '" stroke="' + color + '" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
            }
        }

        svg += '</svg>';

        container.innerHTML = svg;

        // 11. 添加悬停 tooltip 的透明 hit area
        var svgEl = container.querySelector('svg');
        if (svgEl && sortedBuckets.length > 0) {
            // 创建 tooltip 元素（如果不存在）
            var tooltip = document.getElementById('today-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.id = 'today-tooltip';
                tooltip.style.cssText = 'position:absolute;display:none;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.6;pointer-events:none;z-index:100;white-space:nowrap;color:#e6edf3;';
                container.style.position = 'relative';
                container.appendChild(tooltip);
            }

            // 计算每个桶在容器中的实际像素宽度
            var firstX = xScale(sortedBuckets[0].ts);
            var lastX = xScale(sortedBuckets[sortedBuckets.length - 1].ts);
            var bucketWidth = (lastX - firstX) / sortedBuckets.length;
            var hitWidth = Math.max(bucketWidth * 0.8, 4);

            // 添加 hit area 矩形
            for (var i = 0; i < sortedBuckets.length; i++) {
                var b = sortedBuckets[i];
                var cx = xScale(b.ts);
                var hitX = cx - hitWidth / 2;

                var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', hitX.toFixed(2));
                rect.setAttribute('y', '0');
                rect.setAttribute('width', hitWidth.toFixed(2));
                rect.setAttribute('height', svgH);
                rect.setAttribute('fill', 'transparent');
                rect.setAttribute('data-index', String(i));

                // 构建 tooltip 内容
                var ttTime = formatTimeLabel(b.ts, range);
                var ttLines = '<div style="font-weight:600;margin-bottom:4px;color:#8b949e;">' + ttTime + '</div>';
                for (var m = 0; m < models.length; m++) {
                    var mdl = models[m];
                    var tok = b.modelTokens[mdl] || 0;
                    if (tok > 0) {
                        var color = modelColor(mdl, m);
                        var shortName = mdl.length > 30 ? mdl.slice(0, 28) + '...' : mdl;
                        ttLines += '<div style="display:flex;justify-content:space-between;gap:16px;">' +
                            '<span><span style="display:inline-block;width:8px;height:2px;background:' + color + ';vertical-align:middle;margin-right:4px;"></span>' + escapeHtml(shortName) + '</span>' +
                            '<span style="text-align:right;font-weight:600;">' + formatTokens(tok) + '</span>' +
                            '</div>';
                    }
                }

                rect.addEventListener('mouseenter', (function(html) {
                    return function() {
                        tooltip.innerHTML = html;
                        tooltip.style.display = 'block';
                    };
                })(ttLines));

                rect.addEventListener('mousemove', function(e) {
                    var rect_ = container.getBoundingClientRect();
                    var tx = e.clientX - rect_.left + 12;
                    var ty = e.clientY - rect_.top - 10;
                    // 防止 tooltip 超出容器右侧
                    var ttW = tooltip.offsetWidth;
                    if (tx + ttW > rect_.width - 10) {
                        tx = e.clientX - rect_.left - ttW - 12;
                    }
                    tooltip.style.left = Math.max(0, tx) + 'px';
                    tooltip.style.top = Math.max(0, ty - tooltip.offsetHeight) + 'px';
                });

                rect.addEventListener('mouseleave', function() {
                    tooltip.style.display = 'none';
                });

                svgEl.appendChild(rect);
            }
        }

        // 10. 渲染图例
        if (legendEl) {
            var legendHtml = '';
            for (var m = 0; m < models.length; m++) {
                var model = models[m];
                var color = modelColor(model, m);
                var shortName = model.length > 35 ? model.slice(0, 32) + '...' : model;
                legendHtml += '<span class="legend-item">' +
                    '<span class="legend-dot" style="background:' + color + '"></span>' +
                    escapeHtml(shortName) +
                    '</span>';
            }
            legendEl.innerHTML = legendHtml;
        }
    }

    // 暴露给 HTML onclick
    window.switchTimeRange = switchTimeRange;
    window.renderTodayChart = renderTodayChart;

    // 自动渲染今日图表
    renderTodayChart();
})();

const projects = dashboardData.projects || [];

function buildResumeCmd(agentCmd, cwd, sessionPath, sessionUid) {
    if (agentCmd === 'claude') {
        return 'cd "' + cwd + '" && claude --resume "' + sessionUid + '"';
    } else if (agentCmd === 'codex') {
        return 'cd "' + cwd + '" && codex --resume "' + sessionUid + '"';
    } else {
        return 'cd "' + cwd + '" && ' + agentCmd + ' --session "' + sessionPath + '"';
    }
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return Math.round(seconds) + 's';
    } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return mins + 'm' + secs.toString().padStart(2, '0') + 's';
    } else {
        const hours = Math.floor(seconds / 3600);
        const mins = Math.round((seconds % 3600) / 60);
        return hours + 'h' + mins.toString().padStart(2, '0') + 'm';
    }
}

let projectSort = { field: 'last_activity', asc: false };
let sessionsSort = { field: 'start', asc: false };

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFullNumber(value) {
    const n = Number(value) || 0;
    return String(Math.round(n));
}

function trimOneDecimal(value) {
    return value.toFixed(1).replace(/\.0$/, '');
}

function formatCompactNumber(value) {
    const n = Number(value) || 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const units = [
        [1_000_000_000_000, 'T'],
        [1_000_000_000, 'B'],
        [1_000_000, 'M'],
        [1_000, 'k'],
    ];

    for (const [size, suffix] of units) {
        if (abs >= size) {
            return sign + trimOneDecimal(abs / size) + suffix;
        }
    }
    return sign + formatFullNumber(abs);
}

function displayNameFromPath(path) {
    const text = String(path || 'unknown').replace(/[\\/]+$/, '');
    const parts = text.split(/[\\/]+/);
    return parts[parts.length - 1] || text || 'unknown';
}

const TOKEN_DETAIL_FIELDS = [
    ['In', 'input_tokens'],
    ['Out', 'output_tokens'],
    ['Cache read', 'cache_read_tokens'],
    ['Cache write', 'cache_write_tokens'],
    ['Reasoning', 'reasoning_tokens'],
];

function tokenValue(item, field) {
    return Number(item?.[field] || 0);
}

function tokenTitle(item) {
    return [
        `Total: ${formatFullNumber(tokenValue(item, 'tokens'))}`,
        ...TOKEN_DETAIL_FIELDS.map(
            ([label, field]) => `${label}: ${formatFullNumber(tokenValue(item, field))}`
        ),
    ].join('\n');
}

function tokenDetailText(item, compact = false) {
    const formatter = compact ? formatCompactNumber : formatFullNumber;
    return TOKEN_DETAIL_FIELDS
        .map(([label, field]) => [label, tokenValue(item, field)])
        .filter(([, value]) => value > 0)
        .map(([label, value]) => `${label} ${formatter(value)}`)
        .join(' · ');
}

function tokenCellHtml(item) {
    return `<span class="token-cell" title="${escapeHtml(tokenTitle(item))}">${formatCompactNumber(tokenValue(item, 'tokens'))}</span>`;
}

function aggregateTokenCounts(items) {
    const totals = {tokens: 0};
    TOKEN_DETAIL_FIELDS.forEach(([, field]) => { totals[field] = 0; });
    items.forEach(item => {
        totals.tokens += tokenValue(item, 'tokens');
        TOKEN_DETAIL_FIELDS.forEach(([, field]) => {
            totals[field] += tokenValue(item, field);
        });
    });
    return totals;
}

function sortData(data, sort) {
    return [...data].sort((a, b) => {
        let aVal = a[sort.field];
        let bVal = b[sort.field];

        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        if (aVal < bVal) return sort.asc ? -1 : 1;
        if (aVal > bVal) return sort.asc ? 1 : -1;
        return 0;
    });
}

function renderProjects() {
    const tbody = document.getElementById('projects-tbody');
    const sorted = sortData(projects, projectSort);
    tbody.innerHTML = sorted.map((p, idx) => {
        const displayName = displayNameFromPath(p.name);
        const shortName = displayName.length > 50 ? displayName.slice(0, 47) + '...' : displayName;
        const rowId = 'project-' + idx;

        // Build model breakdown HTML
        const modelRows = p.models.map(m => `
            <div class="model-item">
                <span class="model-name">${escapeHtml(m.name)}</span>
                <span class="model-stat" title="${formatFullNumber(m.messages)} msgs">${formatCompactNumber(m.messages)} msgs</span>
                <span class="model-stat token-wide" title="${escapeHtml(tokenTitle(m))}">${formatCompactNumber(m.tokens)} tok</span>
                <span class="model-stat token-detail-wide">${escapeHtml(tokenDetailText(m, true))}</span>
                <span class="model-stat" style="color: var(--accent-blue)">${(m.avg_tps || 0).toFixed(1)} tok/s</span>
                <span class="model-stat cost">$${m.cost.toFixed(2)}</span>
            </div>
        `).join('');

        // Build tool breakdown HTML
        const toolRows = (p.tools || []).map(t => `
            <div class="model-item">
                <span class="model-name" style="color: var(--accent-yellow)">${escapeHtml(t.name)}</span>
                <span class="model-stat" title="${formatFullNumber(t.calls)} calls">${formatCompactNumber(t.calls)} calls</span>
                <span class="model-stat" style="color: var(--accent-yellow)">${t.time_display}</span>
                <span class="model-stat">avg ${t.avg_time_display}</span>
                ${t.errors > 0 ? `<span class="model-stat" style="color: var(--accent-red)">${t.errors} errors</span>` : ''}
            </div>
        `).join('');

        return `
            <tr class="expandable-row" data-target="${rowId}" onclick="toggleProjectRow('${rowId}')">
                <td class="project-name" title="${escapeHtml(p.name)}"><span class="expand-icon">▶</span> ${escapeHtml(shortName)}</td>
                <td>${p.sessions}</td>
                <td title="${formatFullNumber(p.messages)}">${formatCompactNumber(p.messages)}</td>
                <td class="tokens">${tokenCellHtml(p)}</td>
                <td style="color: var(--accent-purple)">${p.llm_time_display}</td>
                <td style="color: var(--accent-yellow)">${p.tool_time_display}</td>
                <td style="color: var(--accent-blue)">${(p.avg_tps || 0).toFixed(1)}</td>
                <td class="cost">$${p.cost.toFixed(2)}</td>
                <td style="color: var(--text-secondary)">${p.last_activity_display}</td>
            </tr>
            <tr class="model-breakdown" id="${rowId}">
                <td colspan="9">
                    <div class="model-tree">
                        <div class="detail-line"><strong>Path:</strong> ${escapeHtml(p.name)}</div>
                        <div class="detail-line" title="${escapeHtml(tokenTitle(p))}"><strong>Tokens:</strong> ${formatCompactNumber(p.tokens)} ${tokenDetailText(p, true) ? `(${escapeHtml(tokenDetailText(p, true))})` : ''}</div>
                        <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-secondary)">Models:</div>
                        ${modelRows || '<div style="color: var(--text-secondary)">No model data</div>'}
                        ${toolRows ? `<div style="font-weight: 600; margin: 12px 0 8px 0; color: var(--text-secondary)">Tools:</div>${toolRows}` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function toggleProjectRow(rowId) {
    const row = document.getElementById(rowId);
    const parentRow = document.querySelector('[data-target="' + rowId + '"]');
    row.classList.toggle('show');
    parentRow.classList.toggle('expanded');
}

function renderSessions() {
    const tbody = document.getElementById('sessions-tbody');

    // Flatten sessions with subagent info
    const allSessionsWithSubs = [];
    projects.forEach(p => {
        p.sessions_list.forEach(s => {
            // Add agent_cmd from parent project for resume command
            allSessionsWithSubs.push({...s, agent_cmd: p.agent_cmd});
        });
    });

    // Helper to get aggregated value for a session (including subagents)
    function getAggregatedValue(s, field) {
        const subs = s.subagent_sessions || [];
        const all = [s, ...subs];

        switch(field) {
            case 'cost':
                return all.reduce((sum, session) => sum + session.cost, 0);
            case 'tokens':
                return all.reduce((sum, session) => sum + session.tokens, 0);
            case 'messages':
                return all.reduce((sum, session) => sum + session.messages, 0);
            case 'llm_time':
                return all.reduce((sum, session) => sum + (session.llm_time || 0), 0);
            case 'tool_time':
                return all.reduce((sum, session) => sum + (session.tool_time || 0), 0);
            case 'avg_tps':
                const tpsValues = all.map(session => session.avg_tps || 0).filter(v => v > 0);
                return tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0;
            case 'duration':
                const starts = all.map(session => session.start).filter(Boolean);
                const ends = all.map(session => session.end).filter(Boolean);
                if (!starts.length || !ends.length) return 0;
                const earliest = Math.min(...starts.map(d => new Date(d)));
                const latest = Math.max(...ends.map(d => new Date(d)));
                return (latest - earliest) / 1000;
            case 'start':
                return s.start ? new Date(s.start).getTime() : 0;
            case 'project':
                return s.cwd.toLowerCase();
            default:
                return s[field] || 0;
        }
    }

    // Sort sessions using current sort state
    const sortedSessions = [...allSessionsWithSubs].sort((a, b) => {
        const aVal = getAggregatedValue(a, sessionsSort.field);
        const bVal = getAggregatedValue(b, sessionsSort.field);

        if (aVal < bVal) return sessionsSort.asc ? -1 : 1;
        if (aVal > bVal) return sessionsSort.asc ? 1 : -1;
        return 0;
    });

    const totalSessions = allSessionsWithSubs.reduce((sum, s) => sum + 1 + (s.subagent_sessions || []).length, 0);
    document.getElementById('sessions-count').textContent = totalSessions + ' sessions';

    let html = '';
    let rowIdx = 0;

    sortedSessions.forEach(s => {
        const subs = s.subagent_sessions || [];
        const hasSubs = subs.length > 0;

        // If no subagent sessions, just show the main session as a regular row
        if (!hasSubs) {
            const sessionUrl = '/session?uid=' + encodeURIComponent(s.uid);
            const resumePath = s.path.replace(/\\\\/g, '/');
            const resumeCmd = buildResumeCmd(s.agent_cmd, s.cwd, resumePath, s.uid);
            const sessionName = displayNameFromPath(s.cwd);
            const shortProject = sessionName.length > 40 ? sessionName.slice(0, 37) + '...' : sessionName;

            html += `
                <tr>
                    <td class="project-name" title="${escapeHtml(s.cwd)}">${escapeHtml(shortProject)}</td>
                    <td style="color: var(--text-secondary)">${s.start_display}</td>
                    <td style="color: var(--text-secondary)">${s.duration_display}</td>
                    <td style="color: var(--accent-purple)">${s.llm_time_display}</td>
                    <td style="color: var(--accent-yellow)">${s.tool_time_display || '0s'}</td>
                    <td style="color: var(--accent-blue)">${(s.avg_tps || 0).toFixed(1)}</td>
                    <td title="${formatFullNumber(s.messages)}">${formatCompactNumber(s.messages)}</td>
                    <td class="tokens">${tokenCellHtml(s)}</td>
                    <td class="cost">$${s.cost.toFixed(2)}</td>
                    <td>
                        <button onclick="copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(resumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                        <a href="${sessionUrl}" class="session-link" target="_blank" title="View full session">Open →</a>
                    </td>
                </tr>
            `;
            return;
        }

        // Has subagent sessions - show expandable summary
        const allSessionsInGroup = [s, ...subs];
        const projectId = 'session-group-' + rowIdx;
        rowIdx++;

        // Calculate aggregated totals
        const aggCost = allSessionsInGroup.reduce((sum, session) => sum + session.cost, 0);
        const aggTokenCounts = aggregateTokenCounts(allSessionsInGroup);
        const aggMessages = allSessionsInGroup.reduce((sum, session) => sum + session.messages, 0);
        const aggLlmTime = allSessionsInGroup.reduce((sum, session) => sum + (session.llm_time || 0), 0);
        const aggToolTime = allSessionsInGroup.reduce((sum, session) => sum + (session.tool_time || 0), 0);

        // Get earliest start and latest end
        const starts = allSessionsInGroup.map(session => session.start).filter(Boolean);
        const ends = allSessionsInGroup.map(session => session.end).filter(Boolean);
        const earliestStart = starts.length ? new Date(Math.min(...starts.map(d => new Date(d)))) : null;
        const latestEnd = ends.length ? new Date(Math.max(...ends.map(d => new Date(d)))) : null;
        const totalDuration = earliestStart && latestEnd ? (latestEnd - earliestStart) / 1000 : 0;

        const sessionName = displayNameFromPath(s.cwd);
        const shortProject = sessionName.length > 40 ? sessionName.slice(0, 37) + '...' : sessionName;

        // Format date to match other sessions (YYYY-MM-DD HH:MM)
        const dateDisplay = s.start_display;

        // Summary row with resume/open buttons
        const sessionUrl = '/session?uid=' + encodeURIComponent(s.uid);
        const resumePath = s.path.replace(/\\\\/g, '/');
        const resumeCmd = buildResumeCmd(s.agent_cmd, s.cwd, resumePath, s.uid);

        // Calculate average tokens/sec for aggregated sessions
        const tpsValues = allSessionsInGroup.map(session => session.avg_tps || 0).filter(v => v > 0);
        const aggAvgTps = tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0;

        html += `
            <tr class="expandable-row" data-target="${projectId}" onclick="toggleProjectRow('${projectId}')">
                <td class="project-name" title="${escapeHtml(s.cwd)}">
                    <span class="expand-icon">▶</span>
                    ${escapeHtml(shortProject)}
                </td>
                <td style="color: var(--text-secondary)">${dateDisplay}</td>
                <td style="color: var(--text-secondary)">${formatDuration(totalDuration)}</td>
                <td style="color: var(--accent-purple)">${formatDuration(aggLlmTime)}</td>
                <td style="color: var(--accent-yellow)">${formatDuration(aggToolTime)}</td>
                <td style="color: var(--accent-blue)">${aggAvgTps.toFixed(1)}</td>
                <td title="${formatFullNumber(aggMessages)}">${formatCompactNumber(aggMessages)}</td>
                <td class="tokens">${tokenCellHtml(aggTokenCounts)}</td>
                <td class="cost">$${aggCost.toFixed(2)}</td>
                <td>
                    <button onclick="event.stopPropagation(); copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(resumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                    <a href="${sessionUrl}" class="session-link" target="_blank" title="View full session" onclick="event.stopPropagation()">Open →</a>
                </td>
            </tr>
            <tr class="model-breakdown" id="${projectId}">
                <td colspan="10" style="padding: 0">
                    <div class="model-tree">
                        <div class="detail-line"><strong>Path:</strong> ${escapeHtml(s.cwd)}</div>
                        <div class="detail-line"><strong>Tokens:</strong> ${formatFullNumber(aggTokenCounts.tokens)} ${tokenDetailText(aggTokenCounts) ? `(${escapeHtml(tokenDetailText(aggTokenCounts))})` : ''}</div>
        `;

        // Main session with buttons
        html += `
            <div class="model-item">
                <span class="model-name" title="${escapeHtml(s.file)}">
                    <strong>Main session:</strong> ${escapeHtml(s.file)}
                </span>
                <span class="model-stat">${s.start_display}</span>
                <span class="model-stat">${s.duration_display}</span>
                <span class="model-stat" style="color: var(--accent-purple)">${s.llm_time_display}</span>
                <span class="model-stat" style="color: var(--accent-yellow)">${s.tool_time_display || '0s'}</span>
                <span class="model-stat" style="color: var(--accent-blue)">${(s.avg_tps || 0).toFixed(1)} tok/s</span>
                <span class="model-stat">${formatFullNumber(s.messages)} msgs</span>
                <span class="model-stat token-wide" title="${escapeHtml(tokenTitle(s))}">${formatFullNumber(s.tokens)} tok</span>
                <span class="model-stat token-detail-wide">${escapeHtml(tokenDetailText(s))}</span>
                <span class="model-stat cost">$${s.cost.toFixed(2)}</span>
                <span style="margin-left: 8px">
                    <button onclick="copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(resumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                    <a href="${sessionUrl}" class="session-link" target="_blank" title="View full session">Open →</a>
                </span>
            </div>
        `;

        // Subagent sessions with buttons
        subs.forEach(sub => {
            const subSessionUrl = '/session?uid=' + encodeURIComponent(sub.uid);
            const subResumePath = sub.path.replace(/\\\\/g, '/');
            // Use parent session's agent_cmd for subagent resume command
            const subResumeCmd = buildResumeCmd(s.agent_cmd, sub.cwd, subResumePath, sub.uid);

            // Just show the filename, not the full relative path
            const fileName = sub.file;

            html += `
                <div class="model-item">
                    <span class="model-name" title="${escapeHtml(sub.relative_path)}">
                        ${escapeHtml(fileName)}
                    </span>
                    <span class="model-stat">${sub.start_display}</span>
                    <span class="model-stat">${sub.duration_display}</span>
                    <span class="model-stat" style="color: var(--accent-purple)">${sub.llm_time_display}</span>
                    <span class="model-stat" style="color: var(--accent-yellow)">${sub.tool_time_display || '0s'}</span>
                    <span class="model-stat" style="color: var(--accent-blue)">${(sub.avg_tps || 0).toFixed(1)} tok/s</span>
                    <span class="model-stat">${formatFullNumber(sub.messages)} msgs</span>
                    <span class="model-stat token-wide" title="${escapeHtml(tokenTitle(sub))}">${formatFullNumber(sub.tokens)} tok</span>
                    <span class="model-stat token-detail-wide">${escapeHtml(tokenDetailText(sub))}</span>
                    <span class="model-stat cost">$${sub.cost.toFixed(2)}</span>
                    <span style="margin-left: 8px">
                        <button onclick="copyResumeCommand(event, this.dataset.resumeCmd)" data-resume-cmd="${escapeHtml(subResumeCmd)}" class="icon-btn" title="Copy resume command">Copy</button>
                        <a href="${subSessionUrl}" class="session-link" target="_blank" title="View full session">Open →</a>
                    </span>
                </div>
            `;
        });

        html += `
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function copyResumeCommand(event, cmd) {
    const btn = event.target;

    function showSuccess() {
        const originalText = btn.textContent;
        btn.textContent = '✓';
        btn.style.color = 'var(--accent-green)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = '';
        }, 1500);
    }

    // Use clipboard API if available (HTTPS or localhost)
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cmd).then(showSuccess).catch(err => {
            console.error('Failed to copy:', err);
        });
    } else {
        // Fallback for HTTP contexts
        const textArea = document.createElement('textarea');
        textArea.value = cmd;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showSuccess();
        } catch (err) {
            console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
    }
}

function setupSorting(tableId, sortState, renderFn) {
    document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortState.field === field) {
                sortState.asc = !sortState.asc;
            } else {
                sortState.field = field;
                sortState.asc = field === 'name' || field === 'project' || field === 'start';
            }
            updateSortIcons(tableId, sortState);
            renderFn();
        });
    });
}

function updateSortIcons(tableId, sortState) {
    document.querySelectorAll(`#${tableId} th`).forEach(th => {
        const field = th.dataset.sort;
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (field === sortState.field) {
            th.classList.add('sorted');
            icon.textContent = sortState.asc ? '▲' : '▼';
        } else {
            th.classList.remove('sorted');
            icon.textContent = '▼';
        }
    });
}

// ── Models table sorting ──────────────────────────────────────────────
const models = dashboardData.models || [];
const totalCost = dashboardData.totalCost || 1;
let modelSort = { field: 'cost', asc: false };

function renderModels() {
    const tbody = document.getElementById('models-tbody');
    const sorted = sortData(models, modelSort);

    tbody.innerHTML = sorted.map(m => {
        const modelClass = m.name.toLowerCase().includes('claude') ? 'model-claude' : 'model-other';
        const tokenDetail = [
            ['In', m.input_tokens],
            ['Out', m.output_tokens],
            ['Cache read', m.cache_read_tokens],
            ['Cache write', m.cache_write_tokens],
            ['Reasoning', m.reasoning_tokens],
        ].filter(([, v]) => v > 0).map(([l, v]) => `${l} ${formatCompactNumber(v)}`).join(' · ');
        const tokenTitle = [
            `Total: ${formatFullNumber(m.tokens)}`,
            `In: ${formatFullNumber(m.input_tokens)}`,
            `Out: ${formatFullNumber(m.output_tokens)}`,
            `Cache read: ${formatFullNumber(m.cache_read_tokens)}`,
            `Cache write: ${formatFullNumber(m.cache_write_tokens)}`,
            `Reasoning: ${formatFullNumber(m.reasoning_tokens)}`,
        ].join('\n');

        return `
            <tr>
                <td><span class="model-tag ${modelClass}">${escapeHtml(m.name)}</span></td>
                <td title="${formatFullNumber(m.messages)}">${formatCompactNumber(m.messages)}</td>
                <td class="tokens" title="${escapeHtml(tokenTitle)}">${formatCompactNumber(m.tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.input_tokens)}">${formatCompactNumber(m.input_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.output_tokens)}">${formatCompactNumber(m.output_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.cache_read_tokens)}">${formatCompactNumber(m.cache_read_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.cache_write_tokens)}">${formatCompactNumber(m.cache_write_tokens)}</td>
                <td class="tokens" title="${formatFullNumber(m.reasoning_tokens)}">${formatCompactNumber(m.reasoning_tokens)}</td>
                <td style="color: var(--accent-blue)">${(m.avg_tps || 0).toFixed(1)}</td>
                <td class="cost">$${m.cost.toFixed(2)}</td>
                <td>
                    <div class="bar-container" style="width: 100px; display: inline-block; vertical-align: middle;">
                        <div class="bar" style="width: ${m.pct}%"></div>
                    </div>
                    ${m.pct.toFixed(1)}%
                </td>
            </tr>
        `;
    }).join('');
}

// ── Tools table sorting ───────────────────────────────────────────────
const tools = dashboardData.tools || [];
const totalToolTime = dashboardData.totalToolTime || 1;
let toolSort = { field: 'time', asc: false };

function renderTools() {
    const tbody = document.getElementById('tools-tbody');
    const sorted = sortData(tools, toolSort);

    tbody.innerHTML = sorted.map(t => {
        const errorStyle = t.errors > 0 ? 'color: var(--accent-red)' : 'color: var(--text-secondary)';
        return `
            <tr>
                <td><span class="model-tag model-other">${escapeHtml(t.name)}</span></td>
                <td title="${formatFullNumber(t.calls)}">${formatCompactNumber(t.calls)}</td>
                <td style="color: var(--accent-yellow)">${t.time_display}</td>
                <td style="color: var(--text-secondary)">${t.avg_time_display}</td>
                <td style="${errorStyle}">${t.errors}</td>
                <td>
                    <div class="bar-container" style="width: 100px; display: inline-block; vertical-align: middle;">
                        <div class="bar" style="width: ${t.pct}%; background: var(--accent-yellow)"></div>
                    </div>
                    ${t.pct.toFixed(1)}%
                </td>
            </tr>
        `;
    }).join('');
}

// Setup
setupSorting('projects-table', projectSort, renderProjects);
setupSorting('sessions-table', sessionsSort, renderSessions);
setupSorting('models-table', modelSort, renderModels);
setupSorting('tools-table', toolSort, renderTools);

// Initial render
renderProjects();
renderSessions();
renderModels();
renderTools();
updateSortIcons('projects-table', projectSort);
updateSortIcons('sessions-table', sessionsSort);
updateSortIcons('models-table', modelSort);
updateSortIcons('tools-table', toolSort);
