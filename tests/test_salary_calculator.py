"""中国口径到手工资测算的单元测试（M10）。

覆盖：五险一金基数裁剪、累计预扣逐月表、跨档边界、年终奖两法、
专项附加扣除、社保数据过期提示、offer 对比。
"""

import json

import pytest

from app.salary import (
    BASIC_DEDUCTION_PER_MONTH,
    IIT_BRACKETS,
    SalaryDataError,
    available_cities,
    calc_income_tax_schedule,
    calc_social_insurance,
    calc_year_end_bonus,
    calculate_take_home,
    compare_offers,
    is_stale,
    load_city,
    progressive_tax,
)


def _write_city(tmp_path, code, payload):
    path = tmp_path / f"{code}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return tmp_path


def test_shanghai_social_insurance_rates():
    shanghai = load_city("shanghai")
    insurance = calc_social_insurance(30000, shanghai, housing_fund_rate=0.07)
    employee = insurance["employee"]
    assert employee["pension"] == 2400        # 8%
    assert employee["medical"] == 600         # 2%
    assert employee["unemployment"] == 150    # 0.5%
    assert employee["housing_fund"] == 2100   # 7%
    assert employee["total"] == 5250
    assert insurance["base_clamped"] is False


def test_base_is_clamped_to_city_floor_and_reported():
    shanghai = load_city("shanghai")
    insurance = calc_social_insurance(3000, shanghai)
    assert insurance["social_insurance_base"] == shanghai["social_insurance_base_min"]
    assert insurance["base_clamped"] is True


def test_base_is_clamped_to_city_ceiling():
    shanghai = load_city("shanghai")
    insurance = calc_social_insurance(100000, shanghai)
    assert insurance["social_insurance_base"] == shanghai["social_insurance_base_max"]


def test_housing_fund_rate_is_clamped_to_city_range():
    shanghai = load_city("shanghai")
    # 上海公积金个人比例为 5%–7%，传入 12% 时应被裁剪到上限。
    insurance = calc_social_insurance(30000, shanghai, housing_fund_rate=0.12)
    assert insurance["housing_fund_rate"] == pytest.approx(0.07)
    assert insurance["employee"]["housing_fund"] == 2100


def test_unknown_city_raises():
    with pytest.raises(SalaryDataError):
        load_city("atlantis")


def test_progressive_tax_bracket_boundaries():
    # 恰好等于档位与超过一分钱的税额必须连续。
    assert progressive_tax(36000, IIT_BRACKETS)[0] == 1080
    assert progressive_tax(36000.01, IIT_BRACKETS)[0] == pytest.approx(1080.001, abs=0.01)
    assert progressive_tax(0, IIT_BRACKETS)[0] == 0
    for ceiling, _rate, _quick in IIT_BRACKETS[:-1]:
        at_ceiling = progressive_tax(ceiling, IIT_BRACKETS)[0]
        over_ceiling = progressive_tax(ceiling + 0.01, IIT_BRACKETS)[0]
        assert over_ceiling >= at_ceiling


def test_cumulative_withholding_schedule_for_shanghai_30000():
    """上海月薪 30000、公积金 7%、无专项附加扣除的逐月预扣表。

    每月应纳税所得额 = 30000 − 5000 − 5250 = 19750 元。
    """
    schedule = calc_income_tax_schedule(30000, 5250)
    assert [row["tax"] for row in schedule][:3] == [592.5, 837.5, 1975.0]
    taxes = [row["tax"] for row in schedule]
    assert all(row["tax"] >= 0 for row in schedule)
    # 累计预扣导致的「前低后高」：后半年每期税额不低于前半年。
    assert min(taxes[6:]) >= max(taxes[:6])
    # 逐月累计税额 == 全年应纳税额（误差 0）。
    assert round(sum(taxes), 2) == 30480.0
    # 年末累计预扣的应税所得额与全年口径一致。
    assert schedule[-1]["taxable"] == pytest.approx(237000.0)


def test_cumulative_schedule_includes_extra_months_in_december():
    schedule = calc_income_tax_schedule(30000, 5250, months_per_year=14)
    assert schedule[11]["gross"] == 90000  # 12 月发放 3 个月工资
    assert sum(row["gross"] for row in schedule) == 420000
    assert schedule[11]["tax"] > schedule[10]["tax"]


def test_special_additional_deduction_reduces_tax():
    without = calc_income_tax_schedule(30000, 5250)
    with_deduction = calc_income_tax_schedule(30000, 5250, special_additional_deduction=3000)
    assert sum(row["tax"] for row in with_deduction) < sum(row["tax"] for row in without)


def test_year_end_bonus_separate_vs_combined():
    result = calc_year_end_bonus(100000, annual_taxable_without_bonus=237000)
    assert result["separate"]["tax"] == 9790      # 100000 ÷ 12 → 10% 档，速算扣除 210
    assert result["separate"]["net"] == 90210
    assert result["combined"]["tax"] == 21850     # 并档后 25% − 31920，减去原税额 30480
    assert result["best"] == "separate"
    assert result["saving"] == 12060


def test_year_end_bonus_zero_is_a_no_op():
    result = calc_year_end_bonus(0, annual_taxable_without_bonus=100000)
    assert result["best"] == "separate"
    assert result["separate"]["tax"] == 0
    assert result["saving"] == 0


def test_calculate_take_home_full_result():
    result = calculate_take_home(
        monthly_salary=30000, city_code="shanghai",
        months_per_year=13, housing_fund_rate=0.07, year_end_bonus=100000,
    )
    summary = result["summary"]
    assert result["input"]["months_per_year"] == 13
    assert summary["annual_salary"] == 390000
    assert summary["first_month_net"] == 30000 - 5250 - 592.5
    assert summary["annual_social_insurance"] == 63000
    assert summary["total_package"] == 490000
    assert summary["employer_cost"] > summary["total_package"]
    assert result["year_end_bonus"]["best"] == "separate"
    assert result["city"]["city_name"] == "上海"
    assert result["city"]["stale"] is False


def test_calculate_take_home_rejects_negative_salary():
    with pytest.raises(SalaryDataError):
        calculate_take_home(monthly_salary=-1)


def test_stale_data_detection(tmp_path):
    payload = {
        "city_code": "oldtown", "city_name": "老城",
        "effective_year": 2019, "updated_at": "2019-01-01",
        "social_insurance_base_min": 1000, "social_insurance_base_max": 5000,
        "housing_fund_base_min": 1000, "housing_fund_base_max": 5000,
        "housing_fund_rate_min": 0.05, "housing_fund_rate_max": 0.12,
        "rates": {"pension": {"employee": 0.08, "employer": 0.16}},
    }
    _write_city(tmp_path, "oldtown", payload)
    assert is_stale(payload) is True
    cities = available_cities(tmp_path)
    assert cities[0]["city_code"] == "oldtown"
    assert cities[0]["stale"] is True
    # 过期数据仍然可以测算，只是界面需要提示核对。
    result = calculate_take_home(monthly_salary=10000, city_code="oldtown", root=tmp_path)
    assert result["city"]["stale"] is True


def test_available_cities_ships_three_demo_cities():
    codes = {city["city_code"] for city in available_cities()}
    assert {"shanghai", "beijing", "hangzhou"} <= codes
    for city in available_cities():
        assert city["effective_year"]
        assert city["source_note"]


def test_compare_offers_ranks_by_total_package():
    offers = [
        {"id": 1, "title": "A", "monthly_salary": 35000, "months_per_year": 14, "city_code": "shanghai"},
        {"id": 2, "title": "B", "monthly_salary": 40000, "months_per_year": 13, "city_code": "beijing"},
    ]
    comparison = compare_offers(offers)
    assert comparison[0]["total_package"] >= comparison[1]["total_package"]
    assert comparison[0]["vs_best"] == 0
    assert comparison[1]["vs_best"] <= 0
    for row in comparison:
        assert row["annual_net_income"] > 0
        assert row["housing_fund_annual"] > 0
        assert row["steady_month_net"] > 0


def test_compare_offers_empty_list():
    assert compare_offers([]) == []


def test_basic_deduction_constant_matches_policy():
    assert BASIC_DEDUCTION_PER_MONTH == 5000
