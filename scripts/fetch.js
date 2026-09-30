/**
 * 各平台热搜抓取脚本
 * 用法: node scripts/fetch.js
 * 输出: archives/YYYY-MM-DD/HH-mm.json
 *
 * 可选环境变量:
 *   ZHIHU_COOKIE - 知乎登录Cookie（知乎接口需登录，未配置时该平台会失败，不影响其他平台）
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      ...headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 生成稳定ID：同一平台同一标题在不同时间点保持一致 */
function makeId(platform, title) {
  return crypto
    .createHash("md5")
    .update(`${platform}:${title}`)
    .digest("hex")
    .slice(0, 12);
}

/** 并发限制执行 */
async function mapLimit(items, limit, fn) {
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i], i);
      }
    })
  );
}

/** 抓取页面HTML（仅取前300KB，meta/title均在head中） */
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html, */*" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) throw new Error(`not html: ${type}`);
  const text = await res.text();
  return text.slice(0, 300 * 1024);
}

/** 解码常见HTML实体 */
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** 从HTML中提取详情：标题、描述、配图 */
function parseDetail(html) {
  const getMeta = (key, attr = "name") => {
    const re = new RegExp(`<meta[^>]*${attr}=["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0] || "";
    return (tag.match(/content=["']([\s\S]*?)["']/i)?.[1] || "").trim();
  };
  const title =
    getMeta("og:title", "property") ||
    getMeta("twitter:title") ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const description =
    getMeta("description") ||
    getMeta("og:description", "property") ||
    getMeta("twitter:description");
  const image = getMeta("og:image", "property") || getMeta("twitter:image");
  return {
    title: decodeEntities(title),
    description: decodeEntities(description),
    image,
  };
}

/** 微博热搜 */
async function fetchWeibo() {
  const data = await fetchJson("https://weibo.com/ajax/side/hotSearch", {
    Referer: "https://weibo.com/",
    "X-Requested-With": "XMLHttpRequest",
  });
  return (data.data?.realtime || [])
    .filter((item) => !item.is_ad)
    .slice(0, 50)
    .map((item, i) => ({
      rank: i + 1,
      title: item.word,
      hot: item.raw_hot || item.num || 0,
      url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word)}`,
      label: item.label_name || "",
    }));
}

/** 知乎热榜（需要Cookie，通过环境变量 ZHIHU_COOKIE 提供） */
async function fetchZhihu() {
  const cookie = process.env.ZHIHU_COOKIE;
  if (!cookie) throw new Error("ZHIHU_COOKIE not configured");
  const data = await fetchJson(
    "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50",
    { Referer: "https://www.zhihu.com/hot", Cookie: cookie }
  );
  return (data.data || []).slice(0, 50).map((item, i) => ({
    rank: i + 1,
    title: item.target?.title || "",
    hot: item.detail_text || "",
    url: (item.target?.url || "").replace(
      "api.zhihu.com/questions",
      "www.zhihu.com/question"
    ),
    label: "",
  }));
}

/** 百度热搜 */
async function fetchBaidu() {
  const data = await fetchJson(
    "https://top.baidu.com/api/board?platform=wise&tab=realtime",
    { Referer: "https://top.baidu.com/board?tab=realtime" }
  );
  // 结构: data.cards[0].content[0].content 为榜单数组
  const list =
    data.data?.cards?.[0]?.content?.[0]?.content ||
    data.data?.cards?.[0]?.content ||
    [];
  return list.slice(0, 50).map((item, i) => ({
    rank: i + 1,
    title: item.word || item.query || "",
    hot: item.hotScore || "",
    url: item.url || "",
    label: item.isTop ? "置顶" : item.hotTag === "1" ? "热" : "",
  }));
}

/** 哔哩哔哩热搜 */
async function fetchBilibili() {
  const data = await fetchJson(
    "https://api.bilibili.com/x/web-interface/search/square?limit=50",
    { Referer: "https://www.bilibili.com" }
  );
  return (data.data?.trending?.list || []).slice(0, 50).map((item, i) => ({
    rank: i + 1,
    title: item.keyword || item.show_name || "",
    hot: "",
    url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(
      item.keyword || ""
    )}`,
    label: "",
  }));
}

/** 抖音热榜 */
async function fetchDouyin() {
  const data = await fetchJson(
    "https://www.douyin.com/aweme/v1/web/hot/search/list/",
    { Referer: "https://www.douyin.com/hot" }
  );
  return (data.data?.word_list || []).slice(0, 50).map((item, i) => ({
    rank: i + 1,
    title: item.word || "",
    hot: item.hot_value || 0,
    url: `https://www.douyin.com/search/${encodeURIComponent(item.word || "")}`,
    label: item.label === 1 ? "热" : item.label === 3 ? "新" : "",
  }));
}

/** 今日头条热榜 */
async function fetchToutiao() {
  const data = await fetchJson(
    "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
    { Referer: "https://www.toutiao.com/" }
  );
  return (data.data || []).slice(0, 50).map((item, i) => ({
    rank: i + 1,
    title: item.Title || "",
    hot: item.HotValue || "",
    url: item.Url || "",
    label: item.Label || "",
  }));
}

const PLATFORMS = {
  weibo: fetchWeibo,
  zhihu: fetchZhihu,
  baidu: fetchBaidu,
  bilibili: fetchBilibili,
  douyin: fetchDouyin,
  toutiao: fetchToutiao,
};

/** 删除超过30天的归档目录 */
function cleanOldArchives() {
  const cutoff = new Date(Date.now() + 8 * 60 * 60 * 1000);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  if (!fs.existsSync("archives")) return;
  for (const name of fs.readdirSync("archives")) {
    // 只处理 YYYY-MM-DD 格式的目录
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
    if (name < cutoffStr) {
      fs.rmSync(path.join("archives", name), { recursive: true, force: true });
      console.log(`Deleted old archive -> archives/${name}`);
    }
  }
}

/** 重建 archives/index.json，方便外部项目查询可用数据 */
function rebuildIndex() {
  const index = { updated: Date.now(), dates: {} };
  if (!fs.existsSync("archives")) return;

  const dates = fs
    .readdirSync("archives")
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();

  for (const date of dates) {
    const files = fs
      .readdirSync(path.join("archives", date))
      .filter((f) => /^\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    if (files.length > 0) index.dates[date] = files;
  }

  fs.writeFileSync(
    path.join("archives", "index.json"),
    JSON.stringify(index, null, 2),
    "utf-8"
  );
  console.log(`Index rebuilt: ${dates.length} days`);
}

async function main() {
  const now = new Date();
  // 使用北京时间归档
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const dateStr = beijing.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = beijing.toISOString().slice(11, 16).replace(":", "-"); // HH-mm

  const result = {
    date: dateStr,
    time: timeStr,
    timestamp: now.getTime(),
    platforms: {},
  };

  const entries = Object.entries(PLATFORMS);
  const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));

  let failCount = 0;
  settled.forEach((outcome, i) => {
    const name = entries[i][0];
    if (outcome.status === "fulfilled") {
      result.platforms[name] = { success: true, list: outcome.value };
      console.log(`[OK] ${name}: ${outcome.value.length} items`);
    } else {
      failCount++;
      result.platforms[name] = {
        success: false,
        error: String(outcome.reason),
        list: [],
      };
      console.error(`[FAIL] ${name}: ${outcome.reason}`);
    }
  });

  // 为每条热搜生成稳定ID，并抓取详情页（标题/描述/配图）
  const items = [];
  for (const [name, p] of Object.entries(result.platforms)) {
    if (!p.success) continue;
    for (const item of p.list) {
      item.id = makeId(name, item.title);
      items.push(item);
    }
  }

  let detailOk = 0;
  await mapLimit(items, 8, async (item) => {
    if (!item.url) {
      item.detail = null;
      return;
    }
    try {
      item.detail = parseDetail(await fetchHtml(item.url));
      detailOk++;
    } catch {
      item.detail = null; // 详情失败不影响榜单本身
    }
  });
  console.log(`Details: ${detailOk}/${items.length}`);

  const dir = path.join("archives", dateStr);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${timeStr}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Saved -> ${file}`);

  cleanOldArchives();
  rebuildIndex();

  // 所有平台都失败才退出非0（数据本身仍保留），避免单平台故障中断
  if (failCount === entries.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
