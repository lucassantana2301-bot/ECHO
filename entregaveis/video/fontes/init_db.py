# Creates a NEW, empty SQLite database for the film. Refuses to touch an existing file.
import os
import sys

from sqlalchemy import create_engine

target = sys.argv[1]
if os.path.exists(target):
    sys.exit(f"refusing to overwrite existing database: {target}")

from echo.core.db import Base
import echo.models  # noqa: F401  (registers the tables)

engine = create_engine(f"sqlite:///{target}")
Base.metadata.create_all(bind=engine)
engine.dispose()
print(f"created {target}")
