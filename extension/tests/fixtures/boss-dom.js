// BOSS 直聘页面结构固定样本（采集回归用）
//
// 用途：把"页面长什么样"和"我们解析出什么"分开。站点改版时先更新这里的样本，
// 再看 boss-dom-fixture.test.js 里哪条断言挂了 —— 不必去真实站点赌运气。
//
// 来源：样本按 BOSS 直聘网页版实际发布的卡片/详情页结构转录（2024 版和更早的
// 经典版各一套），去掉了图片、埋点属性和会话 token 之类的噪音。**不是**浏览器
// 里现抓的完整 outerHTML。
//
// 刷新方法（约 1 分钟）：登录后打开一个职位详情页 → DevTools 里选中
// `div.job-primary` 或卡片 `li` → 右键 Copy → Copy outerHTML → 覆盖下面对应的
// 样本（记得把 lid / securityId 换掉，避免把会话参数提交进仓库）。
//
// 稳定约定：样本里的职位名、公司名、薪资都是任意构造的业务内容，只用于断言解析
// 结果，不要写进界面文案。

// ── 列表卡片 ─────────────────────────────────────────────────────

// 搜索页卡片（2024 版结构）。经验/学历/福利混在同一个 tag-list 里，
// 公司规模与融资阶段在 company-tag-list 里，链接带 lid 与 securityId 会话参数。
export const listingCardCurrent = `
<li class="job-card-wrapper">
  <div class="job-card-body clearfix">
    <a class="job-card-left" href="/job_detail/8f3c1e2b9a4d5c6e1f0a2b3c4d5e6f7081.html?lid=7ahpEMXxaQZ&securityId=kR9mQ2vT7pLxW4" ka="search_list_j_1" target="_blank"></a>
    <div class="job-card-right">
      <h3 class="job-name">
        <a href="/job_detail/8f3c1e2b9a4d5c6e1f0a2b3c4d5e6f7081.html?lid=7ahpEMXxaQZ&securityId=kR9mQ2vT7pLxW4" ka="search_list_j_1" target="_blank">资深后端开发工程师</a>
      </h3>
      <span class="job-area-wrapper"><span class="job-area">深圳·南山区</span></span>
      <ul class="tag-list">
        <li>5-10年</li>
        <li>本科</li>
        <li>五险一金</li>
        <li>弹性工作</li>
      </ul>
      <span class="salary">35-60K·15薪</span>
    </div>
  </div>
  <div class="job-card-footer clearfix">
    <div class="company-info">
      <h3 class="company-name"><a href="/gongsi/9d1b2c3e4f5a6b7c.html" ka="search_list_c_1" target="_blank">某某科技有限公司</a></h3>
      <ul class="company-tag-list">
        <li>已上市</li>
        <li>1000-9999人</li>
      </ul>
    </div>
  </div>
</li>
`;

// 更早的经典版卡片：薪资在 .job-info .salary，标签是并列的 span.tag-list，
// 公司名是 a 标签，福利标签也在同一个 tag-list 里。
export const listingCardClassic = `
<li class="job-card-wrapper clearfix">
  <div class="job-card-left">
    <div class="job-title">
      <span class="job-name">数据分析师</span>
      <span class="job-area-wrapper"><span class="job-area">杭州·西湖区</span></span>
    </div>
    <div class="job-info">
      <span class="tag-list">1-3年</span>
      <span class="tag-list">大专</span>
      <span class="tag-list">双休</span>
      <span class="job-info-section">
        <span class="salary">12-18K</span>
      </span>
    </div>
    <div class="job-card-footer">
      <div class="company-info">
        <p class="company-name"><a href="/gongsi/1122334455.html">某某信息技术有限公司</a></p>
        <div class="company-tag-list">不需要融资</div>
      </div>
    </div>
  </div>
  <a class="job-card-left" href="/job_detail/2a7b4c9d1e3f5a6b7c8d9e0f1a2b3c4d.html?lid=7ahpEMXxaQZ&sessionId=1" ka="search_list_j_2" target="_blank"></a>
</li>
`;

// 面议岗位：没有薪资区间，解析结果里不应出现 salary_min / salary_max。
export const listingCardNegotiable = `
<li class="job-card-wrapper">
  <div class="job-card-body clearfix">
    <h3 class="job-name"><a href="/job_detail/aaaa1111bbbb2222cccc3333dddd4444.html">技术合伙人</a></h3>
    <span class="job-area-wrapper"><span class="job-area">北京·海淀区</span></span>
    <ul class="tag-list">
      <li>10年以上</li>
      <li>硕士</li>
    </ul>
    <span class="salary">面议</span>
  </div>
  <div class="job-card-footer clearfix">
    <div class="company-info">
      <h3 class="company-name"><a href="/gongsi/aabbccddeeff0011.html">某某智能科技</a></h3>
      <ul class="company-tag-list">
        <li>B轮</li>
        <li>100-499人</li>
      </ul>
    </div>
  </div>
</li>
`;

// ── 详情页 ───────────────────────────────────────────────────────

// 经典详情页：标题/地点/薪资在 .job-banner 里，公司信息在 .job-sider。
export const detailPageClassic = `
<div class="job-banner">
  <div class="name">Python开发工程师</div>
  <div class="job-place">北京·朝阳区 ·3-5年 ·本科</div>
  <div class="salary">25-40K·13薪</div>
</div>
<div class="job-detail">
  <div class="job-sec">
    <div class="job-sec-title">职位描述</div>
    <div class="job-sec-text">职位描述：负责后端服务开发与维护，参与系统设计，保障线上服务稳定性，并推动工程效率改进。</div>
  </div>
</div>
<div class="job-sider">
  <div class="company">
    <div class="company-info">
      <div class="name">某某网络科技有限公司</div>
    </div>
  </div>
</div>
`;

// 2024 版详情页：标题与薪资同处 .info-primary .name，城市/经验/学历挤在一行 p 里，
// 公司规模与融资阶段在 .company-info-other，福利在 .job-keyword-list。
export const detailPageCurrent = `
<div class="job-primary detail-box">
  <div class="info-primary">
    <div class="name"><h1>资深后端开发工程师</h1><span class="salary">35-60K·15薪</span></div>
    <p>深圳·南山区 ·5-10年 ·本科</p>
    <ul class="job-tags"><li>五险一金</li><li>弹性工作</li></ul>
  </div>
  <div class="info-company">
    <div class="company-info">
      <a class="company-logo" href="/gongsi/9d1b2c3e4f5a6b7c.html"><img src="logo.png" alt=""></a>
      <h3 class="name"><a href="/gongsi/9d1b2c3e4f5a6b7c.html" ka="job-detail-company_custompage">某某科技有限公司</a></h3>
    </div>
    <div class="company-info-other">
      <span class="company-info-item">已上市</span>
      <span>1000-9999人</span>
    </div>
  </div>
</div>
<div class="job-detail-section">
  <h2 class="job-sec-title">职位描述</h2>
  <div class="job-sec-text">
    岗位职责：<br>
    1. 负责核心交易链路的架构设计与开发，保障高并发场景下的服务稳定性；<br>
    2. 主导性能优化与容量评估，推动工程效率与代码质量持续改进。
  </div>
</div>
<div class="job-detail-section">
  <h2 class="job-sec-title">福利待遇</h2>
  <ul class="job-keyword-list"><li>五险一金</li><li>补充医疗保险</li><li>年终奖</li></ul>
</div>
`;

// 大改版样本：class 名全部换掉，只剩可依赖的语义结构（h1 标题、含「职位描述」的
// 小标题 + 正文、指向 /gongsi/ 的公司链接、一行带 · 的「城市·经验·学历」）。
// 这一套用来验证兜底链路：任何一个精确选择器失效时都要还能采到东西。
export const detailPageRenamedClasses = `
<header class="x1"><h1 class="x2">资深后端开发工程师</h1></header>
<div class="x3">
  <div class="x4">深圳·南山区 ·5-10年 ·本科</div>
  <a class="x5" href="/gongsi/9d1b2c3e4f5a6b7c.html">某某科技有限公司</a>
</div>
<section class="x6">
  <h2 class="x7">职位描述</h2>
  <div class="x8">
    岗位职责：负责核心交易链路的架构设计与开发，保障高并发场景下的服务稳定性；
    主导性能优化与容量评估，推动工程效率与代码质量持续改进，并参与技术方案评审。
  </div>
</section>
`;
