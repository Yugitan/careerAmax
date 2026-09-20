from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    db_path: str = "data/jobfinder.db"
    host: str = "0.0.0.0"
    port: int = 8085
    resume_path: str = "data/resume.txt"

    model_config = {"env_prefix": "JOBFINDER_"}
