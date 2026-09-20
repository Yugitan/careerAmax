"""到手工资测算接口（中国口径：CNY 月薪 + 五险一金 + 个税累计预扣）。"""

from fastapi import APIRouter, Request

from app.errors import AppError
from app.salary import SalaryDataError, available_cities, calculate_take_home, compare_offers

router = APIRouter(prefix="/api")


@router.get("/salary/cities")
async def list_salary_cities():
    return {"cities": available_cities()}


@router.post("/salary/calculate")
async def calculate_salary(request: Request):
    body = await request.json()
    try:
        result = calculate_take_home(
            monthly_salary=body.get("monthly_salary"),
            city_code=body.get("city_code") or "shanghai",
            months_per_year=body.get("months_per_year") or 12,
            housing_fund_rate=body.get("housing_fund_rate"),
            social_insurance_base=body.get("social_insurance_base"),
            housing_fund_base=body.get("housing_fund_base"),
            special_additional_deduction=body.get("special_additional_deduction") or 0,
            year_end_bonus=body.get("year_end_bonus") or 0,
            equity_annual=body.get("equity_annual") or 0,
            sign_on_bonus=body.get("sign_on_bonus") or 0,
            subsidy_annual=body.get("subsidy_annual") or 0,
        )
    except SalaryDataError as err:
        raise AppError("salary.invalid_input", status_code=400, params={"reason": str(err)},
                       detail=str(err))
    return result


@router.post("/salary/compare-offers")
async def compare_salary_offers(request: Request):
    body = await request.json()
    offers = body.get("offers")
    if not isinstance(offers, list) or not offers:
        raise AppError("salary.offers_required", status_code=400)
    try:
        comparison = compare_offers(offers)
    except SalaryDataError as err:
        raise AppError("salary.invalid_input", status_code=400, params={"reason": str(err)},
                       detail=str(err))
    return {"comparison": comparison}
