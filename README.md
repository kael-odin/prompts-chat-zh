<div align="center">

<img src="public/og.png" alt="提示词中文站 —— 2200 多条公开提示词，全部说中文" width="820" />

# 提示词中文站

**prompts.chat 的非官方简体中文镜像**

2205 条公开提示词，全部译成中文 · 中英对照 · 全文搜索 · 一键复制

[![部署状态](https://github.com/kael-odin/prompts-chat-zh/actions/workflows/deploy.yml/badge.svg)](https://github.com/kael-odin/prompts-chat-zh/actions/workflows/deploy.yml)
[![在线站点](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E7%AB%99%E7%82%B9-kael--odin.github.io-b4532a)](https://kael-odin.github.io/prompts-chat-zh/)
[![许可: MIT](https://img.shields.io/badge/%E4%BB%A3%E7%A0%81-MIT-blue)](LICENSE)
[![数据许可: CC0](https://img.shields.io/badge/%E6%95%B0%E6%8D%AE-CC0%201.0-lightgrey)](LICENSE-CC0)
[![Astro](https://img.shields.io/badge/Astro-5-ff5d01?logo=astro&logoColor=white)](https://astro.build)
[![GitHub Pages](https://img.shields.io/badge/%E6%89%98%E7%AE%A1-GitHub%20Pages-222?logo=github)](https://kael-odin.github.io/prompts-chat-zh/)

[在线访问](https://kael-odin.github.io/prompts-chat-zh/) · [关于本站](https://kael-odin.github.io/prompts-chat-zh/about/) · [全部提示词](https://kael-odin.github.io/prompts-chat-zh/prompts/)

</div>

---

## 这是什么

[prompts.chat](https://prompts.chat)（前身是 Awesome ChatGPT Prompts）是目前最大的公开提示词库之一，两千多条提示词，CC0 公共领域授权。

但它的**界面支持多语言，内容不支持**——翻译的是外壳，不是提示词本身。中文用户要么硬啃英文，要么放弃。

这个项目把上游的公开数据抓下来、译成中文，以纯静态站点重新呈现。

**它不是什么**：不是上游的官方项目，不是投稿平台，也没有账号、点赞、评论这些社交功能。它是一座只读的中文提示词库。

## 特性

- **中英对照** —— 每条都保留英文原文，详情页可在「中文／原文／对照」三档间切换，两版都能一键复制
- **代码与占位符保护** —— ` ``` ` 代码块整块跳过不译；`{{变量}}`、`${变量}`、`[PLACEHOLDER]` 这类标记先换成哨兵，译完原样还原，不指望模型「自觉」
- **译后结构校验** —— 逐条比对原文与译文的代码围栏、标题、结构化行、占位符、花括号，不合格自动打回重译
- **增量翻译** —— 以内容指纹为键做缓存：上游改一条只重翻那一条，同一条重复投稿只翻一次
- **中文全文搜索** —— 构建期生成 [Pagefind](https://pagefind.app) 索引，中英文关键词都能搜，搜索结果可分享（`?q=`）
- **零服务端** —— 没有数据库、没有 API 服务器、没有运行时依赖，托管成本为零
- **可复现** —— 数据来自公开接口，翻译缓存随仓库一起版本化，任何人在本地都能重跑出同样的站点

## 它是怎么工作的

```
GitHub Actions（每周一定时 / 手动触发）
  │
  ├─ 1. check     上游 API 契约检查 —— 结构变了立刻报警，而不是默默同步回一堆空数据
  ├─ 2. sync      拉取全量提示词 → data/upstream.json
  ├─ 3. translate 与 data/zh.json 缓存比对，只翻新增/变更的条目
  │                 └─ 分段保护 → 调模型 → 结构校验 → 写缓存（每 25 条落盘）
  ├─ 4. commit    把 data/zh.json 提交回仓库
  └─ 5. build     Astro 静态构建 + Pagefind 索引 → 部署到 GitHub Pages
```

### 数据流

| 文件 | 是否入库 | 说明 |
| --- | --- | --- |
| `data/zh.json` | ✅ 提交 | 译文缓存，以内容指纹为键。**这是仓库里最值钱的产物** |
| `data/upstream.json` | ❌ 忽略 | 上游英文快照，每次同步重新生成 |
| `data/site.json` | ❌ 忽略 | 构建期合并产物，供 Astro 读取 |
| `docs/upstream-openapi.yaml` | ✅ 提交 | 上游 API 的 OpenAPI 描述，可直接导入 Apifox/Postman |

译文缓存入库、英文快照不入库是刻意的：缓存**不可再生**（重翻要花钱、结果还不稳定），而英文快照随时能从上游重新拉取。

### 译后校验查什么

模型输出不可靠，所以译文一律过一遍机器可判定的结构检查。不通过就打回重译（最多重试一次），仍不通过则存下译文并在页面上标注「待校对」：

| 检查项 | 防的是什么 |
| --- | --- |
| 代码围栏数量一致 | 模型吞掉或凭空添加代码块 |
| 标题数量一致 | 标题被降级成普通段落 |
| 结构化行数不减少 | 列表项、标题、表格行被揉进同一行——最隐蔽也最常见的一种损坏 |
| 占位符一个不少 | `{{var}}`、`${var}` 丢了，提示词就废了 |
| 花括号配对 | 只在原文配对而译文不配对时才判不合格（有些原文本身就不配对） |
| 译文长度合理 | 模型截断 |

## 本地开发

```bash
npm install

cp .env.example .env        # 填入翻译端点的 key

npm run sync                # 拉取上游数据
npm run translate -- --limit=20   # 先翻 20 条看看质量
npm run review              # 生成中英对照抽查报告，人工核对
npm run dev                 # 起开发服务器
```

> `npm run dev` 不走 Pagefind 索引，**开发模式下搜索框不可用**（会静默跳过）。要测搜索请用 `npm run build && npm run preview`。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `npm run check` | 上游 API 契约检查 |
| `npm run check:media` | 图片链路健康检查（代理 + 各源站） |
| `npm run sync` | 拉取全量提示词快照 |
| `npm run translate` | 增量翻译 |
| `npm run review` | 生成中英对照抽查报告 |
| `npm run data` | 合并上游与译文 |
| `npm run build` | 构建静态站点（含 sitemap 与搜索索引） |
| `npm run preview` | 预览 `dist/` |
| `npm run pipeline` | `sync` + `translate` + `data` |

### translate 的常用参数

```bash
npm run translate -- --limit=50                 # 只翻 50 条
npm run translate -- --only=linux-terminal      # 只翻指定 slug
npm run translate -- --force                    # 忽略缓存全量重翻
npm run translate -- --force --min-chars=3000   # 只重翻长文
npm run translate -- --stats                    # 只看缓存覆盖率，不翻译
npm run translate -- --dry-run                  # 只列出待翻条目
npm run translate -- --prune                    # 清理失效缓存
npm run translate -- --recheck                  # 校验规则变了，重判整个缓存（不调模型）
npm run translate -- --concurrency=4            # 调并发（默认 6）
```

翻译过程每 25 条落盘一次，中断后重跑会自动接着来——已翻过的走缓存跳过。

## 部署

推送到 `main` 会自动构建并部署到 GitHub Pages。仓库需要配置：

1. **Settings → Pages → Source** 选 **GitHub Actions**
2. **Settings → Secrets and variables → Actions → Repository secrets** 添加：
   - `TRANSLATE_API_KEY` —— 翻译端点的密钥
   - `TRANSLATE_BASE_URL` —— 端点地址（如 `https://example.com/v1`）

定时同步分两条路：

- **GitHub Actions**（每周一 UTC 03:23，见 `deploy.yml` 的 `cron`，也可手动触发）：拉上游 → 尝试翻译 → 构建部署。但翻译端点若屏蔽数据中心 IP（实测 `xc.lifesecretary.com:8000` 屏蔽了海外机房），这一步会整体 `fetch failed`。它设了 `continue-on-error`，站点照常部署，新提示词回落英文原文；「翻译覆盖率告警」步会在运行页顶 `::warning::`，绿勾不再是假成功。
- **本地计划任务**（Windows 任务 `prompts-chat-zh-weekly-sync`，每周一 20:33 跑 `scripts/weekly-sync.cmd`）：在本机能直连端点的机器上拉上游、增量翻译（缓存按内容指纹去重，只翻新增/变更）、提交推送 `data/` 缓存——push 会触发 Actions 重新构建部署。要求仓库根目录 `.env` 里填好 `TRANSLATE_API_KEY`。日志在 `%TEMP%\prompts-chat-zh-sync.log`。

模型名放在仓库 **Variables** 的 `TRANSLATE_MODEL`（不在 Secrets 页签），改模型不用动代码。

**没有配 key 也不会挂**：翻译步骤设了 `continue-on-error`，站点照常部署，只是新提示词会以英文原文呈现并标注「未翻译」。

### 换成自定义域名

构建时传两个环境变量即可，`astro.config.mjs` 会读取：

```
SITE_URL=https://your-domain.com
BASE_PATH=/
```

## 模型选择

当前用 `glm-5.3-flash`（推理模型，flash 档，单价低）。管线已适配推理模型：客户端会自动剥离内联的 `<think>` 思考标签，各调用点也给输出留足了 token 预算，思考挤不坏译文。

之所以弃用曾经的 `deepseek-chat`：它是中转站上唯一的非推理模型，已下架。当年坚持非推理模型的理由是同一句翻译的实测消耗：

| 模型 | 输出 token | 其中推理 token | 耗时 |
| --- | --- | --- | --- |
| `deepseek-chat` | 5 | 0 | 1.1s |
| `deepseek-flash` | 104 | 96 | 1.7s |
| `deepseek-v4-flash` | 121 | 113 | 2.0s |
| `deepseek-v4-pro` | 62 | 54 | 2.4s |

推理模型每句要多烧几十上百个推理 token，但 flash 档单价足够低，增量同步每周只有几十条，这点开销可以接受。若端点再提供非推理模型，批量翻译仍应优先选它。

全量约消耗 380 万 token，之后每周增量通常只有几条。

> key 分组要包含所选模型，否则报 `model_not_found`。模型名在仓库 Variables 的 `TRANSLATE_MODEL` 里改，不用动代码。

## 数据来源与许可

- **提示词数据**来自 [prompts.chat](https://prompts.chat) 的公开接口，依
  [CC0 1.0 通用](https://creativecommons.org/publicdomain/zero/1.0/) 公共领域 dedication 发布。
  可复制、可修改、可分发、可商用，**无需署名**。详见 [LICENSE-CC0](LICENSE-CC0)。
- **本仓库的站点代码**以 [MIT](LICENSE) 许可开源。
- 本站与 prompts.chat 及其作者**没有任何隶属关系**，是非官方镜像。

### 关于示例图片和视频

约四百条提示词带有示例媒材，本站的处理方式是**引用而非复制**——不镜像任何文件。

原因有二。一是这些图**并不在上游自己的服务器上**。实测链接散落在五个不同域名下：一部分指向上游的对象存储，
其余是 `wiro.ai`、`fal.media` 这类生成服务的 CDN，甚至还有直接指向 `pbs.twimg.com`（Twitter）和
`i.ibb.co`（图床）的——用户生成后粘的链接，上游也只是存了个 URL，找上游要授权也覆盖不到。
二是**体积**：图片单张 288 KB – 1.3 MB，视频 400–900 KB，音频单个 16 MB，
全打包进仓库要几百兆，还会永久留在 git 历史里。

具体做法：

| 类型 | 处理 |
| --- | --- |
| 图片（409 条） | 经 [weserv.nl](https://images.weserv.nl/) 中转压成 WebP：列表页 ~17 KB、详情页 ~120 KB，懒加载，点图看原图 |
| 视频（42 条） | `<video preload="metadata">`，只取元数据出首帧，点了才播 |
| 音频（4 条） | `<audio preload="none">`，不点播放一个字节都不下载 |

**文件始终由原站提供，本仓库一个字节都不落盘**，源站压力由代理的 CDN 缓存承担。
加载失败会自动退化成一条「查看原图」链接，不会出现碎图。

### 图片链路的健康监控

图全走第三方代理，这一环挂了所有图就都废了。所以有个每日探测任务
（[`media-health.yml`](.github/workflows/media-health.yml)），按域名分层取样十几张，
把两类性质完全不同的故障分开报：

| 现象 | 判定 | 动作 |
| --- | --- | --- |
| 代理网络不通／返回 5xx | **故障** | 开 issue 告警 |
| 代理正常、某张图返回 4xx | 正常损耗（用户删了图、临时链接过期） | 只统计，不打扰 |
| 链路恢复 | — | 自动关掉之前的告警 issue |

这个区分是刻意的：源站零星失效是常态，如果也报警，很快就不会有人再看告警了。
本地想手动查一遍就 `npm run check:media`。

## 关于译文质量

译文由大模型批量生成，**不是人工翻译**。提示词对措辞格外敏感，一个副词的差别就可能改变模型行为，所以：

- 每一条都保留英文原文，详情页随时可切换对照
- 代码块和占位符有机械化的保护与校验，但这管不住语义层面的偏差
- 结构校验不通过的条目会在页面上标出「待校对」（当前 2205 条中有 9 条）
- **图像／视频／音频生成类提示词**的关键词往往本身就是「咒语」，翻译后出图结果可能明显不同——这类页面会提示你优先使用英文原文

发现译得不对，点详情页的「译文有问题？」链接即可，[Issue 表单](.github/ISSUE_TEMPLATE/translation-error.yml) 会自动填好页面地址。

## 投稿

本站是**只读镜像**，不接受投稿。请前往 [prompts.chat](https://prompts.chat) 提交，
你在那边发布的提示词会在下一次同步时自动出现在这里。

## 致谢

- [prompts.chat](https://prompts.chat) / [f/prompts.chat](https://github.com/f/prompts.chat) —— 全部提示词内容的来源
- [Astro](https://astro.build) —— 静态站点框架
- [Pagefind](https://pagefind.app) —— 静态全文搜索
