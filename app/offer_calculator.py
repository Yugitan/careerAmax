"""Offer 对比：中国口径（CNY 月薪 + 薪数 + 年终奖 + 股权/签字费）。

金额均为人民币，按月薪口径；不做币种换算。到手金额复用 app.salary 的
五险一金与个税累计预扣测算。

数据库中的 offer 行沿用历史列名（base / bonus / equity / relocation），
此处统一按国内口径解释：

* ``base``       → 月薪（元）
* ``bonus``      → 年终奖（元）
* ``equity``     → 股权/期权折年（元）
* ``relocation`` → 签字费/补贴（元）

新字段 ``monthly_salary``、``months_per_year``、``city_code`` 等如存在则优先使用。
"""

from __future__ import annotations

from app.salary import calculate_take_home


def _num(value) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _first_present(offer: dict, *keys, default=0.0) -> float:
    for key in keys:
        if offer.get(key) not in (None, ""):
            return _num(offer[key])
    return default


def calculate_total_comp(offer: dict) -> dict:
    """测算单个 offer 的年总包与到手收入。"""
    monthly_salary = _first_present(offer, "monthly_salary", "base")
    months_per_year = int(_first_present(offer, "months_per_year", default=12) or 12)
    if months_per_year < 1:
        months_per_year = 12
    year_end_bonus = _first_present(offer, "year_end_bonus", "bonus")
    equity_annual = _first_present(offer, "equity_annual", "equity")
    sign_on_bonus = _first_present(offer, "sign_on_bonus")
    subsidy_annual = _first_present(offer, "subsidy_annual", "relocation")

    try:
        result = calculate_take_home(
            monthly_salary=monthly_salary,
            city_code=offer.get("city_code") or "shanghai",
            months_per_year=months_per_year,
            housing_fund_rate=offer.get("housing_fund_rate"),
            social_insurance_base=offer.get("social_insurance_base"),
            special_additional_deduction=offer.get("special_additional_deduction") or 0,
            year_end_bonus=year_end_bonus,
            equity_annual=equity_annual,
            sign_on_bonus=sign_on_bonus,
            subsidy_annual=subsidy_annual,
        )
    except ValueError:
        result = calculate_take_home(monthly_salary=0, city_code="shanghai", months_per_year=months_per_year)

    summary = result["summary"]
    annual_salary = summary["annual_salary"]
    total_cash = round(annual_salary + year_end_bonus + sign_on_bonus + subsidy_annual, 2)

    return {
        # 兼容比较表使用的历史字段名，含义已改为国内口径。
        "base": round(monthly_salary, 2),
        "bonus": round(year_end_bonus, 2),
        "equity": round(equity_annual, 2),
        "relocation": round(sign_on_bonus + subsidy_annual, 2),
        "total_cash": total_cash,
        "total_comp": summary["total_package"],
        # 国内口径新增字段。
        "monthly_salary": result["input"]["monthly_salary"],
        "months_per_year": months_per_year,
        "city_code": result["city"]["city_code"],
        "city_name": result["city"]["city_name"],
        "stale_social_insurance_data": result["city"]["stale"],
        "first_month_net": summary["first_month_net"],
        "steady_month_net": summary["steady_month_net"],
        "annual_social_insurance": summary["annual_social_insurance"],
        "annual_tax": summary["annual_tax"],
        "annual_net_income": summary["annual_net_income"],
        "housing_fund_annual": round(
            result["insurance"]["employee"]["housing_fund"] * 12, 2
        ),
        "employer_cost": summary["employer_cost"],
        "year_end_bonus_best": result["year_end_bonus"]["best"],
    }


def compare_offers(offers: list[dict]) -> list[dict]:
    """按年总包对比多个 offer，降序返回并给出与最优的差额。"""
    results = []
    for offer in offers:
        comp = calculate_total_comp(offer)
        results.append({
            "offer_id": offer.get("id"),
            "job_id": offer.get("job_id"),
            "title": offer.get("title", ""),
            "location": offer.get("location", ""),
            "notes": offer.get("notes", ""),
            **comp,
        })

    results.sort(key=lambda item: item["total_comp"], reverse=True)
    if results:
        best = results[0]["total_comp"]
        for item in results:
            item["vs_best"] = round(item["total_comp"] - best, 2)
    return results
