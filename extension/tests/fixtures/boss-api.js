// BOSS 直聘接口响应固定样本（C1 页面上下文采集回归用）
//
// 来源：按 BOSS 直聘网页版自身接口的公开形态转录（列表 joblist.json 与职位详情
// JSON），字段名取社区抓包记录里反复出现的那些：
//   zpData.jobList[] → jobName / salaryDesc / brandName / cityName /
//                      jobExperience / jobDegree / skills / welfareList / encryptJobId
//   zpData.jobInfo   → jobName / salaryDesc / jobLabels / jobDescription /
//                      experienceName / degreeName / brandName / brandScaleName /
//                      brandStageName / cityName / areaDistrict / encryptJobId
// 层级（zpData.jobInfo vs zpData.data.job）刻意做出两种，用来验证不依赖固定路径。
//
// 业务内容（职位名、公司名、薪资、JD）都是构造的假值，只用于断言解析结果。
//
// 刷新方法：登录后打开职位详情页 → DevTools Network 里找 /wapi/ 开头的 JSON 请求
// → Copy response → 覆盖下面样本（记得换掉真实 jobId/securityId，不要提交会话参数）。

export const BOSS_PAGE_JOB_ID = '8f3c1e2b9a4d5c6e1f0a2b3c4d5e6f7081';
export const BOSS_PAGE_SECURITY_ID = 'kR9mQ2vT7pLxW4';

// 职位详情接口：标题与薪资、JD 正文（带 HTML）、福利、公司规模与融资阶段都在这里
export const detailResponse = {
  code: 0,
  message: 'Success',
  zpData: {
    jobInfo: {
      encryptJobId: BOSS_PAGE_JOB_ID,
      securityId: BOSS_PAGE_SECURITY_ID,
      jobName: '资深后端开发工程师',
      salaryDesc: '35-60K·15薪',
      experienceName: '5-10年',
      degreeName: '本科',
      cityName: '深圳',
      areaDistrict: '南山区',
      businessDistrict: '科技园',
      brandName: '某某科技有限公司',
      brandScaleName: '1000-9999人',
      brandStageName: '已上市',
      jobLabels: ['五险一金'],
      welfareList: ['五险一金', '补充医疗保险', '年终奖'],
      skills: ['Java', 'Spring Boot'],
      jobDescription: '岗位职责：<br>1. 负责核心交易链路的架构设计与开发；<br>2. 主导性能优化与容量评估。',
    },
  },
};

// 另一种层级：职位对象埋在更深的地方，且字段名是另一种写法
export const detailResponseNested = {
  code: 0,
  zpData: {
    data: {
      job: {
        encryptJobId: BOSS_PAGE_JOB_ID,
        jobName: '资深后端开发工程师',
        salaryDesc: '35-60K·15薪',
        jobDescription: '岗位职责：负责核心交易链路的架构设计与开发。',
        jobExperience: '5-10年',
        jobDegree: '本科',
        cityName: '深圳',
        areaDistrict: '南山区',
        brandName: '某某科技有限公司',
      },
    },
  },
};

// 不带职位 id 的详情响应：只有在响应 URL 自己带着页面职位 id 时才可信
export const detailResponseWithoutId = {
  code: 0,
  zpData: {
    jobInfo: {
      jobName: '资深后端开发工程师',
      salaryDesc: '35-60K·15薪',
      experienceName: '5-10年',
      degreeName: '本科',
      jobDescription: '岗位职责：负责核心交易链路的架构设计与开发，并推动工程效率改进。',
    },
  },
};

// 相似职位/推荐位：带的是别的职位 id，绝不能写进当前这条记录
export const relatedJobsResponse = {
  code: 0,
  zpData: {
    jobList: [
      {
        encryptJobId: 'ffff0000aaaa1111bbbb2222cccc3333',
        jobName: '推荐算法工程师',
        salaryDesc: '40-70K·16薪',
        jobDescription: '负责推荐系统召回与排序模型的迭代。',
        brandName: '某某智能科技',
        cityName: '北京',
        areaDistrict: '海淀区',
        jobExperience: '3-5年',
        jobDegree: '硕士',
      },
    ],
  },
};

// 搜索列表响应（当前版本不消费，仅用于确保不会被误当成详情数据）
export const searchListResponse = {
  code: 0,
  zpData: {
    jobList: [
      {
        encryptJobId: BOSS_PAGE_JOB_ID,
        jobName: '资深后端开发工程师',
        salaryDesc: '35-60K·15薪',
        brandName: '某某科技有限公司',
        cityName: '深圳',
        areaDistrict: '南山区',
        jobExperience: '5-10年',
        jobDegree: '本科',
        skills: ['Java'],
        welfareList: ['五险一金'],
      },
    ],
  },
};
