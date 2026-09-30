# 锐机-HotSearchDB

定时抓取各平台热搜，按日期归档为 JSON，供其他项目调用。

## 数据来源

| 平台 | 说明 |
|------|------|
| 微博 | 热搜榜 |
| 知乎 | 热榜（需配置 `ZHIHU_COOKIE`） |
| 百度 | 实时热点 |
| 哔哩哔哩 | 热搜 |
| 抖音 | 热榜 |
| 今日头条 | 热榜 |

单平台失败不影响其他平台，失败信息会记录在当日 JSON 的 `platforms.<name>.error` 字段。

## 目录结构

```
archives/
├── index.json            # 索引：所有可用的日期与时间点
├── 2026-10-01/
│   ├── 01-07.json        # 该时间点抓取的各平台热搜
│   └── 01-08.json
└── 2026-10-02/
    └── ...
```

## 调用方式

**1. 获取索引** `archives/index.json`：

```json
{
  "updated": 1790788112776,
  "dates": {
    "2026-10-01": ["01-07", "01-08"]
  }
}
```

**2. 按需拼接路径获取数据** `archives/{date}/{time}.json`：

```json
{
  "date": "2026-10-01",
  "time": "01-07",
  "timestamp": 1790816737530,
  "platforms": {
    "weibo": {
      "success": true,
      "list": [
        {
          "rank": 1,
          "title": "热搜标题",
          "hot": 1370772,
          "url": "https://s.weibo.com/weibo?q=...",
          "label": "热"
        }
      ]
    }
  }
}
```

若通过 GitHub Raw 访问，URL 格式为：

```
https://raw.githubusercontent.com/RejTech/RejHotSearchDB/main/archives/index.json
https://raw.githubusercontent.com/RejTech/RejHotSearchDB/main/archives/2026-10-01/01-07.json
```

## 自动化

- GitHub Actions 每小时第 5 分钟执行一次（`.github/workflows/fetch-hot-search.yml`），也可在 Actions 页面手动触发
- 每次抓取后自动重建索引并提交回仓库
- 超过 30 天的归档自动删除

## 配置

在仓库 Settings → Secrets and variables → Actions 中添加：

- `ZHIHU_COOKIE`（可选）：知乎登录 Cookie，未配置时知乎抓取会失败但不影响其他平台

## 本地运行

```bash
node scripts/fetch.js
```

要求 Node.js 18+（使用原生 `fetch`）。
