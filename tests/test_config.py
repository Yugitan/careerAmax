from app.config import Settings

def test_settings_defaults():
    s = Settings(anthropic_api_key="test-key")
    assert s.db_path == "data/jobfinder.db"
    assert s.host == "0.0.0.0"
    assert s.port == 8085
    assert s.resume_path == "data/resume.txt"
    assert s.anthropic_api_key == "test-key"

def test_settings_custom():
    s = Settings(anthropic_api_key="k", port=9000, db_path="data/other.db")
    assert s.port == 9000
    assert s.db_path == "data/other.db"
