"""Offer 对比（中国口径）的边界测试。

口径：金额均为人民币月薪；年总包 = 月薪 × 薪数 + 年终奖 + 股权折年 + 签字费/补贴。
"""

from app.offer_calculator import calculate_total_comp, compare_offers


def test_zeros():
    result = calculate_total_comp({})
    assert result["base"] == 0
    assert result["total_comp"] == 0
    assert result["total_cash"] == 0
    assert result["annual_net_income"] == 0
    assert result["city_name"] == "上海"


def test_none_values():
    offer = {"base": None, "bonus": None, "equity": None, "months_per_year": None}
    result = calculate_total_comp(offer)
    assert result["base"] == 0
    assert result["bonus"] == 0
    assert result["total_comp"] == 0


def test_monthly_salary_takes_precedence_over_legacy_base():
    result = calculate_total_comp({"base": 10000, "monthly_salary": 30000})
    assert result["monthly_salary"] == 30000
    assert result["total_comp"] == 360000


def test_yearly_package_with_extra_months():
    result = calculate_total_comp({
        "base": 35000, "months_per_year": 14,
        "bonus": 20000, "equity": 50000, "relocation": 50000,
    })
    assert result["base"] == 35000
    assert result["months_per_year"] == 14
    assert result["total_comp"] == 35000 * 14 + 20000 + 50000 + 50000
    assert result["total_cash"] == 35000 * 14 + 20000 + 50000


def test_take_home_is_computed_for_the_city():
    result = calculate_total_comp({"base": 30000, "months_per_year": 13, "city_code": "beijing"})
    assert result["city_name"] == "北京"
    assert result["first_month_net"] > 0
    # 累计预扣使月度个税逐月升高，因此到手逐月略降。
    assert result["steady_month_net"] <= result["first_month_net"]
    assert result["steady_month_net"] > 0
    assert result["annual_social_insurance"] > 0
    assert result["housing_fund_annual"] > 0
    assert result["employer_cost"] > result["total_comp"] - result["equity"]


def test_unknown_city_falls_back_to_zero_instead_of_raising():
    result = calculate_total_comp({"base": 30000, "city_code": "atlantis"})
    assert result["total_comp"] == 0


def test_compare_offers_empty():
    assert compare_offers([]) == []


def test_compare_offers_single():
    result = compare_offers([{"id": 1, "base": 20000}])
    assert len(result) == 1
    assert result[0]["vs_best"] == 0


def test_compare_offers_sorts_by_total_package_descending():
    offers = [
        {"id": 1, "base": 20000, "months_per_year": 12},
        {"id": 2, "base": 20000, "months_per_year": 16},
        {"id": 3, "base": 22000, "months_per_year": 13},
    ]
    result = compare_offers(offers)
    assert [row["offer_id"] for row in result] == [2, 3, 1]


def test_compare_offers_vs_best_deltas():
    result = compare_offers([
        {"id": 1, "base": 20000, "months_per_year": 12},
        {"id": 2, "base": 10000, "months_per_year": 12},
    ])
    assert result[0]["vs_best"] == 0
    assert result[1]["vs_best"] == -120000


def test_compare_offers_preserves_metadata():
    result = compare_offers([
        {"id": 5, "job_id": 10, "base": 20000, "location": "上海", "notes": "团队不错"},
    ])
    assert result[0]["offer_id"] == 5
    assert result[0]["job_id"] == 10
    assert result[0]["location"] == "上海"
    assert result[0]["notes"] == "团队不错"


def test_compare_offers_includes_take_home_columns():
    result = compare_offers([{"id": 1, "base": 30000, "months_per_year": 13, "city_code": "hangzhou"}])
    row = result[0]
    assert row["city_name"] == "杭州"
    assert row["annual_net_income"] < row["total_comp"]
    assert row["steady_month_net"] > 0
    assert row["months_per_year"] == 13
