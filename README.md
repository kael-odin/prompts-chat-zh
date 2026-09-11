# 提示词中文站

[prompts.chat](https://prompts.chat) 的**非官方简体中文镜像**。

上游站点的界面支持多语言，但它收录的提示词本身几乎全是英文的——翻译的是外壳，不是内容。
这个项目把上游公开的提示词数据抓下来、译成中文，以纯静态站点呈现，托管在 GitHub Pages 上。

**在线地址**：https://kael-odin.github.io/prompts-chat-zh/

---

## 特性

- **中英对照**：每条提示词都保留英文原文，详情页可在「中文／原文／对照」之间切换，两版都能一键复制
- **代码与占位符保护**：` ``` ` 代码块整块跳过不译，`{{变量}}`、`${变量}` 这类占位符先替换成哨兵、译完还原
- **译后结构校验**：逐条比对原文与译文的代码围栏、标题、换行、占位符与花括号，不合格自动打回重译
- **增量翻译**：以内容指纹为键做缓存，上游改一条只重翻那一条，同一条重复投稿只翻一次
- **中文全文搜索**：构建期生成 Pagefind 索引，中英文均可检索
- **零服务端**：纯静态，没有数据库、没有 API 服务器，托管成本为零

### 译后校验查什么

模型输出不可靠，所以译文一律过一遍机器可判定的结构检查，不通过就打回重译（最多重试一次，
仍不通过则存下译文并在页面上标出「待校对」）：

| 检查项 | 为什么 |
| --- | --- |
| 代码围栏数量一致 | 防止模型吞掉或凭空添加代码块 |
| 标题数量一致 | 防止标题被降级成普通段落 |
| 换行数不塌缩 | 防止列表项和标题被揉进同一行——这是最隐蔽也最常见的一种损坏 |
| 占位符一个不少 | `{{var}}`、`${var}` 这类变量丢了，提示词就废了 |
| 花括号配对 | 只在原文配对而译文不配对时才判不合格（有些原文本身就不配对） |
| 译文长度合理 | 防止模型截断 |

## 它是怎么工作的

```
GitHub Actions（每周定时 / 手动触发）
  │
  ├─ 1. check-upstream  上游 API 契约检查，结构变了立刻报警
  ├─ 2. sync             拉取全量提示词 → data/upstream.json
  ├─ 3. translate        与 data/zh.json 缓存比对，只翻新增/变更的条目
  │                        └─ 分段保护 → 调用模型 → 结构校验 → 写缓存
  ├─ 4. 提交缓存         把 data/zh.json 提交回仓库
  └─ 5. build            Astro 静态构建 + Pagefind 索引 → 部署到 Pages
```

### 数据流

| 文件 | 是否入库 | 说明 |
| --- | --- | --- |
| `data/zh.json` | ✅ 提交 | 译文缓存，以内容指纹为键。**这是仓库里最值钱的产物** |
| `data/upstream.json` | ❌ 忽略 | 上游英文快照，每次同步重新生成 |
| `data/site.json` | ❌ 忽略 | 构建期合并产物，供 Astro 读取 |
| `data/review.md` | ❌ 忽略 | 中英对照抽查报告，人工验收用 |

译文缓存入库、英文快照不入库，是刻意的选择：缓存是**不可再生**的（重翻要花钱、结果还不稳定），
而英文快照随时能从上游重新拉取。

## 本地开发

```bash
npm install

# 1. 拉取上游数据
npm run sync

# 2. 复制并填写密钥
cp .env.example .env

# 3. 先翻 20 条看看质量
npm run translate -- --limit=20

# 4. 生成抽查报告，人工核对译文
npm run review

# 5. 合并数据
npm run data

# 6. 起开发服务器
npm run dev
```

### 构建与预览

```bash
npm run build     # 合并数据 + Astro 构建 + Pagefind 索引
npm run preview   # 预览 dist/
```

> 注意：`npm run dev` 不走 Pagefind 索引，搜索框在开发模式下不可用（会静默跳过）。要测搜索请用 `npm run build && npm run preview`。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `npm run check` | 上游 API 契约检查 |
| `npm run sync` | 拉取全量提示词快照 |
| `npm run translate` | 增量翻译 |
| `npm run review` | 生成中英对照抽查报告 |
| `npm run data` | 合并上游与译文 |
| `npm run build` | 构建静态站点 |
| `npm run pipeline` | sync + translate + data |

### translate 的常用参数

```bash
npm run translate -- --limit=50              # 只翻 50 条
npm run translate -- --only=linux-terminal   # 只翻指定 slug
npm run translate -- --force                 # 忽略缓存全量重翻
npm run translate -- --force --min-chars=3000  # 只重翻长文（正文超过 3000 字符的）
npm run translate -- --stats                 # 只看缓存覆盖率，不翻译
npm run translate -- --dry-run               # 只列出待翻条目
npm run translate -- --prune                 # 清理失效缓存（内容已变更的旧条目）
npm run translate -- --concurrency=4         # 调并发（默认 6）
```

翻译过程每 25 条落盘一次，中断后重跑会自动接着来——已经翻过的走缓存跳过。

`--prune` 建议偶尔跑一次：缓存以内容指纹为键，上游改了内容，旧指纹就成了永远不会再命中的孤儿，
留着只会让 `data/zh.json` 越来越大。

## 部署

推送到 `main` 会自动构建并部署到 GitHub Pages。仓库需要配置：

1. **Settings → Pages → Source** 选择 **GitHub Actions**
2. **Settings → Secrets and variables → Actions** 添加：
   - `TRANSLATE_API_KEY`：OpenAI 兼容端点的密钥
   - `TRANSLATE_BASE_URL`：端点地址（如 `https://example.com/v1`）

定时任务默认每周一跑一次（见 `.github/workflows/deploy.yml` 里的 `cron`），
也可以在 Actions 页面手动触发。

### 换成自定义域名

构建时传两个环境变量即可，`astro.config.mjs` 会读取：

```
SITE_URL=https://your-domain.com
BASE_PATH=/
```

## 模型选择

默认用 `deepseek-chat`。**批量翻译请务必用非推理模型**——实测同一句翻译：

| 模型 | 输出 token | 其中推理 token | 耗时 |
| --- | --- | --- | --- |
| `deepseek-chat` | 5 | 0 | 1.1s |
| `deepseek-flash` | 104 | 96 | 1.7s |
| `deepseek-v4-flash` | 121 | 113 | 2.0s |
| `deepseek-v4-pro` | 62 | 54 | 2.4s |

翻译一个 8 个字的句子，推理模型会烧掉近百个推理 token。全量两千多条按这个跑，
会凭空多出上百万 token，速度还慢一倍。

## 数据来源与许可

- **提示词数据**来自 [prompts.chat](https://prompts.chat) 的公开接口，依
  [CC0 1.0 通用](https://creativecommons.org/publicdomain/zero/1.0/) 公共领域 dedication 发布。
  可复制、可修改、可分发、可商用，无需署名。详见 [LICENSE-CC0](LICENSE-CC0)。
- **本仓库的站点代码**以 [MIT](LICENSE) 许可开源。

本站与 prompts.chat 及其作者**没有任何隶属关系**，是非官方镜像。

### 关于示例图片

上游的图像／视频类提示词带有示例图，托管在 DigitalOcean Spaces。
本仓库**不镜像这些图片**，页面上只保留链回原站的链接——图片的版权状态与 CC0 覆盖的文字数据
不是一回事，直接盗链也不合适。

## 关于译文质量

译文由大模型批量生成，**不是人工翻译**。提示词对措辞格外敏感，一个副词的差别就可能改变模型行为，
所以：

- 每一条都保留英文原文，详情页随时可切换对照
- 代码块和占位符有机械化的保护与校验，但这管不住语义层面的偏差
- 结构校验不通过的条目会在页面上标出「待校对」
- 图像／视频／音频生成类提示词的关键词往往本身就是「咒语」，翻译后结果可能明显不同，**建议直接用英文原文**

发现译得不对，欢迎到 [Issues](https://github.com/kael-odin/prompts-chat-zh/issues) 反馈，附上条目链接即可。

## 投稿

本站是**只读镜像**，不接受投稿。请前往 [prompts.chat](https://prompts.chat) 提交，
你在那边发布的提示词会在下一次同步时自动出现在这里。

## 致谢

- [prompts.chat](https://prompts.chat) / [f/prompts.chat](https://github.com/f/prompts.chat) —— 全部提示词内容的来源
- [Astro](https://astro.build) —— 静态站点框架
- [Pagefind](https://pagefind.app) —— 静态全文搜索
