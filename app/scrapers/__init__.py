"""招聘源注册表。

中国版一期只有 BOSS 直聘（zhipin.com）一个平台，且**采集由浏览器扩展在用户
已登录的会话里完成**（PRD 决策 D1 / D8），服务端不再集中爬取。因此这里不再
注册任何服务端爬虫：`ALL_SCRAPERS` 保持为空。

`app/scrapers/base.py` 的契约（重试退避、按域限流、UA 轮换、`JobListing`
数据形状）保留下来，供扩展回传链路复用。

US job boards were removed as part of the China rewrite — see
`docs/plans/2026-09-10-china-subtraction-plan.md` §2.2. Extension-captured
listings enter through the extension bridge, not through this registry.
"""

from app.scrapers.base import BaseScraper, JobListing

# 服务端爬虫注册表：一期为空 —— 采集改由扩展在用户浏览时回传。
ALL_SCRAPERS: list[type[BaseScraper]] = []

__all__ = ["ALL_SCRAPERS", "BaseScraper", "JobListing"]
