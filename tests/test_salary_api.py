"""到手工资测算接口的契约测试。"""

import pytest


@pytest.mark.asyncio
async def test_salary_cities_endpoint(client):
    resp = await client.get("/api/salary/cities")
    assert resp.status_code == 200
    cities = resp.json()["cities"]
    codes = {city["city_code"] for city in cities}
    assert {"shanghai", "beijing", "hangzhou"} <= codes
    shanghai = next(city for city in cities if city["city_code"] == "shanghai")
    assert shanghai["city_name"] == "上海"
    assert shanghai["effective_year"]
    assert shanghai["source_note"]
    assert shanghai["stale"] is False


@pytest.mark.asyncio
async def test_salary_calculate_endpoint(client):
    resp = await client.post("/api/salary/calculate", json={
        "monthly_salary": 30000,
        "city_code": "shanghai",
        "months_per_year": 13,
        "housing_fund_rate": 0.07,
        "year_end_bonus": 100000,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["schedule"]) == 12
    assert body["summary"]["annual_salary"] == 390000
    # 年薪 390000 − 60000 起征点 − 63000 五险一金 = 267000 → 20% − 16920。
    assert body["summary"]["annual_tax"] == 36480
    assert body["summary"]["total_package"] == 490000
    assert body["year_end_bonus"]["best"] == "separate"
    assert body["city"]["city_name"] == "上海"


@pytest.mark.asyncio
async def test_salary_calculate_rejects_unknown_city(client):
    resp = await client.post("/api/salary/calculate", json={
        "monthly_salary": 20000, "city_code": "atlantis",
    })
    assert resp.status_code == 400
    payload = resp.json()
    assert payload["code"] == "salary.invalid_input"
    assert "detail" in payload


@pytest.mark.asyncio
async def test_salary_compare_offers_endpoint(client):
    resp = await client.post("/api/salary/compare-offers", json={
        "offers": [
            {"monthly_salary": 35000, "months_per_year": 14, "city_code": "shanghai"},
            {"monthly_salary": 40000, "months_per_year": 13, "city_code": "beijing"},
        ],
    })
    assert resp.status_code == 200
    comparison = resp.json()["comparison"]
    assert comparison[0]["total_package"] >= comparison[1]["total_package"]
    assert comparison[0]["vs_best"] == 0
    assert comparison[0]["city_name"] in {"上海", "北京"}


@pytest.mark.asyncio
async def test_salary_compare_offers_requires_offers(client):
    resp = await client.post("/api/salary/compare-offers", json={"offers": []})
    assert resp.status_code == 400
    assert resp.json()["code"] == "salary.offers_required"
