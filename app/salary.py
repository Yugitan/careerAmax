"""中国口径到手工资测算（CNY 月薪 + 五险一金 + 个税累计预扣）。

口径说明（细节见 docs/plans/2026-09-10-careerpulse-china-market-prd.md M10）：

* 金额一律为人民币，按月薪口径；不做任何币种换算。
* 缴费基数 = clamp(月薪, 城市下限, 城市上限)，公积金基数单独 clamp。
* 个税按居民个人工资薪金的累计预扣法逐月计算。
* 年终奖同时给出「单独计税」与「并入综合所得」两种结果并指出更省税的一种。
* 城市参数来自 app/data/social_insurance/*.json，带生效年份与来源说明。

数据为测算参考值，不构成税务或社保建议。
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data" / "social_insurance"

# 累计预扣预缴的七级超额累进预扣率（全年应纳税所得额）。
IIT_BRACKETS: list[tuple[float, float, float]] = [
    (36000, 0.03, 0),
    (144000, 0.10, 2520),
    (300000, 0.20, 16920),
    (420000, 0.25, 31920),
    (660000, 0.30, 52920),
    (960000, 0.35, 85920),
    (float("inf"), 0.45, 181920),
]

# 年终奖单独计税按月换算后的综合所得税率表。
BONUS_MONTHLY_BRACKETS: list[tuple[float, float, float]] = [
    (3000, 0.03, 0),
    (12000, 0.10, 210),
    (25000, 0.20, 1410),
    (35000, 0.25, 2660),
    (55000, 0.30, 4410),
    (80000, 0.35, 7160),
    (float("inf"), 0.45, 15160),
]

BASIC_DEDUCTION_PER_MONTH = 5000.0
MONTHS_PER_YEAR = 12
# 社保数据超过该月数未更新即在界面上提示核对。
STALE_AFTER_MONTHS = 18

# 专项附加扣除的可选项目（名称用于界面展示，金额由用户填写）。
SPECIAL_DEDUCTION_ITEMS: list[tuple[str, str]] = [
    ("child_education", "子女教育"),
    ("continuing_education", "继续教育"),
    ("housing_loan", "住房贷款利息"),
    ("housing_rent", "住房租金"),
    ("elderly_support", "赡养老人"),
    ("infant_care", "婴幼儿照护"),
    ("private_pension", "个人养老金"),
]


class SalaryDataError(ValueError):
    """城市社保参数缺失或格式错误。"""


def _migrated(root: Path | None = None) -> Path:
    return Path(root) if root is not None else DATA_DIR


def load_city(city_code: str, root: Path | None = None) -> dict:
    """读取单个城市的社保参数；未知城市抛出 SalaryDataError。"""
    if not city_code or not isinstance(city_code, str):
        raise SalaryDataError("city is required")
    path = _migrated(root) / f"{city_code}.json"
    if not path.is_file():
        raise SalaryDataError(f"unknown city: {city_code}")
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    for key in ("social_insurance_base_min", "social_insurance_base_max", "rates"):
        if key not in data:
            raise SalaryDataError(f"{city_code}.json missing {key}")
    return data


def _months_since(updated_at: str) -> int | None:
    try:
        updated = datetime.strptime(updated_at, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None
    today = date.today()
    return (today.year - updated.year) * 12 + (today.month - updated.month)


def is_stale(city: dict) -> bool:
    """社保数据是否已超过 18 个月未更新。"""
    age = _months_since(city.get("updated_at", ""))
    return age is not None and age > STALE_AFTER_MONTHS


def available_cities(root: Path | None = None) -> list[dict]:
    """返回全部城市参数摘要，供界面下拉框使用。"""
    cities = []
    for path in sorted(_migrated(root).glob("*.json")):
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        cities.append({
            "city_code": data.get("city_code", path.stem),
            "city_name": data.get("city_name", path.stem),
            "effective_year": data.get("effective_year"),
            "updated_at": data.get("updated_at", ""),
            "source_note": data.get("source_note", ""),
            "stale": is_stale(data),
            "social_insurance_base_min": data.get("social_insurance_base_min"),
            "social_insurance_base_max": data.get("social_insurance_base_max"),
            "housing_fund_base_min": data.get("housing_fund_base_min"),
            "housing_fund_base_max": data.get("housing_fund_base_max"),
            "housing_fund_rate_min": data.get("housing_fund_rate_min"),
            "housing_fund_rate_max": data.get("housing_fund_rate_max"),
            "housing_fund_rate_default": data.get("housing_fund_rate_default"),
            "rates": data.get("rates", {}),
        })
    return cities


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _round2(value: float) -> float:
    return round(value + 1e-9, 2)


def progressive_tax(taxable: float, brackets: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    """按超额累进税率表计算税额，返回 (税额, 税率, 速算扣除数)。"""
    if taxable <= 0:
        return 0.0, 0.0, 0.0
    for ceiling, rate, quick in brackets:
        if taxable <= ceiling:
            return _round2(taxable * rate - quick), rate, quick
    ceiling, rate, quick = brackets[-1]
    return _round2(taxable * rate - quick), rate, quick


def calc_social_insurance(
    monthly_salary: float,
    city: dict,
    housing_fund_rate: float | None = None,
    social_insurance_base: float | None = None,
    housing_fund_base: float | None = None,
) -> dict:
    """计算个人与单位每月承担的五险一金。"""
    rates = city.get("rates", {})
    if monthly_salary <= 0 and not social_insurance_base:
        # 没有收入就无从缴费：社保/公积金下限只适用于实际在职收入。
        zeros = {key: 0.0 for key in (
            "pension", "medical", "unemployment", "injury", "maternity", "housing_fund"
        )}
        default_rate = city.get("housing_fund_rate_default", city.get("housing_fund_rate_min", 0.05))
        return {
            "social_insurance_base": 0.0,
            "housing_fund_base": 0.0,
            "housing_fund_rate": round(float(housing_fund_rate or default_rate), 4),
            "employee": {**zeros, "total": 0.0},
            "employer": {**zeros, "total": 0.0},
            "base_clamped": False,
        }
    si_base = _clamp(
        social_insurance_base if social_insurance_base else monthly_salary,
        city["social_insurance_base_min"],
        city["social_insurance_base_max"],
    )
    fund_rate_min = city.get("housing_fund_rate_min", 0.05)
    fund_rate_max = city.get("housing_fund_rate_max", 0.12)
    rate = housing_fund_rate if housing_fund_rate else city.get("housing_fund_rate_default", fund_rate_min)
    fund_rate = _clamp(float(rate), fund_rate_min, fund_rate_max)
    fund_base = _clamp(
        housing_fund_base if housing_fund_base else monthly_salary,
        city.get("housing_fund_base_min", si_base),
        city.get("housing_fund_base_max", si_base),
    )

    employee: dict[str, float] = {}
    employer: dict[str, float] = {}
    for key in ("pension", "medical", "unemployment", "injury", "maternity"):
        item = rates.get(key, {})
        employee[key] = _round2(si_base * float(item.get("employee", 0)))
        employer[key] = _round2(si_base * float(item.get("employer", 0)))
    employee["housing_fund"] = _round2(fund_base * fund_rate)
    employer["housing_fund"] = _round2(fund_base * fund_rate)

    employee_total = _round2(sum(employee.values()))
    employer_total = _round2(sum(employer.values()))
    return {
        "social_insurance_base": _round2(si_base),
        "housing_fund_base": _round2(fund_base),
        "housing_fund_rate": round(fund_rate, 4),
        "employee": {**employee, "total": employee_total},
        "employer": {**employer, "total": employer_total},
        "base_clamped": _round2(si_base) != _round2(monthly_salary),
    }


def calc_income_tax_schedule(
    monthly_salary: float,
    monthly_social_insurance: float,
    months_per_year: int = 12,
    special_additional_deduction: float = 0.0,
) -> list[dict]:
    """按月计算累计预扣个税。

    多出的薪数（13/14 薪等）并入第 12 个月发放，因此第 12 个月的累计
    应纳税所得额会跳档，与实际情况一致。
    """
    extra_months = max(0, int(months_per_year) - MONTHS_PER_YEAR)
    schedule: list[dict] = []
    withheld = 0.0
    cumulative_income = 0.0
    cumulative_si = 0.0
    cumulative_special = 0.0

    for month in range(1, MONTHS_PER_YEAR + 1):
        income = monthly_salary * (1 + extra_months if month == MONTHS_PER_YEAR else 1)
        cumulative_income += income
        cumulative_si += monthly_social_insurance
        cumulative_special += special_additional_deduction

        taxable = (
            cumulative_income
            - BASIC_DEDUCTION_PER_MONTH * month
            - cumulative_si
            - cumulative_special
        )
        tax_total, rate, _quick = progressive_tax(taxable, IIT_BRACKETS)
        tax_this_month = _round2(max(0.0, tax_total - withheld))
        withheld = _round2(withheld + tax_this_month)

        schedule.append({
            "month": month,
            "gross": _round2(income),
            "social_insurance": _round2(monthly_social_insurance),
            "taxable": _round2(max(0.0, taxable)),
            "tax_rate": rate,
            "tax": tax_this_month,
            "net": _round2(income - monthly_social_insurance - tax_this_month),
        })
    return schedule


def calc_year_end_bonus(bonus: float, annual_taxable_without_bonus: float) -> dict:
    """年终奖单独计税 vs 并入综合所得，返回两种方案与更省税的一种。"""
    if bonus <= 0:
        return {
            "bonus": 0.0,
            "separate": {"tax": 0.0, "net": 0.0, "rate": 0.0},
            "combined": {"tax": 0.0, "net": 0.0},
            "best": "separate",
            "saving": 0.0,
        }

    monthly_equivalent = bonus / MONTHS_PER_YEAR
    for ceiling, rate, quick in BONUS_MONTHLY_BRACKETS:
        if monthly_equivalent <= ceiling:
            separate_tax = _round2(max(0.0, bonus * rate - quick))
            separate_rate = rate
            break

    tax_with_bonus, _, _ = progressive_tax(annual_taxable_without_bonus + bonus, IIT_BRACKETS)
    tax_without_bonus, _, _ = progressive_tax(annual_taxable_without_bonus, IIT_BRACKETS)
    combined_tax = _round2(max(0.0, tax_with_bonus - tax_without_bonus))

    best = "separate" if separate_tax <= combined_tax else "combined"
    saving = abs(separate_tax - combined_tax)
    return {
        "bonus": _round2(bonus),
        "separate": {"tax": separate_tax, "net": _round2(bonus - separate_tax), "rate": separate_rate},
        "combined": {"tax": combined_tax, "net": _round2(bonus - combined_tax)},
        "best": best,
        "saving": _round2(saving),
    }


def calculate_take_home(
    monthly_salary: float,
    city_code: str = "shanghai",
    months_per_year: int = 12,
    housing_fund_rate: float | None = None,
    social_insurance_base: float | None = None,
    housing_fund_base: float | None = None,
    special_additional_deduction: float = 0.0,
    year_end_bonus: float = 0.0,
    equity_annual: float = 0.0,
    sign_on_bonus: float = 0.0,
    subsidy_annual: float = 0.0,
    root: Path | None = None,
) -> dict:
    """完整测算了到手工资。

    Returns a dict with the per-month schedule, annual totals, the year-end
    bonus comparison and the city data provenance.
    """
    try:
        salary = float(monthly_salary)
    except (TypeError, ValueError):
        raise SalaryDataError("monthly_salary must be a number")
    if salary < 0:
        raise SalaryDataError("monthly_salary must not be negative")

    city = load_city(city_code, root)
    months = int(months_per_year or MONTHS_PER_YEAR)
    if months < 1 or months > 24:
        raise SalaryDataError("months_per_year out of range")

    insurance = calc_social_insurance(
        salary, city,
        housing_fund_rate=housing_fund_rate,
        social_insurance_base=social_insurance_base,
        housing_fund_base=housing_fund_base,
    )
    monthly_si = insurance["employee"]["total"]
    schedule = calc_income_tax_schedule(
        salary, monthly_si,
        months_per_year=months,
        special_additional_deduction=special_additional_deduction,
    )

    annual_salary = _round2(salary * months)
    annual_si = _round2(monthly_si * MONTHS_PER_YEAR)
    annual_special = _round2(special_additional_deduction * MONTHS_PER_YEAR)
    annual_tax = _round2(sum(row["tax"] for row in schedule))
    annual_net_salary = _round2(sum(row["net"] for row in schedule))
    annual_taxable = max(0.0, annual_salary - BASIC_DEDUCTION_PER_MONTH * MONTHS_PER_YEAR - annual_si - annual_special)

    bonus = calc_year_end_bonus(float(year_end_bonus or 0), annual_taxable)
    bonus_net = bonus["separate"]["net"] if bonus["best"] == "separate" else bonus["combined"]["net"]

    equity = float(equity_annual or 0)
    sign_on = float(sign_on_bonus or 0)
    subsidy = float(subsidy_annual or 0)
    total_package = _round2(annual_salary + float(year_end_bonus or 0) + equity + sign_on + subsidy)
    annual_net = _round2(annual_net_salary + bonus_net + equity + sign_on + subsidy)
    employer_cost = _round2(annual_salary + insurance["employer"]["total"] * MONTHS_PER_YEAR)

    first = schedule[0]
    steady = schedule[10] if len(schedule) >= MONTHS_PER_YEAR else schedule[-1]
    return {
        "city": {
            "city_code": city.get("city_code", city_code),
            "city_name": city.get("city_name", city_code),
            "effective_year": city.get("effective_year"),
            "updated_at": city.get("updated_at", ""),
            "source_note": city.get("source_note", ""),
            "stale": is_stale(city),
        },
        "input": {
            "monthly_salary": _round2(salary),
            "months_per_year": months,
            "housing_fund_rate": insurance["housing_fund_rate"],
            "special_additional_deduction": _round2(float(special_additional_deduction or 0)),
            "year_end_bonus": _round2(float(year_end_bonus or 0)),
            "equity_annual": _round2(equity),
            "sign_on_bonus": _round2(sign_on),
            "subsidy_annual": _round2(subsidy),
        },
        "insurance": insurance,
        "schedule": schedule,
        "summary": {
            "monthly_gross": _round2(salary),
            "first_month_net": first["net"],
            "steady_month_net": steady["net"],
            "annual_salary": annual_salary,
            "annual_social_insurance": annual_si,
            "annual_tax": annual_tax,
            "annual_net_salary": annual_net_salary,
            "annual_net_income": annual_net,
            "total_package": total_package,
            "employer_cost": employer_cost,
            "effective_tax_rate": round(annual_tax / annual_salary, 4) if annual_salary else 0.0,
        },
        "year_end_bonus": bonus,
    }


def compare_offers(offers: list[dict], root: Path | None = None) -> list[dict]:
    """按年总包与年度到手对比多个 offer，降序排列。"""
    results = []
    for offer in offers:
        calculated = calculate_take_home(
            monthly_salary=offer.get("monthly_salary") or offer.get("base") or 0,
            city_code=offer.get("city_code") or "shanghai",
            months_per_year=offer.get("months_per_year") or 12,
            housing_fund_rate=offer.get("housing_fund_rate"),
            social_insurance_base=offer.get("social_insurance_base"),
            housing_fund_base=offer.get("housing_fund_base"),
            special_additional_deduction=offer.get("special_additional_deduction") or 0,
            year_end_bonus=offer.get("year_end_bonus") or 0,
            equity_annual=offer.get("equity_annual") or 0,
            sign_on_bonus=offer.get("sign_on_bonus") or 0,
            subsidy_annual=offer.get("subsidy_annual") or 0,
            root=root,
        )
        summary = calculated["summary"]
        results.append({
            "offer_id": offer.get("id"),
            "job_id": offer.get("job_id"),
            "title": offer.get("title", ""),
            "location": offer.get("location", ""),
            "notes": offer.get("notes", ""),
            "city_name": calculated["city"]["city_name"],
            "monthly_salary": calculated["input"]["monthly_salary"],
            "months_per_year": calculated["input"]["months_per_year"],
            "first_month_net": summary["first_month_net"],
            "steady_month_net": summary["steady_month_net"],
            "annual_net_income": summary["annual_net_income"],
            "total_package": summary["total_package"],
            "employer_cost": summary["employer_cost"],
            "housing_fund_annual": _round2(
                calculated["insurance"]["employee"]["housing_fund"] * MONTHS_PER_YEAR
            ),
            "year_end_bonus_net": calculated["year_end_bonus"]["separate"]["net"]
            if calculated["year_end_bonus"]["best"] == "separate"
            else calculated["year_end_bonus"]["combined"]["net"],
        })

    results.sort(key=lambda item: item["total_package"], reverse=True)
    if results:
        best = results[0]["total_package"]
        for item in results:
            item["vs_best"] = _round2(item["total_package"] - best)
    return results
